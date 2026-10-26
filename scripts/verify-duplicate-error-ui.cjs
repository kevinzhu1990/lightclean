// Exercise the real React page in Electron. Only the native IPC boundary is a
// fixture: no real file is scanned or deleted by this UI regression check.
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const { strict: assert } = require('node:assert')
const { mkdirSync, mkdtempSync, writeFileSync, readdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const project = resolve(__dirname, '..')
const output = process.env.LIGHTCLEAN_VERIFY_OUTPUT
  || resolve(project, '..', 'delete-fix-verification-2026-10-26')
const profile = mkdtempSync(join(tmpdir(), 'lightclean-error-ui-test-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {}) // The runner, not a fixture window, owns exit.
mkdirSync(output, { recursive: true })

const pause = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(win, expression) {
  const deadline = Date.now() + 10_000
  do {
    const result = await win.webContents.executeJavaScript(expression)
    if (result) return result
    await pause(50)
  } while (Date.now() < deadline)
  throw new Error(`UI condition timed out: ${expression}`)
}

async function run() {
  await build({
    stdin: {
      resolveDir: project,
      loader: 'tsx',
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { MemoryRouter } from 'react-router-dom'
        import { Toaster } from 'sonner'
        import i18n from 'i18next'
        import { initReactI18next } from 'react-i18next'
        import zh from './src/renderer/src/locales/zh-CN/duplicates.json'
        import { DuplicateFinderPage } from './src/renderer/src/pages/DuplicateFinderPage'
        import { useDuplicateStore } from './src/renderer/src/stores/duplicate-store'
        i18n.use(initReactI18next).init({ lng: 'zh-CN', fallbackLng: 'zh-CN',
          resources: { 'zh-CN': { duplicates: zh, common: { cancel: '取消', confirm: '确认' } } },
          interpolation: { escapeValue: false } })
        const store = useDuplicateStore.getState()
        const directory = 'C:\\\\lightclean-ui-test'
        store.setDirectory(directory)
        store.setResult({ groups: window.fixtureGroups || [{ hash: 'fixture', fullHash: 'fixture', fileSize: 8,
          files: [
            { path: directory + '\\\\original.txt', size: 8, lastModified: 1 },
            { path: directory + '\\\\longer-copy.txt', size: 8, lastModified: 1 }
          ], reclaimableSpace: 8 }], totalDuplicates: 1, totalReclaimable: 8,
          totalFilesScanned: 2, duration: 1, cancelled: false })
        store.selectAllDuplicates()
        store.setStatus('complete')
        window.fixtureState = () => ({ status: useDuplicateStore.getState().status,
          selected: useDuplicateStore.getState().selectedPaths.size,
          groups: useDuplicateStore.getState().result.groups.length })
        window.fixtureDetails = () => {
          const state = useDuplicateStore.getState()
          return { selectedPaths: [...state.selectedPaths],
            remainingPaths: state.result.groups.flatMap(group => group.files.map(file => file.path)),
            deleteResult: state.deleteResult }
        }
        createRoot(document.getElementById('root')).render(<MemoryRouter>
          <DuplicateFinderPage /><Toaster duration={60000} />
        </MemoryRouter>)
      `,
    },
    tsconfig: join(project, 'tsconfig.web.json'),
    outfile: join(output, 'duplicate-error-ui.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    logLevel: 'warning',
  })
  const cssDirectory = join(project, 'out', 'renderer', 'assets')
  const css = readdirSync(cssDirectory).find((file) => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build first so this check uses production theme CSS.')
  const cssUrl = pathToFileURL(join(cssDirectory, css)).href
  writeFileSync(join(output, 'duplicate-error-ui.html'),
    `<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="${cssUrl}">`
    + '<body style="background:var(--page-bg);color:var(--text-primary);font-family:system-ui">'
    + '<div id="root"></div><script src="duplicate-error-ui.js"></script></body></html>')

  const cases = [
    { name: 'license', error: '离线授权已超过14天，请联网刷新授权后继续使用。请前往“授权与套餐”页面刷新授权或输入有效兑换码后重试。',
      expected: '离线授权已超过14天', licenseLink: true },
    { name: 'service', error: "Error invoking remote method 'duplicates:delete': Error: No handler registered for 'duplicates:delete'",
      expected: '完全退出轻净后重新打开', licenseLink: false },
  ]
  for (const fixture of cases.flatMap((item) => ['dark', 'light'].map((theme) => ({ ...item, theme })))) {
    const label = `${fixture.name}-${fixture.theme}`
    const preload = join(output, `duplicate-error-${label}-preload.cjs`)
    writeFileSync(preload, `const { contextBridge } = require('electron');
      contextBridge.exposeInMainWorld('lightclean', {
        duplicatesDelete: async () => { throw new Error(${JSON.stringify(fixture.error)}) },
        onDuplicatesProgress: () => () => {}
      });`)
    const win = new BrowserWindow({ show: false, width: 1280, height: 900,
      webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    try {
      await win.loadFile(join(output, 'duplicate-error-ui.html'))
      await win.webContents.executeJavaScript(`document.documentElement.className = ${JSON.stringify(fixture.theme)}`)
      await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => /^删除 1 个文件/.test(b.textContent))`)
      await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => /^删除 1 个文件/.test(b.textContent)).click()`)
      await waitFor(win, `document.querySelector('[role="dialog"]') !== null`)
      await win.webContents.executeJavaScript(`Array.from(document.querySelector('[role="dialog"]').querySelectorAll('button')).find(b => b.textContent.trim() === '回收站').click()`)
      await waitFor(win, `document.querySelector('[data-sonner-toast]') !== null`)
      const actual = await win.webContents.executeJavaScript(`({ text: document.body.innerText,
        alert: document.querySelector('[role="alert"]')?.textContent || '',
        licenseLink: document.querySelector('[role="alert"] a[href="/license"]') !== null,
        state: window.fixtureState(),
        contrast: (() => {
          const alert = document.querySelector('[role="alert"]');
          if (!alert) return 0;
          const channels = (color) => color.match(/[\\d.]+/g).map(Number);
          const base = channels(getComputedStyle(document.body).backgroundColor);
          const overlay = channels(getComputedStyle(alert).backgroundColor);
          const alpha = overlay[3] ?? 1;
          const bg = base.slice(0, 3).map((c, i) => c * (1 - alpha) + overlay[i] * alpha);
          const fg = channels(getComputedStyle(alert.querySelector('p')).color).slice(0, 3);
          const luminance = (rgb) => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
            .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          const a = luminance(bg), b = luminance(fg);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        })() })`)
      assert.ok(actual.text.includes(fixture.expected),
        `${fixture.name}: actionable cause was hidden. Page text: ${actual.text.slice(-1000)}`)
      assert.ok(actual.alert.includes(fixture.expected), `${fixture.name}: no persistent actionable error`)
      assert.equal(actual.licenseLink, fixture.licenseLink)
      assert.deepEqual(actual.state, { status: 'complete', selected: 1, groups: 1 })
      assert.ok(actual.contrast >= 4.5, `${label}: alert contrast ${actual.contrast} is below 4.5:1`)
      await win.webContents.executeJavaScript('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
      await pause(150) // Allow the hidden window's compositor to submit its new frame.
      const screenshot = await win.webContents.capturePage()
      writeFileSync(join(output, `duplicate-error-${label}.png`), screenshot.toPNG())
      console.log(`PASS ${label}: error visible, selection preserved, contrast ${actual.contrast.toFixed(2)}:1`)
    } finally {
      win.destroy()
    }
  }
  // These fixtures exercise the real response contract: failed includes safe
  // skips, with an explicit marker (or the older safety-prefixed reason).
  const pair = (hash, directory) => ({ hash, fullHash: hash, fileSize: 8,
    files: [{ path: directory + '\\original.txt', size: 8, lastModified: 1 },
      { path: directory + '\\longer-copy.txt', size: 8, lastModified: 1 }], reclaimableSpace: 8 })
  const protectedGroup = pair('protected', 'C:\\Users\\Fixture\\AppData\\Local\\OpenAI\\Codex')
  const permissionGroup = pair('permission', 'C:\\lightclean-ui-test\\locked')
  const deletedGroup = pair('deleted', 'C:\\lightclean-ui-test\\photos')
  const protectedPath = protectedGroup.files[1].path
  const permissionPath = permissionGroup.files[1].path
  const protectedError = { path: protectedPath, reason: 'Application runtime files are protected', code: 'protected' }
  const legacyProtectedError = { path: protectedPath, reason: '安全保护：Windows、程序安装目录和系统目录中的文件不能删除' }
  const permissionError = { path: permissionPath, reason: '文件被占用或没有删除权限（EPERM）' }
  const outcomes = [
    { name: 'protected-only', groups: [protectedGroup], selected: 1,
      response: { deleted: 0, failed: 1, protectedSkipped: 1, spaceRecovered: 0, errors: [protectedError] },
      want: { status: 'complete', selected: 0, groups: 0 }, trueFailure: false },
    { name: 'legacy-protected-only', groups: [protectedGroup], selected: 1,
      response: { deleted: 0, failed: 1, protectedSkipped: 1, spaceRecovered: 0, errors: [legacyProtectedError] },
      want: { status: 'complete', selected: 0, groups: 0 }, trueFailure: false },
    { name: 'mixed', groups: [protectedGroup, permissionGroup, deletedGroup], selected: 3,
      response: { deleted: 1, failed: 2, protectedSkipped: 1, spaceRecovered: 8, errors: [protectedError, permissionError] },
      want: { status: 'complete', selected: 1, groups: 1 }, trueFailure: true },
  ]
  for (const fixture of outcomes.flatMap(item => ['dark', 'light'].map(theme => ({ ...item, theme })))) {
    const label = `${fixture.name}-${fixture.theme}`
    const preload = join(output, `duplicate-error-${label}-preload.cjs`)
    writeFileSync(preload, `const { contextBridge } = require('electron');
      contextBridge.exposeInMainWorld('fixtureGroups', ${JSON.stringify(fixture.groups)});
      contextBridge.exposeInMainWorld('lightclean', {
        duplicatesDelete: async () => (${JSON.stringify(fixture.response)}),
        onDuplicatesProgress: () => () => {}
      });`)
    const win = new BrowserWindow({ show: false, width: 1280, height: 900,
      webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    try {
      await win.loadFile(join(output, 'duplicate-error-ui.html'))
      await win.webContents.executeJavaScript(`document.documentElement.className = ${JSON.stringify(fixture.theme)}`)
      await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => /^删除 ${fixture.selected} 个文件/.test(b.textContent))`)
      await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => /^删除 ${fixture.selected} 个文件/.test(b.textContent)).click()`)
      await waitFor(win, `document.querySelector('[role="dialog"]') !== null`)
      await win.webContents.executeJavaScript(`Array.from(document.querySelector('[role="dialog"]').querySelectorAll('button')).find(b => b.textContent.trim() === '回收站').click()`)
      await waitFor(win, `window.fixtureDetails().deleteResult !== null && window.fixtureState().status === 'complete'`)
      const actual = await win.webContents.executeJavaScript(`({ text: document.body.innerText,
        info: document.querySelector('[data-delete-outcome="protected"]')?.textContent || '',
        failure: document.querySelector('[data-delete-outcome="failed"]')?.textContent || '',
        errorToasts: Array.from(document.querySelectorAll('[data-sonner-toast][data-type="error"]')).map(el => el.textContent),
        successToasts: Array.from(document.querySelectorAll('[data-sonner-toast][data-type="success"]')).map(el => el.textContent),
        infoToasts: Array.from(document.querySelectorAll('[data-sonner-toast][data-type="info"]')).map(el => el.textContent),
        state: window.fixtureState(), details: window.fixtureDetails(),
        contrast: Array.from(document.querySelectorAll('[data-delete-outcome]')).map(banner => {
          const channels = color => color.match(/[\\d.]+/g).map(Number);
          const base = channels(getComputedStyle(document.body).backgroundColor);
          const overlay = channels(getComputedStyle(banner).backgroundColor);
          const alpha = overlay[3] ?? 1;
          const bg = base.slice(0, 3).map((c, i) => c * (1 - alpha) + overlay[i] * alpha);
          const fg = channels(getComputedStyle(banner.querySelector('p')).color).slice(0, 3);
          const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
            .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          const a = luminance(bg), b = luminance(fg);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        }) })`)
      assert.ok(actual.info.includes('已安全跳过 1 个受保护文件'),
        `${label}: protected skip was not persistent informational feedback. Page: ${actual.text.slice(-1200)}`)
      assert.deepEqual(actual.state, fixture.want, `${label}: protected paths were not removed safely`)
      assert.ok(!actual.details.remainingPaths.includes(protectedPath), `${label}: protected path can still be selected`)
      assert.equal(actual.details.deleteResult.deleted, fixture.response.deleted, `${label}: safe skips counted as deleted`)
      assert.equal(actual.details.deleteResult.spaceRecovered, fixture.response.spaceRecovered, `${label}: safe skips counted as recovered space`)
      assert.equal(actual.successToasts.length, fixture.trueFailure ? 1 : 0, `${label}: false success toast`)
      assert.equal(actual.errorToasts.length, fixture.trueFailure ? 1 : 0, `${label}: safe skip became an error toast`)
      assert.equal(actual.infoToasts.length, 1, `${label}: safe skip did not produce informational feedback`)
      if (fixture.trueFailure) {
        assert.ok(actual.failure.includes('有 1 个文件无法删除'), `${label}: true failure count includes safe skips`)
        assert.ok(actual.failure.includes('EPERM'), `${label}: actual permission failure was hidden`)
        assert.ok(actual.failure.includes('关闭占用文件的程序') && actual.failure.includes('文件夹权限'),
          `${label}: permission guidance is not actionable`)
        assert.ok(!actual.failure.includes(protectedPath), `${label}: safety skip leaked into the failure list`)
        assert.deepEqual(actual.details.selectedPaths, [permissionPath], `${label}: genuine failed selection was lost`)
        assert.ok(actual.successToasts[0].includes('已将 1 个文件（8 B）'), `${label}: success count or byte count is inflated`)
      } else {
        assert.equal(actual.failure, '', `${label}: protected-only outcome rendered a red failure banner`)
        assert.ok(!actual.text.includes('无法删除'), `${label}: protected-only outcome claims inability to delete`)
      }
      assert.ok(!actual.text.includes('管理员') && !actual.text.includes('强制删除'), `${label}: unsafe escalation guidance`)
      assert.equal(actual.contrast.length, fixture.trueFailure ? 2 : 1)
      for (const contrast of actual.contrast) assert.ok(contrast >= 4.5, `${label}: outcome contrast ${contrast} below 4.5:1`)
      await win.webContents.executeJavaScript('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
      await pause(150)
      writeFileSync(join(output, `duplicate-error-${label}.png`), (await win.webContents.capturePage()).toPNG())
      console.log(`PASS ${label}: safe skip persisted, no false success, genuine failures separated, contrast ${actual.contrast.map(ratio => ratio.toFixed(2)).join('/')} :1`)
    } finally {
      win.destroy()
    }
  }
  console.log('PASS duplicate error UI regression checks (real Electron renderer)')
}

app.whenReady().then(run).then(() => app.exit(0)).catch((error) => {
  console.error(error)
  app.exit(1)
})

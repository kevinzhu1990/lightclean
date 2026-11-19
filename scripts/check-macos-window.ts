/** Isolated native-window smoke test. Never starts the cleaner or changes login items.
 * Build: npx esbuild scripts/check-macos-window.ts --bundle --platform=node --external:electron --outfile=.superpowers/macos-window-check.cjs
 * Run: node_modules/.bin/electron .superpowers/macos-window-check.cjs
 */
import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { getApplicationMenuTemplate, getWindowChromeOptions, restoreWindow } from '../src/main/services/window-chrome'
import { getSettings } from '../src/main/services/settings-store'
import { IPC } from '../src/shared/channels'

assert.equal(process.platform, 'darwin', 'This smoke test requires macOS')
const root = resolve(__dirname, '..')
const proof = join(root, '.superpowers', 'macos-window-proof')
mkdirSync(proof, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'lightclean-window-smoke-'))
app.setPath('userData', userData)
app.setName('LightClean macOS Window Test')
app.on('window-all-closed', () => {})
app.on('will-quit', () => console.log('Smoke app will quit'))
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 10000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`)
    await delay(50)
  }
}

app.whenReady().then(async () => {
  console.log('Smoke app ready')
  const settings = { ...getSettings(), language: 'zh-CN', autoUpdate: false }
  const requested = new Set<string>()
  // Fixture-only IPC: no production mutation/scan handlers are ever registered.
  for (const channel of new Set(Object.values(IPC))) {
    ipcMain.handle(channel, () => {
      requested.add(channel)
      switch (channel) {
        case IPC.PLATFORM_INFO: return { platform: 'darwin', features: {
          registry: false, debloater: false, drivers: false, restorePoint: false,
          bootTrace: false, gameMode: false, firewallAudit: false, contextMenu: false,
        } }
        case IPC.SETTINGS_GET: return settings
        case IPC.ONBOARDING_GET: return true
        case IPC.THREAT_MONITOR_GET_SNAPSHOT: return null
        case IPC.UPDATER_GET_STATUS: return { state: 'idle' }
        case IPC.ELEVATION_CHECK: return false
        case IPC.SOFTWARE_UPDATE_CHECK: return {
          apps: [], upToDate: [], packageManagerAvailable: false, packageManagerName: 'brew',
        }
        case IPC.DRIVER_UPDATE_SCAN: return { updates: [] }
        case IPC.GAME_MODE_STATUS: return { active: false, activatedAt: null }
        default: return []
      }
    })
  }
  const menu = Menu.buildFromTemplate(getApplicationMenuTemplate('darwin'))
  Menu.setApplicationMenu(menu)
  const win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 600,
    ...getWindowChromeOptions('darwin'), backgroundColor: '#09090b',
    webPreferences: { preload: join(root, 'out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Prevent any remote traffic from the renderer during this local UI test.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (event) => {
    console.log('Renderer console:', event.level, event.message)
    if (event.level === 'error') consoleErrors.push(event.message)
  })
  win.webContents.on('render-process-gone', (_event, details) => console.error('Renderer gone:', details.reason))
  await win.loadFile(join(root, 'out/renderer/index.html'), { hash: '/about' })
  console.log('Renderer loaded')
  win.show(); win.focus()
  await delay(500)
  console.log('Renderer body:', await win.webContents.executeJavaScript('document.body.innerText.slice(0, 500)'))
  console.log('Fixture calls:', [...requested])
  await until(async () => win.webContents.executeJavaScript('Boolean(document.querySelector("#main-content"))'), 'React app render')
  await delay(350)
  const dom = await win.webContents.executeJavaScript(`({
    controls: document.querySelectorAll('[aria-label="Window controls"]').length,
    logoTop: document.querySelector('img[alt="轻净 LightClean"]').getBoundingClientRect().top,
    platform: window.lightclean.platform,
    body: document.body.innerText,
  })`)
  console.log('UI inspected:', JSON.stringify({ platform: dom.platform, controls: dom.controls, logoTop: dom.logoTop }))
  assert.equal(dom.platform, 'darwin')
  assert.equal(dom.controls, 0)
  assert.ok(dom.logoTop >= 40, 'Sidebar logo must clear native traffic lights')
  assert.ok(!dom.body.includes('Something went wrong'))
  const skipLinkTop = await win.webContents.executeJavaScript(`(() => {
    const link = document.querySelector('.skip-nav'); link.focus();
    const top = link.getBoundingClientRect().top; link.blur(); return top;
  })()`)
  assert.ok(skipLinkTop >= 40, `Keyboard skip link overlaps native traffic lights: top=${skipLinkTop}`)
  assert.deepEqual(win.getWindowButtonPosition(), { x: 16, y: 12 })
  assert.ok(win.isFullScreenable())
  writeFileSync(join(proof, 'renderer.png'), (await win.webContents.capturePage()).toPNG())
  writeFileSync(join(proof, 'window-id.txt'), String(win.getMediaSourceId()))
  const sourceId = win.getMediaSourceId().split(':')[1]
  const screenshot = spawnSync('/usr/sbin/screencapture', ['-x', '-l', sourceId, join(proof, 'native-window.png')], { timeout: 4000 })
  console.log('Native screenshot status:', screenshot.status)
  win.minimize()
  await until(() => win.isMinimized(), 'native minimize')
  restoreWindow(win)
  await until(() => !win.isMinimized() && win.isVisible(), 'Dock restore path')
  win.setFullScreen(true)
  await until(() => win.isFullScreen(), 'native fullscreen')
  win.setFullScreen(false)
  await until(() => !win.isFullScreen(), 'leave native fullscreen')
  console.log('Minimize, restore and fullscreen checks complete')
  win.close()
  await until(() => win.isDestroyed(), 'native close')
  writeFileSync(join(proof, 'verification.json'), JSON.stringify({
    platform: dom.platform, chrome: getWindowChromeOptions('darwin'), htmlControls: dom.controls,
    logoTop: dom.logoTop, skipLinkTop, minimizedAndRestored: true, fullscreenRoundTrip: true, nativeClose: true,
    consoleErrors, ipcFixtures: [...requested], userData,
    note: 'Isolated UI test with fixture IPC. No cleanup, permissions, login items, update or installed-app changes.',
  }, null, 2))
  assert.deepEqual(consoleErrors, [], 'Renderer must not report errors')
  console.log(`macOS native window smoke PASS; evidence: ${proof}`)
  app.quit()
}).catch(error => {
  console.error(error)
  app.exit(1)
})

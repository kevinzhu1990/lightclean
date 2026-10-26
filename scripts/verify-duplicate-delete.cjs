/*
 * Opt-in real Electron / Windows Recycle Bin smoke test. It only creates and
 * deletes tiny fixtures with the lightclean-duplicate-recycle-test- prefix.
 * Recycled fixtures remain recoverable; this script never empties the bin.
 *
 * node scripts/verify-duplicate-delete.cjs --output-dir <absolute-artifact-dir>
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

const fixturePrefix = 'lightclean-duplicate-recycle-test-'

async function runElectronVerification() {
  const { app, ipcMain } = require('electron')
  const handlers = new Map()
  const originalHandle = ipcMain.handle
  const results = []
  const fixtureParent = process.env.LIGHTCLEAN_DUPLICATE_VERIFY_DIRECTORY
  let fixtureRoot = ''
  let cleanupError = null
  let fatalError = null

  try {
    await app.whenReady()
    // Register the production handlers with the real Electron shell, capturing
    // only the renderer boundary so no browser window or application UI opens.
    ipcMain.handle = (channel, handler) => { handlers.set(channel, handler) }
    require(process.env.LIGHTCLEAN_DUPLICATE_VERIFY_BUNDLE).registerDuplicateFinderIpc(() => null)
    ipcMain.handle = originalHandle

    // AppData/Temp is intentionally protected by production duplicate cleanup.
    // Put these disposable ordinary-file fixtures in the dedicated workspace.
    assert.ok(fixtureParent && path.isAbsolute(fixtureParent))
    fixtureRoot = await fs.mkdtemp(path.join(fixtureParent, fixturePrefix))
    const payload = 'Disposable LightClean Recycle Bin verification fixture.\n'
    const original = path.join(fixtureRoot, 'original-must-survive.txt')
    await fs.writeFile(original, payload)
    const deepDirectory = path.join(fixtureRoot, ...Array.from({ length: 5 }, (_, i) => `${i}-long-path-fixture-${'x'.repeat(28)}`))
    await fs.mkdir(deepDirectory, { recursive: true })
    const cases = [
      ['regular filename', path.join(fixtureRoot, 'disposable-copy.txt')],
      ['Chinese filename', path.join(fixtureRoot, '轻净回收验证-可恢复副本.txt')],
      ['long path', path.join(deepDirectory, 'disposable-long-copy.txt')],
    ]
    for (const [, file] of cases) await fs.writeFile(file, payload)
    const runtimeFile = path.join(fixtureRoot, 'codex.exe')
    const appDataDirectory = path.join(fixtureRoot, 'profile', 'AppData', 'Local', 'Vendor')
    await fs.mkdir(appDataDirectory, { recursive: true })
    const appDataFile = path.join(appDataDirectory, 'state.json')
    await Promise.all([runtimeFile, appDataFile].map((file) => fs.writeFile(file, payload)))

    const scan = await handlers.get('duplicates:scan')(null, { directory: fixtureRoot, minFileSize: 1 })
    assert.equal(scan.totalFilesScanned, 4)
    assert.equal(scan.groups.length, 1)
    assert.equal(scan.totalDuplicates, 3)

    for (const [label, file] of cases) {
      try {
        const result = await handlers.get('duplicates:delete')(null, [file], 'recycle')
        assert.equal(result.deleted, 1, JSON.stringify(result))
        assert.equal(result.failed, 0, JSON.stringify(result))
        await assert.rejects(fs.lstat(file), { code: 'ENOENT' })
        assert.equal(await fs.readFile(original, 'utf8'), payload)
        results.push({ label, path: file, pathLength: file.length, passed: true, result })
      } catch (error) {
        results.push({ label, path: file, pathLength: file.length, passed: false, error: String(error) })
      }
    }
    for (const [label, file] of [['runtime file protected', runtimeFile], ['application data protected', appDataFile]]) {
      try {
        const result = await handlers.get('duplicates:delete')(null, [file], 'permanent')
        assert.equal(result.deleted, 0)
        assert.equal(result.protectedSkipped, 1)
        assert.equal(result.errors[0].code, 'protected')
        assert.equal(await fs.readFile(file, 'utf8'), payload)
        assert.equal(await fs.readFile(original, 'utf8'), payload)
        results.push({ label, path: file, passed: true, result })
      } catch (error) {
        results.push({ label, path: file, passed: false, error: String(error) })
      }
    }
  } catch (error) {
    fatalError = String(error.stack || error)
  } finally {
    ipcMain.handle = originalHandle
    if (fixtureRoot && path.dirname(fixtureRoot) === fixtureParent && path.basename(fixtureRoot).startsWith(fixturePrefix)) {
      try {
        await fs.rm(fixtureRoot, { recursive: true, force: true })
      } catch (error) {
        cleanupError = String(error)
      }
    }
    const report = {
      platform: process.platform,
      electron: process.versions.electron,
      fixtureRoot,
      results,
      fatalError,
      cleanupError,
      recycleBin: 'Successful fixture files remain recoverable in Recycle Bin; the bin was not emptied.',
    }
    const output = process.env.LIGHTCLEAN_DUPLICATE_VERIFY_REPORT
    if (output) await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    app.exit(!fatalError && !cleanupError && results.length === 5 && results.every((result) => result.passed) ? 0 : 1)
  }
}

async function launchVerification() {
  const index = process.argv.indexOf('--output-dir')
  const outputDirectory = index >= 0 ? process.argv[index + 1] : ''
  if (!outputDirectory || !path.isAbsolute(outputDirectory) || path.resolve(outputDirectory) === path.parse(outputDirectory).root) {
    throw new Error('Pass --output-dir with an absolute, dedicated verification artifact directory.')
  }
  await fs.mkdir(outputDirectory, { recursive: true })
  const bundle = path.join(outputDirectory, 'duplicate-finder-verification.cjs')
  require('esbuild').buildSync({
    entryPoints: [path.join(__dirname, '../src/main/ipc/duplicate-finder.ipc.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: bundle,
  })
  const env = {
    ...process.env,
    LIGHTCLEAN_DUPLICATE_VERIFY_BUNDLE: bundle,
    LIGHTCLEAN_DUPLICATE_VERIFY_REPORT: path.join(outputDirectory, 'real-electron-recycle-report.json'),
    LIGHTCLEAN_DUPLICATE_VERIFY_DIRECTORY: path.resolve(outputDirectory),
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  })
  if (child.stdout) process.stdout.write(child.stdout)
  if (child.stderr) process.stderr.write(child.stderr)
  if (child.error) throw child.error
  process.exitCode = child.status === null ? 1 : child.status
}

if (process.versions.electron) {
  runElectronVerification().catch((error) => {
    console.error(error)
    require('electron').app.exit(1)
  })
} else {
  launchVerification().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

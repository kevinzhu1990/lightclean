import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { shell } from 'electron'
import { IPC } from '../../shared/channels'
import type { DuplicateDeleteResult, DuplicateScanResult } from '../../shared/types'
import { registerDuplicateFinderIpc } from './duplicate-finder.ipc'

// Keep the real filesystem, streams, hashes and safety policy. Only Electron's
// process boundary is mocked; real Recycle Bin checks live in the opt-in script.
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({
  BrowserWindow: {},
  dialog: {},
  shell: { trashItem: vi.fn() },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) },
}))

let fixtureRoot = ''
let scanRoot = ''
const content = 'LightClean disposable duplicate verification fixture\n'

async function scan(referenceDirectories: string[] = []): Promise<DuplicateScanResult> {
  return handlers.get(IPC.DUPLICATES_SCAN)!(null, {
    directory: scanRoot,
    minFileSize: 1,
    referenceDirectories,
  })
}

async function remove(paths: string[]): Promise<DuplicateDeleteResult> {
  return handlers.get(IPC.DUPLICATES_DELETE)!(null, paths, 'permanent')
}

beforeEach(async () => {
  vi.clearAllMocks()
  handlers.clear()
  registerDuplicateFinderIpc(() => null)
  // macOS puts its OS temporary directory under protected /var. Use a uniquely
  // named workspace fixture so the production scan safety policy stays real.
  fixtureRoot = await mkdtemp(join(process.cwd(), 'lightclean-duplicate-delete-test-'))
  scanRoot = join(fixtureRoot, 'scanned')
  await mkdir(scanRoot)
})

afterEach(async () => {
  // Never allow a failed setup to turn cleanup into a broad filesystem delete.
  if (fixtureRoot && dirname(fixtureRoot) === process.cwd() && basename(fixtureRoot).startsWith('lightclean-duplicate-delete-test-')) {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

it('permanently removes a real scanned duplicate and preserves the original bytes', async () => {
  const original = join(scanRoot, 'original.txt')
  const duplicate = join(scanRoot, '副本-可以删除.txt')
  await Promise.all([writeFile(original, content), writeFile(duplicate, content)])

  const scanned = await scan()
  expect(scanned.totalFilesScanned).toBe(2)
  expect(scanned.groups).toHaveLength(1)
  expect(scanned.totalDuplicates).toBe(1)
  expect(scanned.groups[0].files.map((file) => file.path)).toContain(duplicate)

  expect(await remove([duplicate])).toMatchObject({
    deleted: 1, failed: 0, protectedSkipped: 0, spaceRecovered: Buffer.byteLength(content), errors: [],
  })
  await expect(lstat(duplicate)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(original, 'utf8')).toBe(content)
  expect(shell.trashItem).not.toHaveBeenCalled()
})

it('keeps a real reference directory read-only while deleting a duplicate copy', async () => {
  const references = join(scanRoot, 'reference-originals')
  await mkdir(references)
  const original = join(references, 'original.txt')
  const duplicate = join(scanRoot, 'copy.txt')
  await Promise.all([writeFile(original, content), writeFile(duplicate, content)])
  const scanned = await scan([references])
  expect(scanned.groups[0].files.find((file) => file.path === original)?.isReference).toBe(true)

  const result = await remove([original, duplicate])
  expect(result).toMatchObject({ deleted: 1, failed: 1, protectedSkipped: 1 })
  expect(result.errors).toEqual([{ path: original, code: 'protected', reason: '安全保护：参考目录为只读，不能删除' }])
  expect(await readFile(original, 'utf8')).toBe(content)
  await expect(lstat(duplicate)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('continues deleting later real files after an earlier selected file disappears', async () => {
  const original = join(scanRoot, 'original.txt')
  const disappeared = join(scanRoot, 'disappeared-copy.txt')
  const duplicate = join(scanRoot, 'remaining-copy.txt')
  await Promise.all([original, disappeared, duplicate].map((file) => writeFile(file, content)))
  await scan()
  await rm(disappeared)

  const result = await remove([disappeared, duplicate])
  expect(result).toMatchObject({ deleted: 1, failed: 1, protectedSkipped: 0, spaceRecovered: Buffer.byteLength(content) })
  expect(result.errors).toEqual([{ path: disappeared, reason: '文件已不存在，请重新扫描。' }])
  expect(await readFile(original, 'utf8')).toBe(content)
  await expect(lstat(duplicate)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a real directory link that would escape the scanned filesystem boundary', async () => {
  const outside = join(fixtureRoot, 'outside-scan')
  await mkdir(outside)
  const original = join(outside, 'must-survive.txt')
  await writeFile(original, content)
  const link = join(scanRoot, 'outside-link')
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect((await scan()).totalFilesScanned).toBe(0)

  const selected = join(link, 'must-survive.txt')
  const result = await remove([selected])
  expect(result).toMatchObject({ deleted: 0, failed: 1, protectedSkipped: 1 })
  expect(result.errors).toEqual([{ path: selected, code: 'protected', reason: '安全保护：文件的真实路径超出本次扫描边界' }])
  expect(await readFile(original, 'utf8')).toBe(content)
})

it('rejects a real symbolic directory link even when its target stays inside the scan root', async () => {
  const originalDirectory = join(scanRoot, 'original-directory')
  await mkdir(originalDirectory)
  const original = join(originalDirectory, 'must-survive.txt')
  await writeFile(original, content)
  const link = join(scanRoot, 'internal-link')
  await symlink(originalDirectory, link, process.platform === 'win32' ? 'junction' : 'dir')
  await scan()

  const result = await remove([link])
  expect(result).toMatchObject({ deleted: 0, failed: 1, protectedSkipped: 1 })
  expect(result.errors).toEqual([{ path: link, code: 'protected', reason: '安全保护：不处理符号链接' }])
  expect((await lstat(link)).isSymbolicLink()).toBe(true)
  expect(await readFile(original, 'utf8')).toBe(content)
})

it.skipIf(process.platform !== 'win32')('permanently removes a real Windows read-only duplicate without changing the original', async () => {
  const original = join(scanRoot, 'original.txt')
  const duplicate = join(scanRoot, 'read-only-copy.txt')
  await Promise.all([writeFile(original, content), writeFile(duplicate, content)])
  await chmod(duplicate, 0o444)
  await scan()

  expect(await remove([duplicate])).toMatchObject({ deleted: 1, failed: 0, errors: [] })
  await expect(lstat(duplicate)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(original, 'utf8')).toBe(content)
})

it.each(['codex.exe', 'codex-code-mode-host.exe', 'd3dcompiler_47.dll', 'runtime.node'])
  ('does not scan or delete a runtime binary named %s, while ordinary duplicate photos stay cleanable', async (name) => {
    const runtime = join(scanRoot, name)
    const photo = join(scanRoot, 'original.jpg')
    const copy = join(scanRoot, 'photo-copy.jpg')
    await Promise.all([runtime, photo, copy].map((file) => writeFile(file, content)))
    const scanned = await scan()
    expect(scanned.totalFilesScanned).toBe(2)
    expect(scanned.groups[0].files.map((file) => file.path)).not.toContain(runtime)
    const protectedResult = await remove([runtime])
    expect(protectedResult).toMatchObject({ deleted: 0, failed: 1, protectedSkipped: 1, spaceRecovered: 0 })
    expect(protectedResult.errors[0]).toMatchObject({ path: runtime, code: 'protected' })
    expect(await readFile(runtime, 'utf8')).toBe(content)
    expect(await remove([copy])).toMatchObject({ deleted: 1, failed: 0 })
    expect(await readFile(photo, 'utf8')).toBe(content)
  })

it.skipIf(process.platform !== 'win32')('does not scan or delete user application data with an ordinary JSON extension', async () => {
  const dataDirectory = join(scanRoot, 'Users', 'Test', 'AppData', 'Local', 'Vendor')
  await mkdir(dataDirectory, { recursive: true })
  const settings = join(dataDirectory, 'settings.json')
  const original = join(scanRoot, 'document.txt')
  const copy = join(scanRoot, 'document-copy.txt')
  await Promise.all([settings, original, copy].map((file) => writeFile(file, content)))
  const scanned = await scan()
  expect(scanned.totalFilesScanned).toBe(2)
  expect(scanned.groups[0].files.map((file) => file.path)).not.toContain(settings)
  const result = await remove([settings, copy])
  expect(result).toMatchObject({ deleted: 1, failed: 1, protectedSkipped: 1 })
  expect(result.errors[0]).toMatchObject({ path: settings, code: 'protected' })
  expect(await readFile(settings, 'utf8')).toBe(content)
  expect(await readFile(original, 'utf8')).toBe(content)
})

it.skipIf(process.platform !== 'win32')('protects the real application-data target behind a junction alias inside the scan root', async () => {
  const dataDirectory = join(scanRoot, 'Users', 'Test', 'AppData', 'Local', 'Vendor')
  await mkdir(dataDirectory, { recursive: true })
  const settings = join(dataDirectory, 'settings.json')
  await writeFile(settings, content)
  const alias = join(scanRoot, 'unprotected-looking-alias')
  await symlink(dataDirectory, alias, 'junction')
  await scan()
  const aliasFile = join(alias, 'settings.json')
  const result = await remove([aliasFile])
  expect(result).toMatchObject({ deleted: 0, failed: 1, protectedSkipped: 1 })
  expect(result.errors[0]).toMatchObject({ path: aliasFile, code: 'protected' })
  expect(await readFile(settings, 'utf8')).toBe(content)
})

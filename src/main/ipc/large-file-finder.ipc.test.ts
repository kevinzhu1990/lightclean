import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, stat, access, rm, symlink, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import { registerLargeFileFinderIpc } from './large-file-finder.ipc'

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: { trashItem: vi.fn() },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) },
}))
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightclean-safety-test-'))
  registerLargeFileFinderIpc(() => null)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const scan = (directory: string) => handlers.get(IPC.LARGE_FILES_SCAN)!(null, { directory, minFileSize: 1 })
const remove = (paths: string[]) => handlers.get(IPC.LARGE_FILES_DELETE)!(null, paths, 'permanent')

it.each(['.colima/disk', '.codex/logs_2.sqlite', 'backup/archive.zip'])('labels and refuses critical file %s', async (name) => {
  const parts = name.split('/')
  await mkdir(join(root, parts[0]))
  const file = join(root, ...parts)
  await writeFile(file, 'keep this')
  const result = await scan(root)
  expect(result.files[0].safety?.level).toBe('protected')
  expect((await remove([file])).failed).toBe(1)
  await expect(access(file)).resolves.toBeUndefined()
})

it('rejects files not in the completed scan', async () => {
  await scan(root)
  const file = join(root, 'new.txt')
  await writeFile(file, 'not scanned')
  expect((await remove([file])).deleted).toBe(0)
  await expect(access(file)).resolves.toBeUndefined()
})

it('refuses sandbox application data even when explicitly requested', async () => {
  const directory = join(root, 'Library', 'Containers', 'com.docker.docker', 'Data')
  await mkdir(directory, { recursive: true })
  const file = join(directory, 'Docker.raw')
  await writeFile(file, 'container data')
  await scan(root)
  expect((await remove([file])).deleted).toBe(0)
  await expect(access(file)).resolves.toBeUndefined()
})

it('deletes an explicitly selected ordinary file only once', async () => {
  const file = join(root, 'copy.txt')
  await writeFile(file, 'disposable fixture')
  await scan(root)
  expect((await remove([file, file])).deleted).toBe(1)
  await expect(access(file)).rejects.toThrow()
})

it('rejects a scanned path replaced by a symlink', async () => {
  const file = join(root, 'copy.txt')
  const target = join(root, 'other.txt')
  await writeFile(file, 'original')
  await scan(root)
  await rename(file, target)
  await symlink(target, file)
  expect((await remove([file])).deleted).toBe(0)
  await expect(access(target)).resolves.toBeUndefined()
})

it('reports allocated blocks separately from logical size', async () => {
  const file = join(root, 'plain.txt')
  await writeFile(file, 'fixture')
  const s = await stat(file)
  const result = await scan(root)
  expect(result.files[0].size).toBe(7)
  expect(result.files[0].allocatedSize).toBe(process.platform === 'win32' ? null : s.blocks * 512)
})

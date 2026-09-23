import { beforeEach, expect, it, vi } from 'vitest'
import { parse, join } from 'path'
import { Readable } from 'stream'
import { readdir, realpath, lstat, rm } from 'fs/promises'
import { shell } from 'electron'
import { IPC } from '../../shared/channels'
import { registerDuplicateFinderIpc } from './duplicate-finder.ipc'

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({
  BrowserWindow: {}, dialog: {}, shell: { trashItem: vi.fn() },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) },
}))
vi.mock('fs/promises', () => ({
  readdir: vi.fn(), stat: vi.fn(async () => ({ size: 8, mtimeMs: 1 })),
  chmod: vi.fn(), lstat: vi.fn(), realpath: vi.fn(), rm: vi.fn(),
}))
vi.mock('fs', () => ({ createReadStream: () => Readable.from([Buffer.from('samefile')]) }))

beforeEach(() => { vi.clearAllMocks(); registerDuplicateFinderIpc(() => null) })

it('scans a volume root while skipping protected operating system directories', async () => {
  const root = parse(process.cwd()).root
  const entry = (name: string, directory: boolean) => ({
    name, isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory,
  })
  vi.mocked(readdir).mockImplementation(async (path) => {
    if (path === root) return [entry('Windows', true), entry('System', true), entry('Users', true)] as any
    if (path === join(root, 'Users')) return [entry('a.txt', false), entry('b.txt', false)] as any
    return []
  })
  const result = await handlers.get(IPC.DUPLICATES_SCAN)!(null, { directory: root, minFileSize: 1 })
  expect(result.totalFilesScanned).toBe(2)
  expect(result.groups).toHaveLength(1)
  const protectedName = process.platform === 'win32' ? 'Windows' : 'System'
  expect(vi.mocked(readdir).mock.calls.some(([path]) => path === join(root, protectedName))).toBe(false)
})

it.each(['recycle', 'permanent'])('deletes a scanned user copy using explicit %s mode', async (mode) => {
  const directory = join(parse(process.cwd()).root, 'Users', 'test', 'Pictures')
  vi.mocked(readdir).mockResolvedValue([])
  await handlers.get(IPC.DUPLICATES_SCAN)!(null, { directory })
  vi.mocked(realpath).mockImplementation(async (p) => String(p))
  vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => false } as any)
  const file = join(directory, 'copy.jpg')
  const result = await handlers.get(IPC.DUPLICATES_DELETE)!(null, [file], mode)
  expect(result.deleted).toBe(1)
  expect(result.failed).toBe(0)
  if (mode === 'recycle') {
    expect(shell.trashItem).toHaveBeenCalledWith(file)
    expect(rm).not.toHaveBeenCalled()
  } else {
    expect(rm).toHaveBeenCalledWith(file, { force: true })
    expect(shell.trashItem).not.toHaveBeenCalled()
  }
})

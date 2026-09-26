import { beforeEach, expect, it } from 'vitest'
import { useLargeFileStore } from './large-file-store'

beforeEach(() => useLargeFileStore.getState().reset())
const files = [
  { path: '/Users/a/.colima/disk', safety: { level: 'protected', reason: 'virtual-disk' } },
  { path: '/Users/a/report.pdf', safety: { level: 'confirm', reason: 'unknown' } },
  { path: '/Users/a/Library/Caches/old.bin', safety: { level: 'candidate', reason: 'cache' } },
  { path: '/Users/a/legacy.txt' },
].map((f) => ({ name: 'file', size: 10, lastModified: 1, extension: '', ...f }))

it('bulk selects only classified cleaning candidates, not unknown or protected files', () => {
  useLargeFileStore.getState().setResult({ files: files as any, duration: 1, totalFilesScanned: 4, cancelled: false })
  useLargeFileStore.getState().selectAll()
  expect([...useLargeFileStore.getState().selectedPaths]).toEqual(['/Users/a/Library/Caches/old.bin'])
})

it('does not permit toggling a protected file', () => {
  useLargeFileStore.getState().setResult({ files: files as any, duration: 1, totalFilesScanned: 4, cancelled: false })
  useLargeFileStore.getState().togglePath(files[0].path)
  expect(useLargeFileStore.getState().selectedPaths.size).toBe(0)
})

it('keeps cancelled partial scans read-only', () => {
  useLargeFileStore.getState().setResult({ files: files as any, duration: 1, totalFilesScanned: 4, cancelled: true })
  useLargeFileStore.getState().selectAll()
  useLargeFileStore.getState().togglePath(files[1].path)
  expect(useLargeFileStore.getState().selectedPaths.size).toBe(0)
})

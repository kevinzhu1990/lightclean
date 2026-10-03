import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes, rm, readFile, symlink, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanDirectory, cleanItems, resolveChildSubdirs, scanMultipleDirectories } from './file-utils'
import { cacheItems, clearCache } from './scan-cache'

const settings = vi.hoisted(() => ({ cleaner: { secureDelete: false, skipRecentMinutes: 60 }, exclusions: [] as string[] }))
vi.mock('./settings-store', () => ({ getSettings: () => settings }))
vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))
vi.mock('fs/promises', async (getActual) => {
  const actual = await getActual<typeof import('fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})
let root: string
const old = new Date(Date.now() - 30 * 86400000)
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightclean-cache-test-'))
  settings.exclusions = []
  settings.cleaner.skipRecentMinutes = 60
  clearCache()
  vi.mocked(readdir).mockClear()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
async function oldFile(relative: string, content = '1234567') {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  await utimes(path, old, old)
  return path
}

it('counts deep old cache files beneath a newly modified directory', async () => {
  const file = await oldFile('app/a/b/c/d/cache.bin')
  const result = await scanDirectory(root, 'app', 'App Cache')
  expect(result.totalSize).toBe(7)
  expect(result.items.map(i => i.path)).toEqual([file])
})

it('keeps recent and excluded children out of deletion while selecting old siblings', async () => {
  const keep = await oldFile('cache/keep.txt')
  const candidate = await oldFile('cache/remove.txt')
  const recent = join(root, 'cache/recent.txt')
  await writeFile(recent, 'recent')
  settings.exclusions = [keep]
  const result = await scanDirectory(root, 'app', 'App Cache')
  expect(result.items.map(i => i.path)).toEqual([candidate])
  cacheItems(result.items)
  expect((await cleanItems(result.items.map(i => i.id), undefined, 'permanent')).filesDeleted).toBe(1)
  expect(await readFile(keep, 'utf8')).toBe('1234567')
  expect(await readFile(recent, 'utf8')).toBe('recent')
})

it('uses the configured recent-file window instead of a fixed one hour', async () => {
  settings.cleaner.skipRecentMinutes = 0
  const file = join(root, 'new.log')
  await writeFile(file, '123')
  const result = await scanDirectory(root, 'system', 'User Logs')
  expect(result.items.map(i => i.path)).toEqual([file])
})

it('does not silently stop at 5000 cache files', async () => {
  for (let start = 0; start < 5001; start += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 5001 - start) }, (_, i) => oldFile(`cache/${start + i}.bin`, 'x')))
  }
  const result = await scanDirectory(root, 'app', 'App Cache')
  expect(result.itemCount).toBe(5001)
  expect(result.totalSize).toBe(5001)
}, 20000)

it('reports permission-denied paths instead of presenting them as empty', async () => {
  vi.mocked(readdir).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  const result = await scanDirectory(root, 'system', 'User Logs')
  expect(result.scanWarnings).toEqual([{ path: root, reason: 'permission-denied' }])
})

it('scans only Android Studio version children and not Chrome under the Google namespace', async () => {
  await oldFile('Google/Chrome/Default/Cache/browser.bin', 'keep')
  const app = await oldFile('Google/AndroidStudio2025.1/a/b/cache.bin')
  const paths = await resolveChildSubdirs([join(root, 'Google')], '.', 'AndroidStudio')
  const result = await scanMultipleDirectories(paths, 'app', 'Android Studio Cache')
  expect(result.items.map(i => i.path)).toEqual([app])
})

it('does not double count overlapping cache roots', async () => {
  const app = await oldFile('cache/a/b/cache.bin')
  const result = await scanMultipleDirectories([join(root, 'cache'), join(root, 'cache/a')], 'app', 'App Cache')
  expect(result.totalSize).toBe(7)
  expect(result.items.map(i => i.path)).toEqual([app])
})

it('refuses a file modified after the scan', async () => {
  const file = await oldFile('cache/changed.txt')
  const result = await scanDirectory(root, 'app', 'App Cache')
  expect(result.itemCount).toBe(1)
  cacheItems(result.items)
  await writeFile(file, 'new application content')
  const outcome = await cleanItems(result.items.map(i => i.id), undefined, 'permanent')
  expect(outcome.filesDeleted).toBe(0)
  expect(await readFile(file, 'utf8')).toBe('new application content')
})

it('reports missing scan IDs instead of silently reporting success', async () => {
  const outcome = await cleanItems(['expired'], undefined, 'permanent')
  expect(outcome.filesSkipped).toBe(1)
  expect(outcome.errors[0].reason).toContain('重新扫描')
})

it('refuses protected paths even when cached as review-only', async () => {
  const file = await oldFile('unknown/wechat_files/account/msg/keep.db')
  const scan = await scanDirectory(root, 'app', 'Other App Cache')
  cacheItems(scan.items.map(item => ({ ...item, safety: 'confirm' })))
  const outcome = await cleanItems(scan.items.map(item => item.id), undefined, 'permanent')
  expect(outcome.filesDeleted).toBe(0)
  expect(await readFile(file, 'utf8')).toBe('1234567')
})

it.skipIf(process.platform === 'win32')('does not follow a cache directory symlink', async () => {
  const file = await oldFile('outside/keep.txt')
  await mkdir(join(root, 'cache'))
  await symlink(join(root, 'outside'), join(root, 'cache', 'linked'))
  const result = await scanDirectory(join(root, 'cache'), 'app', 'App Cache')
  expect(result.items).toEqual([])
  expect(await readFile(file, 'utf8')).toBe('1234567')
})

import { beforeEach, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import { rm } from 'fs/promises'
import { cleanItems, safeDelete } from './file-utils'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))
vi.mock('fs/promises', () => ({
  lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
  rm: vi.fn(async () => {}), stat: vi.fn(), readdir: vi.fn(), open: vi.fn(), writeFile: vi.fn(),
}))
vi.mock('./settings-store', () => ({ getSettings: () => ({ cleaner: { secureDelete: false } }) }))
vi.mock('./scan-cache', () => ({ getCachedItems: () => [{
  id: 'cache', path: 'cache.tmp', size: 12, safety: 'recommended', category: 'system',
}] }))

beforeEach(() => vi.clearAllMocks())

it.each(['EPERM', 'EACCES'])('reports %s as a permission failure and offers elevation', async (code) => {
  vi.mocked(shell.trashItem).mockRejectedValue({ code })
  expect((await safeDelete('cache.tmp')).reason).toBe('permission-denied')
  expect((await cleanItems(['cache'])).needsElevation).toBe(true)
  expect(rm).not.toHaveBeenCalled()
})

it('keeps file-lock errors distinct from permissions', async () => {
  vi.mocked(shell.trashItem).mockRejectedValue({ code: 'EBUSY' })
  expect((await safeDelete('cache.tmp')).reason).toBe('in-use')
})

it('never falls back to permanent deletion when recycling fails', async () => {
  vi.mocked(shell.trashItem).mockRejectedValue({ code: 'ENOTSUP', message: 'No recycle support' })
  expect((await safeDelete('cache.tmp')).success).toBe(false)
  expect(rm).not.toHaveBeenCalled()
})

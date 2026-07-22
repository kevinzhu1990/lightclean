import { describe, expect, it } from 'vitest'
import { applyCleaningSafety, classifyCleaningTarget } from './cleaning-safety'

describe('cleaning safety classification', () => {
  it('recommends ordinary cache and temp files', () => {
    expect(classifyCleaningTarget('system', 'User Temp Files').level).toBe('recommended')
    expect(classifyCleaningTarget('browser', 'Chrome Cache').level).toBe('recommended')
  })

  it('requires confirmation for recoverable or diagnostic content', () => {
    expect(classifyCleaningTarget('recycleBin', 'Trash').level).toBe('confirm')
    expect(classifyCleaningTarget('system', 'Windows Update Cache').level).toBe('confirm')
  })

  it('protects installer and user databases', () => {
    expect(classifyCleaningTarget('system', 'Installer Patch Cache', 'C:\\Windows\\Installer\\$PatchCache$').level).toBe('protected')
    expect(classifyCleaningTarget('app', 'WeChat', 'D:\\WeChat_Files\\abc\\db_storage\\msg.db').level).toBe('protected')
  })

  it('only marks recommended items selected', () => {
    const result = applyCleaningSafety({
      category: 'system',
      subcategory: 'Windows Update Cache',
      totalSize: 1,
      itemCount: 1,
      items: [{ id: '1', path: 'C:\\Windows\\SoftwareDistribution\\Download\\x', size: 1, category: 'system', subcategory: 'Windows Update Cache', lastModified: 0, selected: true }],
    })
    expect(result.items[0].selected).toBe(false)
    expect(result.safety).toBe('confirm')
  })
})

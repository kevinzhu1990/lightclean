import { describe, expect, it } from 'vitest'
import {
  getElevationNotice,
  getElevationCategoryKey,
  getElevationCategorySeparator,
} from './cleaner-elevation'

describe('cleaner elevation notice', () => {
  it('describes macOS admin-only categories as safely protected', () => {
    expect(getElevationNotice('darwin')).toEqual({
      titleKey: 'protectedCategoriesSkipped',
      suffixKey: 'protectedCategoriesSkippedSuffix',
      helpKey: 'protectedCategoriesSkippedHelp',
      canRelaunch: false,
    })
  })

  it.each(['win32', 'linux'] as const)('keeps the admin relaunch path on %s', (platform) => {
    expect(getElevationNotice(platform)).toEqual({
      titleKey: 'categoriesSkipped',
      suffixKey: 'categoriesSkippedSuffix',
      helpKey: null,
      canRelaunch: true,
    })
  })

  it('maps protected macOS categories to localized labels', () => {
    expect(getElevationCategoryKey('System Logs')).toBe('elevationCategorySystemLogs')
    expect(getElevationCategoryKey('Font Cache')).toBe('elevationCategoryFontCache')
    expect(getElevationCategoryKey('unknown')).toBeNull()
  })

  it('uses a Chinese separator only for the macOS protected-category notice', () => {
    expect(getElevationCategorySeparator('darwin')).toBe('、')
    expect(getElevationCategorySeparator('win32')).toBe(', ')
    expect(getElevationCategorySeparator('linux')).toBe(', ')
  })
})

import type { PlatformInfo } from '@shared/types'

type CleanerPlatform = PlatformInfo['platform']

export function getElevationNotice(platform: CleanerPlatform) {
  if (platform === 'darwin') {
    return {
      titleKey: 'protectedCategoriesSkipped',
      suffixKey: 'protectedCategoriesSkippedSuffix',
      helpKey: 'protectedCategoriesSkippedHelp',
      canRelaunch: false,
    } as const
  }

  return {
    titleKey: 'categoriesSkipped',
    suffixKey: 'categoriesSkippedSuffix',
    helpKey: null,
    canRelaunch: true,
  } as const
}

const elevationCategoryKeys: Record<string, string> = {
  'System Logs': 'elevationCategorySystemLogs',
  'Font Cache': 'elevationCategoryFontCache',
  'System Crash Reports': 'elevationCategorySystemCrashReports',
  'Apple System Logs': 'elevationCategoryAppleSystemLogs',
  'Icon Services Cache': 'elevationCategoryIconServicesCache',
}

export function getElevationCategoryKey(category: string): string | null {
  return elevationCategoryKeys[category] ?? null
}

export function getElevationCategorySeparator(platform: CleanerPlatform): string {
  return platform === 'darwin' ? '、' : ', '
}

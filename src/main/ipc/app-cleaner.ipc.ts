import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { getPlatform } from '../platform'
import { scanMultipleDirectories, resolveChildSubdirs, cleanItems } from '../services/file-utils'
import { cacheItems } from '../services/scan-cache'
import { CleanerType } from '../../shared/enums'
import type { ScanResult, CleanResult } from '../../shared/types'
import type { WindowGetter } from './index'
import { validateStringArray } from '../services/ipc-validation'
import { discoverMacAppCaches } from '../services/mac-app-caches'
import { homedir } from 'os'
import { join } from 'path'

export function registerAppCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.APP_SCAN, async (): Promise<ScanResult[]> => {
    const results: ScanResult[] = []
    const category = CleanerType.App

    const platform = getPlatform()
    const appDefs = platform.paths.appPaths()
    const resolutions = new Map<(typeof appDefs)[number], { paths: string[]; warnings: NonNullable<ScanResult['scanWarnings']> }>()
    if (process.platform === 'darwin') {
      const browserPaths = platform.paths.browserPaths()
      const resolvedAppPaths = (await Promise.all(appDefs.map(async app => {
        const warnings: NonNullable<ScanResult['scanWarnings']> = []
        try {
          const paths = await resolveChildSubdirs(app.paths, app.childSubdir, app.childPrefix, warnings)
          resolutions.set(app, { paths, warnings })
          return paths
        } catch { return [] }
      }))).flat()
      const coveredPaths = [...resolvedAppPaths, ...Object.values(browserPaths).flatMap(browser =>
        browser ? [browser.base, ...(browser.externalCacheBases || []), ...(typeof browser.cache === 'string' && browser.cache.startsWith('/') ? [browser.cache] : [])].filter(Boolean) : []
      )]
      appDefs.push(...await discoverMacAppCaches(join(homedir(), 'Library', 'Caches'), coveredPaths))
    }
    for (const app of appDefs) {
      try {
        const existing = resolutions.get(app)
        const resolutionWarnings: NonNullable<ScanResult['scanWarnings']> = existing?.warnings || []
        const paths = existing?.paths || await resolveChildSubdirs(app.paths, app.childSubdir, app.childPrefix, resolutionWarnings)
        const label = app.kind ? `${app.name} - ${app.kind === 'logs' ? 'Logs' : 'Cache'}` : app.name
        const result = await scanMultipleDirectories(paths, category, label)
        if (resolutionWarnings.length) result.scanWarnings = [...resolutionWarnings, ...(result.scanWarnings || [])]
        if (app.reviewOnly) {
          result.items = result.items.map(item => ({ ...item, safety: 'confirm', selected: false,
            cleanupReason: '这是尚未适配专用规则的应用缓存，请先确认用途。',
          }))
        }
        if (result.items.length > 0 || result.scanWarnings?.length) {
          cacheItems(result.items)
          results.push(result)
        }
      } catch {
        // Skip
      }
    }

    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.SCAN_PROGRESS, {
      phase: 'scanning',
      category,
      currentPath: 'App scan complete',
      progress: 100,
      itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
      sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
    })

    return results
  })

  ipcMain.handle(IPC.APP_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    const valid = validateStringArray(itemIds)
    if (!valid) return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    return cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'cleaning',
        category: CleanerType.App,
        currentPath,
        progress: (processed / total) * 100,
        itemsFound: total,
        sizeFound: cleanedSize,
      })
    })
  })
}

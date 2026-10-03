import type { ScanResult } from './types'

/** A cache may be found by system, app and browser rules; only count its first occurrence. */
export function mergeScanResults(existing: ScanResult[], incoming: ScanResult[]): ScanResult[] {
  const seen = new Set<string>()
  return [...existing, ...incoming].map(result => {
    const items = result.items.filter(item => {
      const path = item.scanIdentity?.realPath || item.path
      const key = /^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, '/').toLowerCase() : path
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { ...result, items, itemCount: items.length, totalSize: items.reduce((sum, item) => sum + item.size, 0) }
  }).filter(result => result.items.length || result.scanWarnings?.length)
}

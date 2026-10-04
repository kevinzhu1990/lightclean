import type { ScanItem } from '../../shared/types'

/**
 * In-memory cache of scan results so clean handlers can look up
 * item paths by ID. Clear once at the beginning of a complete scan session.
 * Never evict IDs still displayed by the renderer during that session.
 */
const itemCache = new Map<string, ScanItem>()

export function cacheItems(items: ScanItem[]): void {
  for (const item of items) {
    itemCache.set(item.id, item)
  }
}

export function getCachedItem(id: string): ScanItem | undefined {
  return itemCache.get(id)
}

export function getCachedItems(ids: string[]): ScanItem[] {
  const items: ScanItem[] = []
  for (const id of ids) {
    const item = itemCache.get(id)
    if (item) items.push(item)
  }
  return items
}

export function clearCache(): void {
  itemCache.clear()
}

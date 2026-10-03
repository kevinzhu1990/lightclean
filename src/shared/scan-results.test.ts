import { it, expect } from 'vitest'
import { mergeScanResults } from './scan-results'
import type { ScanResult } from './types'
it('counts overlapping cache files once while retaining permission warnings', () => {
  const result = (id: string, path: string): ScanResult => ({ category: 'app', subcategory: 'Cache', items: [{ id, path, size: 7, category: 'app', subcategory: 'Cache', selected: true, lastModified: 0 }], totalSize: 7, itemCount: 1 })
  const merged = mergeScanResults([result('first', 'C:\\cache\\file')], [result('second', 'c:/cache/file'), { category: 'app', subcategory: 'Locked', items: [], itemCount: 0, totalSize: 0, scanWarnings: [{ path: '/locked', reason: 'permission-denied' }] }])
  expect(merged.reduce((sum, r) => sum + r.totalSize, 0)).toBe(7)
  expect(merged.flatMap(r => r.items).map(i => i.id)).toEqual(['first'])
  expect(merged.flatMap(r => r.scanWarnings || [])).toEqual([{ path: '/locked', reason: 'permission-denied' }])
})

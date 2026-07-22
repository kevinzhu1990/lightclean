import { create } from 'zustand'
import type { ScanResult, ProgressData, ScanItem, CleanError } from '@shared/types'
import { ScanStatus, CleanerType } from '@shared/enums'
import { applyCleaningSafety } from '@shared/cleaning-safety'

export interface CleanSummaryData {
  totalCleaned: number
  filesDeleted: number
  filesSkipped: number
  errors: CleanError[]
  needsElevation: boolean
  categories: Array<{ name: string; type: string; found: number; cleaned: number; space: number }>
  duration: number
  totalSizeBefore: number
}

const EXCLUDED_KEY = 'lightclean:excluded-subcategories'

function loadExcluded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

function saveExcluded(excluded: Set<string>): void {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]))
  } catch { /* ignore */ }
}

interface ScanState {
  status: ScanStatus
  results: ScanResult[]
  selectedItems: Set<string>
  excludedSubcategories: Set<string>
  progress: ProgressData | null
  cleanSummary: CleanSummaryData | null
  activeCategory: CleanerType | null

  setStatus: (status: ScanStatus) => void
  setResults: (results: ScanResult[]) => void
  addResults: (results: ScanResult[]) => void
  setProgress: (progress: ProgressData | null) => void
  setCleanSummary: (summary: CleanSummaryData | null) => void
  setActiveCategory: (cat: CleanerType | null) => void
  toggleItem: (id: string) => void
  toggleSubcategory: (result: ScanResult) => void
  selectAll: (category: string) => void
  deselectAll: (category: string) => void
  toggleCategory: (category: string) => void
  getSelectedIds: () => string[]
  getTotalSize: () => number
  getSelectedSize: () => number
  reset: () => void
}

export const useScanStore = create<ScanState>((set, get) => ({
  status: ScanStatus.Idle,
  results: [],
  selectedItems: new Set<string>(),
  excludedSubcategories: loadExcluded(),
  progress: null,
  cleanSummary: null,
  activeCategory: null,

  setStatus: (status) => set({ status }),
  setResults: (results) => {
    const excluded = get().excludedSubcategories
    const safeResults = results.map(applyCleaningSafety)
    const selected = new Set<string>()
    safeResults.forEach((r) =>
      r.items.forEach((item) => {
        if (item.safety === 'recommended' && !excluded.has(r.subcategory)) selected.add(item.id)
      })
    )
    set({ results: safeResults, selectedItems: selected })
  },
  addResults: (newResults) =>
    set((s) => {
      const safeResults = newResults.map(applyCleaningSafety)
      const excluded = s.excludedSubcategories
      const selected = new Set(s.selectedItems)
      safeResults.forEach((r) =>
        r.items.forEach((item) => {
          if (item.safety === 'recommended' && !excluded.has(r.subcategory)) selected.add(item.id)
        })
      )
      return { results: [...s.results, ...safeResults], selectedItems: selected }
    }),
  setProgress: (progress) => set({ progress }),
  setCleanSummary: (cleanSummary) => set({ cleanSummary }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  toggleItem: (id) =>
    set((s) => {
      const target = s.results.flatMap((r) => r.items).find((item) => item.id === id)
      if (!target || target.safety === 'protected') return s
      const next = new Set(s.selectedItems)
      if (next.has(id)) next.delete(id)
      else next.add(id)

      // Update excluded subcategories based on current selection state
      const excluded = new Set(s.excludedSubcategories)
      for (const r of s.results) {
        const itemInResult = r.items.find((i) => i.id === id)
        if (!itemInResult) continue
        const allDeselected = r.items.every((i) => !next.has(i.id))
        const allSelected = r.items.every((i) => next.has(i.id))
        if (allDeselected) excluded.add(r.subcategory)
        else if (allSelected) excluded.delete(r.subcategory)
        break
      }
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  toggleSubcategory: (result) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      const excluded = new Set(s.excludedSubcategories)
      const selectableItems = result.items.filter((i) => i.safety !== 'protected')
      const allSelected = selectableItems.length > 0 && selectableItems.every((i) => next.has(i.id))
      if (allSelected) {
        selectableItems.forEach((i) => next.delete(i.id))
        excluded.add(result.subcategory)
      } else {
        selectableItems.forEach((i) => next.add(i.id))
        excluded.delete(result.subcategory)
      }
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  selectAll: (category) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      const excluded = new Set(s.excludedSubcategories)
      s.results
        .filter((r) => r.category === category)
        .forEach((r) => {
          r.items.filter((item) => item.safety !== 'protected').forEach((item) => next.add(item.id))
          excluded.delete(r.subcategory)
        })
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  deselectAll: (category) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      const excluded = new Set(s.excludedSubcategories)
      s.results
        .filter((r) => r.category === category)
        .forEach((r) => {
          r.items.forEach((item) => next.delete(item.id))
          excluded.add(r.subcategory)
        })
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  toggleCategory: (category) => {
    const state = get()
    const categoryItems = state.results
      .filter((r) => r.category === category)
      .flatMap((r) => r.items)
      .filter((item) => item.safety !== 'protected')
    const allSelected = categoryItems.length > 0 && categoryItems.every((item) => state.selectedItems.has(item.id))
    if (allSelected) {
      state.deselectAll(category)
    } else {
      state.selectAll(category)
    }
  },
  getSelectedIds: () => Array.from(get().selectedItems),
  getTotalSize: () => get().results.reduce((sum, r) => sum + r.totalSize, 0),
  getSelectedSize: () => {
    const selected = get().selectedItems
    return get().results.reduce(
      (sum, r) =>
        sum + r.items.filter((item) => selected.has(item.id)).reduce((s, i) => s + i.size, 0),
      0
    )
  },
  reset: () =>
    set({
      status: ScanStatus.Idle,
      results: [],
      selectedItems: new Set(),
      progress: null,
      cleanSummary: null
    })
}))

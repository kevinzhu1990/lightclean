import { create } from 'zustand'
import type {
  DuplicateScanResult,
  DuplicateScanProgress,
  DuplicateDeleteMode,
  DuplicateDeleteResult
} from '@shared/types'

interface DuplicateState {
  // Config
  directory: string | null
  minFileSize: number
  maxFileSize: number | null
  excludePatterns: string[]
  extensionFilter: string[]
  maxDepth: number
  referenceDirectories: string[]

  // Scan state
  status: 'idle' | 'scanning' | 'complete' | 'deleting'
  progress: DuplicateScanProgress | null
  result: DuplicateScanResult | null

  // Selection
  selectedPaths: Set<string>
  deleteMode: DuplicateDeleteMode
  deleteResult: DuplicateDeleteResult | null

  // Setters
  setDirectory: (dir: string | null) => void
  setMinFileSize: (size: number) => void
  setMaxFileSize: (size: number | null) => void
  setExcludePatterns: (patterns: string[]) => void
  setExtensionFilter: (exts: string[]) => void
  setMaxDepth: (depth: number) => void
  setReferenceDirectories: (dirs: string[]) => void
  setStatus: (status: DuplicateState['status']) => void
  setProgress: (progress: DuplicateScanProgress | null) => void
  setResult: (result: DuplicateScanResult | null) => void
  setDeleteMode: (mode: DuplicateDeleteMode) => void
  setDeleteResult: (result: DuplicateDeleteResult | null) => void
  togglePath: (path: string) => void
  selectAllDuplicates: () => void
  deselectAll: () => void
  removeDeletedFiles: (deletedPaths: Set<string>) => void
  reset: () => void
}

export const useDuplicateStore = create<DuplicateState>((set, get) => ({
  directory: null,
  minFileSize: 1_048_576,
  maxFileSize: null,
  excludePatterns: ['node_modules', '.git', '$Recycle.Bin'],
  extensionFilter: [],
  maxDepth: 20,
  referenceDirectories: [],

  status: 'idle',
  progress: null,
  result: null,

  selectedPaths: new Set(),
  deleteMode: 'recycle',
  deleteResult: null,

  setDirectory: (directory) => set({ directory }),
  setMinFileSize: (minFileSize) => set({ minFileSize }),
  setMaxFileSize: (maxFileSize) => set({ maxFileSize }),
  setExcludePatterns: (excludePatterns) => set({ excludePatterns }),
  setExtensionFilter: (extensionFilter) => set({ extensionFilter }),
  setMaxDepth: (maxDepth) => set({ maxDepth }),
  setReferenceDirectories: (referenceDirectories) => set({ referenceDirectories }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result }),
  setDeleteMode: (deleteMode) => set({ deleteMode }),
  setDeleteResult: (deleteResult) => set({ deleteResult }),
  togglePath: (path) =>
    set((s) => {
      const file = s.result?.groups.flatMap((group) => group.files).find((item) => item.path === path)
      if (file?.isReference) return s
      const next = new Set(s.selectedPaths)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { selectedPaths: next }
    }),
  selectAllDuplicates: () => {
    const result = get().result
    if (!result) return
    const selected = new Set<string>()
    for (const group of result.groups) {
      const references = group.files.filter((file) => file.isReference)
      const candidates = group.files.filter((file) => !file.isReference).sort((a, b) => a.path.length - b.path.length)
      // A reference copy is always kept. Without one, keep the shortest local path.
      const start = references.length > 0 ? 0 : 1
      for (let i = start; i < candidates.length; i++) {
        selected.add(candidates[i].path)
      }
    }
    set({ selectedPaths: selected })
  },
  deselectAll: () => set({ selectedPaths: new Set() }),
  removeDeletedFiles: (deletedPaths) => {
    const result = get().result
    if (!result) return
    // Remove deleted files from each group, drop groups with <2 files remaining
    const groups = result.groups
      .map((g) => {
        const remaining = g.files.filter((f) => !deletedPaths.has(f.path))
        const referenceCount = remaining.filter((f) => f.isReference).length
        const deletableCopies = referenceCount > 0 ? remaining.length - referenceCount : remaining.length - 1
        return {
          ...g,
          files: remaining,
          reclaimableSpace: remaining.length >= 2 ? g.fileSize * Math.max(0, deletableCopies) : 0
        }
      })
      .filter((g) => g.files.length >= 2)
    const totalDuplicates = groups.reduce((s, g) => {
      const referenceCount = g.files.filter((f) => f.isReference).length
      return s + (referenceCount > 0 ? g.files.length - referenceCount : g.files.length - 1)
    }, 0)
    const totalReclaimable = groups.reduce((s, g) => s + g.reclaimableSpace, 0)
    // Remove deleted paths from selection
    const nextSelected = new Set<string>()
    for (const p of get().selectedPaths) {
      if (!deletedPaths.has(p)) nextSelected.add(p)
    }
    set({
      result: { ...result, groups, totalDuplicates, totalReclaimable },
      selectedPaths: nextSelected
    })
  },
  reset: () =>
    set({
      status: 'idle',
      progress: null,
      result: null,
      selectedPaths: new Set(),
      deleteResult: null
    })
}))

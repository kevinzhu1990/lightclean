import { create } from 'zustand'
import type {
  LargeFileScanResult,
  LargeFileScanProgress,
  LargeFileDeleteMode,
  LargeFileDeleteResult
} from '@shared/types'

interface LargeFileState {
  directory: string | null
  minFileSize: number
  maxDepth: number
  excludePatterns: string[]

  status: 'idle' | 'scanning' | 'complete' | 'deleting'
  progress: LargeFileScanProgress | null
  result: LargeFileScanResult | null

  selectedPaths: Set<string>
  deleteMode: LargeFileDeleteMode
  deleteResult: LargeFileDeleteResult | null

  setDirectory: (dir: string | null) => void
  setMinFileSize: (size: number) => void
  setMaxDepth: (depth: number) => void
  setExcludePatterns: (patterns: string[]) => void
  setStatus: (status: LargeFileState['status']) => void
  setProgress: (progress: LargeFileScanProgress | null) => void
  setResult: (result: LargeFileScanResult | null) => void
  setDeleteMode: (mode: LargeFileDeleteMode) => void
  setDeleteResult: (result: LargeFileDeleteResult | null) => void
  togglePath: (path: string) => void
  selectAll: () => void
  deselectAll: () => void
  removeDeletedFiles: (deletedPaths: Set<string>) => void
  reset: () => void
}

export const useLargeFileStore = create<LargeFileState>((set, get) => ({
  directory: null,
  minFileSize: 104_857_600, // 100 MB default
  maxDepth: 20,
  excludePatterns: ['node_modules', '.git', '$Recycle.Bin'],

  status: 'idle',
  progress: null,
  result: null,

  selectedPaths: new Set(),
  deleteMode: 'recycle',
  deleteResult: null,

  setDirectory: (directory) => set({ directory }),
  setMinFileSize: (minFileSize) => set({ minFileSize }),
  setMaxDepth: (maxDepth) => set({ maxDepth }),
  setExcludePatterns: (excludePatterns) => set({ excludePatterns }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result }),
  setDeleteMode: (deleteMode) => set({ deleteMode }),
  setDeleteResult: (deleteResult) => set({ deleteResult }),
  togglePath: (path) =>
    set((s) => {
      const next = new Set(s.selectedPaths)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { selectedPaths: next }
    }),
  selectAll: () => {
    const result = get().result
    if (!result) return
    const selected = new Set<string>()
    for (const file of result.files) selected.add(file.path)
    set({ selectedPaths: selected })
  },
  deselectAll: () => set({ selectedPaths: new Set() }),
  removeDeletedFiles: (deletedPaths) => {
    const result = get().result
    if (!result) return
    const files = result.files.filter((f) => !deletedPaths.has(f.path))
    const nextSelected = new Set<string>()
    for (const p of get().selectedPaths) {
      if (!deletedPaths.has(p)) nextSelected.add(p)
    }
    set({
      result: { ...result, files },
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

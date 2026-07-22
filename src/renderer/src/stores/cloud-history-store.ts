import { create } from 'zustand'
import type { CloudActionEntry } from '@shared/types'

interface CloudHistoryState {
  entries: CloudActionEntry[]
  loaded: boolean
  load: () => Promise<void>
  clear: () => Promise<void>
}

export const useCloudHistoryStore = create<CloudHistoryState>((set) => ({
  entries: [],
  loaded: false,

  load: async () => {
    try {
      const entries = await window.lightclean.cloudHistoryGet()
      set({ entries, loaded: true })
    } catch {
      set({ entries: [], loaded: true })
    }
  },

  clear: async () => {
    try {
      await window.lightclean.cloudHistoryClear()
      set({ entries: [] })
    } catch {
      // Silent fail
    }
  }
}))

// Auto-refresh when main process signals a new cloud action was logged.
// Guard against duplicate listeners on HMR reload.
let _cloudHistoryListenerRegistered = false
if (!_cloudHistoryListenerRegistered) {
  _cloudHistoryListenerRegistered = true
  window.lightclean.onCloudHistoryChanged(() => {
    useCloudHistoryStore.getState().load()
  })
}

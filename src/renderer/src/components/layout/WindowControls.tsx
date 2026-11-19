import type { PlatformInfo } from '../../../../shared/types'

export function WindowControls({ platform }: { platform: PlatformInfo['platform'] }) {
  if (platform === 'darwin') return null

  return (
    <div className="no-drag fixed right-0 top-0 z-50 flex" role="toolbar" aria-label="Window controls">
      <button
        onClick={() => window.lightclean.windowMinimize()}
        aria-label="Minimize window"
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.lightclean.windowMaximize()}
        aria-label="Maximize window"
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.lightclean.windowClose()}
        aria-label="Close window"
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-red-500 hover:text-white"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  )
}

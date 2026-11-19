import { useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { AdminBanner } from './AdminBanner'
import { WindowControls } from './WindowControls'
import { usePlatform } from '../../hooks/usePlatform'

export function AppShell({ children }: { children: React.ReactNode }) {
  const info = usePlatform()
  // Read the preload primitive immediately: the async platform query defaults to Windows.
  const platform = window.lightclean?.platform ?? info.platform
  const handleSkip = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault()
    const el = document.getElementById('main-content')
    if (el) { el.focus(); el.scrollIntoView() }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      <a
        href="#"
        className={`skip-nav${platform === 'darwin' ? ' no-drag' : ''}`}
        style={platform === 'darwin' ? { top: 40 } : undefined}
        onClick={handleSkip}
      >Skip to main content</a>
      <Sidebar />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Ambient background glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-[100px] left-[80px] h-[500px] w-[500px] rounded-full blur-[180px]"
            style={{ background: 'var(--glow-amber)' }}
          />
          <div
            className="absolute bottom-[0] right-[40px] h-[400px] w-[400px] rounded-full blur-[160px]"
            style={{ background: 'var(--glow-blue)' }}
          />
        </div>

        {/* Invisible drag region for moving window (top edge) */}
        <div className={`drag-region shrink-0 ${platform === 'darwin' ? 'h-10' : 'h-8'}`} />
        {/* macOS owns its native controls; other platforms keep the HTML buttons. */}
        <WindowControls platform={platform} />
        <AdminBanner />
        <main id="main-content" tabIndex={-1} className="relative flex-1 overflow-y-auto px-10 pb-10 pt-2 outline-none">
          {children}
        </main>
      </div>
    </div>
  )
}

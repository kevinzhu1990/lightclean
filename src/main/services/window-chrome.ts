import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron'

export function getWindowChromeOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  return platform === 'darwin'
    ? { frame: true, titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 12 } }
    : { frame: false }
}

export function getApplicationMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  }
  if (platform !== 'darwin') return [{ role: 'appMenu' }, edit]
  return [
    { role: 'appMenu' },
    { role: 'fileMenu', submenu: [{ role: 'close' }] },
    edit,
    { role: 'viewMenu', submenu: [{ role: 'togglefullscreen' }] },
    { role: 'windowMenu', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' },
    ] },
  ]
}

type RestorableWindow = {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function restoreWindow(window: RestorableWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

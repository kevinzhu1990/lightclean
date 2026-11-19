import { describe, expect, it } from 'vitest'
import { getApplicationMenuTemplate, getWindowChromeOptions, restoreWindow } from './window-chrome'

describe('platform window chrome', () => {
  it('keeps real native traffic lights in the upper left on macOS', () => {
    expect(getWindowChromeOptions('darwin')).toEqual({
      frame: true, titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 12 },
    })
  })
  it.each(['win32', 'linux'] as const)('preserves frameless HTML controls on %s', platform => {
    expect(getWindowChromeOptions(platform)).toEqual({ frame: false })
  })
  it('provides native macOS close, minimize, fullscreen and editing actions', () => {
    const menu = getApplicationMenuTemplate('darwin')
    const roles = menu.flatMap(item => [item.role, ...(Array.isArray(item.submenu) ? item.submenu.map(child => child.role) : [])])
    for (const role of ['appMenu', 'close', 'minimize', 'togglefullscreen', 'copy', 'paste', 'windowMenu']) {
      expect(roles).toContain(role)
    }
  })
  it.each(['win32', 'linux'] as const)('does not add macOS-only menu items on %s', platform => {
    const menu = getApplicationMenuTemplate(platform)
    expect(menu).toHaveLength(2)
    expect(menu[1].submenu).toEqual([
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ])
  })
})

describe('restoreWindow', () => {
  it('restores a minimized hidden window before showing and focusing it', () => {
    const calls: string[] = []
    let minimized = true, visible = false
    restoreWindow({
      isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => visible,
      restore: () => { minimized = false; calls.push('restore') },
      show: () => { visible = true; calls.push('show') },
      focus: () => { expect(minimized).toBe(false); expect(visible).toBe(true); calls.push('focus') },
    })
    expect(calls).toEqual(['restore', 'show', 'focus'])
  })
  it('only focuses an already visible window', () => {
    const calls: string[] = []
    restoreWindow({
      isDestroyed: () => false, isMinimized: () => false, isVisible: () => true,
      restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'),
    })
    expect(calls).toEqual(['focus'])
  })
  it('ignores null and destroyed windows', () => {
    expect(() => restoreWindow(null)).not.toThrow()
    restoreWindow({
      isDestroyed: () => true,
      isMinimized: () => { throw new Error('destroyed window must not be queried') },
      isVisible: () => false, restore() {}, show() {}, focus() {},
    })
  })
})

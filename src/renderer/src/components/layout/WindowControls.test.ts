import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WindowControls } from './WindowControls'

describe('platform window controls', () => {
  it('does not duplicate the native macOS traffic lights with HTML buttons', () => {
    expect(renderToStaticMarkup(createElement(WindowControls, { platform: 'darwin' }))).toBe('')
  })
  it.each(['win32', 'linux'] as const)('keeps all three right-hand controls on %s', platform => {
    const markup = renderToStaticMarkup(createElement(WindowControls, { platform }))
    expect(markup.match(/<button/g)).toHaveLength(3)
    expect(markup).toContain('right-0')
    expect(markup).toContain('Minimize window')
    expect(markup).toContain('Maximize window')
    expect(markup).toContain('Close window')
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LicensePage } from './LicensePage'

describe('license transfer guidance', () => {
  it('directs replacement devices to seller review rather than offering self-unbind', () => {
    const html = renderToStaticMarkup(createElement(LicensePage))
    expect(html).toContain('换机必须联系卖家人工审核')
    expect(html).toContain('复制设备申请码')
    expect(html).not.toContain('移除本机授权')
  })
})

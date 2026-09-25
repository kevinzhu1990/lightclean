import { describe, expect, it } from 'vitest'
import type { WeChatMediaFile } from '@shared/types'
import { filterWeChatMedia } from './wechat-media-filter'

const file = (id: string, date: string, sizeMb: number, account = 'alice'): WeChatMediaFile => ({
  id, path: `C:/WeChat/${account}/${id}.jpg`, name: `${id}.jpg`, account,
  category: 'image', size: sizeMb * 1024 * 1024, modifiedAt: new Date(date).getTime(),
})

const files = [
  file('old', '2025-01-01T12:00:00', 5),
  file('first', '2026-07-01T08:00:00', 20),
  file('last', '2026-07-31T23:59:00', 100),
  file('other-account', '2026-07-15T12:00:00', 50, 'bob'),
]

describe('filterWeChatMedia', () => {
  it('uses inclusive local calendar dates and exact size range', () => {
    expect(filterWeChatMedia(files, { fromDate: '2026-07-01', toDate: '2026-07-31', minSizeMb: 20, maxSizeMb: 100, account: 'alice' }).map((item) => item.id))
      .toEqual(['last', 'first'])
  })

  it('sorts deterministically by oldest or smallest first', () => {
    expect(filterWeChatMedia(files, { sort: 'oldest' }).map((item) => item.id))
      .toEqual(['old', 'first', 'other-account', 'last'])
    expect(filterWeChatMedia(files, { sort: 'smallest' }).map((item) => item.id))
      .toEqual(['old', 'first', 'other-account', 'last'])
  })

  it('rejects invalid ranges rather than silently including files', () => {
    expect(filterWeChatMedia(files, { fromDate: '2026-08-01', toDate: '2026-07-01' })).toEqual([])
    expect(filterWeChatMedia(files, { minSizeMb: 200, maxSizeMb: 20 })).toEqual([])
  })
})

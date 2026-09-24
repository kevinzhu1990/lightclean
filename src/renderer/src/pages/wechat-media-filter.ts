import type { WeChatMediaCategory, WeChatMediaFile } from '@shared/types'

export type WeChatMediaSort = 'largest' | 'smallest' | 'newest' | 'oldest'

export interface WeChatMediaFilters {
  category?: 'all' | WeChatMediaCategory
  account?: string
  query?: string
  fromDate?: string
  toDate?: string
  minSizeMb?: number
  maxSizeMb?: number
  sort?: WeChatMediaSort
}

function localDay(date: string, end: boolean): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return Number.NaN
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3])
  const value = new Date(year, month, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0)
  if (value.getFullYear() !== year || value.getMonth() !== month || value.getDate() !== day) return Number.NaN
  return value.getTime()
}

export function filterWeChatMedia(files: WeChatMediaFile[], filters: WeChatMediaFilters): WeChatMediaFile[] {
  const from = filters.fromDate ? localDay(filters.fromDate, false) : -Infinity
  const to = filters.toDate ? localDay(filters.toDate, true) : Infinity
  const min = Math.max(0, filters.minSizeMb ?? 0) * 1024 * 1024
  const max = filters.maxSizeMb === undefined ? Infinity : Math.max(0, filters.maxSizeMb) * 1024 * 1024
  if (Number.isNaN(from) || Number.isNaN(to) || from > to || min > max) return []
  const query = filters.query?.trim().toLowerCase()
  const sort = filters.sort ?? 'largest'
  return files.filter((file) =>
    (!filters.category || filters.category === 'all' || file.category === filters.category)
    && (!filters.account || file.account === filters.account)
    && file.modifiedAt >= from && file.modifiedAt <= to
    && file.size >= min && file.size <= max
    && (!query || file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query)),
  ).sort((a, b) => {
    const difference = sort === 'smallest' ? a.size - b.size
      : sort === 'newest' ? b.modifiedAt - a.modifiedAt
        : sort === 'oldest' ? a.modifiedAt - b.modifiedAt : b.size - a.size
    return difference || a.path.localeCompare(b.path)
  })
}

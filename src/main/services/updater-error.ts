import type { UpdateErrorCode } from '../../shared/types'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

export function getSafeUpdateErrorCode(error: unknown): UpdateErrorCode {
  const message = errorMessage(error)

  if (/\b404\b|status(?:Code)?["'\s:=]+404/i.test(message)) {
    return 'source-unavailable'
  }

  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network error|fetch failed/i.test(message)) {
    return 'network'
  }

  return 'unknown'
}

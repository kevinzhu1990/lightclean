import { describe, expect, it } from 'vitest'
import { getSafeUpdateErrorCode } from './updater-error'

describe('getSafeUpdateErrorCode', () => {
  it('classifies a private or unavailable GitHub release feed without exposing response details', () => {
    const error = new Error('404 GET https://github.com/example/private/releases.atom headers: set-cookie=secret')

    expect(getSafeUpdateErrorCode(error)).toBe('source-unavailable')
  })

  it('classifies common connection failures as network errors', () => {
    expect(getSafeUpdateErrorCode(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('network')
    expect(getSafeUpdateErrorCode(new Error('getaddrinfo ENOTFOUND github.com'))).toBe('network')
  })

  it('uses a generic safe code for unexpected errors', () => {
    expect(getSafeUpdateErrorCode(new Error('token=do-not-render'))).toBe('unknown')
    expect(getSafeUpdateErrorCode('unexpected failure')).toBe('unknown')
  })
})

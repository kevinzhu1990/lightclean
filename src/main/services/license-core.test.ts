import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildLicenseStatus,
  daysRemaining,
  normalizeRedemptionCode,
  type StoredLicense,
} from './license-core'

const now = new Date('2026-07-23T00:00:00.000Z')

describe('license core', () => {
  it('starts a full 30 day trial', () => {
    const stored: StoredLicense = {
      plan: 'trial',
      startedAt: now.toISOString(),
      expiresAt: addDays(now, 30).toISOString(),
    }
    const status = buildLicenseStatus(stored, 'AB12CD34', false, now)
    expect(status.state).toBe('trial')
    expect(status.daysRemaining).toBe(30)
    expect(status.canUsePaidFeatures).toBe(true)
  })

  it('expires a subscription after its end date', () => {
    const stored: StoredLicense = {
      plan: 'annual',
      startedAt: '2025-07-22T00:00:00.000Z',
      expiresAt: '2026-07-22T00:00:00.000Z',
      activationToken: 'token',
      lastValidatedAt: '2026-07-20T00:00:00.000Z',
    }
    expect(buildLicenseStatus(stored, 'AB12CD34', true, now).state).toBe('expired')
  })

  it('allows lifetime licenses without an expiry date', () => {
    const stored: StoredLicense = {
      plan: 'lifetime',
      startedAt: now.toISOString(),
      expiresAt: null,
      activationToken: 'token',
      lastValidatedAt: now.toISOString(),
    }
    const status = buildLicenseStatus(stored, 'AB12CD34', true, now)
    expect(status.state).toBe('active')
    expect(status.daysRemaining).toBeNull()
  })

  it('normalizes redemption codes', () => {
    expect(normalizeRedemptionCode(' lc_q1 abcd ')).toBe('LC-Q1-ABCD')
    expect(daysRemaining(null, now)).toBeNull()
  })
})


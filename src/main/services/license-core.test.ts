import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'crypto'
import {
  ACTIVATION_PREFIX,
  addDays,
  buildLicenseStatus,
  createDeviceRequestCode,
  daysRemaining,
  normalizeRedemptionCode,
  verifyOfflineActivation,
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
    const status = buildLicenseStatus(stored, 'AB12CD34', 'LC-REQ-test', now)
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
    }
    expect(buildLicenseStatus(stored, 'AB12CD34', 'LC-REQ-test', now).state).toBe('expired')
  })

  it('allows lifetime licenses without an expiry date', () => {
    const stored: StoredLicense = {
      plan: 'lifetime',
      startedAt: now.toISOString(),
      expiresAt: null,
      activationToken: 'token',
    }
    const status = buildLicenseStatus(stored, 'AB12CD34', 'LC-REQ-test', now)
    expect(status.state).toBe('active')
    expect(status.daysRemaining).toBeNull()
  })

  it('normalizes redemption codes', () => {
    expect(normalizeRedemptionCode(' lc_q1 abcd ')).toBe('LC-Q1-ABCD')
    expect(daysRemaining(null, now)).toBeNull()
  })

  it('creates a device-bound request code', () => {
    const deviceId = 'a'.repeat(64)
    const request = createDeviceRequestCode(deviceId, 'win32', 'x64', '1.3.0')
    expect(request.startsWith('LC-REQ-')).toBe(true)
    const payload = JSON.parse(Buffer.from(request.slice(7), 'base64url').toString('utf8'))
    expect(payload.deviceId).toBe(deviceId)
    expect(payload.deviceSuffix).toBe('AAAAAAAA')
  })

  it('accepts a valid signed activation only on the requested device', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const deviceId = 'b'.repeat(64)
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      licenseId: 'license-test',
      deviceId,
      plan: 'annual',
      issuedAt: now.toISOString(),
      expiresAt: addDays(now, 365).toISOString(),
      purchaseCodeHint: 'LC-YEAR-****-TEST',
    }), 'utf8')
    const token = `${ACTIVATION_PREFIX}${payload.toString('base64url')}.${sign(null, payload, privateKey).toString('base64url')}`
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(verifyOfflineActivation(token, deviceId, publicPem, now).success).toBe(true)
    const otherDevice = verifyOfflineActivation(token, 'c'.repeat(64), publicPem, now)
    expect(otherDevice.success).toBe(false)
    if (!otherDevice.success) expect(otherDevice.error).toContain('其他电脑')
  })

  it('rejects a modified activation code', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      licenseId: 'license-test',
      deviceId: 'd'.repeat(64),
      plan: 'lifetime',
      issuedAt: now.toISOString(),
      expiresAt: null,
      purchaseCodeHint: 'LC-LIFE-****-TEST',
    }), 'utf8')
    const token = `${ACTIVATION_PREFIX}${payload.toString('base64url')}.${sign(null, payload, privateKey).toString('base64url')}`
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const tampered = token.replace('LC-ACT-', 'LC-ACT-X')
    expect(verifyOfflineActivation(tampered, 'd'.repeat(64), publicPem, now).success).toBe(false)
  })
})

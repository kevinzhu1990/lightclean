import { createHash, generateKeyPairSync } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeviceRequestCode, verifyOfflineActivation } from './license-core'

interface FakeCode {
  code_hash: string
  code_hint: string
  plan: 'annual'
  duration_days: number
  redeemed_at: string | null
  entitlement_expires_at: string | null
  disabled: number
}

interface FakeActivation {
  id: string
  code_hash: string
  device_id: string
  device_suffix: string
  plan: 'annual'
  expires_at: string | null
  token: string
  revoked_at: string | null
  issued_at: string
}

const fake = vi.hoisted(() => ({
  codes: new Map<string, FakeCode>(),
  activations: [] as FakeActivation[],
}))

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    pragma() {}
    exec() {}
    close() {}
    transaction<T>(callback: () => T) {
      return callback
    }
    prepare(sql: string) {
      if (sql.includes('SELECT * FROM codes')) {
        return { get: (hash: string) => fake.codes.get(hash) }
      }
      if (sql.includes('SELECT * FROM offline_activations')) {
        return {
          get: (hash: string) => fake.activations
            .filter((row) => row.code_hash === hash && !row.revoked_at)
            .sort((left, right) => right.issued_at.localeCompare(left.issued_at))[0],
        }
      }
      if (sql.includes('INSERT INTO offline_activations')) {
        return {
          run: (
            id: string,
            codeHash: string,
            deviceId: string,
            deviceSuffix: string,
            _request: string,
            plan: 'annual',
            issuedAt: string,
            expiresAt: string | null,
            token: string,
          ) => {
            fake.activations.push({
              id,
              code_hash: codeHash,
              device_id: deviceId,
              device_suffix: deviceSuffix,
              plan,
              expires_at: expiresAt,
              token,
              revoked_at: null,
              issued_at: issuedAt,
            })
          },
        }
      }
      if (sql.includes('UPDATE codes')) {
        return {
          run: (issuedAt: string, expiresAt: string | null, _licenseId: string, hash: string) => {
            const row = fake.codes.get(hash)
            if (row) {
              row.redeemed_at = issuedAt
              row.entitlement_expires_at = expiresAt
            }
          },
        }
      }
      throw new Error(`Unexpected SQL in test: ${sql}`)
    }
  }
  return { default: FakeDatabase }
})

import { issueOfflineLicense, normalizePurchaseCode } from './license-issuer-core'

const temporaryDirectories: string[] = []

beforeEach(() => {
  fake.codes.clear()
  fake.activations.splice(0)
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lightclean-issuer-'))
  temporaryDirectories.push(directory)
  const privateKeyPath = join(directory, 'lightclean-ed25519-private.pem')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))

  const purchaseCode = 'LC-YEAR-ABCD-EFGH-IJKL'
  const codeHash = createHash('sha256').update(purchaseCode).digest('hex')
  fake.codes.set(codeHash, {
    code_hash: codeHash,
    code_hint: 'LC-YEAR-****-IJKL',
    plan: 'annual',
    duration_days: 365,
    redeemed_at: null,
    entitlement_expires_at: null,
    disabled: 0,
  })

  return {
    databasePath: join(directory, 'licenses.db'),
    privateKeyPath,
    purchaseCode,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

describe('offline license issuer core', () => {
  it('normalizes purchase codes safely', () => {
    expect(normalizePurchaseCode(' lc_year_abcd-efgh-ijkl ')).toBe('LC-YEAR-ABCD-EFGH-IJKL')
    expect(() => normalizePurchaseCode('../bad')).toThrow('格式不正确')
  })

  it('issues a device-bound activation code and returns it again for the same device', () => {
    const data = fixture()
    const deviceId = 'a'.repeat(64)
    const deviceRequestCode = createDeviceRequestCode(deviceId, 'win32', 'x64', '1.3.0')
    const first = issueOfflineLicense({ ...data, deviceRequestCode })
    const second = issueOfflineLicense({ ...data, deviceRequestCode })

    expect(first.activationCode?.startsWith('LC-ACT-')).toBe(true)
    expect(second.activationCode).toBe(first.activationCode)
    expect(second.repeated).toBe(true)
    expect(verifyOfflineActivation(first.activationCode!, deviceId, data.publicKey).success).toBe(true)
  })

  it('rejects issuing an already-bound code to another device', () => {
    const data = fixture()
    issueOfflineLicense({
      ...data,
      deviceRequestCode: createDeviceRequestCode('b'.repeat(64), 'win32', 'x64', '1.3.0'),
    })

    expect(() => issueOfflineLicense({
      ...data,
      deviceRequestCode: createDeviceRequestCode('c'.repeat(64), 'win32', 'x64', '1.3.0'),
    })).toThrow('已绑定设备尾号')
  })

  it('rejects an unknown purchase code', () => {
    const data = fixture()
    expect(() => issueOfflineLicense({
      ...data,
      purchaseCode: 'LC-YEAR-NOT-FOUND-CODE',
      deviceRequestCode: createDeviceRequestCode('d'.repeat(64), 'win32', 'x64', '1.3.0'),
    })).toThrow('不存在或已停用')
  })
})

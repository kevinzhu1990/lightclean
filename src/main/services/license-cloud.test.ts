import { createHash, generateKeyPairSync } from 'crypto'
import { describe, expect, it } from 'vitest'
import worker from '../../../license-cloud/src/index'

describe('online redemption binding', () => {
  it('accepts the original device but rejects the same code on a second device', async () => {
    const code = 'LC-YEAR-TEST-CODE-1234'
    const codeHash = createHash('sha256').update(code).digest('hex')
    const row = {
      code_hash: codeHash,
      code_hint: 'LC-YEAR-****-1234',
      plan: 'annual',
      duration_days: 365,
      redeemed_at: null as string | null,
      entitlement_expires_at: null as string | null,
      current_activation_id: null as string | null,
      device_id: null as string | null,
      device_suffix: null as string | null,
      rebind_year: 0,
      rebind_count: 0,
      disabled: 0,
    }
    const { privateKey } = generateKeyPairSync('ed25519')
    const env = {
      LICENSE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      LICENSE_DB: {
        prepare(sql: string) {
          let parameters: unknown[] = []
          return {
            bind(...values: unknown[]) { parameters = values; return this },
            async first() { return parameters[0] === codeHash ? { ...row } : null },
            async run() {
              if (sql.includes('SET redeemed_at') && parameters[6] === codeHash && row.device_id === null) {
                row.redeemed_at = parameters[0] as string
                row.entitlement_expires_at = parameters[1] as string
                row.current_activation_id = parameters[2] as string
                row.device_id = parameters[3] as string
                row.device_suffix = parameters[4] as string
                return { success: true, meta: { changes: 1 } }
              }
              return { success: true, meta: { changes: 0 } }
            },
          }
        },
      },
    } as Parameters<typeof worker.fetch>[1]
    const activate = (deviceId: string) => worker.fetch(new Request('https://license.test/v1/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceId }),
    }), env)

    const first = await activate('a'.repeat(64))
    expect(first.status).toBe(200)
    expect((await first.json()).success).toBe(true)

    const selfRelease = await worker.fetch(new Request('https://license.test/v1/deactivate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceId: 'a'.repeat(64) }),
    }), env)
    expect(selfRelease.status).toBe(403)
    expect((await selfRelease.json()).error).toContain('人工审核')

    const second = await activate('b'.repeat(64))
    expect(second.status).toBe(409)
    const secondBody = await second.json()
    expect(secondBody.error).toContain('已绑定另一台电脑')
    expect(secondBody.error).toContain('人工审核')

    const original = await activate('a'.repeat(64))
    expect(original.status).toBe(200)
    expect((await original.json()).success).toBe(true)
  })
})

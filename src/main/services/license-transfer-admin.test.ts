import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { createDeviceRequestCode } from './license-core'

const script = resolve(process.cwd(), 'license-cloud', 'approve-transfer.mjs')

describe('seller-reviewed license transfer tool', () => {
  it('previews the exact code digest and replacement device without releasing the old binding', () => {
    const code = 'LC-YEAR-TEST-CODE-1234'
    const request = createDeviceRequestCode('b'.repeat(64), 'win32', 'x64', '1.3.6')
    const result = spawnSync(process.execPath, [script, '--preview'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LIGHTCLEAN_TRANSFER_CODE: code,
        LIGHTCLEAN_TRANSFER_REQUEST: request,
      },
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      codeHash: createHash('sha256').update(code).digest('hex'),
      newDeviceId: 'b'.repeat(64),
      newDeviceSuffix: 'BBBBBBBB',
    })
  })

  it('atomically assigns the reviewed device and keeps the original expiry', async () => {
    const admin = await import('../../../license-cloud/approve-transfer.mjs')
    expect(typeof admin.buildApprovedTransferSql).toBe('function')
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE codes (code_hash TEXT PRIMARY KEY, device_id TEXT, device_suffix TEXT, current_activation_id TEXT, entitlement_expires_at TEXT, disabled INTEGER, rebind_year INTEGER, rebind_count INTEGER)')
      database.prepare('INSERT INTO codes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        'c'.repeat(64), 'a'.repeat(64), 'AAAAAAAA', 'old-id', '2027-01-01T00:00:00.000Z', 0, 2026, 2,
      )
      const sql = admin.buildApprovedTransferSql({
        codeHash: 'c'.repeat(64),
        oldDeviceId: 'a'.repeat(64),
        newDeviceId: 'b'.repeat(64),
        newDeviceSuffix: 'BBBBBBBB',
        activationId: '00000000-0000-4000-8000-000000000001',
        nowIso: '2026-09-25T00:00:00.000Z',
        year: 2026,
      })
      database.exec(sql)
      const row = database.prepare('SELECT device_id, device_suffix, current_activation_id, entitlement_expires_at, rebind_count FROM codes').get()
      expect(row).toEqual({
        device_id: 'b'.repeat(64),
        device_suffix: 'BBBBBBBB',
        current_activation_id: '00000000-0000-4000-8000-000000000001',
        entitlement_expires_at: '2027-01-01T00:00:00.000Z',
        rebind_count: 3,
      })
    } finally {
      database.close()
    }
  })
})

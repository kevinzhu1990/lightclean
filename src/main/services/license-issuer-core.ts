import { createHash, randomUUID, sign } from 'crypto'
import { readFileSync } from 'fs'
import Database from 'better-sqlite3'
import type { LicenseAdminIssueResult, LicensePlan } from '../../shared/types'
import { ACTIVATION_PREFIX } from './license-core'

const REQUEST_PREFIX = 'LC-REQ-'
const PAID_PLANS = new Set<Exclude<LicensePlan, 'trial'>>([
  'quarter',
  'half_year',
  'annual',
  'lifetime',
])

interface DeviceRequestPayload {
  v: 1
  deviceId: string
  deviceSuffix: string
  platform: string
  arch: string
}

interface CodeRow {
  code_hash: string
  code_hint: string
  plan: Exclude<LicensePlan, 'trial'>
  duration_days: number | null
  redeemed_at: string | null
  entitlement_expires_at: string | null
  disabled: number
}

interface ActivationRow {
  id: string
  device_id: string
  device_suffix: string
  plan: Exclude<LicensePlan, 'trial'>
  expires_at: string | null
  token: string
}

function addDays(value: string, days: number): string {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString()
}

function parseDeviceRequest(raw: string): { request: string; payload: DeviceRequestPayload } {
  const request = raw.trim()
  if (!request.startsWith(REQUEST_PREFIX)) throw new Error('设备申请码格式不正确。')

  try {
    const payload = JSON.parse(
      Buffer.from(request.slice(REQUEST_PREFIX.length), 'base64url').toString('utf8'),
    ) as Partial<DeviceRequestPayload>
    if (
      payload.v !== 1
      || typeof payload.deviceId !== 'string'
      || !/^[a-f0-9]{64}$/.test(payload.deviceId)
      || typeof payload.deviceSuffix !== 'string'
      || !/^[A-Z0-9]{8}$/.test(payload.deviceSuffix)
      || typeof payload.platform !== 'string'
      || typeof payload.arch !== 'string'
    ) {
      throw new Error('invalid request payload')
    }
    return { request, payload: payload as DeviceRequestPayload }
  } catch {
    throw new Error('设备申请码无法读取，请让客户重新完整复制。')
  }
}

export function normalizePurchaseCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[\s_]+/g, '-')
  if (!/^[A-Z0-9-]{10,64}$/.test(code)) throw new Error('购买兑换码格式不正确。')
  return code
}

export function issueOfflineLicense(options: {
  purchaseCode: string
  deviceRequestCode: string
  databasePath: string
  privateKeyPath: string
}): LicenseAdminIssueResult {
  const code = normalizePurchaseCode(options.purchaseCode)
  const { request, payload: requestPayload } = parseDeviceRequest(options.deviceRequestCode)
  const privateKey = readFileSync(options.privateKeyPath, 'utf8')
  const database = new Database(options.databasePath)

  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE IF NOT EXISTS offline_activations (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_suffix TEXT NOT NULL,
        request_code TEXT NOT NULL,
        plan TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT,
        token TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (code_hash) REFERENCES codes(code_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_offline_code ON offline_activations(code_hash);
      CREATE INDEX IF NOT EXISTS idx_offline_device ON offline_activations(device_id);
    `)

    const codeHash = createHash('sha256').update(code).digest('hex')
    return database.transaction(() => {
      const row = database.prepare('SELECT * FROM codes WHERE code_hash = ?').get(codeHash) as CodeRow | undefined
      if (!row || row.disabled) throw new Error('购买兑换码不存在或已停用。')
      if (!PAID_PLANS.has(row.plan)) throw new Error('购买兑换码套餐类型无效。')
      if (row.entitlement_expires_at && new Date(row.entitlement_expires_at) <= new Date()) {
        throw new Error('该购买兑换码对应的套餐已经到期。')
      }

      const existing = database.prepare(`
        SELECT * FROM offline_activations
        WHERE code_hash = ? AND revoked_at IS NULL
        ORDER BY issued_at DESC LIMIT 1
      `).get(codeHash) as ActivationRow | undefined

      if (existing && existing.device_id !== requestPayload.deviceId) {
        throw new Error(`该兑换码已绑定设备尾号 ${existing.device_suffix}，不能签发给其他电脑。`)
      }
      if (existing) {
        return {
          success: true,
          activationCode: existing.token,
          plan: existing.plan,
          expiresAt: existing.expires_at,
          deviceSuffix: existing.device_suffix,
          repeated: true,
        }
      }

      const issuedAt = row.redeemed_at || new Date().toISOString()
      const expiresAt = row.plan === 'lifetime'
        ? null
        : (row.entitlement_expires_at || addDays(issuedAt, row.duration_days ?? 0))
      const licenseId = randomUUID()
      const activationPayload = {
        v: 1,
        licenseId,
        deviceId: requestPayload.deviceId,
        plan: row.plan,
        issuedAt,
        expiresAt,
        purchaseCodeHint: row.code_hint,
      }
      const payloadBytes = Buffer.from(JSON.stringify(activationPayload), 'utf8')
      const signature = sign(null, payloadBytes, privateKey)
      const token = `${ACTIVATION_PREFIX}${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`

      database.prepare(`
        INSERT INTO offline_activations
          (id, code_hash, device_id, device_suffix, request_code, plan, issued_at, expires_at, token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        licenseId,
        codeHash,
        requestPayload.deviceId,
        requestPayload.deviceSuffix,
        request,
        row.plan,
        issuedAt,
        expiresAt,
        token,
      )
      database.prepare(`
        UPDATE codes
        SET redeemed_at = ?, entitlement_expires_at = ?, current_activation_id = ?
        WHERE code_hash = ?
      `).run(issuedAt, expiresAt, licenseId, codeHash)

      return {
        success: true,
        activationCode: token,
        plan: row.plan,
        expiresAt,
        deviceSuffix: requestPayload.deviceSuffix,
        repeated: false,
      }
    })()
  } finally {
    database.close()
  }
}

import { createHash, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

const REQUEST_PREFIX = 'LC-REQ-'
const ACTIVATION_PREFIX = 'LC-ACT-'
const plans = new Set(['quarter', 'half_year', 'annual', 'lifetime'])

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function fail(message) {
  console.error(`错误：${message}`)
  process.exit(1)
}

function addDays(value, days) {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString()
}

function parseRequest(raw) {
  const request = String(raw || '').trim()
  if (!request.startsWith(REQUEST_PREFIX)) fail('设备申请码格式不正确。')
  try {
    const payload = JSON.parse(Buffer.from(request.slice(REQUEST_PREFIX.length), 'base64url').toString('utf8'))
    if (
      payload.v !== 1
      || typeof payload.deviceId !== 'string'
      || !/^[a-f0-9]{64}$/.test(payload.deviceId)
      || typeof payload.deviceSuffix !== 'string'
      || typeof payload.platform !== 'string'
      || typeof payload.arch !== 'string'
    ) {
      fail('设备申请码内容不完整。')
    }
    return { request, payload }
  } catch {
    fail('设备申请码无法读取，请让买家重新完整复制。')
  }
}

const rawCode = argument('--code')
const rawRequest = argument('--request')
const rebind = process.argv.includes('--rebind')
const copy = process.argv.includes('--copy')
if (!rawCode || !rawRequest) {
  fail('用法：node offline-issuer.mjs --code "购买兑换码" --request "LC-REQ-..." [--copy] [--rebind]')
}

const code = rawCode.trim().toUpperCase().replace(/[\s_]+/g, '-')
if (!/^[A-Z0-9-]{10,64}$/.test(code)) fail('购买兑换码格式不正确。')
const { request, payload: requestPayload } = parseRequest(rawRequest)
const keyPath = resolve(
  argument('--key')
    || process.env.LIGHTCLEAN_PRIVATE_KEY
    || '../轻净离线授权私钥/lightclean-ed25519-private.pem',
)
const databasePath = resolve(
  argument('--db')
    || process.env.LIGHTCLEAN_LICENSE_DB
    || './license-server/data/licenses.db',
)

let privateKey
try {
  privateKey = readFileSync(keyPath, 'utf8')
} catch {
  fail(`找不到授权私钥：${keyPath}`)
}

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
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
const issue = db.transaction(() => {
  const row = db.prepare('SELECT * FROM codes WHERE code_hash = ?').get(codeHash)
  if (!row || row.disabled) fail('购买兑换码不存在或已停用。')
  if (!plans.has(row.plan)) fail('购买兑换码套餐类型无效。')
  if (row.entitlement_expires_at && new Date(row.entitlement_expires_at) <= new Date()) {
    fail('该购买兑换码对应的套餐已经到期。')
  }

  const existing = db.prepare(`
    SELECT * FROM offline_activations
    WHERE code_hash = ? AND revoked_at IS NULL
    ORDER BY issued_at DESC LIMIT 1
  `).get(codeHash)

  if (existing && existing.device_id !== requestPayload.deviceId) {
    if (!rebind) {
      fail(`该兑换码已绑定设备尾号 ${existing.device_suffix}。确认售后换机后才能使用 --rebind。`)
    }
    const year = new Date().getUTCFullYear()
    const rebindCount = row.rebind_year === year ? row.rebind_count : 0
    if (rebindCount >= 2) fail('该兑换码本年度换绑次数已达到2次。')
    db.prepare('UPDATE offline_activations SET revoked_at = ? WHERE id = ?')
      .run(new Date().toISOString(), existing.id)
    db.prepare('UPDATE codes SET rebind_year = ?, rebind_count = ? WHERE code_hash = ?')
      .run(year, rebindCount + 1, codeHash)
  }

  if (existing && existing.device_id === requestPayload.deviceId) {
    return {
      token: existing.token,
      plan: existing.plan,
      expiresAt: existing.expires_at,
      deviceSuffix: existing.device_suffix,
      repeated: true,
    }
  }

  const issuedAt = row.redeemed_at || new Date().toISOString()
  const expiresAt = row.plan === 'lifetime'
    ? null
    : (row.entitlement_expires_at || addDays(issuedAt, row.duration_days))
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
  db.prepare(`
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
  db.prepare(`
    UPDATE codes
    SET redeemed_at = ?, entitlement_expires_at = ?, current_activation_id = ?
    WHERE code_hash = ?
  `).run(issuedAt, expiresAt, licenseId, codeHash)
  return { token, plan: row.plan, expiresAt, deviceSuffix: requestPayload.deviceSuffix, repeated: false }
})

const result = issue()
if (copy && process.platform === 'win32') {
  const copied = spawnSync('clip.exe', { input: result.token, encoding: 'utf8' })
  if (copied.status !== 0) console.error('提示：自动复制失败，请手动复制下方激活码。')
}
console.error(`成功：${result.repeated ? '已重新读取' : '已签发'} ${result.plan} 激活码`)
console.error(`设备尾号：${result.deviceSuffix}`)
console.error(`到期时间：${result.expiresAt || '永久有效'}`)
if (copy && process.platform === 'win32') console.error('激活码已复制到剪贴板。')
console.log(result.token)

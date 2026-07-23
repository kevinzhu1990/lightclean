import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

const port = Number(process.env.PORT || 3210)
const databasePath = resolve(process.env.LIGHTCLEAN_LICENSE_DB || './data/licenses.db')
const adminToken = process.env.LIGHTCLEAN_LICENSE_ADMIN_TOKEN || ''
mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS codes (
    code_hash TEXT PRIMARY KEY,
    code_hint TEXT NOT NULL,
    plan TEXT NOT NULL,
    duration_days INTEGER,
    created_at TEXT NOT NULL,
    redeemed_at TEXT,
    entitlement_expires_at TEXT,
    current_activation_id TEXT,
    rebind_year INTEGER NOT NULL DEFAULT 0,
    rebind_count INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activations (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    code_hash TEXT,
    plan TEXT NOT NULL,
    device_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT,
    deactivated_at TEXT,
    FOREIGN KEY (code_hash) REFERENCES codes(code_hash)
  );

  CREATE TABLE IF NOT EXISTS trials (
    device_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    activation_id TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activations_code ON activations(code_hash);
  CREATE INDEX IF NOT EXISTS idx_activations_device ON activations(device_id);
`)

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const nowIso = () => new Date().toISOString()
const addDays = (value, days) => {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString()
}
const validDevice = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const validCode = (value) => typeof value === 'string' && /^[A-Z0-9-]{10,64}$/.test(value)

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 32_768) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function issueActivation({ codeHash = null, plan, deviceId, expiresAt }) {
  const activationToken = randomBytes(32).toString('base64url')
  const activationId = randomUUID()
  const createdAt = nowIso()
  db.prepare(`
    INSERT INTO activations
      (id, token_hash, code_hash, plan, device_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(activationId, sha256(activationToken), codeHash, plan, deviceId, createdAt, createdAt, expiresAt)
  return { activationId, activationToken, startedAt: createdAt }
}

function publicLicense(activation, token, maskedCode) {
  return {
    success: true,
    plan: activation.plan,
    startedAt: activation.created_at,
    expiresAt: activation.expires_at,
    activationToken: token,
    maskedCode,
  }
}

const redeemTransaction = db.transaction((code, deviceId) => {
  const codeHash = sha256(code)
  const row = db.prepare('SELECT * FROM codes WHERE code_hash = ?').get(codeHash)
  if (!row || row.disabled) return { status: 404, data: { success: false, error: 'invalid_code' } }
  if (row.entitlement_expires_at && new Date(row.entitlement_expires_at) <= new Date()) {
    return { status: 410, data: { success: false, error: 'code_expired' } }
  }

  if (row.current_activation_id) {
    const current = db.prepare('SELECT * FROM activations WHERE id = ? AND deactivated_at IS NULL')
      .get(row.current_activation_id)
    if (current && current.device_id !== deviceId) {
      return { status: 409, data: { success: false, error: 'code_bound' } }
    }
    if (current) {
      const token = randomBytes(32).toString('base64url')
      db.prepare('UPDATE activations SET token_hash = ?, last_seen_at = ? WHERE id = ?')
        .run(sha256(token), nowIso(), current.id)
      return { status: 200, data: publicLicense(current, token, row.code_hint) }
    }
  }

  const redeemedAt = row.redeemed_at || nowIso()
  const expiresAt = row.plan === 'lifetime'
    ? null
    : (row.entitlement_expires_at || addDays(new Date(redeemedAt), row.duration_days))
  const issued = issueActivation({ codeHash, plan: row.plan, deviceId, expiresAt })
  db.prepare(`
    UPDATE codes
    SET redeemed_at = ?, entitlement_expires_at = ?, current_activation_id = ?
    WHERE code_hash = ?
  `).run(redeemedAt, expiresAt, issued.activationId, codeHash)
  const activation = db.prepare('SELECT * FROM activations WHERE id = ?').get(issued.activationId)
  return { status: 200, data: publicLicense(activation, issued.activationToken, row.code_hint) }
})

const deactivateTransaction = db.transaction((activation, codeRow) => {
  const year = new Date().getUTCFullYear()
  const count = codeRow.rebind_year === year ? codeRow.rebind_count : 0
  if (count >= 2) return { status: 429, data: { success: false, error: 'rebind_limit' } }
  db.prepare('UPDATE activations SET deactivated_at = ? WHERE id = ?').run(nowIso(), activation.id)
  db.prepare(`
    UPDATE codes
    SET current_activation_id = NULL, rebind_year = ?, rebind_count = ?
    WHERE code_hash = ?
  `).run(year, count + 1, codeRow.code_hash)
  return { status: 200, data: { success: true } }
})

async function route(request, response) {
  const url = new URL(request.url || '/', 'http://localhost')
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(response, 200, { ok: true, service: 'lightclean-license' })
  }
  if (request.method !== 'POST') return json(response, 404, { success: false, error: 'not_found' })

  let input
  try { input = await body(request) } catch {
    return json(response, 400, { success: false, error: 'invalid_request' })
  }

  if (url.pathname === '/v1/trials/start') {
    if (!validDevice(input.deviceId)) return json(response, 400, { success: false, error: 'invalid_request' })
    const existing = db.prepare('SELECT * FROM trials WHERE device_id = ?').get(input.deviceId)
    if (existing) {
      const token = randomBytes(32).toString('base64url')
      db.prepare('UPDATE activations SET token_hash = ?, last_seen_at = ? WHERE id = ?')
        .run(sha256(token), nowIso(), existing.activation_id)
      const activation = db.prepare('SELECT * FROM activations WHERE id = ?').get(existing.activation_id)
      return json(response, 200, publicLicense(activation, token, '免费试用'))
    }
    const startedAt = nowIso()
    const expiresAt = addDays(new Date(startedAt), 30)
    const issued = issueActivation({ plan: 'trial', deviceId: input.deviceId, expiresAt })
    db.prepare('INSERT INTO trials (device_id, started_at, expires_at, activation_id) VALUES (?, ?, ?, ?)')
      .run(input.deviceId, startedAt, expiresAt, issued.activationId)
    const activation = db.prepare('SELECT * FROM activations WHERE id = ?').get(issued.activationId)
    return json(response, 201, publicLicense(activation, issued.activationToken, '免费试用'))
  }

  if (url.pathname === '/v1/licenses/redeem') {
    if (!validDevice(input.deviceId) || !validCode(input.code)) {
      return json(response, 400, { success: false, error: 'invalid_request' })
    }
    const result = redeemTransaction(input.code, input.deviceId)
    return json(response, result.status, result.data)
  }

  if (url.pathname === '/v1/licenses/validate') {
    if (!validDevice(input.deviceId) || typeof input.activationToken !== 'string') {
      return json(response, 400, { success: false, error: 'invalid_request' })
    }
    const activation = db.prepare('SELECT * FROM activations WHERE token_hash = ? AND deactivated_at IS NULL')
      .get(sha256(input.activationToken))
    if (!activation || activation.device_id !== input.deviceId) {
      return json(response, 401, { success: false, error: 'invalid_code' })
    }
    if (activation.expires_at && new Date(activation.expires_at) <= new Date()) {
      return json(response, 410, { success: false, error: 'code_expired' })
    }
    db.prepare('UPDATE activations SET last_seen_at = ? WHERE id = ?').run(nowIso(), activation.id)
    const hint = activation.code_hash
      ? db.prepare('SELECT code_hint FROM codes WHERE code_hash = ?').get(activation.code_hash)?.code_hint
      : '免费试用'
    return json(response, 200, publicLicense(activation, input.activationToken, hint))
  }

  if (url.pathname === '/v1/licenses/deactivate') {
    if (!validDevice(input.deviceId) || typeof input.activationToken !== 'string') {
      return json(response, 400, { success: false, error: 'invalid_request' })
    }
    const activation = db.prepare('SELECT * FROM activations WHERE token_hash = ? AND deactivated_at IS NULL')
      .get(sha256(input.activationToken))
    if (!activation || activation.device_id !== input.deviceId || !activation.code_hash) {
      return json(response, 401, { success: false, error: 'invalid_code' })
    }
    const codeRow = db.prepare('SELECT * FROM codes WHERE code_hash = ?').get(activation.code_hash)
    const result = deactivateTransaction(activation, codeRow)
    return json(response, result.status, result.data)
  }

  if (url.pathname === '/v1/admin/disable-code') {
    const supplied = request.headers['authorization']?.replace(/^Bearer\s+/i, '') || ''
    if (!adminToken || supplied.length !== adminToken.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(adminToken))) {
      return json(response, 401, { success: false, error: 'unauthorized' })
    }
    if (!validCode(input.code)) return json(response, 400, { success: false, error: 'invalid_request' })
    db.prepare('UPDATE codes SET disabled = 1 WHERE code_hash = ?').run(sha256(input.code))
    return json(response, 200, { success: true })
  }

  return json(response, 404, { success: false, error: 'not_found' })
}

createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error)
    if (!response.headersSent) json(response, 500, { success: false, error: 'server_error' })
    else response.end()
  })
}).listen(port, '0.0.0.0', () => {
  console.log(`LightClean license service listening on port ${port}`)
})


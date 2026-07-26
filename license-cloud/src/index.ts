interface Env {
  LICENSE_DB: D1Database
  LICENSE_PRIVATE_KEY: string
  OFFLINE_DAYS?: string
  FEISHU_APP_ID?: string
  FEISHU_APP_SECRET?: string
  FEISHU_SPREADSHEET_TOKEN?: string
  FEISHU_SHEET_ID?: string
  FEISHU_STATUS_COLUMN?: string
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>
}

type PaidPlan = 'quarter' | 'half_year' | 'annual' | 'lifetime'

interface CodeRow {
  code_hash: string
  code_hint: string
  plan: PaidPlan
  duration_days: number | null
  redeemed_at: string | null
  entitlement_expires_at: string | null
  current_activation_id: string | null
  device_id: string | null
  device_suffix: string | null
  rebind_year: number
  rebind_count: number
  disabled: number
}

interface ActivationRequest {
  code?: unknown
  deviceId?: unknown
  deviceSuffix?: unknown
  appVersion?: unknown
  platform?: unknown
  arch?: unknown
}

interface DeactivationRequest {
  code?: unknown
  deviceId?: unknown
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_]+/g, '-')
}

function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function isPaidPlan(value: unknown): value is PaidPlan {
  return value === 'quarter'
    || value === 'half_year'
    || value === 'annual'
    || value === 'lifetime'
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function minDate(left: Date, right: Date | null): Date {
  return right && right.getTime() < left.getTime() ? right : left
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pemBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signActivation(payload: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(privateKeyPem),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('Ed25519', key, payloadBytes)
  return `LC-ACT-${base64Url(payloadBytes)}.${base64Url(new Uint8Array(signature))}`
}

async function readCode(env: Env, codeHash: string): Promise<CodeRow | null> {
  return env.LICENSE_DB.prepare(`
    SELECT code_hash, code_hint, plan, duration_days, redeemed_at,
           entitlement_expires_at, current_activation_id, device_id,
           device_suffix, rebind_year, rebind_count, disabled
    FROM codes
    WHERE code_hash = ?
  `).bind(codeHash).first<CodeRow>()
}

async function markFeishuUsed(env: Env, code: string, deviceSuffix: string): Promise<void> {
  if (
    !env.FEISHU_APP_ID
    || !env.FEISHU_APP_SECRET
    || !env.FEISHU_SPREADSHEET_TOKEN
    || !env.FEISHU_SHEET_ID
  ) return

  const authResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
    }),
  })
  const auth = await authResponse.json() as { code?: number; tenant_access_token?: string }
  if (!authResponse.ok || auth.code !== 0 || !auth.tenant_access_token) return

  const range = `${env.FEISHU_SHEET_ID}!A1:Z2000`
  const valuesResponse = await fetch(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(env.FEISHU_SPREADSHEET_TOKEN)}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${auth.tenant_access_token}` } },
  )
  const valuesBody = await valuesResponse.json() as {
    code?: number
    data?: { valueRange?: { values?: unknown[][] } }
  }
  const values = valuesBody.data?.valueRange?.values
  if (!valuesResponse.ok || valuesBody.code !== 0 || !Array.isArray(values)) return

  const normalized = normalizeCode(code)
  const rowIndex = values.findIndex((row) =>
    Array.isArray(row) && row.some((cell) =>
      typeof cell === 'string' && normalizeCode(cell) === normalized,
    ),
  )
  if (rowIndex < 0) return

  const rowNumber = rowIndex + 1
  const statusColumn = env.FEISHU_STATUS_COLUMN || 'D'
  const updateRange = `${env.FEISHU_SHEET_ID}!${statusColumn}${rowNumber}:${statusColumn}${rowNumber}`
  await fetch(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(env.FEISHU_SPREADSHEET_TOKEN)}/values`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${auth.tenant_access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        valueRange: {
          range: updateRange,
          values: [['已使用']],
        },
      }),
    },
  )

  void deviceSuffix
}

async function activate(request: Request, env: Env): Promise<Response> {
  let body: ActivationRequest
  try {
    body = await request.json() as ActivationRequest
  } catch {
    return json({ success: false, error: '请求格式不正确。' }, 400)
  }

  if (typeof body.code !== 'string' || !/^LC-[A-Z0-9-]{8,64}$/i.test(normalizeCode(body.code))) {
    return json({ success: false, error: '兑换码格式不正确，请完整复制后重试。' }, 400)
  }
  if (!isDeviceId(body.deviceId)) {
    return json({ success: false, error: '无法识别当前电脑，请重新启动轻净后重试。' }, 400)
  }

  const code = normalizeCode(body.code)
  const codeHash = await sha256(code)
  let row = await readCode(env, codeHash)
  if (!row || !isPaidPlan(row.plan)) {
    return json({ success: false, error: '兑换码不存在，请核对后重试。' }, 404)
  }
  if (row.disabled) {
    return json({ success: false, error: '该兑换码已停用，请联系卖家处理。' }, 403)
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const suffix = typeof body.deviceSuffix === 'string' && /^[A-Z0-9]{4,16}$/.test(body.deviceSuffix)
    ? body.deviceSuffix
    : body.deviceId.slice(-8).toUpperCase()

  if (row.device_id && row.device_id !== body.deviceId) {
    return json({
      success: false,
      error: `该兑换码已绑定另一台电脑。如需换机，请先在原电脑解除授权或联系卖家。`,
      boundDeviceSuffix: row.device_suffix,
    }, 409)
  }

  if (!row.device_id) {
    const activationId = crypto.randomUUID()
    const entitlementExpiresAt = row.entitlement_expires_at
      ?? (row.duration_days ? addDays(now, row.duration_days).toISOString() : null)
    const update = await env.LICENSE_DB.prepare(`
      UPDATE codes
      SET redeemed_at = COALESCE(redeemed_at, ?),
          entitlement_expires_at = COALESCE(entitlement_expires_at, ?),
          current_activation_id = ?,
          device_id = ?,
          device_suffix = ?,
          last_seen_at = ?
      WHERE code_hash = ? AND device_id IS NULL
    `).bind(
      nowIso,
      entitlementExpiresAt,
      activationId,
      body.deviceId,
      suffix,
      nowIso,
      codeHash,
    ).run()
    if (!update.success) return json({ success: false, error: '激活服务暂时不可用，请稍后重试。' }, 503)
    row = await readCode(env, codeHash)
    if (!row || row.device_id !== body.deviceId) {
      return json({ success: false, error: '兑换码刚刚被其他电脑绑定，请联系卖家处理。' }, 409)
    }
    await markFeishuUsed(env, code, suffix).catch(() => {})
  } else {
    await env.LICENSE_DB.prepare(`
      UPDATE codes SET last_seen_at = ? WHERE code_hash = ? AND device_id = ?
    `).bind(nowIso, codeHash, body.deviceId).run()
  }
  await markFeishuUsed(env, code, suffix).catch(() => {})

  if (row.entitlement_expires_at && new Date(row.entitlement_expires_at).getTime() <= now.getTime()) {
    return json({ success: false, error: '该兑换码对应的套餐已经到期，请续费后再试。' }, 403)
  }

  const offlineDays = Math.min(30, Math.max(1, Number(env.OFFLINE_DAYS || 14) || 14))
  const offlineUntil = minDate(
    addDays(now, offlineDays),
    row.entitlement_expires_at ? new Date(row.entitlement_expires_at) : null,
  ).toISOString()
  const token = await signActivation({
    v: 2,
    licenseId: row.current_activation_id,
    deviceId: body.deviceId,
    plan: row.plan,
    issuedAt: nowIso,
    expiresAt: row.entitlement_expires_at,
    offlineUntil,
    purchaseCodeHint: row.code_hint,
  }, env.LICENSE_PRIVATE_KEY)

  return json({
    success: true,
    activationToken: token,
    plan: row.plan,
    expiresAt: row.entitlement_expires_at,
    offlineUntil,
    deviceSuffix: suffix,
  })
}

async function deactivate(request: Request, env: Env): Promise<Response> {
  let body: DeactivationRequest
  try {
    body = await request.json() as DeactivationRequest
  } catch {
    return json({ success: false, error: '请求格式不正确。' }, 400)
  }
  if (typeof body.code !== 'string' || !isDeviceId(body.deviceId)) {
    return json({ success: false, error: '授权信息不完整。' }, 400)
  }

  const codeHash = await sha256(normalizeCode(body.code))
  const row = await readCode(env, codeHash)
  if (!row || row.device_id !== body.deviceId) {
    return json({ success: false, error: '当前电脑没有可解除的授权。' }, 404)
  }

  const year = new Date().getUTCFullYear()
  const currentCount = row.rebind_year === year ? row.rebind_count : 0
  if (currentCount >= 2) {
    return json({ success: false, error: '本年度换绑次数已用完，请联系卖家处理。' }, 403)
  }

  const result = await env.LICENSE_DB.prepare(`
    UPDATE codes
    SET device_id = NULL,
        device_suffix = NULL,
        current_activation_id = NULL,
        last_seen_at = ?,
        rebind_year = ?,
        rebind_count = ?
    WHERE code_hash = ? AND device_id = ?
  `).bind(new Date().toISOString(), year, currentCount + 1, codeHash, body.deviceId).run()
  if (!result.success) return json({ success: false, error: '解除授权失败，请稍后重试。' }, 503)
  return json({ success: true, message: '当前电脑授权已解除，可在新电脑上重新激活。' })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'LightClean License', version: 1 })
    }
    if (request.method === 'POST' && url.pathname === '/v1/activate') {
      return activate(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/v1/deactivate') {
      return deactivate(request, env)
    }
    return json({ success: false, error: '接口不存在。' }, 404)
  },
}

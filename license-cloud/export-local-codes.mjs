import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../license-server/data/licenses.db')
const target = resolve(here, 'import-codes.sql')
const db = new Database(source, { readonly: true })

const hasOfflineTable = Boolean(db.prepare(`
  SELECT 1 AS found FROM sqlite_master
  WHERE type = 'table' AND name = 'offline_activations'
`).get())

const rows = hasOfflineTable
  ? db.prepare(`
      SELECT c.*,
             a.device_id AS bound_device_id,
             a.device_suffix AS bound_device_suffix
      FROM codes c
      LEFT JOIN offline_activations a
        ON a.id = c.current_activation_id
       AND a.revoked_at IS NULL
      ORDER BY c.created_at, c.code_hash
    `).all()
  : db.prepare(`
      SELECT c.*, NULL AS bound_device_id, NULL AS bound_device_suffix
      FROM codes c
      ORDER BY c.created_at, c.code_hash
    `).all()
db.close()

function sql(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

const statements = [
  ...rows.map((row) => `
INSERT INTO codes (
  code_hash, code_hint, plan, duration_days, created_at, redeemed_at,
  entitlement_expires_at, current_activation_id, device_id, device_suffix,
  last_seen_at, rebind_year, rebind_count, disabled
) VALUES (
  ${sql(row.code_hash)}, ${sql(row.code_hint)}, ${sql(row.plan)}, ${sql(row.duration_days)},
  ${sql(row.created_at)}, ${sql(row.redeemed_at)}, ${sql(row.entitlement_expires_at)},
  ${sql(row.current_activation_id)}, ${sql(row.bound_device_id)}, ${sql(row.bound_device_suffix)},
  ${sql(row.redeemed_at)}, ${sql(row.rebind_year)}, ${sql(row.rebind_count)}, ${sql(row.disabled)}
)
ON CONFLICT(code_hash) DO UPDATE SET
  code_hint = excluded.code_hint,
  plan = excluded.plan,
  duration_days = excluded.duration_days,
  created_at = excluded.created_at,
  redeemed_at = excluded.redeemed_at,
  entitlement_expires_at = excluded.entitlement_expires_at,
  current_activation_id = excluded.current_activation_id,
  device_id = excluded.device_id,
  device_suffix = excluded.device_suffix,
  last_seen_at = excluded.last_seen_at,
  rebind_year = excluded.rebind_year,
  rebind_count = excluded.rebind_count,
  disabled = excluded.disabled;`.trim()),
  '',
]

writeFileSync(target, statements.join('\n'), 'utf8')
console.log(`已准备迁移 ${rows.length} 张兑换码；导出文件不包含任何原始兑换码。`)

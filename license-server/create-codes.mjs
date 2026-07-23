import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

const plans = {
  quarter: { prefix: 'QTR', days: 90 },
  half_year: { prefix: 'HALF', days: 180 },
  annual: { prefix: 'YEAR', days: 365 },
  lifetime: { prefix: 'LIFE', days: null },
}

const plan = process.argv[2]
const count = Number(process.argv[3] || 1)
const outputIndex = process.argv.indexOf('--output')
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : ''
if (!plans[plan] || !Number.isInteger(count) || count < 1 || count > 1000) {
  console.error('用法: npm run codes -- <quarter|half_year|annual|lifetime> <数量1-1000>')
  process.exit(1)
}

const databasePath = resolve(process.env.LIGHTCLEAN_LICENSE_DB || './data/licenses.db')
mkdirSync(dirname(databasePath), { recursive: true })
const db = new Database(databasePath)
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
  )
`)

const insert = db.prepare(`
  INSERT INTO codes (code_hash, code_hint, plan, duration_days, created_at)
  VALUES (?, ?, ?, ?, ?)
`)
const generated = []
const create = db.transaction(() => {
  for (let index = 0; index < count; index += 1) {
    const body = randomBytes(9).toString('base64url').toUpperCase()
      .replace(/[^A-Z0-9]/g, 'X').slice(0, 12)
    const groups = body.match(/.{1,4}/g).join('-')
    const code = `LC-${plans[plan].prefix}-${groups}`
    const hint = `${code.slice(0, 8)}-****-${code.slice(-4)}`
    insert.run(createHash('sha256').update(code).digest('hex'), hint, plan, plans[plan].days, new Date().toISOString())
    generated.push(code)
  }
})
create()

if (outputPath) {
  const resolvedOutput = resolve(outputPath)
  mkdirSync(dirname(resolvedOutput), { recursive: true })
  writeFileSync(resolvedOutput, JSON.stringify({ plan, codes: generated }, null, 2), 'utf8')
  console.error(`已生成 ${generated.length} 个${plan}兑换码并保存到指定文件。`)
} else {
  console.log(generated.join('\n'))
  console.error(`已生成 ${generated.length} 个${plan}兑换码，请妥善保存；数据库只保存哈希，无法找回原码。`)
}

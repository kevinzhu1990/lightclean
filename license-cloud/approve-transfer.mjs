import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const directory = dirname(fileURLToPath(import.meta.url))
const wrangler = join(directory, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const database = 'lightclean-license'

export function transferTarget(code, requestCode) {
  const normalized = code.trim().toUpperCase().replace(/[\s_]+/g, '-')
  if (!/^LC-[A-Z0-9-]{8,64}$/.test(normalized)) {
    throw new Error('兑换码格式不正确，请完整复制客户使用的兑换码。')
  }
  const request = requestCode.trim()
  if (!/^LC-REQ-[A-Za-z0-9_-]{16,2048}$/.test(request)) {
    throw new Error('新电脑设备申请码格式不正确。')
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(request.slice('LC-REQ-'.length), 'base64url').toString('utf8'))
  } catch {
    throw new Error('新电脑设备申请码无法读取，请让客户重新完整复制。')
  }
  if (
    payload?.v !== 1
    || typeof payload.deviceId !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.deviceId)
    || payload.deviceSuffix !== payload.deviceId.slice(-8).toUpperCase()
    || !['win32', 'darwin', 'linux'].includes(payload.platform)
    || typeof payload.arch !== 'string'
  ) {
    throw new Error('新电脑设备申请码内容无效，请让客户重新生成。')
  }
  return {
    codeHash: createHash('sha256').update(normalized).digest('hex'),
    newDeviceId: payload.deviceId,
    newDeviceSuffix: payload.deviceSuffix,
  }
}

export function buildApprovedTransferSql({
  codeHash, oldDeviceId, newDeviceId, newDeviceSuffix, activationId, nowIso, year,
}) {
  if (
    ![codeHash, oldDeviceId, newDeviceId].every((value) => /^[a-f0-9]{64}$/.test(value))
    || newDeviceSuffix !== newDeviceId.slice(-8).toUpperCase()
    || !/^[a-f0-9-]{36}$/.test(activationId)
    || Number.isNaN(Date.parse(nowIso))
    || !Number.isInteger(year)
  ) {
    throw new Error('换机数据不完整，未修改授权。')
  }
  return `UPDATE codes SET device_id = '${newDeviceId}', device_suffix = '${newDeviceSuffix}', current_activation_id = '${activationId}', rebind_count = CASE WHEN rebind_year = ${year} THEN rebind_count + 1 ELSE 1 END, rebind_year = ${year} WHERE code_hash = '${codeHash}' AND device_id = '${oldDeviceId}' AND disabled = 0 AND (entitlement_expires_at IS NULL OR entitlement_expires_at > '${nowIso}')`
}

function runSql(sql) {
  if (!existsSync(wrangler)) {
    throw new Error('未安装 Cloudflare 管理工具，请先在 license-cloud 目录运行 npm ci。')
  }
  const result = spawnSync(process.execPath, [
    wrangler, 'd1', 'execute', database, '--remote', '--yes', '--json', '--command', sql,
  ], { cwd: directory, encoding: 'utf8', timeout: 30_000 })
  if (result.error || result.status !== 0) {
    throw new Error('无法访问云端兑换码数据库。请先运行 npx wrangler login，再重试。')
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error('云端数据库返回了无法识别的结果，未继续换机。')
  }
  const operation = Array.isArray(parsed) ? parsed[0] : parsed
  if (!operation?.success) throw new Error('云端数据库操作失败，未继续换机。')
  return operation
}

async function main() {
  if (process.argv[2] === '--preview') {
    const code = process.env.LIGHTCLEAN_TRANSFER_CODE || ''
    const request = process.env.LIGHTCLEAN_TRANSFER_REQUEST || ''
    process.stdout.write(`${JSON.stringify(transferTarget(code, request))}\n`)
    return
  }
  if (process.argv.length > 2) throw new Error('请直接运行 npm run transfer:approve。')
  if (!process.stdin.isTTY) throw new Error('人工审核工具必须在交互终端运行。')

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('先核对订单与客户身份，再批准换机；不要只凭兑换码批准。')
    const code = await prompt.question('客户兑换码：')
    const request = await prompt.question('新电脑设备申请码：')
    const target = transferTarget(code, request)
    const lookup = runSql(`SELECT code_hint, plan, device_id, device_suffix, entitlement_expires_at, disabled FROM codes WHERE code_hash = '${target.codeHash}'`)
    const row = lookup.results?.[0]
    if (!row) throw new Error('兑换码不存在，未执行换机。')
    if (row.disabled) throw new Error('兑换码已停用，未执行换机。')
    if (typeof row.device_id !== 'string' || !/^[a-f0-9]{64}$/.test(row.device_id)) {
      throw new Error('此兑换码尚未绑定电脑，不能按换机流程处理。')
    }
    if (row.device_id === target.newDeviceId) {
      throw new Error('新旧设备相同，无需换机。')
    }
    const now = new Date()
    if (row.entitlement_expires_at && new Date(row.entitlement_expires_at).getTime() <= now.getTime()) {
      throw new Error('套餐已到期，请先处理续费。')
    }

    console.log(`兑换码：${row.code_hint}；套餐：${row.plan}`)
    console.log(`原设备尾号：${row.device_suffix} → 新设备尾号：${target.newDeviceSuffix}`)
    console.log(`到期时间：${row.entitlement_expires_at || '永久有效'}`)
    console.log('批准后旧设备的离线凭证在剩余有效期内仍可能使用，最长 14 天。')
    const confirmation = await prompt.question(`已核对订单和客户身份？输入 APPROVE ${target.newDeviceSuffix}：`)
    if (confirmation.trim() !== `APPROVE ${target.newDeviceSuffix}`) {
      console.log('已取消，授权未改变。')
      return
    }

    const update = runSql(buildApprovedTransferSql({
      ...target,
      oldDeviceId: row.device_id,
      activationId: randomUUID(),
      nowIso: now.toISOString(),
      year: now.getUTCFullYear(),
    }))
    if (update.meta?.changes !== 1) {
      throw new Error('授权状态在审核期间发生变化，未改绑；请重新核对。')
    }
    console.log(`已批准换机。请让客户在新电脑输入原兑换码，设备尾号 ${target.newDeviceSuffix}。`)
  } finally {
    prompt.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : '换机审核失败。')
    process.exitCode = 1
  })
}

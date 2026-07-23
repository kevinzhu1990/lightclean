import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, safeStorage } from 'electron'
import type { LicenseActionResult, LicensePlan, LicenseStatus } from '../../shared/types'
import { getDataDir, getMachineId } from './settings-store'
import {
  addDays,
  buildLicenseStatus,
  normalizeRedemptionCode,
  TRIAL_DAYS,
  type StoredLicense,
} from './license-core'

interface ServerLicenseResponse {
  success: boolean
  plan?: LicensePlan
  startedAt?: string
  expiresAt?: string | null
  activationToken?: string
  maskedCode?: string
  error?: string
  message?: string
}

const STORE_FILE = 'license.dat'
const REQUEST_TIMEOUT_MS = 12_000

function storePath(): string {
  return join(getDataDir(), STORE_FILE)
}

function deviceId(): string {
  return createHash('sha256')
    .update(`lightclean-license-v1:${getMachineId()}:${process.platform}:${process.arch}`)
    .digest('hex')
}

function deviceSuffix(): string {
  return deviceId().slice(-8).toUpperCase()
}

function configuredServerUrl(): string {
  const envUrl = process.env.LIGHTCLEAN_LICENSE_API_URL?.trim()
  if (envUrl) return envUrl.replace(/\/+$/, '')
  const configPath = app.isPackaged
    ? join(process.resourcesPath, 'license-config.json')
    : join(app.getAppPath(), 'resources', 'license-config.json')
  try {
    const value = JSON.parse(readFileSync(configPath, 'utf8')) as { apiUrl?: string }
    return value.apiUrl?.trim().replace(/\/+$/, '') ?? ''
  } catch {
    return ''
  }
}

function readStored(): StoredLicense | null {
  try {
    const raw = readFileSync(storePath())
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return JSON.parse(json) as StoredLicense
  } catch {
    return null
  }
}

function writeStored(value: StoredLicense): void {
  mkdirSync(getDataDir(), { recursive: true })
  const json = JSON.stringify(value)
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  writeFileSync(storePath(), data)
}

function ensureLocalTrial(): StoredLicense {
  const existing = readStored()
  if (existing) return existing
  const startedAt = new Date()
  const trial: StoredLicense = {
    plan: 'trial',
    startedAt: startedAt.toISOString(),
    expiresAt: addDays(startedAt, TRIAL_DAYS).toISOString(),
  }
  writeStored(trial)
  return trial
}

async function post(pathname: string, body: Record<string, unknown>): Promise<ServerLicenseResponse> {
  const baseUrl = configuredServerUrl()
  if (!baseUrl) return { success: false, error: 'service_unconfigured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json() as ServerLicenseResponse
    return response.ok ? data : { ...data, success: false }
  } catch {
    return { success: false, error: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(code?: string): string {
  switch (code) {
    case 'invalid_code': return '兑换码无效，请检查后重新输入。'
    case 'code_bound': return '该兑换码已绑定其他电脑。'
    case 'code_expired': return '该兑换码对应的套餐已到期。'
    case 'rebind_limit': return '本年度换绑次数已用完，请联系客服处理。'
    case 'network': return '无法连接授权服务，请检查网络后重试。'
    case 'service_unconfigured': return '授权服务尚未配置，请联系轻净客服。'
    default: return '授权操作失败，请稍后重试。'
  }
}

function fromServer(data: ServerLicenseResponse): StoredLicense | null {
  if (!data.plan || !data.startedAt || !data.activationToken) return null
  return {
    plan: data.plan,
    startedAt: data.startedAt,
    expiresAt: data.expiresAt ?? null,
    activationToken: data.activationToken,
    maskedCode: data.maskedCode,
    lastValidatedAt: new Date().toISOString(),
  }
}

export async function getLicenseStatus(refresh = false): Promise<LicenseStatus> {
  const serverUrl = configuredServerUrl()
  let stored = readStored()
  if (!stored) {
    if (serverUrl) {
      const trial = await post('/v1/trials/start', {
        deviceId: deviceId(),
        appVersion: app.getVersion(),
      })
      const issued = trial.success ? fromServer(trial) : null
      if (!issued) {
        return buildLicenseStatus(
          null,
          deviceSuffix(),
          true,
          new Date(),
          errorMessage(trial.error),
        )
      }
      stored = issued
      writeStored(issued)
    } else {
      stored = ensureLocalTrial()
    }
  }
  if (refresh && stored.activationToken && serverUrl) {
    const result = await post('/v1/licenses/validate', {
      activationToken: stored.activationToken,
      deviceId: deviceId(),
      appVersion: app.getVersion(),
    })
    if (result.success) {
      const updated = fromServer(result)
      if (updated) {
        stored = updated
        writeStored(updated)
      }
    } else {
      return buildLicenseStatus(stored, deviceSuffix(), true, new Date(), errorMessage(result.error))
    }
  }
  return buildLicenseStatus(stored, deviceSuffix(), !!serverUrl)
}

export async function redeemLicense(rawCode: unknown): Promise<LicenseActionResult> {
  const current = ensureLocalTrial()
  if (typeof rawCode !== 'string') {
    return { success: false, status: await getLicenseStatus(), error: '请输入有效的兑换码。' }
  }
  const code = normalizeRedemptionCode(rawCode)
  if (!/^[A-Z0-9-]{10,64}$/.test(code)) {
    return { success: false, status: await getLicenseStatus(), error: '兑换码格式不正确。' }
  }
  const result = await post('/v1/licenses/redeem', {
    code,
    deviceId: deviceId(),
    appVersion: app.getVersion(),
    trialStartedAt: current.plan === 'trial' ? current.startedAt : undefined,
  })
  const stored = result.success ? fromServer(result) : null
  if (!stored) {
    return { success: false, status: await getLicenseStatus(), error: errorMessage(result.error) }
  }
  writeStored(stored)
  return { success: true, status: buildLicenseStatus(stored, deviceSuffix(), true) }
}

export async function deactivateLicense(): Promise<LicenseActionResult> {
  const stored = readStored()
  if (!stored?.activationToken) {
    return { success: false, status: await getLicenseStatus(), error: '当前没有可解绑的付费授权。' }
  }
  const result = await post('/v1/licenses/deactivate', {
    activationToken: stored.activationToken,
    deviceId: deviceId(),
  })
  if (!result.success) {
    return { success: false, status: await getLicenseStatus(), error: errorMessage(result.error) }
  }
  const startedAt = new Date()
  const expiredTrial: StoredLicense = {
    plan: 'trial',
    startedAt: startedAt.toISOString(),
    expiresAt: startedAt.toISOString(),
  }
  writeStored(expiredTrial)
  return {
    success: true,
    status: buildLicenseStatus(expiredTrial, deviceSuffix(), !!configuredServerUrl(), new Date(), '设备已解绑。'),
  }
}

export function isLicenseStorePresent(): boolean {
  return existsSync(storePath())
}

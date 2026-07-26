import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, safeStorage } from 'electron'
import type { LicenseActionResult, LicenseStatus } from '../../shared/types'
import { getDataDir, getMachineId } from './settings-store'
import {
  addDays,
  buildLicenseStatus,
  createDeviceRequestCode,
  normalizeRedemptionCode,
  TRIAL_DAYS,
  verifyOfflineActivation,
  type StoredLicense,
} from './license-core'

const STORE_FILE = 'license.dat'
const DEFAULT_LICENSE_API_URL = 'https://lightclean-license.617705109.workers.dev'

interface CloudActivationResponse {
  success: boolean
  activationToken?: string
  plan?: StoredLicense['plan']
  expiresAt?: string | null
  offlineUntil?: string
  error?: string
}

function licenseApiUrl(): string {
  return (process.env.LIGHTCLEAN_LICENSE_API_URL || DEFAULT_LICENSE_API_URL).replace(/\/+$/, '')
}

async function callLicenseApi(
  path: '/v1/activate' | '/v1/deactivate',
  code: string,
): Promise<CloudActivationResponse> {
  const apiUrl = licenseApiUrl()
  if (apiUrl.includes('REPLACE_WITH_SUBDOMAIN')) {
    throw new Error('轻净在线授权服务尚未完成部署，请联系卖家。')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        deviceId: deviceId(),
        deviceSuffix: deviceSuffix(),
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      }),
      signal: controller.signal,
    })
    const body = await response.json() as CloudActivationResponse
    if (!response.ok || !body.success) {
      return { success: false, error: body.error || '授权服务暂时不可用，请稍后重试。' }
    }
    return body
  } catch (error) {
    if (error instanceof Error && error.message.includes('尚未完成部署')) throw error
    throw new Error('无法连接授权服务，请检查网络后重试。')
  } finally {
    clearTimeout(timeout)
  }
}

function storeCloudActivation(
  code: string,
  result: CloudActivationResponse,
): StoredLicense {
  if (!result.activationToken) throw new Error('授权服务返回的数据不完整，请稍后重试。')
  const verified = verifyOfflineActivation(result.activationToken, deviceId(), publicKeyPem())
  if (!verified.success) throw new Error(verified.error)
  const stored: StoredLicense = {
    plan: verified.payload.plan,
    startedAt: verified.payload.issuedAt,
    expiresAt: verified.payload.expiresAt,
    offlineUntil: verified.payload.offlineUntil ?? null,
    activationToken: result.activationToken,
    redemptionCode: normalizeRedemptionCode(code),
    maskedCode: verified.payload.purchaseCodeHint,
    licenseId: verified.payload.licenseId,
    activationMode: 'online',
  }
  writeStored(stored)
  return stored
}

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

function requestCode(): string {
  return createDeviceRequestCode(deviceId(), process.platform, process.arch, app.getVersion())
}

function publicKeyPem(): string {
  const keyPath = app.isPackaged
    ? join(process.resourcesPath, 'offline-license-public-key.pem')
    : join(app.getAppPath(), 'resources', 'offline-license-public-key.pem')
  return readFileSync(keyPath, 'utf8')
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

function statusFor(stored: StoredLicense, message?: string): LicenseStatus {
  return buildLicenseStatus(stored, deviceSuffix(), requestCode(), new Date(), message)
}

function validateStored(stored: StoredLicense): StoredLicense {
  if (!stored.activationToken) return stored
  const result = verifyOfflineActivation(stored.activationToken, deviceId(), publicKeyPem())
  if (!result.success) {
    return {
      plan: stored.plan,
      startedAt: stored.startedAt,
      expiresAt: new Date(0).toISOString(),
      maskedCode: stored.maskedCode,
    }
  }
  return {
    plan: result.payload.plan,
    startedAt: result.payload.issuedAt,
    expiresAt: result.payload.expiresAt,
    offlineUntil: result.payload.offlineUntil ?? stored.offlineUntil ?? null,
    activationToken: stored.activationToken,
    redemptionCode: stored.redemptionCode,
    maskedCode: result.payload.purchaseCodeHint,
    licenseId: result.payload.licenseId,
    activationMode: result.payload.v === 2 ? 'online' : (stored.activationMode ?? 'offline'),
  }
}

export async function getLicenseStatus(refresh = false): Promise<LicenseStatus> {
  let stored = validateStored(ensureLocalTrial())
  if (refresh && stored.activationMode === 'online' && stored.redemptionCode) {
    try {
      const result = await callLicenseApi('/v1/activate', stored.redemptionCode)
      if (result.success) stored = storeCloudActivation(stored.redemptionCode, result)
      else return statusFor(stored, result.error)
    } catch (error) {
      return statusFor(
        stored,
        error instanceof Error ? error.message : '无法连接授权服务，请检查网络后重试。',
      )
    }
  }
  return statusFor(stored)
}

export async function redeemLicense(rawCode: unknown): Promise<LicenseActionResult> {
  if (typeof rawCode !== 'string' || !rawCode.trim()) {
    return {
      success: false,
      status: await getLicenseStatus(),
      error: '请输入卖家发给您的完整兑换码。',
    }
  }
  const code = rawCode.trim()
  if (!code.startsWith('LC-ACT-')) {
    try {
      const result = await callLicenseApi('/v1/activate', normalizeRedemptionCode(code))
      if (!result.success) {
        return { success: false, status: await getLicenseStatus(), error: result.error }
      }
      const stored = storeCloudActivation(code, result)
      return {
        success: true,
        status: statusFor(stored, '激活成功。本机已绑定，断网后仍可继续使用14天。'),
      }
    } catch (error) {
      return {
        success: false,
        status: await getLicenseStatus(),
        error: error instanceof Error ? error.message : '无法连接授权服务，请检查网络后重试。',
      }
    }
  }
  let result
  try {
    result = verifyOfflineActivation(code, deviceId(), publicKeyPem())
  } catch {
    return {
      success: false,
      status: await getLicenseStatus(),
      error: '授权公钥无法读取，请重新安装轻净后再试。',
    }
  }
  if (!result.success) {
    return { success: false, status: await getLicenseStatus(), error: result.error }
  }
  const stored: StoredLicense = {
    plan: result.payload.plan,
    startedAt: result.payload.issuedAt,
    expiresAt: result.payload.expiresAt,
    activationToken: code,
    maskedCode: result.payload.purchaseCodeHint,
    licenseId: result.payload.licenseId,
  }
  writeStored(stored)
  return { success: true, status: statusFor(stored, '离线授权已生效，无需联网即可使用全部功能。') }
}

export async function deactivateLicense(): Promise<LicenseActionResult> {
  const stored = readStored()
  if (!stored?.activationToken) {
    return { success: false, status: await getLicenseStatus(), error: '当前电脑没有可移除的付费授权。' }
  }
  if (stored.activationMode === 'online' && stored.redemptionCode) {
    try {
      const result = await callLicenseApi('/v1/deactivate', stored.redemptionCode)
      if (!result.success) {
        return { success: false, status: await getLicenseStatus(), error: result.error }
      }
    } catch (error) {
      return {
        success: false,
        status: await getLicenseStatus(),
        error: error instanceof Error ? error.message : '解除授权需要联网，请检查网络后重试。',
      }
    }
  }
  const now = new Date()
  const expiredTrial: StoredLicense = {
    plan: 'trial',
    startedAt: now.toISOString(),
    expiresAt: now.toISOString(),
  }
  writeStored(expiredTrial)
  return {
    success: true,
    status: statusFor(expiredTrial, '本机授权已解除，可以在新电脑上输入原兑换码激活。'),
  }
}

export function isLicenseStorePresent(): boolean {
  return existsSync(storePath())
}

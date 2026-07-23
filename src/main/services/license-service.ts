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
  TRIAL_DAYS,
  verifyOfflineActivation,
  type StoredLicense,
} from './license-core'

const STORE_FILE = 'license.dat'

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
    activationToken: stored.activationToken,
    maskedCode: result.payload.purchaseCodeHint,
    licenseId: result.payload.licenseId,
  }
}

export async function getLicenseStatus(_refresh = false): Promise<LicenseStatus> {
  const stored = validateStored(ensureLocalTrial())
  return statusFor(stored)
}

export async function redeemLicense(rawCode: unknown): Promise<LicenseActionResult> {
  if (typeof rawCode !== 'string' || !rawCode.trim()) {
    return {
      success: false,
      status: await getLicenseStatus(),
      error: '请输入卖家根据本机设备申请码生成的完整激活码。',
    }
  }
  let result
  try {
    result = verifyOfflineActivation(rawCode, deviceId(), publicKeyPem())
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
    activationToken: rawCode.trim(),
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
  const now = new Date()
  const expiredTrial: StoredLicense = {
    plan: 'trial',
    startedAt: now.toISOString(),
    expiresAt: now.toISOString(),
  }
  writeStored(expiredTrial)
  return {
    success: true,
    status: statusFor(expiredTrial, '本机授权已移除。如需换电脑，请联系卖家重新签发。'),
  }
}

export function isLicenseStorePresent(): boolean {
  return existsSync(storePath())
}

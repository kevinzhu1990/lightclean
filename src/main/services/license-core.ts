import { verify } from 'crypto'
import type { LicensePlan, LicenseState, LicenseStatus } from '../../shared/types'

export const TRIAL_DAYS = 30
export const ACTIVATION_PREFIX = 'LC-ACT-'
export const REQUEST_PREFIX = 'LC-REQ-'

export interface StoredLicense {
  plan: LicensePlan
  startedAt: string
  expiresAt: string | null
  activationToken?: string
  maskedCode?: string
  licenseId?: string
}

export interface OfflineActivationPayload {
  v: 1
  licenseId: string
  deviceId: string
  plan: Exclude<LicensePlan, 'trial'>
  issuedAt: string
  expiresAt: string | null
  purchaseCodeHint: string
}

const PLAN_LABELS: Record<LicensePlan, string> = {
  trial: '30天免费试用',
  quarter: '季度版',
  half_year: '半年版',
  annual: '一年版',
  lifetime: '买断版',
}

export function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

export function daysRemaining(expiresAt: string | null, now = new Date()): number | null {
  if (!expiresAt) return null
  const diff = new Date(expiresAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

export function buildLicenseStatus(
  stored: StoredLicense | null,
  deviceIdSuffix: string,
  deviceRequestCode: string,
  now = new Date(),
  messageOverride?: string,
): LicenseStatus {
  if (!stored) {
    return {
      state: 'needs_activation',
      plan: null,
      planLabel: '未激活',
      expiresAt: null,
      daysRemaining: null,
      canUsePaidFeatures: false,
      deviceIdSuffix,
      message: messageOverride ?? '请复制设备申请码，向卖家换取本机激活码。',
      deviceRequestCode,
      activationMode: 'offline',
    }
  }

  const expiresAt = stored.expiresAt
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now.getTime() : false
  let state: LicenseState = stored.plan === 'trial' ? 'trial' : 'active'
  let allowed = true
  let message = stored.plan === 'trial'
    ? '免费试用期间可使用全部功能。'
    : '授权有效，可使用全部功能。'

  if (expired) {
    state = 'expired'
    allowed = false
    message = stored.plan === 'trial'
      ? '免费试用已结束，请使用本机激活码继续使用。'
      : '当前套餐已到期，续费后即可继续使用。'
  }

  return {
    state,
    plan: stored.plan,
    planLabel: PLAN_LABELS[stored.plan],
    expiresAt,
    daysRemaining: daysRemaining(expiresAt, now),
    canUsePaidFeatures: allowed,
    deviceIdSuffix,
    message: messageOverride ?? message,
    deviceRequestCode,
    activationMode: 'offline',
  }
}

export function normalizeRedemptionCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_]+/g, '-')
}

function isPaidPlan(value: unknown): value is Exclude<LicensePlan, 'trial'> {
  return value === 'quarter'
    || value === 'half_year'
    || value === 'annual'
    || value === 'lifetime'
}

export function createDeviceRequestCode(
  deviceId: string,
  platform: string,
  arch: string,
  appVersion: string,
): string {
  const payload = {
    v: 1,
    deviceId,
    deviceSuffix: deviceId.slice(-8).toUpperCase(),
    platform,
    arch,
    appVersion,
  }
  return `${REQUEST_PREFIX}${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`
}

export function verifyOfflineActivation(
  rawToken: string,
  expectedDeviceId: string,
  publicKeyPem: string,
  now = new Date(),
): { success: true; payload: OfflineActivationPayload } | { success: false; error: string } {
  const token = rawToken.trim()
  if (!token.startsWith(ACTIVATION_PREFIX)) {
    return { success: false, error: '激活码格式不正确，请完整复制卖家发给您的激活码。' }
  }
  const parts = token.slice(ACTIVATION_PREFIX.length).split('.')
  if (parts.length !== 2 || parts.some((part) => !part || part.length > 4096)) {
    return { success: false, error: '激活码格式不正确，请完整复制卖家发给您的激活码。' }
  }
  try {
    const payloadBytes = Buffer.from(parts[0], 'base64url')
    const signature = Buffer.from(parts[1], 'base64url')
    if (!verify(null, payloadBytes, publicKeyPem, signature)) {
      return { success: false, error: '激活码签名无效，请联系卖家重新生成。' }
    }
    const value = JSON.parse(payloadBytes.toString('utf8')) as Partial<OfflineActivationPayload>
    if (
      value.v !== 1
      || typeof value.licenseId !== 'string'
      || typeof value.deviceId !== 'string'
      || !isPaidPlan(value.plan)
      || typeof value.issuedAt !== 'string'
      || !(typeof value.expiresAt === 'string' || value.expiresAt === null)
      || typeof value.purchaseCodeHint !== 'string'
    ) {
      return { success: false, error: '激活码内容不完整，请联系卖家重新生成。' }
    }
    if (value.deviceId !== expectedDeviceId) {
      return { success: false, error: '该激活码属于其他电脑，请发送本机设备申请码重新获取。' }
    }
    if (Number.isNaN(new Date(value.issuedAt).getTime())) {
      return { success: false, error: '激活码日期无效，请联系卖家重新生成。' }
    }
    if (value.expiresAt && new Date(value.expiresAt).getTime() <= now.getTime()) {
      return { success: false, error: '该激活码对应的套餐已到期，请续费后重新获取。' }
    }
    return { success: true, payload: value as OfflineActivationPayload }
  } catch {
    return { success: false, error: '激活码无法读取，请完整复制后重试。' }
  }
}

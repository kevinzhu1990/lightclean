import type { LicensePlan, LicenseState, LicenseStatus } from '../../shared/types'

export const TRIAL_DAYS = 30
export const VALIDATION_INTERVAL_DAYS = 7
export const OFFLINE_GRACE_DAYS = 14

export interface StoredLicense {
  plan: LicensePlan
  startedAt: string
  expiresAt: string | null
  activationToken?: string
  maskedCode?: string
  lastValidatedAt?: string
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
  serverConfigured: boolean,
  now = new Date(),
  messageOverride?: string,
): LicenseStatus {
  if (!stored) {
    return {
      state: serverConfigured ? 'needs_activation' : 'service_unavailable',
      plan: null,
      planLabel: '未激活',
      expiresAt: null,
      daysRemaining: null,
      canUsePaidFeatures: false,
      deviceIdSuffix,
      lastValidatedAt: null,
      nextValidationAt: null,
      offlineGraceEndsAt: null,
      message: messageOverride ?? (serverConfigured
        ? '请输入购买后收到的兑换码。'
        : '授权服务尚未配置，请联系轻净客服。'),
      serverConfigured,
    }
  }

  const expiresAt = stored.expiresAt
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now.getTime() : false
  const lastValidated = stored.lastValidatedAt ? new Date(stored.lastValidatedAt) : null
  const nextValidation = lastValidated ? addDays(lastValidated, VALIDATION_INTERVAL_DAYS) : null
  const graceEnds = lastValidated ? addDays(lastValidated, OFFLINE_GRACE_DAYS) : null
  let state: LicenseState = stored.plan === 'trial' ? 'trial' : 'active'
  let allowed = true
  let message = stored.plan === 'trial'
    ? '免费试用期间可使用全部功能。'
    : '授权有效，可使用全部功能。'

  if (expired) {
    state = 'expired'
    allowed = false
    message = stored.plan === 'trial'
      ? '免费试用已结束，请输入兑换码继续使用。'
      : '当前套餐已到期，续费后即可继续使用。'
  } else if (stored.activationToken && lastValidated && graceEnds && now > graceEnds) {
    state = 'expired'
    allowed = false
    message = '已超过14天离线宽限期，请联网验证授权。'
  } else if (stored.activationToken && nextValidation && now > nextValidation) {
    state = 'grace'
    message = '暂时无法连接授权服务，当前处于离线宽限期。'
  }

  return {
    state,
    plan: stored.plan,
    planLabel: PLAN_LABELS[stored.plan],
    expiresAt,
    daysRemaining: daysRemaining(expiresAt, now),
    canUsePaidFeatures: allowed,
    deviceIdSuffix,
    lastValidatedAt: stored.lastValidatedAt ?? null,
    nextValidationAt: nextValidation?.toISOString() ?? null,
    offlineGraceEndsAt: graceEnds?.toISOString() ?? null,
    message: messageOverride ?? message,
    serverConfigured,
  }
}

export function normalizeRedemptionCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_]+/g, '-')
}


import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import type {
  LicenseFeishuConfig,
  LicenseFeishuConfigInput,
  LicenseFeishuTestResult,
} from '../../shared/types'
import { getDataDir } from './settings-store'
import { normalizePurchaseCode } from './license-issuer-core'
import { isAdmin } from './elevation'

const CONFIG_FILE = 'license-feishu-sync.json'
const DEFAULT_WIKI_URL = 'https://dcnz34opa4ey.feishu.cn/wiki/HwmEwuUwOiBZnsk1jjkcrbu7nwd'
const DEFAULT_SHEET_TITLE = '兑换码台账'

interface StoredConfig {
  appId: string
  appSecretEncrypted: string
  wikiUrl: string
  sheetTitle: string
}

interface FeishuResponse<T> {
  code: number
  msg: string
  data: T
  tenant_access_token?: string
}

interface ResolvedSheet {
  accessToken: string
  spreadsheetToken: string
  spreadsheetTitle: string
  sheetId: string
  sheetTitle: string
}

function configPath(): string {
  return join(getDataDir(), CONFIG_FILE)
}

function requireAdmin(): void {
  if (process.platform !== 'win32' || !isAdmin()) {
    throw new Error('请先以管理员身份重新启动轻净。')
  }
}

function emptyStoredConfig(): StoredConfig {
  return {
    appId: '',
    appSecretEncrypted: '',
    wikiUrl: DEFAULT_WIKI_URL,
    sheetTitle: DEFAULT_SHEET_TITLE,
  }
}

function readStoredConfig(): StoredConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<StoredConfig>
    return {
      appId: typeof parsed.appId === 'string' ? parsed.appId : '',
      appSecretEncrypted: typeof parsed.appSecretEncrypted === 'string' ? parsed.appSecretEncrypted : '',
      wikiUrl: typeof parsed.wikiUrl === 'string' && parsed.wikiUrl
        ? parsed.wikiUrl
        : DEFAULT_WIKI_URL,
      sheetTitle: typeof parsed.sheetTitle === 'string' && parsed.sheetTitle
        ? parsed.sheetTitle
        : DEFAULT_SHEET_TITLE,
    }
  } catch {
    return emptyStoredConfig()
  }
}

function decryptSecret(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全加密飞书密钥，请在正常 Windows 桌面环境中配置。')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function publicConfig(stored: StoredConfig): LicenseFeishuConfig {
  const secretSaved = Boolean(decryptSecret(stored.appSecretEncrypted))
  const configured = Boolean(stored.appId && secretSaved && extractWikiToken(stored.wikiUrl))
  return {
    configured,
    appId: stored.appId,
    appSecretSaved: secretSaved,
    wikiUrl: stored.wikiUrl,
    sheetTitle: stored.sheetTitle,
    message: configured
      ? '飞书自动同步已配置，签发成功后会更新兑换码台账。'
      : '请填写飞书自建应用凭证，保存并测试连接。',
  }
}

function extractWikiToken(value: string): string {
  const match = value.trim().match(/\/wiki\/([A-Za-z0-9_-]+)/)
  return match?.[1] ?? ''
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<FeishuResponse<T>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.json() as FeishuResponse<T>
    if (!response.ok || body.code !== 0) {
      throw new Error(`${label}失败：${body.msg || `HTTP ${response.status}`}`)
    }
    return body
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label}超时，请检查网络后重试。`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveSheet(stored: StoredConfig): Promise<ResolvedSheet> {
  const appSecret = decryptSecret(stored.appSecretEncrypted)
  if (!stored.appId || !appSecret) throw new Error('飞书应用凭证尚未配置。')
  const wikiToken = extractWikiToken(stored.wikiUrl)
  if (!wikiToken) throw new Error('飞书台账链接格式不正确。')

  const tokenResponse = await requestJson<Record<string, never>>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: stored.appId, app_secret: appSecret }),
    },
    '获取飞书访问凭证',
  )
  const resolvedAccessToken = tokenResponse.tenant_access_token
  if (!resolvedAccessToken) throw new Error('飞书没有返回访问凭证。')

  const authHeaders = {
    Authorization: `Bearer ${resolvedAccessToken}`,
    'Content-Type': 'application/json; charset=utf-8',
  }
  const nodeResponse = await requestJson<{
    node: { obj_token: string; obj_type: string; title: string }
  }>(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`,
    { method: 'GET', headers: authHeaders },
    '读取飞书知识库台账',
  )
  if (nodeResponse.data.node.obj_type !== 'sheet') {
    throw new Error('飞书链接指向的不是电子表格。')
  }
  const spreadsheetToken = nodeResponse.data.node.obj_token

  const sheetsResponse = await requestJson<{
    sheets: Array<{ sheet_id: string; title: string }>
  }>(
    `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`,
    { method: 'GET', headers: authHeaders },
    '读取飞书工作表列表',
  )
  const sheet = sheetsResponse.data.sheets.find((item) => item.title === stored.sheetTitle)
  if (!sheet) throw new Error(`没有找到名为“${stored.sheetTitle}”的工作表。`)

  return {
    accessToken: resolvedAccessToken,
    spreadsheetToken,
    spreadsheetTitle: nodeResponse.data.node.title,
    sheetId: sheet.sheet_id,
    sheetTitle: sheet.title,
  }
}

export function getLicenseFeishuConfig(): LicenseFeishuConfig {
  requireAdmin()
  return publicConfig(readStoredConfig())
}

export function saveLicenseFeishuConfig(input: LicenseFeishuConfigInput): LicenseFeishuConfig {
  requireAdmin()
  const current = readStoredConfig()
  const appId = input.appId.trim()
  const appSecret = input.appSecret?.trim() ?? ''
  const wikiUrl = input.wikiUrl.trim()
  const sheetTitle = input.sheetTitle.trim()
  if (!appId) throw new Error('请输入飞书 App ID。')
  if (!extractWikiToken(wikiUrl)) throw new Error('请输入正确的飞书知识库台账链接。')
  if (!sheetTitle) throw new Error('请输入工作表名称。')
  if (!appSecret && !decryptSecret(current.appSecretEncrypted)) {
    throw new Error('请输入飞书 App Secret。')
  }

  const stored: StoredConfig = {
    appId,
    appSecretEncrypted: appSecret ? encryptSecret(appSecret) : current.appSecretEncrypted,
    wikiUrl,
    sheetTitle,
  }
  mkdirSync(getDataDir(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(stored, null, 2), 'utf8')
  return publicConfig(stored)
}

export async function testLicenseFeishuConnection(): Promise<LicenseFeishuTestResult> {
  requireAdmin()
  try {
    const resolved = await resolveSheet(readStoredConfig())
    return {
      success: true,
      message: '飞书连接成功，可以自动更新兑换码状态。',
      spreadsheetTitle: resolved.spreadsheetTitle,
      sheetTitle: resolved.sheetTitle,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '飞书连接测试失败。',
    }
  }
}

export async function syncRedeemedCodeToFeishu(purchaseCode: string): Promise<{
  success: boolean
  message: string
  row?: number
}> {
  const stored = readStoredConfig()
  if (!publicConfig(stored).configured) {
    return { success: false, message: '飞书自动同步尚未配置。' }
  }

  try {
    const code = normalizePurchaseCode(purchaseCode)
    const resolved = await resolveSheet(stored)
    const authHeaders = {
      Authorization: `Bearer ${resolved.accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    }
    const readRange = `${resolved.sheetId}!A1:F1000`
    const valuesResponse = await requestJson<{
      valueRange: { values: unknown[][] }
    }>(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(resolved.spreadsheetToken)}/values/${encodeURIComponent(readRange)}`,
      { method: 'GET', headers: authHeaders },
      '读取飞书兑换码台账',
    )
    const values = valuesResponse.data.valueRange.values ?? []
    const rowIndex = values.findIndex((row) =>
      typeof row?.[2] === 'string' && normalizePurchaseCode(row[2]) === code)
    if (rowIndex < 0) throw new Error('飞书台账中没有找到这枚兑换码。')

    const rowNumber = rowIndex + 1
    const writeRange = `${resolved.sheetId}!D${rowNumber}:D${rowNumber}`
    await requestJson(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(resolved.spreadsheetToken)}/values`,
      {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          valueRange: {
            range: writeRange,
            values: [['已使用']],
          },
        }),
      },
      '更新飞书兑换码状态',
    )
    return {
      success: true,
      message: `飞书第 ${rowNumber} 行已标记为已使用。`,
      row: rowNumber,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '飞书自动同步失败。',
    }
  }
}

import { createPublicKey } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import type { LicenseAdminIssueResult, LicenseAdminStatus } from '../../shared/types'
import { isAdmin } from './elevation'
import { getDataDir } from './settings-store'
import { issueOfflineLicense } from './license-issuer-core'
import { syncRedeemedCodeToFeishu } from './license-feishu-sync'

interface AdminPaths {
  databasePath: string | null
  privateKeyPath: string | null
}

const CONFIG_FILE = 'license-admin.json'
const DATABASE_NAME = 'licenses.db'
const PRIVATE_KEY_NAME = 'lightclean-ed25519-private.pem'

function configPath(): string {
  return join(getDataDir(), CONFIG_FILE)
}

function readConfig(): AdminPaths {
  try {
    const value = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<AdminPaths>
    return {
      databasePath: typeof value.databasePath === 'string' ? value.databasePath : null,
      privateKeyPath: typeof value.privateKeyPath === 'string' ? value.privateKeyPath : null,
    }
  } catch {
    return { databasePath: null, privateKeyPath: null }
  }
}

function writeConfig(value: AdminPaths): void {
  mkdirSync(getDataDir(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(value, null, 2), 'utf8')
}

function firstExisting(paths: Array<string | null | undefined>): string | null {
  for (const candidate of paths) {
    if (candidate && existsSync(candidate)) return resolve(candidate)
  }
  return null
}

function discoverPaths(): AdminPaths {
  const stored = readConfig()
  const appPath = app.getAppPath()
  const projectRoot = app.isPackaged ? null : appPath
  const sellerRoot = 'D:\\Documents\\轻净软件'

  return {
    databasePath: firstExisting([
      process.env.LIGHTCLEAN_LICENSE_DB,
      stored.databasePath,
      projectRoot && join(projectRoot, 'license-server', 'data', DATABASE_NAME),
      join(sellerRoot, 'lightclean-publish-menu', 'license-server', 'data', DATABASE_NAME),
    ]),
    privateKeyPath: firstExisting([
      process.env.LIGHTCLEAN_PRIVATE_KEY,
      stored.privateKeyPath,
      projectRoot && join(dirname(projectRoot), '轻净离线授权私钥', PRIVATE_KEY_NAME),
      join(sellerRoot, '轻净离线授权私钥', PRIVATE_KEY_NAME),
    ]),
  }
}

function bundledPublicKey(): string {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'offline-license-public-key.pem')
    : join(app.getAppPath(), 'resources', 'offline-license-public-key.pem')
  return readFileSync(path, 'utf8').trim()
}

function privateKeyMatches(path: string | null): boolean {
  if (!path || !existsSync(path)) return false
  try {
    const derived = createPublicKey(readFileSync(path, 'utf8'))
      .export({ type: 'spki', format: 'pem' })
      .toString()
      .trim()
    return derived === bundledPublicKey()
  } catch {
    return false
  }
}

export function getLicenseAdminStatus(): LicenseAdminStatus {
  const supported = process.platform === 'win32'
  const elevated = supported && isAdmin()
  const paths = discoverPaths()
  const databaseFound = Boolean(paths.databasePath && existsSync(paths.databasePath))
  const privateKeyFound = Boolean(paths.privateKeyPath && existsSync(paths.privateKeyPath))
  const keyMatches = privateKeyMatches(paths.privateKeyPath)
  const ready = elevated && databaseFound && privateKeyFound && keyMatches

  let message = '管理员发码功能仅支持 Windows。'
  if (supported && !elevated) message = '请先以管理员身份重新启动轻净。'
  else if (supported && !databaseFound) message = '请选择兑换码数据库 licenses.db。'
  else if (supported && !privateKeyFound) message = '请选择离线授权私钥。'
  else if (supported && !keyMatches) message = '所选私钥与轻净内置公钥不匹配，请勿继续签发。'
  else if (ready) message = '管理员身份和授权资料校验通过，可以签发激活码。'

  return {
    supported,
    isAdmin: elevated,
    databasePath: paths.databasePath,
    privateKeyPath: paths.privateKeyPath,
    databaseFound,
    privateKeyFound,
    keyMatches,
    ready,
    message,
  }
}

export async function selectLicenseAdminFile(
  kind: 'database' | 'privateKey',
): Promise<LicenseAdminStatus> {
  if (process.platform !== 'win32' || !isAdmin()) return getLicenseAdminStatus()

  const expectedName = kind === 'database' ? DATABASE_NAME : PRIVATE_KEY_NAME
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    title: kind === 'database' ? '选择轻净兑换码数据库' : '选择轻净离线授权私钥',
    properties: ['openFile'],
    filters: kind === 'database'
      ? [{ name: '轻净兑换码数据库', extensions: ['db'] }]
      : [{ name: 'PEM 私钥', extensions: ['pem'] }],
  }
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return getLicenseAdminStatus()

  const selected = resolve(result.filePaths[0])
  if (basename(selected).toLowerCase() !== expectedName.toLowerCase()) {
    throw new Error(`请选择名为 ${expectedName} 的文件。`)
  }
  const current = readConfig()
  writeConfig({
    databasePath: kind === 'database' ? selected : current.databasePath,
    privateKeyPath: kind === 'privateKey' ? selected : current.privateKeyPath,
  })
  return getLicenseAdminStatus()
}

export async function issueLicenseAsAdmin(
  purchaseCode: unknown,
  deviceRequestCode: unknown,
): Promise<LicenseAdminIssueResult> {
  if (process.platform !== 'win32') return { success: false, error: '管理员发码功能仅支持 Windows。' }
  if (!isAdmin()) return { success: false, error: '请先以管理员身份重新启动轻净。' }
  if (typeof purchaseCode !== 'string' || typeof deviceRequestCode !== 'string') {
    return { success: false, error: '购买兑换码或设备申请码格式不正确。' }
  }

  const status = getLicenseAdminStatus()
  if (!status.ready || !status.databasePath || !status.privateKeyPath) {
    return { success: false, error: status.message }
  }
  try {
    const result = issueOfflineLicense({
      purchaseCode,
      deviceRequestCode,
      databasePath: status.databasePath,
      privateKeyPath: status.privateKeyPath,
    })
    if (!result.success) return result
    return {
      ...result,
      feishuSync: await syncRedeemedCodeToFeishu(purchaseCode),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '签发失败，请检查授权资料后重试。',
    }
  }
}

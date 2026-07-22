import { createHash, verify } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RulePackManifest, RulePackStatus } from '../../shared/types'
import type { RulesJsonSet } from './loader'
import { getDataDir } from '../services/settings-store'

export const BUNDLED_RULE_VERSION = '1.2.4'
export const RULE_FILES = [
  'system.json',
  'browsers.json',
  'apps.json',
  'gaming.json',
  'gpu-cache.json',
  'steam.json',
  'databases.json',
  'misc.json',
] as const

// Public release key. The corresponding private key must never be shipped with the app.
export const OFFICIAL_RULE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=
-----END PUBLIC KEY-----`

interface RulePackState {
  activeVersion: string | null
  previousVersion: string | null
  platform: string
}

let restartRequired = false

export function canonicalManifestPayload(manifest: Omit<RulePackManifest, 'signature'>): string {
  const files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    platform: manifest.platform,
    releasedAt: manifest.releasedAt,
    changelog: manifest.changelog,
    files,
  })
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function statePath(dataDir: string): string {
  return join(dataDir, 'rule-packs', 'state.json')
}

function readState(dataDir: string, platform: string): RulePackState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dataDir), 'utf8')) as RulePackState
    if (parsed.platform === platform) return parsed
  } catch { /* use bundled rules */ }
  return { activeVersion: null, previousVersion: null, platform }
}

function writeState(dataDir: string, state: RulePackState): void {
  const dir = join(dataDir, 'rule-packs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(statePath(dataDir), JSON.stringify(state, null, 2), 'utf8')
}

function packPath(dataDir: string, platform: string, version: string): string {
  return join(dataDir, 'rule-packs', platform, version)
}

export function verifyRulePackDirectory(
  directory: string,
  platform: 'win32' | 'darwin' | 'linux',
  publicKey = OFFICIAL_RULE_PUBLIC_KEY,
): { valid: boolean; manifest?: RulePackManifest; error?: string } {
  try {
    const manifestPath = join(directory, 'manifest.json')
    if (!existsSync(manifestPath)) return { valid: false, error: '规则包缺少 manifest.json。' }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RulePackManifest
    if (manifest.schemaVersion !== 1) return { valid: false, error: '规则包格式版本不受支持。' }
    if (manifest.platform !== platform) return { valid: false, error: '规则包与当前系统不匹配。' }
    if (!/^[0-9A-Za-z._-]{1,40}$/.test(manifest.version)) return { valid: false, error: '规则包版本号无效。' }
    if (!Array.isArray(manifest.changelog) || !manifest.changelog.every((item) => typeof item === 'string')) {
      return { valid: false, error: '规则包变更说明无效。' }
    }
    for (const file of RULE_FILES) {
      const expected = manifest.files[file]
      if (!/^[0-9a-f]{64}$/i.test(expected || '')) return { valid: false, error: `规则文件 ${file} 缺少有效哈希。` }
      const target = join(directory, file)
      if (!existsSync(target) || sha256File(target) !== expected.toLowerCase()) {
        return { valid: false, error: `规则文件 ${file} 校验失败。` }
      }
    }
    const { signature, ...unsigned } = manifest
    const signatureValid = verify(
      null,
      Buffer.from(canonicalManifestPayload(unsigned)),
      publicKey,
      Buffer.from(signature || '', 'base64'),
    )
    if (!signatureValid) return { valid: false, error: '规则包签名无效，已拒绝安装。' }
    return { valid: true, manifest }
  } catch {
    return { valid: false, error: '无法读取规则包，请检查文件是否完整。' }
  }
}

export function installRulePackDirectory(
  sourceDirectory: string,
  platform: 'win32' | 'darwin' | 'linux',
  dataDir = getDataDir(),
  publicKey = OFFICIAL_RULE_PUBLIC_KEY,
): RulePackStatus {
  const checked = verifyRulePackDirectory(sourceDirectory, platform, publicKey)
  if (!checked.valid || !checked.manifest) return getRulePackStatus(platform, dataDir, checked.error, publicKey)

  const manifest = checked.manifest
  const destination = packPath(dataDir, platform, manifest.version)
  mkdirSync(destination, { recursive: true })
  for (const file of RULE_FILES) copyFileSync(join(sourceDirectory, file), join(destination, file))
  copyFileSync(join(sourceDirectory, 'manifest.json'), join(destination, 'manifest.json'))

  const previous = readState(dataDir, platform)
  writeState(dataDir, {
    activeVersion: manifest.version,
    previousVersion: previous.activeVersion,
    platform,
  })
  restartRequired = true
  return getRulePackStatus(platform, dataDir, undefined, publicKey)
}

export function rollbackRulePack(platform: 'win32' | 'darwin' | 'linux', dataDir = getDataDir(), publicKey = OFFICIAL_RULE_PUBLIC_KEY): RulePackStatus {
  const state = readState(dataDir, platform)
  if (!state.previousVersion) return getRulePackStatus(platform, dataDir, '没有可回滚的规则版本。', publicKey)
  const next = state.previousVersion
  const checked = verifyRulePackDirectory(packPath(dataDir, platform, next), platform, publicKey)
  if (!checked.valid) return getRulePackStatus(platform, dataDir, checked.error, publicKey)
  writeState(dataDir, { activeVersion: next, previousVersion: state.activeVersion, platform })
  restartRequired = true
  return getRulePackStatus(platform, dataDir, undefined, publicKey)
}

export function getRulePackStatus(
  platform: 'win32' | 'darwin' | 'linux',
  dataDir = getDataDir(),
  error?: string,
  publicKey = OFFICIAL_RULE_PUBLIC_KEY,
): RulePackStatus {
  const state = readState(dataDir, platform)
  if (!state.activeVersion) {
    return {
      source: 'bundled', version: BUNDLED_RULE_VERSION, platform, changelog: ['内置安全清理规则'],
      signatureValid: true, canRollback: false, restartRequired, error,
    }
  }
  const checked = verifyRulePackDirectory(packPath(dataDir, platform, state.activeVersion), platform, publicKey)
  return {
    source: checked.valid ? 'local' : 'bundled',
    version: checked.valid && checked.manifest ? checked.manifest.version : BUNDLED_RULE_VERSION,
    platform,
    changelog: checked.valid && checked.manifest ? checked.manifest.changelog : ['内置安全清理规则'],
    signatureValid: checked.valid,
    canRollback: Boolean(state.previousVersion),
    restartRequired,
    error: error || checked.error,
  }
}

export function loadActiveRules(
  bundled: RulesJsonSet,
  platform: 'win32' | 'darwin' | 'linux',
  dataDir?: string,
): RulesJsonSet {
  let resolvedDataDir = dataDir
  if (!resolvedDataDir) {
    try { resolvedDataDir = getDataDir() } catch { return bundled }
  }
  const state = readState(resolvedDataDir, platform)
  if (!state.activeVersion) return bundled
  const directory = packPath(resolvedDataDir, platform, state.activeVersion)
  const checked = verifyRulePackDirectory(directory, platform)
  if (!checked.valid) return bundled
  const load = (file: typeof RULE_FILES[number]) => JSON.parse(readFileSync(join(directory, file), 'utf8'))
  return {
    system: load('system.json'), browsers: load('browsers.json'), apps: load('apps.json'),
    gaming: load('gaming.json'), gpuCache: load('gpu-cache.json'), steam: load('steam.json'),
    databases: load('databases.json'), misc: load('misc.json'),
  } as RulesJsonSet
}

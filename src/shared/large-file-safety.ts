export type LargeFileSafetyLevel = 'protected' | 'confirm' | 'candidate'
export type LargeFileSafetyReason = 'system' | 'virtual-disk' | 'database' | 'app-data' | 'backup' | 'cache' | 'recent-cache' | 'installer' | 'browser-model' | 'unknown'
export interface LargeFileSafety { level: LargeFileSafetyLevel; reason: LargeFileSafetyReason }

/** Conservative path hints, not a guarantee that a file is dispensable. */
export function classifyLargeFile(path: string, modified: number, now = Date.now()): LargeFileSafety {
  const p = '/' + path.replace(/\\/g, '/').toLowerCase().replace(/^\/+/, '')
  const parts = p.split('/').filter(Boolean)
  const name = parts.at(-1) || ''
  const protect = (reason: LargeFileSafetyReason): LargeFileSafety => ({ level: 'protected', reason })
  if (parts.some((s) => ['.colima', '.lima', '.docker', '.orbstack'].includes(s)) || /\.(vhdx?|vmdk|vdi|qcow2?|pvm|sparsebundle|sparseimage)$/.test(name)) return protect('virtual-disk')
  if (parts.some((s) => ['backup', 'backups', '备份', 'mobile backups', 'backups.backupdb'].includes(s))) return protect('backup')
  if (/\.(db|sqlite[3]?)(-wal|-shm|-journal)?$/.test(name) || /^(cookies|login data|history|web data|key[34]\.db|wallet\.dat)$/.test(name)) return protect('database')
  if (parts.some((s) => ['.codex', '.ssh', '.gnupg'].includes(s))) return protect('app-data')
  if (/\/library\/(containers|group containers)(\/|$)/.test(p)) return protect('app-data')
  if (parts.some((s) => s.endsWith('.app')) || /^\/(?:[a-z]:\/)?(?:windows|program files(?: \(x86\))?|programdata|system|applications|library|usr|etc|bin|sbin|boot|recovery|\$recycle.bin|system volume information)(?:\/|$)/.test(p) || /\/(pagefile\.sys|swapfile\.sys|hiberfil\.sys|bootmgr)$/.test(p)) return protect('system')
  // Only known cache roots qualify; an arbitrary folder named "cache" does not.
  const cache = /\/(?:library\/caches|\.cache|appdata\/local\/(?:temp|[^/]+\/cache))(?:\/|$)/.test(p)
  if (cache) return Number.isFinite(modified) && now - modified >= 7 * 86400_000
    ? { level: 'candidate', reason: 'cache' } : { level: 'confirm', reason: 'recent-cache' }
  if (parts.includes('optguideondevicemodel')) return { level: 'confirm', reason: 'browser-model' }
  if (/\/(updater|updates?)\//.test(p) && /\.(zip|dmg|exe|msi|pkg)$/.test(name)) return { level: 'confirm', reason: 'installer' }
  if (/\/(library\/application support|appdata|chrome-sycm-profiles)\//.test(p)) return protect('app-data')
  return { level: 'confirm', reason: 'unknown' }
}

/** st_blocks is in 512-byte units on POSIX; unavailable is not zero. */
export function allocatedFileSize(blocks: number | undefined, platform: string): number | null {
  return platform !== 'win32' && Number.isFinite(blocks) && blocks! >= 0 ? blocks! * 512 : null
}

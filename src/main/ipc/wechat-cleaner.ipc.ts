import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { lstatSync, readFileSync, readdirSync } from 'fs'
import { lstat, readdir, realpath } from 'fs/promises'
import { homedir } from 'os'
import { basename, isAbsolute, join, relative, resolve, win32 } from 'path'
import { dialog, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/channels'
import type { WeChatDataKind, WeChatDataLocation, WeChatDeleteResult, WeChatMediaCategory, WeChatMediaFile, WeChatScanProgress, WeChatScanResult } from '../../shared/types'
import type { WindowGetter } from './index'

const CANDIDATE_DIRS: Record<string, { kind: WeChatDataKind; label: string }> = {
  msg: { kind: 'messages', label: 'Chat databases' },
  db_storage: { kind: 'messages', label: 'Chat databases' },
  messagetemp: { kind: 'messages', label: 'Messages and attachments' },
  filestorage: { kind: 'media', label: 'Chat files, images and video' },
}

let lastScan = new Map<string, WeChatDataLocation>()
let lastMediaScan = new Map<string, WeChatMediaFile>()
let lastRoots: string[] = []
let scanEpoch = 0

interface ScanOptions {
  shouldCancel?: () => boolean
  onProgress?: (progress: WeChatScanProgress) => void
}

function checkScanCancelled(options: ScanOptions): void {
  if (options.shouldCancel?.()) throw new Error('扫描已取消')
}

function addConfiguredRoot(roots: string[], configuredPath: string): void {
  const cleaned = configuredPath.replace(/^\uFEFF/, '').replace(/\0/g, '').trim().replace(/^['"]|['"]$/g, '')
  // Tencent's Windows config always stores Windows paths. Use win32 helpers
  // explicitly so validation remains correct when the config is inspected or
  // tested from macOS/Linux.
  if (!cleaned || !win32.isAbsolute(cleaned)) return
  const normalized = win32.normalize(cleaned)
  const name = win32.basename(normalized).toLowerCase()
  if (name === 'xwechat_files' || name === 'wechat files') {
    roots.push(normalized)
  } else {
    // WeChat 4 stores only the selected drive/folder in its config file and
    // creates xwechat_files underneath it. Older builds may use WeChat Files.
    roots.push(win32.join(normalized, 'xwechat_files'), win32.join(normalized, 'WeChat Files'))
  }
}

export function rootsFromConfigDirectory(configDir: string): string[] {
  const roots: string[] = []
  let entries
  try { entries = readdirSync(configDir, { withFileTypes: true }) } catch { return roots }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.ini')) continue
    const file = join(configDir, entry.name)
    const stat = safeStat(file)
    if (!stat?.isFile() || stat.size > 4096) continue
    try { addConfiguredRoot(roots, readFileSync(file, 'utf8')) } catch { /* ignore unreadable config */ }
  }
  return roots
}

export function normalizeRoots(roots: string[]): string[] {
  return [...new Set(roots.map((root) => resolve(root)))]
}

export function defaultRoots(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE || home
    const roaming = process.env.APPDATA || join(profile, 'AppData', 'Roaming')
    const oneDrive = process.env.OneDrive
    const roots = [
      join(profile, 'Documents', 'WeChat Files'),
      join(profile, 'Documents', 'xwechat_files'),
      ...(oneDrive ? [
        join(oneDrive, 'Documents', 'WeChat Files'),
        join(oneDrive, 'Documents', 'xwechat_files'),
      ] : []),
      ...rootsFromConfigDirectory(join(roaming, 'Tencent', 'xwechat', 'config')),
      ...rootsFromConfigDirectory(join(roaming, 'Tencent', 'WeChat', 'All Users', 'config')),
    ]
    return normalizeRoots(roots)
  }
  if (process.platform === 'darwin') {
    return [
      join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Library', 'Application Support', 'com.tencent.xinWeChat'),
      join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'xwechat_files'),
      join(home, 'Library', 'Application Support', 'com.tencent.xinWeChat'),
    ]
  }
  return []
}

function safeStat(path: string) {
  try { return lstatSync(path) } catch { return null }
}

const CATEGORY_EXTENSIONS: Record<Exclude<WeChatMediaCategory, 'other'>, Set<string>> = {
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.svg']),
  video: new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.m4v', '.webm']),
  document: new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.md', '.html', '.htm', '.rtf', '.ai', '.psd']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.amr']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2']),
}

export function classifyWeChatMedia(path: string): WeChatMediaCategory {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(extension)) return category as WeChatMediaCategory
  }
  const normalized = path.toLowerCase()
  if (/[\\/]video[\\/]/.test(normalized)) return 'video'
  return 'other'
}

const PROTECTED_FILE_SUFFIXES = /\.(?:db3?|sqlite3?|ldb|edb)(?:-(?:wal|shm|journal))?$/i
export function isSafeWeChatMediaPath(path: string): boolean {
  return !PROTECTED_FILE_SUFFIXES.test(path) && !/[\\/]db_storage[\\/]/i.test(path)
}

async function directorySize(
  root: string,
  account = '',
  collectedFiles?: WeChatMediaFile[],
  options: ScanOptions = {},
  progress: WeChatScanProgress = { filesScanned: 0, currentPath: '' },
): Promise<{ size: number; modifiedAt: number }> {
  let size = 0
  let modifiedAt = 0
  let directories = [root]
  // Work in bounded batches so large chat folders do not freeze Electron's
  // main process and the renderer can keep showing scan progress.
  while (directories.length) {
    checkScanCancelled(options)
    const batch = directories.splice(0, 16)
    const listings = await Promise.all(batch.map(async (current) => {
      try { return { current, entries: await readdir(current, { withFileTypes: true }) } }
      catch { return { current, entries: [] } }
    }))
    const files: string[] = []
    for (const { current, entries } of listings) {
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const full = join(current, entry.name)
        if (entry.isDirectory()) directories.push(full)
        else if (entry.isFile()) files.push(full)
      }
    }
    for (let index = 0; index < files.length; index += 64) {
      checkScanCancelled(options)
      const fileBatch = files.slice(index, index + 64)
      const stats = await Promise.all(fileBatch.map(async (file) => {
        try { return await lstat(file) } catch { return null }
      }))
      for (let statIndex = 0; statIndex < stats.length; statIndex++) {
        const stat = stats[statIndex]
        if (!stat?.isFile() || stat.isSymbolicLink()) continue
        size += stat.size
        modifiedAt = Math.max(modifiedAt, stat.mtimeMs)
        if (collectedFiles) {
          const file = fileBatch[statIndex]
          if (!isSafeWeChatMediaPath(file)) continue
          const category = classifyWeChatMedia(file)
          // WeChat stores tens of thousands of tiny extensionless fragments in
          // attach. Listing them individually makes the page unusable and has
          // little cleanup value; keep recognized files and other files >= 1 MB.
          if (category === 'other' && stat.size < 1024 * 1024) continue
          collectedFiles.push({
            id: makeId(file),
            path: file,
            account,
            name: basename(file),
            category,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          })
        }
      }
      progress.filesScanned += fileBatch.length
      progress.currentPath = root
      options.onProgress?.({ ...progress })
      checkScanCancelled(options)
    }
  }
  return { size, modifiedAt }
}

function makeId(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 24)
}

export async function scanWeChatRoots(roots: string[], mediaFiles?: WeChatMediaFile[], options: ScanOptions = {}): Promise<WeChatDataLocation[]> {
  const found: WeChatDataLocation[] = []
  const seen = new Set<string>()
  const progress: WeChatScanProgress = { filesScanned: 0, currentPath: '' }
  for (const root of roots) {
    checkScanCancelled(options)
    const rootStat = safeStat(root)
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue
    const queue: Array<{ path: string; depth: number }> = [{ path: resolve(root), depth: 0 }]
    while (queue.length) {
      checkScanCancelled(options)
      const current = queue.shift()!
      let entries
      try { entries = readdirSync(current.path, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const full = resolve(current.path, entry.name)
        let definition = CANDIDATE_DIRS[entry.name.toLowerCase()]
        if (definition) {
          // In WeChat 4, db_storage contains the databases while msg mainly
          // contains files, attachments and video. Keep the two removable
          // groups clearly separated for the user.
          if (entry.name.toLowerCase() === 'msg' && safeStat(join(current.path, 'db_storage'))?.isDirectory()) {
            definition = { kind: 'media', label: 'Chat files, images and video' }
          }
          const normalized = full.toLowerCase()
          if (seen.has(normalized)) continue
          seen.add(normalized)
          const account = basename(current.path)
          const { size, modifiedAt } = await directorySize(
            full,
            account,
            definition.kind === 'media' || entry.name.toLowerCase() === 'msg' || entry.name.toLowerCase() === 'messagetemp' ? mediaFiles : undefined,
            options,
            progress,
          )
          found.push({
            id: makeId(full),
            path: full,
            account,
            label: definition.label,
            kind: definition.kind,
            size,
            modifiedAt,
          })
          continue
        }
        if (current.depth < 6) queue.push({ path: full, depth: current.depth + 1 })
      }
    }
  }
  return found.sort((a, b) => b.size - a.size)
}

function isInsideRoots(path: string, roots: string[]): boolean {
  const target = resolve(path)
  return roots.some((root) => {
    const rel = relative(resolve(root), target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

export async function validateScannedMediaFile(
  file: Pick<WeChatMediaFile, 'path' | 'size' | 'modifiedAt'>,
  roots: string[],
): Promise<string | null> {
  if (!isSafeWeChatMediaPath(file.path)) return '聊天数据库或受保护文件不可清理。'
  if (!isInsideRoots(file.path, roots)) return '文件已超出安全扫描范围。'
  let stat
  try { stat = await lstat(file.path) } catch { return '文件已不存在，请重新扫描。' }
  if (!stat.isFile() || stat.isSymbolicLink()) return '链接或非普通文件不可清理。'
  if (stat.size !== file.size || Math.abs(stat.mtimeMs - file.modifiedAt) > 1) return '文件在扫描后发生变化，请重新扫描。'
  try {
    const resolvedFile = await realpath(file.path)
    const resolvedRoots = await Promise.all(roots.map(async (root) => {
      try { return await realpath(root) } catch { return null }
    }))
    if (!isInsideRoots(resolvedFile, resolvedRoots.filter((root): root is string => !!root))) {
      return '文件路径包含跳出安全范围的链接。'
    }
  } catch { return '无法核对文件真实位置，请重新扫描。' }
  return null
}

async function isWeChatRunning(): Promise<boolean> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false
  return new Promise((resolveResult) => {
    const command = process.platform === 'win32' ? 'tasklist.exe' : 'pgrep'
    const args = process.platform === 'win32' ? ['/FO', 'CSV', '/NH'] : ['-if', 'WeChat|Weixin']
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (process.platform === 'win32') {
        resolveResult(!error && /"(?:WeChat|Weixin|WeChatAppEx)\.exe"/i.test(stdout))
      } else {
        resolveResult(!error && stdout.trim().length > 0)
      }
    })
  })
}

async function scan(customRoot?: string, onProgress?: ScanOptions['onProgress']): Promise<WeChatScanResult> {
  const run = ++scanEpoch
  let lastProgressAt = 0
  const roots = [...defaultRoots()]
  if (customRoot && typeof customRoot === 'string') roots.push(resolve(customRoot))
  const normalizedRoots = normalizeRoots(roots)
  const mediaFiles: WeChatMediaFile[] = []
  let locations: WeChatDataLocation[]
  try {
    locations = await scanWeChatRoots(normalizedRoots, mediaFiles, {
      shouldCancel: () => run !== scanEpoch,
      onProgress: (progress) => {
        const now = Date.now()
        if (run === scanEpoch && now - lastProgressAt >= 100) {
          lastProgressAt = now
          onProgress?.(progress)
        }
      },
    })
  } catch (error) {
    if (run !== scanEpoch) return { locations: [], mediaFiles: [], roots: normalizedRoots, totalSize: 0, weChatRunning: false, cancelled: true }
    throw error
  }
  if (run !== scanEpoch) return { locations: [], mediaFiles: [], roots: normalizedRoots, totalSize: 0, weChatRunning: false, cancelled: true }
  lastRoots = normalizedRoots
  lastScan = new Map(locations.map((location) => [location.id, location]))
  lastMediaScan = new Map(mediaFiles.map((file) => [file.id, file]))
  return {
    locations,
    mediaFiles: mediaFiles.sort((a, b) => b.size - a.size),
    roots: lastRoots,
    totalSize: locations.reduce((sum, location) => sum + location.size, 0),
    weChatRunning: await isWeChatRunning(),
  }
}

export function registerWeChatCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WECHAT_SCAN, (_event, customRoot?: unknown) =>
    scan(typeof customRoot === 'string' ? customRoot : undefined, (progress) => {
      getWindow()?.webContents.send(IPC.WECHAT_SCAN_PROGRESS, progress)
    }))

  ipcMain.handle(IPC.WECHAT_CANCEL, () => { scanEpoch++ })

  ipcMain.handle(IPC.WECHAT_SELECT_ROOT, async () => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the WeChat data folder',
      properties: ['openDirectory'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.WECHAT_OPEN_LOCATION, (_event, id: unknown) => {
    if (typeof id !== 'string') return
    const path = lastScan.get(id)?.path ?? lastMediaScan.get(id)?.path
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.WECHAT_DELETE, async (_event, ids: unknown): Promise<WeChatDeleteResult> => {
    const result: WeChatDeleteResult = { deleted: 0, failed: 0, spaceRecovered: 0, errors: [] }
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) return result
    if (await isWeChatRunning()) {
      return { ...result, failed: ids.length, errors: [{ id: '*', reason: 'Close WeChat before deleting chat data.' }] }
    }
    for (const id of [...new Set(ids as string[])]) {
      const location = lastScan.get(id)
      if (!location || !isInsideRoots(location.path, lastRoots)) {
        result.failed++
        result.errors.push({ id, reason: 'This item is no longer part of the verified scan.' })
        continue
      }
      const stat = safeStat(location.path)
      if (!stat?.isDirectory() || stat.isSymbolicLink()) {
        result.failed++
        result.errors.push({ id, reason: 'The folder no longer exists or is not safe to remove.' })
        continue
      }
      try {
        await shell.trashItem(location.path)
        result.deleted++
        // Moving to Trash does not free disk space until Trash is emptied.
        lastScan.delete(id)
      } catch (error) {
        result.failed++
        result.errors.push({ id, reason: error instanceof Error ? error.message : 'Unable to move item to Trash.' })
      }
    }
    return result
  })

  ipcMain.handle(IPC.WECHAT_DELETE_FILES, async (_event, ids: unknown): Promise<WeChatDeleteResult> => {
    const result: WeChatDeleteResult = { deleted: 0, failed: 0, spaceRecovered: 0, errors: [] }
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) return result
    if (await isWeChatRunning()) {
      return { ...result, failed: ids.length, errors: [{ id: '*', reason: '请先完全退出微信，再清理聊天文件。' }] }
    }
    for (const id of [...new Set(ids as string[])]) {
      const file = lastMediaScan.get(id)
      if (!file) {
        result.failed++
        result.errors.push({ id, reason: '该文件不在本次安全扫描结果中。' })
        continue
      }
      const unsafeReason = await validateScannedMediaFile(file, lastRoots)
      if (unsafeReason) {
        result.failed++
        result.errors.push({ id, reason: unsafeReason })
        continue
      }
      try {
        await shell.trashItem(file.path)
        result.deleted++
        // Moving to Trash does not free disk space until Trash is emptied.
        lastMediaScan.delete(id)
      } catch (error) {
        result.failed++
        result.errors.push({ id, reason: error instanceof Error ? error.message : '无法移入回收站。' })
      }
    }
    return result
  })
}

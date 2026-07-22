import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readdir, stat, lstat, realpath, rm } from 'fs/promises'
import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import { join, extname, isAbsolute, resolve, relative } from 'path'
import { IPC } from '../../shared/channels'
import type {
  DuplicateScanOptions,
  DuplicateFile,
  DuplicateGroup,
  DuplicateScanResult,
  DuplicateScanProgress,
  DuplicateDeleteMode,
  DuplicateDeleteResult
} from '../../shared/types'
import type { WindowGetter } from './index'

let cancelled = false
let lastScanRoot = ''
let lastReferenceDirectories: string[] = []

function normalizePath(filePath: string): string {
  const value = resolve(filePath)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function isPathInside(filePath: string, rootPath: string): boolean {
  const child = normalizePath(filePath)
  const root = normalizePath(rootPath)
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// ── Progress helpers ──

function sendProgress(win: BrowserWindow | null, data: DuplicateScanProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.DUPLICATES_PROGRESS, data)
  }
}

// ── Phase 1: Filesystem walk ──

async function walkDirectory(
  dirPath: string,
  options: DuplicateScanOptions,
  depth: number,
  files: DuplicateFile[],
  win: BrowserWindow | null,
  lastReport: { time: number }
): Promise<void> {
  if (cancelled) return
  if (depth > options.maxDepth) return

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return // inaccessible directory
  }

  for (const entry of entries) {
    if (cancelled) return

    const fullPath = join(dirPath, entry.name)

    // Skip symlinks
    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      // Check exclude patterns
      const shouldExclude = options.excludePatterns.some(
        (p) => entry.name === p || entry.name.toLowerCase() === p.toLowerCase()
      )
      if (shouldExclude) continue

      await walkDirectory(fullPath, options, depth + 1, files, win, lastReport)
    } else if (entry.isFile()) {
      try {
        const s = await stat(fullPath)

        // Apply size filters
        if (s.size < options.minFileSize) continue
        if (options.maxFileSize !== null && s.size > options.maxFileSize) continue

        // Apply extension filter
        if (options.extensionFilter.length > 0) {
          const ext = extname(entry.name).toLowerCase()
          if (!options.extensionFilter.includes(ext)) continue
        }

        files.push({
          path: fullPath,
          size: s.size,
          lastModified: s.mtimeMs,
          isReference: (options.referenceDirectories || []).some((root) => isPathInside(fullPath, root)),
        })

        // Throttled progress
        const now = Date.now()
        if (now - lastReport.time > 500) {
          lastReport.time = now
          sendProgress(win, {
            phase: 'walking',
            currentPath: fullPath,
            filesScanned: files.length,
            duplicatesFound: 0,
            reclaimableSpace: 0,
            progress: 0
          })
        }
      } catch {
        // Skip inaccessible files
      }
    }
  }
}

// ── Phase 2: Size grouping ──

function groupBySize(files: DuplicateFile[]): Map<number, DuplicateFile[]> {
  const sizeMap = new Map<number, DuplicateFile[]>()
  for (const file of files) {
    const group = sizeMap.get(file.size)
    if (group) {
      group.push(file)
    } else {
      sizeMap.set(file.size, [file])
    }
  }

  // Remove unique sizes
  for (const [size, group] of sizeMap) {
    if (group.length < 2) sizeMap.delete(size)
  }

  return sizeMap
}

// ── Phase 3: Hashing ──

function hashFilePartial(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath, { start: 0, end: 4095 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function hashFileFull(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath, { highWaterMark: 65536 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    if (cancelled) break
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((item) => fn(item).catch(() => null))
    )
    results.push(...batchResults)
  }
  return results
}

async function findDuplicates(
  sizeGroups: Map<number, DuplicateFile[]>,
  win: BrowserWindow | null
): Promise<DuplicateGroup[]> {
  // Collect all files that need partial hashing
  const filesToHash: DuplicateFile[] = []
  for (const group of sizeGroups.values()) {
    filesToHash.push(...group)
  }
  const totalToHash = filesToHash.length
  let hashed = 0

  // Phase 3a: Partial hash
  const partialHashMap = new Map<string, DuplicateFile[]>()

  const partialHashes = await processBatch(filesToHash, 8, async (file) => {
    const hash = await hashFilePartial(file.path)
    hashed++
    if (hashed % 50 === 0 || hashed === totalToHash) {
      sendProgress(win, {
        phase: 'partial-hash',
        currentPath: file.path,
        filesScanned: 0,
        duplicatesFound: 0,
        reclaimableSpace: 0,
        progress: Math.round((hashed / totalToHash) * 50),
        filesToHash: totalToHash,
        filesHashed: hashed
      })
    }
    return { file, hash }
  })

  for (const result of partialHashes) {
    if (!result) continue
    const key = `${result.file.size}:${result.hash}`
    const group = partialHashMap.get(key)
    if (group) {
      group.push(result.file)
    } else {
      partialHashMap.set(key, [result.file])
    }
  }

  // Filter to groups with 2+ partial hash matches
  const needFullHash: DuplicateFile[][] = []
  for (const group of partialHashMap.values()) {
    if (group.length >= 2) needFullHash.push(group)
  }

  if (cancelled || needFullHash.length === 0) return []

  // Phase 3b: Full hash
  const fullHashGroups: DuplicateGroup[] = []
  const fullHashFilesTotal = needFullHash.reduce((sum, g) => sum + g.length, 0)
  let fullHashed = 0

  for (const group of needFullHash) {
    if (cancelled) break

    const hashMap = new Map<string, DuplicateFile[]>()

    const hashes = await processBatch(group, 4, async (file) => {
      const hash = await hashFileFull(file.path)
      fullHashed++
      if (fullHashed % 10 === 0 || fullHashed === fullHashFilesTotal) {
        sendProgress(win, {
          phase: 'full-hash',
          currentPath: file.path,
          filesScanned: 0,
          duplicatesFound: fullHashGroups.length,
          reclaimableSpace: fullHashGroups.reduce((s, g) => s + g.reclaimableSpace, 0),
          progress: 50 + Math.round((fullHashed / fullHashFilesTotal) * 50),
          filesToHash: fullHashFilesTotal,
          filesHashed: fullHashed
        })
      }
      return { file, hash }
    })

    for (const result of hashes) {
      if (!result) continue
      const existing = hashMap.get(result.hash)
      if (existing) {
        existing.push(result.file)
      } else {
        hashMap.set(result.hash, [result.file])
      }
    }

    for (const [fullHash, files] of hashMap) {
      if (files.length >= 2) {
        const referenceCount = files.filter((file) => file.isReference).length
        const deletableCopies = referenceCount > 0 ? files.length - referenceCount : files.length - 1
        fullHashGroups.push({
          hash: fullHash.slice(0, 16),
          fullHash,
          fileSize: files[0].size,
          files,
          reclaimableSpace: files[0].size * Math.max(0, deletableCopies)
        })
      }
    }
  }

  // Sort by reclaimable space descending
  fullHashGroups.sort((a, b) => b.reclaimableSpace - a.reclaimableSpace)
  return fullHashGroups
}

// ── IPC registration ──

export function registerDuplicateFinderIpc(getWindow: WindowGetter): void {
  // Directory picker — on macOS, avoid passing parent window so the dialog
  // opens as a standalone panel instead of a sheet (sidebar items like Desktop
  // are unresponsive in sheet mode).
  ipcMain.handle(IPC.DUPLICATES_SELECT_DIR, async () => {
    const win = getWindow()
    if (!win) return null
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = process.platform === 'darwin'
      ? await dialog.showOpenDialog(opts)
      : await dialog.showOpenDialog(win, opts)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  // Cancel
  ipcMain.handle(IPC.DUPLICATES_CANCEL, () => {
    cancelled = true
  })

  // Scan
  ipcMain.handle(IPC.DUPLICATES_SCAN, async (_event, options: unknown): Promise<DuplicateScanResult> => {
    cancelled = false
    const startTime = Date.now()
    const win = getWindow()
    const emptyResult: DuplicateScanResult = { groups: [], totalDuplicates: 0, totalReclaimable: 0, totalFilesScanned: 0, duration: 0, cancelled: false }

    if (!options || typeof options !== 'object') return emptyResult
    const opts = options as Record<string, unknown>

    // Validate options
    const dir = typeof opts.directory === 'string' ? opts.directory : ''
    const safeOptions: DuplicateScanOptions = {
      directory: isAbsolute(dir) ? dir : '',
      minFileSize: typeof opts.minFileSize === 'number' && opts.minFileSize >= 0 ? opts.minFileSize : 1_048_576,
      maxFileSize: typeof opts.maxFileSize === 'number' && opts.maxFileSize > 0 ? opts.maxFileSize : null,
      excludePatterns: Array.isArray(opts.excludePatterns) ? (opts.excludePatterns as unknown[]).filter((p): p is string => typeof p === 'string') : [],
      extensionFilter: Array.isArray(opts.extensionFilter) ? (opts.extensionFilter as unknown[]).filter((e): e is string => typeof e === 'string') : [],
      maxDepth: typeof opts.maxDepth === 'number' && opts.maxDepth > 0 ? opts.maxDepth : 20,
      referenceDirectories: Array.isArray(opts.referenceDirectories)
        ? (opts.referenceDirectories as unknown[])
          .filter((p): p is string => typeof p === 'string' && isAbsolute(p))
          .map(normalizePath)
        : []
    }

    if (!safeOptions.directory) return emptyResult
    lastScanRoot = normalizePath(safeOptions.directory)
    lastReferenceDirectories = [...new Set(safeOptions.referenceDirectories || [])]

    // Phase 1: Walk
    const files: DuplicateFile[] = []
    const lastReport = { time: Date.now() }
    await walkDirectory(safeOptions.directory, safeOptions, 0, files, win, lastReport)
    for (const referenceDir of lastReferenceDirectories) {
      if (isPathInside(referenceDir, safeOptions.directory)) continue
      await walkDirectory(referenceDir, safeOptions, 0, files, win, lastReport)
    }

    if (cancelled) {
      return { groups: [], totalDuplicates: 0, totalReclaimable: 0, totalFilesScanned: files.length, duration: Date.now() - startTime, cancelled: true }
    }

    // Phase 2: Group by size
    sendProgress(win, {
      phase: 'grouping',
      currentPath: '',
      filesScanned: files.length,
      duplicatesFound: 0,
      reclaimableSpace: 0,
      progress: 0
    })

    const sizeGroups = groupBySize(files)

    if (cancelled || sizeGroups.size === 0) {
      return { groups: [], totalDuplicates: 0, totalReclaimable: 0, totalFilesScanned: files.length, duration: Date.now() - startTime, cancelled }
    }

    // Phase 3: Hash
    const groups = await findDuplicates(sizeGroups, win)

    const totalDuplicates = groups.reduce((sum, g) => {
      const references = g.files.filter((file) => file.isReference).length
      return sum + (references > 0 ? g.files.length - references : g.files.length - 1)
    }, 0)
    const totalReclaimable = groups.reduce((sum, g) => sum + g.reclaimableSpace, 0)

    sendProgress(win, {
      phase: 'complete',
      currentPath: '',
      filesScanned: files.length,
      duplicatesFound: totalDuplicates,
      reclaimableSpace: totalReclaimable,
      progress: 100
    })

    return {
      groups,
      totalDuplicates,
      totalReclaimable,
      totalFilesScanned: files.length,
      duration: Date.now() - startTime,
      cancelled
    }
  })

  // Delete
  ipcMain.handle(IPC.DUPLICATES_DELETE, async (_event, paths: unknown, mode: unknown): Promise<DuplicateDeleteResult> => {
    if (!Array.isArray(paths)) return { deleted: 0, failed: 0, spaceRecovered: 0, errors: [] }
    const safePaths = paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p))
    const deleteMode: DuplicateDeleteMode = mode === 'permanent' ? 'permanent' : 'recycle'

    let deleted = 0
    let failed = 0
    let spaceRecovered = 0
    const errors: { path: string; reason: string }[] = []

    for (const filePath of safePaths) {
      try {
        if (!lastScanRoot || !isPathInside(filePath, lastScanRoot)) {
          failed++
          errors.push({ path: filePath, reason: '安全保护：路径不在本次扫描目录内' })
          continue
        }
        const canonicalPath = await realpath(filePath)
        const canonicalRoot = await realpath(lastScanRoot)
        if (!isPathInside(canonicalPath, canonicalRoot)) {
          failed++
          errors.push({ path: filePath, reason: '安全保护：文件的真实路径超出本次扫描边界' })
          continue
        }
        if (lastReferenceDirectories.some((root) => isPathInside(filePath, root))) {
          failed++
          errors.push({ path: filePath, reason: '安全保护：参考目录为只读，不能删除' })
          continue
        }
        const linkStats = await lstat(filePath)
        if (linkStats.isSymbolicLink()) {
          failed++
          errors.push({ path: filePath, reason: '安全保护：不处理符号链接' })
          continue
        }
        const s = await stat(filePath)
        const fileSize = s.size

        if (deleteMode === 'recycle') {
          await shell.trashItem(filePath)
        } else {
          await rm(filePath, { force: true })
        }
        deleted++
        spaceRecovered += fileSize
      } catch (err: any) {
        failed++
        const reason = err?.code === 'EACCES' || err?.code === 'EPERM'
          ? '权限不足，请以管理员身份运行，或关闭正在占用该文件的程序。'
          : err?.code === 'EBUSY'
            ? '文件正在使用，请关闭相关程序后重新扫描。'
            : err?.code === 'ENOENT'
              ? '文件已不存在，请重新扫描。'
              : '删除失败，请检查文件权限后重新扫描。'
        errors.push({ path: filePath, reason })
      }
    }

    return { deleted, failed, protectedSkipped: errors.filter((error) => error.reason.startsWith('安全保护')).length, spaceRecovered, errors }
  })

  // Open file location in system file manager
  ipcMain.handle(IPC.DUPLICATES_OPEN_LOCATION, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) return
    shell.showItemInFolder(filePath)
  })
}

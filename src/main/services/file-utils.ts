import { rm, stat, lstat, realpath, readdir, open, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, relative, isAbsolute } from 'path'
import { randomUUID, randomBytes } from 'crypto'
import { shell } from 'electron'
import type { ScanItem, ScanResult, CleanResult } from '../../shared/types'
import { getCachedItems } from './scan-cache'
import { getSettings } from './settings-store'
import { canCleanItem } from '../../shared/cleaning-safety'

export interface DeleteResult {
  path: string
  success: boolean
  reason?: string
}

/**
 * Check if a path matches any of the configured exclusions.
 * Supports exact path prefixes and *.ext glob patterns.
 */
export function isExcluded(filePath: string, exclusions: string[]): boolean {
  if (exclusions.length === 0) return false
  // Only normalize to backslash on Windows; on Linux/macOS forward slash is the separator
  const toSep = process.platform === 'win32' ? /\//g : /\\/g
  const sep = process.platform === 'win32' ? '\\' : '/'
  const normalized = filePath.toLowerCase().replace(toSep, sep)
  for (const exc of exclusions) {
    const pattern = exc.toLowerCase().replace(toSep, sep)
    if (pattern.startsWith('*.')) {
      // Extension glob: *.log, *.tmp etc.
      if (normalized.endsWith(pattern.substring(1))) return true
    } else {
      // Path prefix match
      if (normalized === pattern || normalized.startsWith(pattern.endsWith(sep) ? pattern : pattern + sep)) return true
    }
  }
  return false
}

/**
 * Overwrite a single file's contents with random data, then zeros, before deletion.
 * For directories, recursively overwrite all files within.
 */
async function secureOverwrite(filePath: string): Promise<void> {
  const stats = await stat(filePath)

  if (stats.isDirectory()) {
    const entries = await readdir(filePath, { withFileTypes: true })
    for (const entry of entries) {
      await secureOverwrite(join(filePath, entry.name))
    }
    return
  }

  if (!stats.isFile() || stats.size === 0) return

  const size = stats.size
  const CHUNK = 1024 * 1024 // 1 MB chunks
  const fh = await open(filePath, 'r+')
  try {
    // Pass 1: random data
    let offset = 0
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset)
      await fh.write(randomBytes(len), 0, len, offset)
      offset += len
    }
    await fh.datasync()

    // Pass 2: zeros
    const zeroBuf = Buffer.alloc(Math.min(CHUNK, size))
    offset = 0
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset)
      await fh.write(zeroBuf, 0, len, offset)
      offset += len
    }
    await fh.datasync()
  } finally {
    await fh.close()
  }
}

export async function safeDelete(filePath: string, mode: 'recycle' | 'permanent' = 'recycle'): Promise<DeleteResult> {
  try {
    const linkStats = await lstat(filePath)
    if (linkStats.isSymbolicLink()) {
      return { path: filePath, success: false, reason: '安全保护：不处理符号链接' }
    }
    const settings = getSettings()
    if (settings.cleaner.secureDelete) {
      try {
        await secureOverwrite(filePath)
      } catch {
        // If overwrite fails (e.g. permission), still attempt normal deletion
      }
    }
    if (mode === 'recycle' && !settings.cleaner.secureDelete) {
      await shell.trashItem(filePath)
    } else {
      await rm(filePath, { force: true, recursive: true })
    }
    return { path: filePath, success: true }
  } catch (err: any) {
    if (err.code === 'EBUSY') {
      return { path: filePath, success: false, reason: 'in-use' }
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { path: filePath, success: false, reason: 'permission-denied' }
    }
    if (err.code === 'ENOENT') {
      return { path: filePath, success: true }
    }
    return { path: filePath, success: false, reason: err.message }
  }
}

/**
 * Look up cached scan items by ID, delete each one, and return a CleanResult.
 */
export async function cleanItems(
  itemIds: unknown,
  onProgress?: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
  mode: 'recycle' | 'permanent' = 'recycle'
): Promise<CleanResult> {
  // Validate input is a string array
  const validIds = Array.isArray(itemIds)
    ? [...new Set(itemIds.filter((v): v is string => typeof v === 'string'))]
    : []
  const items = getCachedItems(validIds)
  let totalCleaned = 0
  let filesDeleted = 0
  let filesSkipped = 0
  const errors: CleanResult['errors'] = []
  const cachedIds = new Set(items.map(item => item.id))
  for (const id of validIds) {
    if (!cachedIds.has(id)) {
      filesSkipped++
      errors.push({ path: id, reason: '扫描记录已失效，请重新扫描' })
    }
  }
  let lastReport = 0

  for (const item of items) {
    if (!canCleanItem(item)) {
      filesSkipped++
      errors.push({ path: item.path, reason: '安全保护：该项目禁止自动清理' })
      continue
    }
    if (item.scanIdentity) {
      try {
        const current = await lstat(item.path)
        const canonical = await realpath(item.path)
        const identity = item.scanIdentity
        const rel = relative(identity.root, canonical)
        if (!current.isFile() || current.isSymbolicLink() || canonical !== identity.realPath ||
          rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(rel) ||
          current.size !== identity.size || current.mtimeMs !== identity.modified ||
          current.ino !== identity.ino || current.dev !== identity.dev ||
          isExcluded(item.path, getSettings().exclusions)) {
          throw new Error('扫描后文件已变化或被排除，请重新扫描')
        }
      } catch {
        filesSkipped++
        errors.push({ path: item.path, reason: '扫描后文件已变化或无法访问，请重新扫描' })
        continue
      }
    }
    const result = await safeDelete(item.path, mode)
    if (result.success) {
      totalCleaned += item.size
      filesDeleted++
    } else {
      filesSkipped++
      if (result.reason) {
        errors.push({ path: item.path, reason: result.reason })
      }
    }
    if (onProgress) {
      const processed = filesDeleted + filesSkipped
      const now = Date.now()
      if (now - lastReport > 120 || processed === items.length) {
        lastReport = now
        onProgress(processed, items.length, item.path, totalCleaned)
      }
    }
  }

  const needsElevation = errors.some((e) => e.reason === 'permission-denied')
  return { totalCleaned, filesDeleted, filesSkipped, errors, needsElevation }
}

export async function scanDirectory(
  dirPath: string,
  category: string,
  subcategory: string,
  skipRecentMinutes = getSettings().cleaner.skipRecentMinutes ?? 60
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  const cutoff = Date.now() - Math.max(0, skipRecentMinutes) * 60 * 1000
  const MAX_ITEMS = 50000
  const MAX_VISITED = 200000
  const exclusions = getSettings().exclusions
  const scanWarnings: NonNullable<ScanResult['scanWarnings']> = []
  const warn = (path: string, error: any) => {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return
    if (scanWarnings.length < 100) scanWarnings.push({ path, reason: error?.code === 'EACCES' || error?.code === 'EPERM' ? 'permission-denied' : 'scan-failed' })
  }
  let visited = 0
  try {
    const rootStats = await lstat(dirPath)
    if (!rootStats.isSymbolicLink() && rootStats.isDirectory() && !isExcluded(dirPath, exclusions)) {
      const canonicalRoot = await realpath(dirPath)
      const directories = [dirPath]
      scan: while (directories.length) {
        const directory = directories.pop()!
        try {
          // Re-check queued directories so a replaced symlink cannot redirect traversal.
          const currentDir = await lstat(directory)
          if (!currentDir.isDirectory() || currentDir.isSymbolicLink()) continue
          const resolvedDir = await realpath(directory)
          const dirRelative = relative(canonicalRoot, resolvedDir)
          if (dirRelative === '..' || dirRelative.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(dirRelative)) continue
          const entries = await readdir(directory, { withFileTypes: true })
          for (const entry of entries) {
            if (++visited > MAX_VISITED || items.length >= MAX_ITEMS) {
              scanWarnings.push({ path: dirPath, reason: 'limit-reached' })
              break scan
            }
            if (entry.isSymbolicLink()) continue
            const fullPath = join(directory, entry.name)
            if (isExcluded(fullPath, exclusions)) continue
            try {
              const stats = await lstat(fullPath)
              if (stats.isSymbolicLink()) continue
              if (stats.isDirectory()) { directories.push(fullPath); continue }
              if (!stats.isFile() || (skipRecentMinutes > 0 && stats.mtimeMs > cutoff)) continue
              const canonical = await realpath(fullPath)
              const rel = relative(canonicalRoot, canonical)
              if (rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(rel)) continue
              items.push({ id: randomUUID(), path: fullPath, size: stats.size, category, subcategory,
                lastModified: stats.mtimeMs, selected: true,
                scanIdentity: { root: canonicalRoot, realPath: canonical, size: stats.size, modified: stats.mtimeMs, ino: stats.ino, dev: stats.dev },
              })
              totalSize += stats.size
            } catch (error) { warn(fullPath, error) }
          }
        } catch (error) {
          warn(directory, error)
        }
      }
    }
  } catch (error) {
    warn(dirPath, error)
  }

  return {
    category,
    subcategory,
    items,
    totalSize,
    itemCount: items.length,
    ...(scanWarnings.length ? { scanWarnings } : {}),
  }
}

/**
 * Scan multiple directories and merge their items into a single ScanResult.
 * Each item's subcategory is set to the provided label so they group together.
 */
export async function scanMultipleDirectories(
  dirPaths: string[],
  category: string,
  subcategory: string,
  skipRecentMinutes = getSettings().cleaner.skipRecentMinutes ?? 60
): Promise<ScanResult> {
  const allItems: ScanItem[] = []
  let totalSize = 0
  const scanWarnings: NonNullable<ScanResult['scanWarnings']> = []
  const seen = new Set<string>()

  for (const dirPath of dirPaths) {
    const result = await scanDirectory(dirPath, category, subcategory, skipRecentMinutes)
    for (const item of result.items) {
      const key = item.scanIdentity?.realPath || item.path
      if (seen.has(key)) continue
      seen.add(key)
      allItems.push(item)
      totalSize += item.size
    }
    scanWarnings.push(...(result.scanWarnings || []))
  }

  return {
    category,
    subcategory,
    items: allItems,
    totalSize,
    itemCount: allItems.length,
    ...(scanWarnings.length ? { scanWarnings } : {}),
  }
}

export async function scanFile(
  filePath: string,
  category: string,
  subcategory: string
): Promise<ScanResult> {
  const exclusions = getSettings().exclusions
  if (isExcluded(filePath, exclusions)) {
    return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
  }

  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink()) {
      return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
    }
    if (!stats.isFile()) {
      return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
    }
    const item: ScanItem = {
      id: randomUUID(),
      path: filePath,
      size: stats.size,
      category,
      subcategory,
      lastModified: stats.mtimeMs,
      selected: true
    }
    return { category, subcategory, items: [item], totalSize: stats.size, itemCount: 1 }
  } catch {
    return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
  }
}

/**
 * Treat each directory path as a single deletable item (not individual files inside).
 * Returns one ScanItem per existing directory with its total size.
 */
export async function scanDirectoriesAsItems(
  dirPaths: string[],
  category: string,
  subcategory: string,
  group?: string
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  const exclusions = getSettings().exclusions

  for (const dirPath of dirPaths) {
    if (isExcluded(dirPath, exclusions)) continue

    try {
      const stats = await lstat(dirPath)
      if (stats.isSymbolicLink()) continue
      if (!stats.isDirectory()) continue
      const size = await getDirectorySize(dirPath)
      if (size < 1024) continue

      items.push({
        id: randomUUID(),
        path: dirPath,
        size,
        category,
        subcategory,
        lastModified: stats.mtimeMs,
        selected: true,
      })
      totalSize += size
    } catch {
      // Path doesn't exist or inaccessible
    }
  }

  return { category, subcategory, group, items, totalSize, itemCount: items.length }
}

/**
 * For paths with a childSubdir, expand paths/&ast;/childSubdir.
 * e.g. given ['/home/.var/app'] with childSubdir='cache', returns
 * ['/home/.var/app/com.spotify.Client/cache', '/home/.var/app/org.foo/cache', ...]
 * If no childSubdir, returns the original paths unchanged.
 */
export async function resolveChildSubdirs(paths: string[], childSubdir?: string, childPrefix?: string, warnings?: NonNullable<ScanResult['scanWarnings']>): Promise<string[]> {
  if (!childSubdir) return paths

  const resolved: string[] = []
  for (const basePath of paths) {
    try {
      const children = await readdir(basePath, { withFileTypes: true })
      for (const child of children) {
        if (child.isDirectory() && (!childPrefix || child.name.startsWith(childPrefix))) {
          const subPath = join(basePath, child.name, childSubdir)
          if (existsSync(subPath)) resolved.push(subPath)
        }
      }
    } catch (error: any) {
      if (warnings && error.code !== 'ENOENT' && error.code !== 'ENOTDIR') warnings.push({ path: basePath,
        reason: error.code === 'EACCES' || error.code === 'EPERM' ? 'permission-denied' : 'scan-failed' })
    }
  }
  return resolved
}

export async function getDirectorySize(dirPath: string, maxDepth = Infinity): Promise<number> {
  if (maxDepth <= 0) return 0
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dirPath, entry.name)
      try {
        const stats = await lstat(fullPath)
        if (stats.isSymbolicLink()) continue
        if (stats.isDirectory()) {
          size += await getDirectorySize(fullPath, maxDepth - 1)
        } else {
          size += stats.size
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return size
}

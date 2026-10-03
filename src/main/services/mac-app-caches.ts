import { readdir } from 'fs/promises'
import { join, relative, isAbsolute } from 'path'
import type { AppCacheDef } from '../platform/types'

/** Discover only unrecognized cache roots; recurse into partially covered namespaces. */
export async function discoverMacAppCaches(cacheRoot: string, coveredPaths: string[]): Promise<AppCacheDef[]> {
  const apps: AppCacheDef[] = []
  const within = (root: string, path: string): boolean => {
    const rel = relative(root, path)
    return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
  }
  const visit = async (root: string, depth: number): Promise<void> => {
    if (depth > 32) return
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('com.apple.')) continue
      const directory = join(root, entry.name)
      if (coveredPaths.some(path => within(path, directory))) continue
      if (coveredPaths.some(path => within(directory, path))) {
        await visit(directory, depth + 1)
      } else {
        apps.push({ id: `other-cache-${apps.length}`, name: `Other App Cache - ${entry.name}`, paths: [directory], reviewOnly: true })
      }
    }
  }
  try {
    await visit(cacheRoot, 0)
  } catch (error: any) {
    // Let the normal scanner surface permission errors for the root, with selection disabled.
    if (error.code !== 'ENOENT') apps.push({ id: 'other-cache-root', name: 'Other App Cache', paths: [cacheRoot], reviewOnly: true })
  }
  return apps
}

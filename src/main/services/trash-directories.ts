import { lstat, realpath, rmdir, readdir } from 'fs/promises'
import { dirname, relative, isAbsolute, sep, join } from 'path'

/** Remove only empty ancestors of scanned leaves, never recursively or through links. */
export async function findEmptyTrashDirectories(root: string, shouldKeep: (path: string) => boolean = () => false): Promise<string[]> {
  const results: string[] = []
  const canonicalRoot = await realpath(root)
  const queue = [root]
  let visited = 0
  while (queue.length && visited++ < 200000) {
    const directory = queue.pop()!
    if (shouldKeep(directory)) continue
    try {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) continue
      if (await realpath(directory) !== join(canonicalRoot, relative(root, directory))) continue
      const entries = await readdir(directory, { withFileTypes: true })
      if (!entries.length && directory !== root) results.push(directory)
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(join(directory, entry.name))
      }
    } catch { /* The leaf scanner reports access failures for the same tree. */ }
  }
  return results
}

export async function pruneEmptyTrashDirectories(root: string, scannedPaths: string[], shouldKeep: (path: string) => boolean = () => false): Promise<number> {
  const canonicalRoot = await realpath(root)
  let removed = 0
  const inside = (path: string): boolean => {
    const rel = relative(canonicalRoot, path)
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
  }
  const directories = new Set<string>()
  for (const path of scannedPaths) {
    const rel = relative(root, dirname(path))
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) continue
    let directory = join(canonicalRoot, rel)
    while (inside(directory)) {
      directories.add(directory)
      directory = dirname(directory)
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    if (shouldKeep(directory)) continue
    try {
      const info = await lstat(directory)
      const canonical = await realpath(directory)
      if (!info.isDirectory() || info.isSymbolicLink() || canonical !== directory || !inside(canonical)) continue
      await rmdir(directory) // Fails safely if new/excluded/protected contents remain.
      removed++
    } catch { /* Non-empty, disappeared, or inaccessible directories must remain. */ }
  }
  return removed
}

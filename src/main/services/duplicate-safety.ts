import { isAbsolute, normalize, parse, relative, resolve } from 'path'

const WINDOWS_PROTECTED_ROOTS = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'boot',
  '$recycle.bin',
  'system volume information',
  'perflogs',
  'msocache',
  'config.msi',
])

const UNIX_PROTECTED_ROOTS = new Set([
  'applications',
  'bin',
  'boot',
  'cores',
  'dev',
  'etc',
  'library',
  'opt',
  'private',
  'proc',
  'root',
  'run',
  'sbin',
  'snap',
  'sys',
  'system',
  'usr',
  'var',
])

function pathSegments(targetPath: string, platform: NodeJS.Platform): string[] {
  const resolved = normalize(resolve(targetPath))
  const root = parse(resolved).root
  return relative(root, resolved)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
}

/**
 * Duplicate cleanup must never scan or delete operating-system and application
 * installation trees. Those locations intentionally contain identical files
 * (hard links, component stores and shared runtimes) that are not user copies.
 */
export function isProtectedDuplicatePath(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!targetPath || !isAbsolute(targetPath)) return true
  const segments = pathSegments(targetPath, platform)
  if (segments.length === 0) return true

  const first = segments[0]
  return platform === 'win32'
    ? WINDOWS_PROTECTED_ROOTS.has(first)
    : UNIX_PROTECTED_ROOTS.has(first)
}

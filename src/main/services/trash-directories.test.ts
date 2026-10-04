import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, basename, relative } from 'path'
import { pruneEmptyTrashDirectories, findEmptyTrashDirectories } from './trash-directories'

it('discovers and removes an entirely empty folder tree, preserving excluded directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lightclean-empty-trash-test-'))
  try {
    await mkdir(join(root, 'package', 'folder'), { recursive: true })
    await mkdir(join(root, 'excluded'))
    const paths = await findEmptyTrashDirectories(root, p => basename(p) === 'excluded')
    expect(paths.map(p => relative(root, p))).toEqual([join('package', 'folder')])
    await pruneEmptyTrashDirectories(root, paths.map(p => join(p, 'placeholder')), p => basename(p) === 'excluded')
    expect(await readdir(root)).toEqual(['excluded'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('removes only empty ancestors of scanned trash files and preserves new contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lightclean-trash-test-'))
  try {
    const empty = join(root, 'empty', 'nested')
    const nonempty = join(root, 'keep', 'nested')
    await mkdir(empty, { recursive: true })
    await mkdir(nonempty, { recursive: true })
    await writeFile(join(nonempty, 'new.txt'), 'keep')
    await pruneEmptyTrashDirectories(root, [join(empty, 'deleted.txt'), join(nonempty, 'deleted.txt')])
    expect(await readdir(root)).toEqual(['keep'])
    expect(await readdir(nonempty)).toEqual(['new.txt'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('does not follow a substituted trash directory symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lightclean-trash-link-test-'))
  try {
    await mkdir(join(root, 'outside'))
    await mkdir(join(root, 'trash'))
    await symlink(join(root, 'outside'), join(root, 'trash', 'link'))
    await pruneEmptyTrashDirectories(join(root, 'trash'), [join(root, 'trash', 'link', 'deleted.txt')])
    expect(await readdir(join(root, 'trash'))).toEqual(['link'])
    expect(await readdir(root)).toContain('outside')
  } finally { await rm(root, { recursive: true, force: true }) }
})

import { it, expect } from 'vitest'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { discoverMacAppCaches } from './mac-app-caches'

it('lists unknown caches for review and avoids known Chrome and app namespaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lightclean-discovery-test-'))
  try {
    for (const name of ['UnknownApp', 'Google/Chrome', 'Google/AndroidStudio2025', 'Google/Chrome Canary', 'ChatGPTHelper', 'com.apple.protected']) await mkdir(join(root, name), { recursive: true })
    const results = await discoverMacAppCaches(root, [join(root, 'Google', 'Chrome'), join(root, 'Google', 'AndroidStudio2025'), join(root, 'ChatGPTHelper')])
    expect(results.map(r => r.paths[0]).sort()).toEqual([join(root, 'Google', 'Chrome Canary'), join(root, 'UnknownApp')].sort())
    expect(results[0].reviewOnly).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

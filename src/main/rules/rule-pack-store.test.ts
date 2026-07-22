import { afterEach, describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RulePackManifest } from '../../shared/types'
import {
  RULE_FILES,
  canonicalManifestPayload,
  installRulePackDirectory,
  rollbackRulePack,
  verifyRulePackDirectory,
} from './rule-pack-store'

const roots: string[] = []

function createPack(version: string, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): string {
  const root = join(tmpdir(), `lightclean-rule-pack-${version}-${Date.now()}-${Math.random()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const files: Record<string, string> = {}
  for (const file of RULE_FILES) {
    const content = JSON.stringify({ type: file.replace('.json', ''), version })
    writeFileSync(join(root, file), content, 'utf8')
    files[file] = createHash('sha256').update(content).digest('hex')
  }
  const unsigned: Omit<RulePackManifest, 'signature'> = {
    schemaVersion: 1,
    version,
    platform: 'win32',
    releasedAt: '2026-07-22T00:00:00.000Z',
    changelog: [`Rules ${version}`],
    files,
  }
  const signature = sign(null, Buffer.from(canonicalManifestPayload(unsigned)), privateKey).toString('base64')
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ ...unsigned, signature }), 'utf8')
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('signed rule packs', () => {
  it('verifies hashes and an Ed25519 signature', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pack = createPack('2.0.0', privateKey)
    const checked = verifyRulePackDirectory(pack, 'win32', publicKey)
    expect(checked.valid).toBe(true)
    expect(checked.manifest?.version).toBe('2.0.0')
  })

  it('rejects a modified rule file', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pack = createPack('2.0.1', privateKey)
    writeFileSync(join(pack, 'system.json'), '{"tampered":true}', 'utf8')
    expect(verifyRulePackDirectory(pack, 'win32', publicKey)).toMatchObject({ valid: false })
  })

  it('keeps the previous version available for rollback', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const dataDir = join(tmpdir(), `lightclean-rule-state-${Date.now()}-${Math.random()}`)
    roots.push(dataDir)
    installRulePackDirectory(createPack('2.1.0', privateKey), 'win32', dataDir, publicKey)
    const installed = installRulePackDirectory(createPack('2.2.0', privateKey), 'win32', dataDir, publicKey)
    expect(installed.version).toBe('2.2.0')
    expect(installed.canRollback).toBe(true)
    const rolledBack = rollbackRulePack('win32', dataDir, publicKey)
    expect(rolledBack.version).toBe('2.1.0')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { buildCleanerPaths } from './loader'
import type { RulesJsonSet } from './loader'
import { readFileSync } from 'fs'
import path from 'path'

// ─── Mock homedir/tmpdir for deterministic comparison ──────────

// Win32 tests use these env vars (set before import)
process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local'
process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming'
process.env.WINDIR = 'C:\\Windows'
process.env.ProgramData = 'C:\\ProgramData'
process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)'
process.env.ProgramFiles = 'C:\\Program Files'
process.env.USERPROFILE = 'C:\\Users\\TestUser'

vi.mock('os', () => ({
  homedir: () => 'C:\\Users\\TestUser',
  tmpdir: () => 'C:\\Users\\TestUser\\AppData\\Local\\Temp',
}))

// ─── Load JSON rule files ─────────────────────────────────────

function loadRulesJson(platform: string): RulesJsonSet {
  const dir = path.resolve(__dirname, '..', '..', '..', 'rules', platform)
  const load = (file: string) => JSON.parse(readFileSync(path.join(dir, file), 'utf-8'))
  return {
    system: load('system.json'),
    browsers: load('browsers.json'),
    apps: load('apps.json'),
    gaming: load('gaming.json'),
    gpuCache: load('gpu-cache.json'),
    steam: load('steam.json'),
    databases: load('databases.json'),
    misc: load('misc.json'),
  }
}

// ─── Import hardcoded paths (after mock) ──────────────────────

const { createWin32Paths } = await import('../platform/win32/paths')

describe('parity: win32 JSON rules vs hardcoded paths', () => {
  const hardcoded = createWin32Paths()
  const json = loadRulesJson('win32')
  const fromJson = buildCleanerPaths(json, 'win32')

  it('systemCleanTargets match', () => {
    expect(fromJson.systemCleanTargets()).toEqual(hardcoded.systemCleanTargets())
  })

  it('singleFileCleanTargets match', () => {
    expect(fromJson.singleFileCleanTargets()).toEqual(hardcoded.singleFileCleanTargets())
  })

  it('protectedEventLogs match', () => {
    expect(fromJson.protectedEventLogs()).toEqual(hardcoded.protectedEventLogs())
  })

  it('browserPaths match', () => {
    expect(fromJson.browserPaths()).toEqual(hardcoded.browserPaths())
  })

  it('appPaths match', () => {
    expect(fromJson.appPaths()).toEqual(hardcoded.appPaths())
  })

  it('gamingPaths match', () => {
    expect(fromJson.gamingPaths()).toEqual(hardcoded.gamingPaths())
  })

  it('gpuCachePaths match', () => {
    expect(fromJson.gpuCachePaths()).toEqual(hardcoded.gpuCachePaths())
  })

  it('steamLibraries match', () => {
    expect(fromJson.steamLibraries()).toEqual(hardcoded.steamLibraries())
  })

  it('steamRedistPatterns match', () => {
    expect(fromJson.steamRedistPatterns()).toEqual(hardcoded.steamRedistPatterns())
  })

  it('trashPath match', () => {
    expect(fromJson.trashPath()).toEqual(hardcoded.trashPath())
  })

  it('databaseOptimizeTargets match', () => {
    expect(fromJson.databaseOptimizeTargets()).toEqual(hardcoded.databaseOptimizeTargets())
  })
})

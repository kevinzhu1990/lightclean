import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ dataRoot: '' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => runtime.dataRoot },
}))

import { flushSettings, getMachineId, setSettings } from './settings-store'

describe('getMachineId', () => {
  const root = mkdtempSync(join(tmpdir(), 'lightclean-machine-id-'))
  runtime.dataRoot = root

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('returns the same persisted device identity on consecutive first-run calls', async () => {
    setSettings({ theme: 'light' })
    const first = getMachineId()
    const second = getMachineId()

    expect(first).toMatch(/^[a-f0-9-]{36}$/)
    expect(second).toBe(first)
    await flushSettings()
    const stored = JSON.parse(readFileSync(join(root, 'LightClean-Dev', 'config.json'), 'utf8'))
    expect(stored.machineId).toBe(first)
    expect(stored.settings.theme).toBe('light')
  })
})

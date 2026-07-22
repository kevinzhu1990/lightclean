import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process.execFile
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }))

// Mock elevation
vi.mock('./elevation', () => ({ isAdmin: vi.fn() }))

import { createRestorePoint } from './restore-point'
import { isAdmin } from './elevation'

const mockedIsAdmin = vi.mocked(isAdmin)

describe('createRestorePoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when not running as admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await createRestorePoint('Test Point')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Administrator privileges required')
  })

  it('calls powershell with correct arguments when admin', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, '', '')
    })

    const result = await createRestorePoint('Before Cleanup')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    expect(mockExecFile).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
      expect.objectContaining({ timeout: 60_000 }),
      expect.any(Function)
    )

    // Verify the PowerShell script includes the description
    const script = mockExecFile.mock.calls[0][1][3]
    expect(script).toContain('Before Cleanup')
    expect(script).toContain('Checkpoint-Computer')
    expect(script).toContain('MODIFY_SETTINGS')
  })

  it('escapes single quotes in description', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, '', '')
    })

    await createRestorePoint("Kudu's cleanup")
    const script = mockExecFile.mock.calls[0][1][3]
    // PowerShell escape: single quote -> double single quote
    expect(script).toContain("Kudu''s cleanup")
  })

  it('returns friendly error when Windows throttles (24h limit)', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      cb(new Error('fail'), '', 'A restore point cannot be created because one was already created within the past 1440 minutes.')
    })

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('last 24 hours')
  })

  it('returns friendly error on frequency keyword', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      cb(new Error('fail'), '', 'The frequency of restore point creation is limited.')
    })

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('last 24 hours')
  })

  it('returns generic error for other failures', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      cb(new Error('System Protection is turned off'), '', '')
    })

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('System Protection is turned off')
  })

  it('truncates long error messages to 500 chars', async () => {
    mockedIsAdmin.mockReturnValue(true)
    const longError = 'x'.repeat(1000)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      cb(new Error(longError), '', '')
    })

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error!.length).toBeLessThanOrEqual(500)
  })
})

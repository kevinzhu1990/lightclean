import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/channels'
import type { LicenseStatus } from '../shared/types'
import type { LightCleanAPI } from './index'

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(),
  api: null as LightCleanAPI | null,
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: LightCleanAPI) => {
      if (name === 'lightclean') boundary.api = api
    },
  },
  ipcRenderer: { invoke: boundary.invoke },
}))

import './index'

const paths = ['C:\\Users\\Test\\Pictures\\copy.jpg']
const deleteResult = { deleted: 1, failed: 0, spaceRecovered: 8, errors: [] }
const validStatus: LicenseStatus = {
  state: 'active',
  plan: 'annual',
  planLabel: '一年版',
  expiresAt: '2099-01-01T00:00:00.000Z',
  daysRemaining: 100,
  canUsePaidFeatures: true,
  deviceIdSuffix: 'TEST1234',
  message: '授权有效，可使用全部功能。',
  deviceRequestCode: 'test-device-request',
  activationMode: 'online',
  offlineUntil: '2098-01-01T00:00:00.000Z',
}
const offlineExpiredStatus: LicenseStatus = {
  ...validStatus,
  state: 'needs_activation',
  canUsePaidFeatures: false,
  offlineUntil: '2000-01-01T00:00:00.000Z',
  message: '离线授权已超过14天，请联网刷新授权后继续使用。',
}

beforeEach(() => boundary.invoke.mockReset())

describe('paid mutations exposed through the preload bridge', () => {
  it.each(['online', 'offline'] as const)('uses valid %s authorization without a network refresh', async (activationMode) => {
    boundary.invoke.mockResolvedValueOnce({ ...validStatus, activationMode }).mockResolvedValueOnce(deleteResult)

    await expect(boundary.api!.duplicatesDelete(paths, 'recycle')).resolves.toEqual(deleteResult)

    expect(boundary.invoke.mock.calls).toEqual([
      [IPC.LICENSE_STATUS],
      [IPC.DUPLICATES_DELETE, paths, 'recycle'],
    ])
  })

  it('refreshes an offline-expired online paid license once before invoking deletion once', async () => {
    boundary.invoke
      .mockResolvedValueOnce(offlineExpiredStatus)
      .mockResolvedValueOnce(validStatus)
      .mockResolvedValueOnce(deleteResult)

    await expect(boundary.api!.duplicatesDelete(paths, 'recycle')).resolves.toEqual(deleteResult)

    expect(boundary.invoke.mock.calls).toEqual([
      [IPC.LICENSE_STATUS],
      [IPC.LICENSE_REFRESH],
      [IPC.DUPLICATES_DELETE, paths, 'recycle'],
    ])
  })

  it('preserves a refresh denial reason and does not invoke deletion', async () => {
    const message = '当前兑换码已失效，请联系卖家。'
    boundary.invoke
      .mockResolvedValueOnce(offlineExpiredStatus)
      .mockResolvedValueOnce({ ...offlineExpiredStatus, message })

    const operation = boundary.api!.duplicatesDelete(paths, 'recycle')
    await expect(operation).rejects.toThrow(message)
    await expect(operation).rejects.toThrow('授权与套餐')
    expect(boundary.invoke.mock.calls).toEqual([[IPC.LICENSE_STATUS], [IPC.LICENSE_REFRESH]])
  })

  it('preserves a recoverable network failure returned by the refresh service without deleting', async () => {
    const message = '无法连接授权服务，请检查网络后重试。'
    boundary.invoke
      .mockResolvedValueOnce(offlineExpiredStatus)
      .mockResolvedValueOnce({ ...offlineExpiredStatus, message })

    const operation = boundary.api!.duplicatesDelete(paths, 'recycle')
    await expect(operation).rejects.toThrow(message)
    await expect(operation).rejects.toThrow('授权与套餐')
    expect(boundary.invoke.mock.calls).toEqual([[IPC.LICENSE_STATUS], [IPC.LICENSE_REFRESH]])
  })

  it('provides a recoverable Chinese error when the refresh IPC rejects and never deletes', async () => {
    boundary.invoke
      .mockResolvedValueOnce(offlineExpiredStatus)
      .mockRejectedValueOnce(new Error('IPC unavailable'))

    const operation = boundary.api!.duplicatesDelete(paths, 'recycle')
    await expect(operation).rejects.toThrow(/刷新授权/)
    await expect(operation).rejects.toThrow('授权与套餐')
    expect(boundary.invoke.mock.calls).toEqual([[IPC.LICENSE_STATUS], [IPC.LICENSE_REFRESH]])
  })

  it('provides a recoverable Chinese error when status IPC rejects and never deletes', async () => {
    boundary.invoke.mockRejectedValueOnce(new Error('IPC unavailable'))

    const operation = boundary.api!.duplicatesDelete(paths, 'recycle')
    await expect(operation).rejects.toThrow(/授权状态/)
    await expect(operation).rejects.toThrow('授权与套餐')
    expect(boundary.invoke.mock.calls).toEqual([[IPC.LICENSE_STATUS]])
  })

  it.each([
    { plan: 'trial', activationMode: 'offline', state: 'expired', message: '免费试用已结束，请输入卖家提供的兑换码继续使用。' },
    { plan: 'annual', activationMode: 'online', state: 'expired', message: '当前套餐已到期，续费后即可继续使用。' },
    { plan: 'annual', activationMode: 'offline', state: 'needs_activation', message: '离线授权不可用，请重新激活。' },
  ] as const)('never refreshes or deletes for $plan / $activationMode / $state', async (deniedStatus) => {
    boundary.invoke.mockResolvedValueOnce({
      ...offlineExpiredStatus,
      ...deniedStatus,
      expiresAt: deniedStatus.state === 'expired' ? '2000-01-01T00:00:00.000Z' : validStatus.expiresAt,
    })

    const operation = boundary.api!.duplicatesDelete(paths, 'recycle')
    await expect(operation).rejects.toThrow(deniedStatus.message)
    await expect(operation).rejects.toThrow('授权与套餐')
    expect(boundary.invoke.mock.calls).toEqual([[IPC.LICENSE_STATUS]])
  })
})

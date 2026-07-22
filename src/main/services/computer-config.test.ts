import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  system: vi.fn(),
  osInfo: vi.fn(),
  cpu: vi.fn(),
  mem: vi.fn(),
  memLayout: vi.fn(),
  graphics: vi.fn(),
  diskLayout: vi.fn(),
  fsSize: vi.fn(),
  baseboard: vi.fn(),
  networkInterfaces: vi.fn(),
  battery: vi.fn(),
}))

vi.mock('systeminformation', () => mocks)

import { getComputerConfig } from './computer-config'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.system.mockResolvedValue({ manufacturer: 'Acme', model: 'Pro', version: '1', virtual: false, serial: 'private-system-serial' })
  mocks.osInfo.mockResolvedValue({ platform: 'win32', distro: 'Windows 11', release: '11', build: '26100', kernel: '10.0', arch: 'x64', hostname: 'DESKTOP' })
  mocks.cpu.mockResolvedValue({ manufacturer: 'Intel', brand: 'Core Test', speed: 3.2, speedMax: 4.8, physicalCores: 8, cores: 16, processors: 1, socket: 'LGA', virtualization: true })
  mocks.mem.mockResolvedValue({ total: 16 * 1024 ** 3, available: 8 * 1024 ** 3 })
  mocks.memLayout.mockResolvedValue([{ size: 16 * 1024 ** 3, type: 'DDR5', clockSpeed: 5600, manufacturer: 'Memory Co', partNum: 'PART-1', formFactor: 'DIMM', serialNum: 'private-memory-serial' }])
  mocks.graphics.mockResolvedValue({
    controllers: [{ vendor: 'NVIDIA', model: 'Test GPU', vram: 8192, bus: 'PCIe', driverVersion: '1.2.3' }],
    displays: [{ model: 'Test Display', connection: 'HDMI', currentResX: 2560, currentResY: 1440, currentRefreshRate: 144, main: true, serial: 'private-display-serial' }],
  })
  mocks.diskLayout.mockResolvedValue([{ device: 'Disk 0', name: 'Fast SSD', vendor: 'Disk Co', type: 'NVMe', interfaceType: 'PCIe', size: 1024 ** 4, smartStatus: 'Ok', serialNum: 'private-disk-serial' }])
  mocks.fsSize.mockResolvedValue([{ fs: 'C:', type: 'NTFS', mount: 'C:', size: 1024 ** 4, used: 512 * 1024 ** 3, available: 512 * 1024 ** 3, use: 50 }])
  mocks.baseboard.mockResolvedValue({ manufacturer: 'Board Co', model: 'Board 1', version: 'A', serial: 'private-board-serial' })
  mocks.networkInterfaces.mockResolvedValue([{ iface: 'Ethernet', ifaceName: 'Ethernet', default: true, internal: false, virtual: false, type: 'wired', speed: 1000, mac: 'private-mac', ip4: 'private-ip' }])
  mocks.battery.mockResolvedValue({ hasBattery: true, percent: 80, isCharging: false, cycleCount: 20, designedCapacity: 50000, maxCapacity: 45000, serial: 'private-battery-serial' })
})

describe('getComputerConfig', () => {
  it('returns useful cross-platform configuration without hardware identifiers', async () => {
    const result = await getComputerConfig(true)

    expect(result.cpu).toMatchObject({ brand: 'Core Test', physicalCores: 8, threads: 16 })
    expect(result.memory.modules[0]).toMatchObject({ type: 'DDR5', clockMhz: 5600 })
    expect(result.graphics[0]).toMatchObject({ model: 'Test GPU', vramBytes: 8192 * 1024 * 1024 })
    expect(result.network[0]).toMatchObject({ iface: 'Ethernet', speedMbps: 1000, default: true })
    expect(result.battery).toMatchObject({ percent: 80, cycleCount: 20 })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('private-system-serial')
    expect(serialized).not.toContain('private-memory-serial')
    expect(serialized).not.toContain('private-disk-serial')
    expect(serialized).not.toContain('private-mac')
    expect(serialized).not.toContain('private-ip')
  })

  it('keeps the page usable when an individual probe fails', async () => {
    mocks.graphics.mockRejectedValueOnce(new Error('graphics unavailable'))
    const result = await getComputerConfig(true)

    expect(result.graphics).toEqual([])
    expect(result.cpu.brand).toBe('Core Test')
  })
})

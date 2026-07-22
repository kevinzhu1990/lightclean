import * as si from 'systeminformation'
import type { ComputerConfigInfo } from '../../shared/types'

const CACHE_MS = 30_000
let cached: ComputerConfigInfo | null = null
let cachedAt = 0

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch {
    return fallback
  }
}

export async function getComputerConfig(refresh = false): Promise<ComputerConfigInfo> {
  if (!refresh && cached && Date.now() - cachedAt < CACHE_MS) return cached

  const [system, os, cpu, mem, modules, graphics, disks, volumes, motherboard, network, battery] =
    await Promise.all([
      safe(() => si.system(), {} as si.SystemData),
      safe(() => si.osInfo(), {} as si.OsData),
      safe(() => si.cpu(), {} as si.CpuData),
      safe(() => si.mem(), {} as si.MemData),
      safe(() => si.memLayout(), [] as si.MemLayoutData[]),
      safe(() => si.graphics(), { controllers: [], displays: [] } as si.GraphicsData),
      safe(() => si.diskLayout(), [] as si.DiskLayoutData[]),
      safe(() => si.fsSize(), [] as si.FsSizeData[]),
      safe(() => si.baseboard(), {} as si.BaseboardData),
      safe(() => si.networkInterfaces(), [] as si.NetworkInterfacesData[]),
      safe(() => si.battery(), {} as si.BatteryData),
    ])

  const result: ComputerConfigInfo = {
    generatedAt: Date.now(),
    system: {
      manufacturer: text(system.manufacturer),
      model: text(system.model),
      version: text(system.version),
      virtual: system.virtual === true,
    },
    os: {
      platform: text(os.platform),
      distro: text(os.distro),
      release: text(os.release),
      build: text(os.build),
      kernel: text(os.kernel),
      arch: text(os.arch),
      hostname: text(os.hostname),
    },
    cpu: {
      manufacturer: text(cpu.manufacturer),
      brand: text(cpu.brand),
      speedGHz: number(cpu.speed),
      speedMaxGHz: number(cpu.speedMax),
      physicalCores: number(cpu.physicalCores),
      threads: number(cpu.cores),
      processors: number(cpu.processors),
      socket: text(cpu.socket),
      virtualization: cpu.virtualization === true,
    },
    memory: {
      totalBytes: number(mem.total),
      availableBytes: number(mem.available),
      modules: modules.map((module) => ({
        sizeBytes: number(module.size),
        type: text(module.type),
        clockMhz: number(module.clockSpeed),
        manufacturer: text(module.manufacturer),
        partNumber: text(module.partNum),
        formFactor: text(module.formFactor),
      })),
    },
    graphics: graphics.controllers.map((controller) => ({
      vendor: text(controller.vendor),
      model: text(controller.model || controller.name),
      // systeminformation reports controller VRAM in MiB.
      vramBytes: number(controller.vram) * 1024 * 1024,
      bus: text(controller.bus || controller.pciBus),
      driverVersion: text(controller.driverVersion),
    })),
    displays: graphics.displays.map((display) => ({
      model: text(display.model || display.deviceName),
      connection: text(display.connection),
      resolutionX: number(display.currentResX || display.resolutionX),
      resolutionY: number(display.currentResY || display.resolutionY),
      refreshRate: number(display.currentRefreshRate),
      main: display.main === true,
    })),
    disks: disks.map((disk) => ({
      device: text(disk.device),
      name: text(disk.name),
      vendor: text(disk.vendor),
      type: text(disk.type),
      interfaceType: text(disk.interfaceType),
      sizeBytes: number(disk.size),
      smartStatus: text(disk.smartStatus),
    })),
    volumes: volumes.map((volume) => ({
      fs: text(volume.fs),
      type: text(volume.type),
      mount: text(volume.mount),
      sizeBytes: number(volume.size),
      usedBytes: number(volume.used),
      availableBytes: number(volume.available),
      usePercent: number(volume.use),
    })),
    motherboard: {
      manufacturer: text(motherboard.manufacturer),
      model: text(motherboard.model),
      version: text(motherboard.version),
    },
    network: network
      .filter((item) => !item.internal && !item.virtual)
      .map((item) => ({
        iface: text(item.ifaceName || item.iface),
        type: text(item.type),
        speedMbps: number(item.speed),
        default: item.default === true,
      })),
    battery: battery.hasBattery ? {
      hasBattery: true,
      percent: number(battery.percent),
      charging: battery.isCharging === true,
      cycleCount: number(battery.cycleCount),
      designedCapacity: number(battery.designedCapacity),
      maxCapacity: number(battery.maxCapacity),
    } : null,
  }

  cached = result
  cachedAt = Date.now()
  return result
}

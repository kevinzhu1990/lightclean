import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Battery,
  CircuitBoard,
  Cpu,
  HardDrive,
  Laptop,
  MemoryStick,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { formatBytes } from '@/lib/utils'
import type { ComputerConfigInfo } from '@shared/types'

const unknown = '未检测到'
const show = (value: string | number | null | undefined, suffix = ''): string =>
  value === '' || value === null || value === undefined || value === 0 ? unknown : `${value}${suffix}`

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-5 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="shrink-0 text-sm text-[var(--text-muted)]">{label}</span>
      <span className="break-all text-right text-sm font-medium text-[var(--text-primary)]">{value || unknown}</span>
    </div>
  )
}

function InfoCard({ icon: Icon, title, children, className = '' }: {
  icon: LucideIcon
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`glass-card rounded-2xl p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
          <Icon size={19} />
        </div>
        <h2 className="font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      {children}
    </section>
  )
}

export function ComputerConfigPage() {
  const [data, setData] = useState<ComputerConfigInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      setData(await window.lightclean.computerConfigGet(refresh))
    } catch {
      setError('读取电脑配置失败，请点击重新检测。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Laptop className="text-amber-500" size={28} />
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">电脑配置</h1>
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">查看系统、处理器、显卡、内存、硬盘和网络配置</p>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-500">
            <ShieldCheck size={14} />
            信息仅在本机读取，不会上传；序列号、IP 和 MAC 地址不会显示
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? '正在检测' : '重新检测'}
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
      )}

      {!data && loading && (
        <div className="glass-card flex min-h-64 items-center justify-center rounded-2xl">
          <div className="flex flex-col items-center gap-3 text-[var(--text-muted)]">
            <RefreshCw size={28} className="animate-spin text-amber-500" />
            正在读取电脑配置…
          </div>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <InfoCard icon={Laptop} title="电脑与系统">
            <InfoRow label="电脑型号" value={[data.system.manufacturer, data.system.model].filter(Boolean).join(' ')} />
            <InfoRow label="系统" value={[data.os.distro, data.os.release].filter(Boolean).join(' ')} />
            <InfoRow label="系统版本" value={data.os.build ? `Build ${data.os.build}` : data.os.kernel} />
            <InfoRow label="架构" value={data.os.arch} />
            <InfoRow label="电脑名称" value={data.os.hostname} />
            <InfoRow label="运行环境" value={data.system.virtual ? '虚拟机' : '实体电脑'} />
          </InfoCard>

          <InfoCard icon={Cpu} title="处理器">
            <InfoRow label="型号" value={[data.cpu.manufacturer, data.cpu.brand].filter(Boolean).join(' ')} />
            <InfoRow label="核心 / 线程" value={`${data.cpu.physicalCores || '-'} 核 / ${data.cpu.threads || '-'} 线程`} />
            <InfoRow label="基础频率" value={show(data.cpu.speedGHz, ' GHz')} />
            <InfoRow label="最高频率" value={show(data.cpu.speedMaxGHz, ' GHz')} />
            <InfoRow label="插槽" value={data.cpu.socket} />
            <InfoRow label="虚拟化支持" value={data.cpu.virtualization ? '支持' : '未检测到'} />
          </InfoCard>

          <InfoCard icon={MemoryStick} title={`内存 · ${data.memory.totalBytes ? formatBytes(data.memory.totalBytes) : unknown}`}>
            <InfoRow label="总容量" value={data.memory.totalBytes ? formatBytes(data.memory.totalBytes) : unknown} />
            <InfoRow label="当前可用" value={data.memory.availableBytes ? formatBytes(data.memory.availableBytes) : unknown} />
            {data.memory.modules.length > 0 && data.memory.modules.map((module, index) => (
              <InfoRow
                key={`${module.partNumber}-${index}`}
                label={`内存条 ${index + 1}`}
                value={`${formatBytes(module.sizeBytes)} · ${module.type || '未知类型'}${module.clockMhz ? ` · ${module.clockMhz} MHz` : ''}`}
              />
            ))}
          </InfoCard>

          <InfoCard icon={Monitor} title="显卡与显示器">
            {data.graphics.length ? data.graphics.map((gpu, index) => (
              <InfoRow
                key={`${gpu.model}-${index}`}
                label={`显卡 ${index + 1}`}
                value={`${[gpu.vendor, gpu.model].filter(Boolean).join(' ') || unknown}${gpu.vramBytes ? ` · ${formatBytes(gpu.vramBytes, 0)}` : ''}`}
              />
            )) : <InfoRow label="显卡" value={unknown} />}
            {data.displays.map((display, index) => (
              <InfoRow
                key={`${display.model}-${index}`}
                label={`显示器 ${index + 1}${display.main ? '（主）' : ''}`}
                value={`${display.model || '显示器'}${display.resolutionX ? ` · ${display.resolutionX}×${display.resolutionY}` : ''}${display.refreshRate ? ` · ${display.refreshRate} Hz` : ''}`}
              />
            ))}
          </InfoCard>

          <InfoCard icon={HardDrive} title="硬盘与分区" className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">物理硬盘</h3>
                {data.disks.length ? data.disks.map((disk, index) => (
                  <InfoRow
                    key={`${disk.device}-${index}`}
                    label={`硬盘 ${index + 1}`}
                    value={`${[disk.vendor, disk.name].filter(Boolean).join(' ') || disk.device || unknown} · ${formatBytes(disk.sizeBytes)}${disk.type ? ` · ${disk.type}` : ''}`}
                  />
                )) : <InfoRow label="硬盘" value={unknown} />}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">分区</h3>
                {data.volumes.length ? data.volumes.map((volume, index) => (
                  <InfoRow
                    key={`${volume.mount}-${index}`}
                    label={volume.mount || volume.fs || `分区 ${index + 1}`}
                    value={`${formatBytes(volume.usedBytes)} / ${formatBytes(volume.sizeBytes)} · ${Math.round(volume.usePercent)}%`}
                  />
                )) : <InfoRow label="分区" value={unknown} />}
              </div>
            </div>
          </InfoCard>

          <InfoCard icon={CircuitBoard} title="主板">
            <InfoRow label="制造商" value={data.motherboard.manufacturer} />
            <InfoRow label="型号" value={data.motherboard.model} />
            <InfoRow label="版本" value={data.motherboard.version} />
          </InfoCard>

          <InfoCard icon={Wifi} title="网络设备">
            {data.network.length ? data.network.map((item, index) => (
              <InfoRow
                key={`${item.iface}-${index}`}
                label={`${item.default ? '默认 · ' : ''}${item.type || '网络'}`}
                value={`${item.iface}${item.speedMbps ? ` · ${item.speedMbps} Mbps` : ''}`}
              />
            )) : <InfoRow label="网络设备" value={unknown} />}
          </InfoCard>

          {data.battery && (
            <InfoCard icon={Battery} title="电池" className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-x-8 lg:grid-cols-4">
                <InfoRow label="电量" value={`${data.battery.percent}%`} />
                <InfoRow label="状态" value={data.battery.charging ? '充电中' : '未充电'} />
                <InfoRow label="循环次数" value={show(data.battery.cycleCount, ' 次')} />
                <InfoRow label="健康度" value={data.battery.designedCapacity && data.battery.maxCapacity
                  ? `${Math.min(100, Math.round(data.battery.maxCapacity / data.battery.designedCapacity * 100))}%`
                  : unknown}
                />
              </div>
            </InfoCard>
          )}
        </div>
      )}

      {data && <p className="pb-2 text-center text-xs text-[var(--text-muted)]">上次检测：{new Date(data.generatedAt).toLocaleString()}</p>}
    </div>
  )
}

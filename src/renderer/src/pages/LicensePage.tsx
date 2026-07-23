import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  KeyRound,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import type { LicensePlan, LicenseStatus } from '@shared/types'

const PLANS: {
  id: Exclude<LicensePlan, 'trial'>
  name: string
  price: string
  regular: string
  note: string
  recommended?: boolean
}[] = [
  { id: 'quarter', name: '季度版', price: '¥19.9', regular: '日常价 ¥29.9', note: '90天 · 1台电脑' },
  { id: 'half_year', name: '半年版', price: '¥29.9', regular: '日常价 ¥49.9', note: '180天 · 1台电脑' },
  { id: 'annual', name: '一年版', price: '¥49.9', regular: '日常价 ¥79.9', note: '365天 · 1台电脑', recommended: true },
  { id: 'lifetime', name: '买断版', price: '¥99', regular: '日常价 ¥159', note: '永久授权 · 1台电脑' },
]

function formatDate(value: string | null): string {
  if (!value) return '永久有效'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function statusTone(status: LicenseStatus | null): { label: string; color: string; background: string } {
  if (!status) return { label: '正在读取', color: 'var(--text-muted)', background: 'var(--bg-subtle)' }
  if (status.state === 'trial') return { label: '免费试用中', color: '#2563eb', background: 'rgba(59,130,246,.10)' }
  if (status.state === 'active') return { label: '授权有效', color: '#16a34a', background: 'rgba(34,197,94,.10)' }
  if (status.state === 'grace') return { label: '离线宽限期', color: '#b45309', background: 'rgba(245,158,11,.12)' }
  if (status.state === 'expired') return { label: '已到期', color: '#dc2626', background: 'rgba(239,68,68,.10)' }
  return { label: '需要激活', color: '#b45309', background: 'rgba(245,158,11,.12)' }
}

export function LicensePage() {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [redeeming, setRedeeming] = useState(false)
  const tone = useMemo(() => statusTone(status), [status])

  const load = async (refresh = false) => {
    setLoading(true)
    try {
      const next = refresh
        ? await window.lightclean.licenseRefresh()
        : await window.lightclean.licenseStatus()
      setStatus(next)
      if (refresh) toast.success('授权状态已更新')
    } catch {
      toast.error('无法读取授权状态，请重新打开软件后再试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(false) }, [])

  const redeem = async () => {
    if (!code.trim()) {
      toast.error('请输入购买后收到的兑换码。')
      return
    }
    setRedeeming(true)
    try {
      const result = await window.lightclean.licenseRedeem(code)
      setStatus(result.status)
      if (result.success) {
        setCode('')
        toast.success('兑换成功，轻净已完成激活。')
      } else {
        toast.error(result.error ?? '兑换失败，请稍后重试。')
      }
    } catch {
      toast.error('无法连接授权服务，请检查网络后重试。')
    } finally {
      setRedeeming(false)
    }
  }

  const deactivate = async () => {
    if (!confirm('确定解绑当前电脑吗？解绑后，本机将不能继续使用付费功能。')) return
    const result = await window.lightclean.licenseDeactivate()
    setStatus(result.status)
    result.success ? toast.success('当前电脑已解绑。') : toast.error(result.error ?? '解绑失败。')
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="授权与套餐"
        description="查看试用期、套餐价格、兑换码和设备绑定状态"
        action={(
          <button
            onClick={() => void load(true)}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新授权
          </button>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}>
                <BadgeCheck className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {status?.planLabel ?? '正在读取授权'}
                  </h2>
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ color: tone.color, background: tone.background }}>{tone.label}</span>
                </div>
                <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {status?.message ?? '请稍候…'}
                </p>
              </div>
            </div>
            {loading && <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--accent)' }} />}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <InfoCard icon={CalendarDays} label="到期时间"
              value={status ? formatDate(status.expiresAt) : '读取中'} />
            <InfoCard icon={Clock3} label="剩余时间"
              value={status?.daysRemaining == null ? (status?.plan === 'lifetime' ? '永久' : '—') : `${status.daysRemaining} 天`} />
            <InfoCard icon={Laptop} label="当前设备"
              value={status ? `设备尾号 ${status.deviceIdSuffix}` : '读取中'} />
          </div>

          <div className="mt-6 rounded-2xl p-5"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}>
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4" style={{ color: 'var(--accent)' }} />
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>兑换激活码</h3>
            </div>
            <div className="flex gap-3">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => { if (event.key === 'Enter') void redeem() }}
                placeholder="请输入购买后收到的兑换码"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl px-4 py-3 font-mono text-[13px] outline-none"
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={() => void redeem()}
                disabled={redeeming}
                className="flex min-w-[112px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13px] font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                立即兑换
              </button>
            </div>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              一码绑定1台电脑；每12个月可换绑2次。首次激活需要联网，之后可离线使用14天。
            </p>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5" style={{ color: '#22c55e' }} />
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>授权说明</h2>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>安装包可以分享，使用权由设备授权控制</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {[
              '首次安装免费使用全部功能30天',
              '兑换码激活后绑定当前电脑',
              '到期不会删除文件或清理记录',
              '换电脑前可先解绑当前设备',
              '授权验证只上传匿名设备摘要',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ background: 'rgba(34,197,94,.10)', color: '#22c55e' }}>
                  <Check className="h-3 w-3" />
                </span>
                {item}
              </div>
            ))}
          </div>
          {status?.plan && status.plan !== 'trial' && (
            <button onClick={() => void deactivate()}
              className="mt-6 flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium"
              style={{ border: '1px solid rgba(239,68,68,.25)', color: '#ef4444' }}>
              <Unlink className="h-3.5 w-3.5" /> 解绑当前电脑
            </button>
          )}
          {status && !status.serverConfigured && (
            <div className="mt-5 rounded-xl px-4 py-3 text-[11px]"
              style={{ background: 'rgba(245,158,11,.08)', color: '#b45309', border: '1px solid rgba(245,158,11,.18)' }}>
              当前为本机试用模式。正式销售前需要配置授权服务地址，兑换码才可跨电脑验证。
            </div>
          )}
        </section>
      </div>

      <section className="mt-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>套餐价格</h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>首发优惠价，前500名用户可享</p>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>所有套餐均为1台电脑授权</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
            <div key={plan.id} className="glass-card relative rounded-2xl p-5"
              style={plan.recommended ? { borderColor: 'rgba(245,158,11,.45)' } : undefined}>
              {plan.recommended && (
                <span className="absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>推荐</span>
              )}
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{plan.name}</p>
              <div className="mt-3 text-[28px] font-bold tracking-tight" style={{ color: 'var(--accent)' }}>{plan.price}</div>
              <p className="mt-1 text-[11px] line-through" style={{ color: 'var(--text-muted)' }}>{plan.regular}</p>
              <div className="my-4 h-px" style={{ background: 'var(--border-subtle)' }} />
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{plan.note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function InfoCard({ icon: Icon, label, value }: {
  icon: typeof CalendarDays
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-2 truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }} title={value}>{value}</p>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ClipboardCopy,
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
  if (status.state === 'active') return { label: '离线授权有效', color: '#16a34a', background: 'rgba(34,197,94,.10)' }
  if (status.state === 'expired') return { label: '已到期', color: '#dc2626', background: 'rgba(239,68,68,.10)' }
  return { label: '需要激活', color: '#b45309', background: 'rgba(245,158,11,.12)' }
}

export function LicensePage() {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [activationCode, setActivationCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [redeeming, setRedeeming] = useState(false)
  const tone = useMemo(() => statusTone(status), [status])

  const load = async (showMessage = false) => {
    setLoading(true)
    try {
      const next = showMessage
        ? await window.lightclean.licenseRefresh()
        : await window.lightclean.licenseStatus()
      setStatus(next)
      if (showMessage) toast.success('本机授权校验完成')
    } catch {
      toast.error('无法读取本机授权，请重新打开软件后再试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(false) }, [])

  const copyRequestCode = async () => {
    if (!status?.deviceRequestCode) return
    try {
      await navigator.clipboard.writeText(status.deviceRequestCode)
      toast.success('设备申请码已复制，请发送给卖家。')
    } catch {
      toast.error('复制失败，请手动选择并复制设备申请码。')
    }
  }

  const activate = async () => {
    if (!activationCode.trim()) {
      toast.error('请输入卖家发给您的本机激活码。')
      return
    }
    setRedeeming(true)
    try {
      const result = await window.lightclean.licenseRedeem(activationCode)
      setStatus(result.status)
      if (result.success) {
        setActivationCode('')
        toast.success('激活成功，轻净现在可完全离线使用。')
      } else {
        toast.error(result.error ?? '激活失败，请检查激活码。')
      }
    } catch {
      toast.error('激活失败，请确认激活码完整且属于当前电脑。')
    } finally {
      setRedeeming(false)
    }
  }

  const deactivate = async () => {
    if (!confirm('确定移除当前电脑上的授权吗？移除后本机将不能继续使用付费功能。')) return
    const result = await window.lightclean.licenseDeactivate()
    setStatus(result.status)
    result.success
      ? toast.success('本机授权已移除。换电脑使用请联系卖家重新签发。')
      : toast.error(result.error ?? '移除授权失败。')
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="授权与套餐"
        description="查看试用期、套餐价格、设备申请码、激活码和到期时间"
        action={(
          <button
            onClick={() => void load(true)}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            校验本机授权
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Laptop className="h-4 w-4" style={{ color: 'var(--accent)' }} />
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>第一步：复制设备申请码</h3>
              </div>
              <button onClick={() => void copyRequestCode()}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium"
                style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                <ClipboardCopy className="h-3.5 w-3.5" /> 复制申请码
              </button>
            </div>
            <textarea
              readOnly
              value={status?.deviceRequestCode ?? ''}
              onFocus={(event) => event.currentTarget.select()}
              className="h-20 w-full resize-none rounded-xl p-3 font-mono text-[11px] outline-none"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}
            />
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              将申请码和购买兑换码一起发送给卖家。申请码不包含姓名、聊天记录或文件内容。
            </p>
          </div>

          <div className="mt-4 rounded-2xl p-5"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}>
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4" style={{ color: 'var(--accent)' }} />
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>第二步：输入本机激活码</h3>
            </div>
            <textarea
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value.trim())}
              placeholder="粘贴卖家根据本机设备申请码生成的 LC-ACT-… 激活码"
              spellCheck={false}
              className="h-24 w-full resize-none rounded-xl p-3 font-mono text-[11px] outline-none"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                激活和后续使用均不需要联网；激活码仅适用于当前电脑。
              </p>
              <button
                onClick={() => void activate()}
                disabled={redeeming}
                className="flex min-w-[112px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13px] font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                立即激活
              </button>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5" style={{ color: '#22c55e' }} />
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>离线授权说明</h2>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>不连接服务器，不上传任何电脑资料</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {[
              '首次安装可免费使用全部功能30天',
              '购买兑换码由卖家签发为本机激活码',
              '激活后无需联网，可一直离线使用',
              '安装包可以分享，但激活码不能跨电脑使用',
              '到期不会自动删除文件或执行任何清理',
              '更换电脑时，请联系卖家重新签发',
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
              <Unlink className="h-3.5 w-3.5" /> 移除本机授权
            </button>
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

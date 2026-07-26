import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Cloud,
  Database,
  FolderOpen,
  KeyRound,
  Laptop,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Unlink,
  UserCog,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import type {
  LicenseAdminStatus,
  LicenseFeishuConfig,
  LicensePlan,
  LicenseStatus,
} from '@shared/types'

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
      if (showMessage) {
        next.state === 'active' || next.state === 'trial'
          ? toast.success('本机授权已刷新')
          : toast.error(next.message)
      }
    } catch {
      toast.error('无法读取本机授权，请重新打开软件后再试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(false) }, [])

  const activate = async () => {
    if (!activationCode.trim()) {
      toast.error('请输入卖家发给您的兑换码。')
      return
    }
    setRedeeming(true)
    try {
      const result = await window.lightclean.licenseRedeem(activationCode)
      setStatus(result.status)
      if (result.success) {
        setActivationCode('')
        toast.success('激活成功，兑换码已绑定当前电脑。')
      } else {
        toast.error(result.error ?? '激活失败，请检查激活码。')
      }
    } catch {
      toast.error('激活失败，请确认兑换码完整并检查网络。')
    } finally {
      setRedeeming(false)
    }
  }

  const deactivate = async () => {
    if (!confirm('确定解除当前电脑的授权吗？解除后可在新电脑上输入原兑换码，每年最多换绑2次。')) return
    const result = await window.lightclean.licenseDeactivate()
    setStatus(result.status)
    result.success
      ? toast.success('本机授权已解除，可以在新电脑输入原兑换码。')
      : toast.error(result.error ?? '移除授权失败。')
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="授权与套餐"
        description="查看试用期、套餐价格、兑换码、设备绑定和到期时间"
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
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4" style={{ color: 'var(--accent)' }} />
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>输入兑换码激活</h3>
            </div>
            <textarea
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value.trim())}
              placeholder="粘贴卖家发给您的 LC-QTR-…、LC-HALF-…、LC-YEAR-… 或 LC-LIFE-… 兑换码"
              spellCheck={false}
              className="h-24 w-full resize-none rounded-xl p-3 font-mono text-[11px] outline-none"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                首次激活需要联网，兑换码会自动绑定当前电脑；之后可离线使用14天。
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
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>授权说明</h2>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>仅上传兑换码摘要和匿名设备标识，不读取个人文件</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {[
              '首次安装可免费使用全部功能30天',
              '卖家只需发送一张购买兑换码',
              '首次激活自动绑定当前电脑',
              '激活成功后可连续离线使用14天',
              '安装包可以分享，但兑换码不能同时绑定多台电脑',
              '到期不会自动删除文件或执行任何清理',
              '原电脑解除授权后可在新电脑重新激活',
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

function LicenseAdminPanel() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LicenseAdminStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [purchaseCode, setPurchaseCode] = useState('')
  const [deviceRequestCode, setDeviceRequestCode] = useState('')
  const [activationCode, setActivationCode] = useState('')
  const [feishu, setFeishu] = useState<LicenseFeishuConfig | null>(null)
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuAppSecret, setFeishuAppSecret] = useState('')
  const [feishuWikiUrl, setFeishuWikiUrl] = useState('')
  const [feishuSheetTitle, setFeishuSheetTitle] = useState('兑换码台账')
  const [savingFeishu, setSavingFeishu] = useState(false)
  const [testingFeishu, setTestingFeishu] = useState(false)
  const [syncingFeishu, setSyncingFeishu] = useState(false)

  const applyFeishuConfig = (value: LicenseFeishuConfig) => {
    setFeishu(value)
    setFeishuAppId(value.appId)
    setFeishuWikiUrl(value.wikiUrl)
    setFeishuSheetTitle(value.sheetTitle)
    setFeishuAppSecret('')
  }

  const loadStatus = async () => {
    setLoading(true)
    try {
      const nextStatus = await window.lightclean.licenseAdminStatus()
      setStatus(nextStatus)
      if (nextStatus.isAdmin) {
        applyFeishuConfig(await window.lightclean.licenseFeishuConfigGet())
      }
    } catch {
      toast.error('无法读取管理员发码状态。')
    } finally {
      setLoading(false)
    }
  }

  const saveFeishu = async () => {
    setSavingFeishu(true)
    try {
      const next = await window.lightclean.licenseFeishuConfigSave({
        appId: feishuAppId,
        appSecret: feishuAppSecret || undefined,
        wikiUrl: feishuWikiUrl,
        sheetTitle: feishuSheetTitle,
      })
      applyFeishuConfig(next)
      toast.success('飞书自动同步配置已安全保存。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存飞书配置失败。')
    } finally {
      setSavingFeishu(false)
    }
  }

  const testFeishu = async () => {
    setTestingFeishu(true)
    try {
      const result = await window.lightclean.licenseFeishuTest()
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '飞书连接测试失败。')
    } finally {
      setTestingFeishu(false)
    }
  }

  const syncFeishuCode = async () => {
    if (!purchaseCode.trim()) {
      toast.error('请先填写需要补同步的兑换码。')
      return
    }
    setSyncingFeishu(true)
    try {
      const result = await window.lightclean.licenseFeishuSyncCode(purchaseCode.trim())
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '补同步兑换码失败。')
    } finally {
      setSyncingFeishu(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void loadStatus()
  }

  const selectFile = async (kind: 'database' | 'privateKey') => {
    setLoading(true)
    try {
      setStatus(await window.lightclean.licenseAdminSelectFile(kind))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '选择授权资料失败。')
    } finally {
      setLoading(false)
    }
  }

  const issue = async () => {
    if (!purchaseCode.trim() || !deviceRequestCode.trim()) {
      toast.error('请完整填写客户购买兑换码和设备申请码。')
      return
    }
    setIssuing(true)
    try {
      const result = await window.lightclean.licenseAdminIssue(
        purchaseCode.trim(),
        deviceRequestCode.trim(),
      )
      if (!result.success || !result.activationCode) {
        toast.error(result.error ?? '激活码签发失败。')
        return
      }
      setActivationCode(result.activationCode)
      await navigator.clipboard.writeText(result.activationCode).catch(() => {})
      const issuedMessage = result.repeated
        ? '已读取原激活码并复制到剪贴板。'
        : '激活码签发成功，已复制到剪贴板。'
      if (result.feishuSync?.success) {
        toast.success(`${issuedMessage}${result.feishuSync.message}`)
      } else if (result.feishuSync) {
        toast.warning(`${issuedMessage}但${result.feishuSync.message}`)
      } else {
        toast.success(issuedMessage)
      }
    } catch {
      toast.error('签发失败，请检查兑换码和设备申请码。')
    } finally {
      setIssuing(false)
    }
  }

  return (
    <section className="glass-card mt-5 rounded-2xl p-5">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: 'rgba(59,130,246,.10)', color: '#2563eb' }}
          >
            <UserCog className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              管理员发放激活码
            </span>
            <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-muted)' }}>
              仅卖家电脑使用，需要 Windows 管理员权限和本地授权私钥
            </span>
          </span>
        </div>
        <span className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
          {open ? '收起' : '打开工具'}
        </span>
      </button>

      {open && (
        <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--border-subtle)' }}>
          {loading && !status ? (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="h-4 w-4 animate-spin" /> 正在检查管理员权限和授权资料
            </div>
          ) : (
            <>
              <div
                className="rounded-xl p-4 text-[12px]"
                style={{
                  background: status?.ready ? 'rgba(34,197,94,.08)' : 'rgba(59,130,246,.08)',
                  color: status?.ready ? '#15803d' : 'var(--text-secondary)',
                  border: `1px solid ${status?.ready ? 'rgba(34,197,94,.20)' : 'rgba(59,130,246,.18)'}`,
                }}
              >
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-4 w-4" />
                  {status?.message ?? '正在检查管理员状态。'}
                </div>
              </div>

              {!status?.isAdmin ? (
                <button
                  onClick={() => window.lightclean.elevationRelaunch()}
                  className="mt-4 flex items-center gap-2 rounded-xl px-5 py-3 text-[13px] font-semibold"
                  style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                >
                  <ShieldCheck className="h-4 w-4" />
                  以管理员身份重新启动轻净
                </button>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <AdminFileRow
                      icon={Database}
                      label="兑换码数据库"
                      path={status.databasePath}
                      valid={status.databaseFound}
                      onSelect={() => void selectFile('database')}
                    />
                    <AdminFileRow
                      icon={KeyRound}
                      label="离线授权私钥"
                      path={status.privateKeyPath}
                      valid={status.privateKeyFound && status.keyMatches}
                      onSelect={() => void selectFile('privateKey')}
                    />
                  </div>

                  <div
                    className="mt-4 rounded-xl p-4"
                    style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: 'rgba(37,99,235,.10)', color: '#2563eb' }}
                        >
                          <Cloud className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                            飞书兑换码台账自动同步
                          </div>
                          <div className="mt-1 text-[11px]" style={{ color: feishu?.configured ? '#15803d' : 'var(--text-muted)' }}>
                            {feishu?.message ?? '读取飞书配置中'}
                          </div>
                        </div>
                      </div>
                      {feishu?.configured && (
                        <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'rgba(34,197,94,.10)', color: '#15803d' }}>
                          已启用
                        </span>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>飞书 App ID</span>
                        <input
                          value={feishuAppId}
                          onChange={(event) => setFeishuAppId(event.target.value.trim())}
                          placeholder="cli_..."
                          className="w-full rounded-lg px-3 py-2.5 font-mono text-[11px] outline-none"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                          飞书 App Secret {feishu?.appSecretSaved ? '（已加密保存，留空不修改）' : ''}
                        </span>
                        <input
                          type="password"
                          value={feishuAppSecret}
                          onChange={(event) => setFeishuAppSecret(event.target.value)}
                          placeholder={feishu?.appSecretSaved ? '••••••••••••••••' : '输入 App Secret'}
                          className="w-full rounded-lg px-3 py-2.5 font-mono text-[11px] outline-none"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>飞书台账链接</span>
                        <input
                          value={feishuWikiUrl}
                          onChange={(event) => setFeishuWikiUrl(event.target.value.trim())}
                          placeholder="https://...feishu.cn/wiki/..."
                          className="w-full rounded-lg px-3 py-2.5 text-[11px] outline-none"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>工作表名称</span>
                        <input
                          value={feishuSheetTitle}
                          onChange={(event) => setFeishuSheetTitle(event.target.value)}
                          placeholder="兑换码台账"
                          className="w-full rounded-lg px-3 py-2.5 text-[11px] outline-none"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => void saveFeishu()}
                        disabled={savingFeishu}
                        className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-semibold disabled:opacity-50"
                        style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                      >
                        {savingFeishu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        保存配置
                      </button>
                      <button
                        onClick={() => void testFeishu()}
                        disabled={!feishu?.configured || testingFeishu}
                        className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-semibold disabled:opacity-50"
                        style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
                      >
                        {testingFeishu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        测试连接
                      </button>
                      <button
                        onClick={() => void syncFeishuCode()}
                        disabled={!feishu?.configured || !purchaseCode.trim() || syncingFeishu}
                        className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-semibold disabled:opacity-50"
                        style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
                      >
                        {syncingFeishu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                        同步当前兑换码
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        客户购买兑换码
                      </span>
                      <input
                        value={purchaseCode}
                        onChange={(event) => setPurchaseCode(event.target.value)}
                        placeholder="LC-QTR-… / LC-YEAR-…"
                        className="w-full rounded-xl px-3 py-3 font-mono text-[12px] outline-none"
                        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        客户设备申请码
                      </span>
                      <textarea
                        value={deviceRequestCode}
                        onChange={(event) => setDeviceRequestCode(event.target.value.trim())}
                        placeholder="LC-REQ-…"
                        className="h-20 w-full resize-none rounded-xl p-3 font-mono text-[11px] outline-none"
                        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex items-center justify-end">
                    <button
                      onClick={() => void issue()}
                      disabled={!status.ready || issuing}
                      className="flex min-w-[150px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13px] font-semibold disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                    >
                      {issuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                      生成并复制激活码
                    </button>
                  </div>

                  {activationCode && (
                    <div className="mt-4 rounded-xl p-4" style={{ background: 'rgba(34,197,94,.07)', border: '1px solid rgba(34,197,94,.20)' }}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[12px] font-semibold" style={{ color: '#15803d' }}>签发成功</span>
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(activationCode)
                            toast.success('激活码已复制。')
                          }}
                          className="flex items-center gap-1.5 text-[11px] font-medium"
                          style={{ color: 'var(--accent)' }}
                        >
                          <ClipboardCopy className="h-3.5 w-3.5" /> 再次复制
                        </button>
                      </div>
                      <textarea
                        readOnly
                        value={activationCode}
                        onFocus={(event) => event.currentTarget.select()}
                        className="h-24 w-full resize-none rounded-lg p-3 font-mono text-[10px] outline-none"
                        style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)' }}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function AdminFileRow({
  icon: Icon,
  label,
  path,
  valid,
  onSelect,
}: {
  icon: typeof Database
  label: string
  path: string | null | undefined
  valid: boolean
  onSelect: () => void
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            <Icon className="h-4 w-4" />
            {label}
            <span style={{ color: valid ? '#16a34a' : '#dc2626' }}>{valid ? '已验证' : '未就绪'}</span>
          </div>
          <p className="mt-2 truncate text-[10px]" style={{ color: 'var(--text-muted)' }} title={path ?? ''}>
            {path ?? '尚未选择文件'}
          </p>
        </div>
        <button
          onClick={onSelect}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium"
          style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
        >
          <FolderOpen className="h-3.5 w-3.5" /> 选择
        </button>
      </div>
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

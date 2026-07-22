import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Files, HardDrive, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatBytes, formatNumber } from '@/lib/utils'
import type { ScanResult } from '@shared/types'

export function RecycleBinPage() {
  const [results, setResults] = useState<ScanResult[]>([])
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [scanComplete, setScanComplete] = useState(false)
  const [lastCleaned, setLastCleaned] = useState<{ count: number; size: number } | null>(null)

  const totals = useMemo(() => results.reduce(
    (total, result) => ({ count: total.count + result.itemCount, size: total.size + result.totalSize }),
    { count: 0, size: 0 },
  ), [results])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setResults(await window.lightclean.recycleBinScan())
      setScanComplete(true)
    } catch (error) {
      toast.error('无法读取回收站', { description: error instanceof Error ? error.message : undefined })
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => { void scan() }, [scan])

  const emptyRecycleBin = async () => {
    setConfirming(false)
    setCleaning(true)
    const before = totals
    try {
      const result = await window.lightclean.recycleBinClean()
      if (result.errors.length > 0 || result.filesSkipped > 0) {
        toast.warning('回收站未能完全清空', {
          description: result.errors[0]?.reason ?? `仍有 ${result.filesSkipped} 个项目无法删除`,
        })
      } else {
        toast.success(`已清空回收站，释放 ${formatBytes(before.size)}`)
        setLastCleaned(before)
      }
      await scan()
    } catch (error) {
      toast.error('清空回收站失败', { description: error instanceof Error ? error.message : undefined })
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="清空回收站"
        description="查看回收站占用空间，确认后永久删除其中的垃圾文件。"
        action={
          <button
            onClick={() => void scan()}
            disabled={scanning || cleaning}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium disabled:opacity-40"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? '正在检查…' : '重新检查'}
          </button>
        }
      />

      <div className="mb-5 flex items-start gap-3 rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}>
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
        <div>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>安全提醒</p>
          <p className="mt-1 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            清空回收站后文件将无法通过系统回收站恢复。请先确认其中没有误删的重要文件。
          </p>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-3xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}>
        <div className="flex flex-col items-center px-8 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl" style={{ background: totals.count ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)' }}>
            {totals.count ? <Trash2 className="h-10 w-10 text-red-500" /> : <CheckCircle2 className="h-10 w-10 text-green-500" />}
          </div>

          <h2 className="mt-6 text-[22px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {!scanComplete || scanning ? '正在检查回收站' : totals.count ? '回收站中有可清理文件' : '回收站已经是空的'}
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {totals.count ? `共 ${formatNumber(totals.count)} 个项目，占用 ${formatBytes(totals.size)}` : '当前没有需要清空的项目'}
          </p>

          {totals.count > 0 && (
            <div className="mt-8 grid w-full max-w-md grid-cols-2 gap-3">
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-subtle)' }}>
                <Files className="mx-auto h-5 w-5 text-sky-500" />
                <div className="mt-2 text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>{formatNumber(totals.count)}</div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>文件和文件夹</div>
              </div>
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-subtle)' }}>
                <HardDrive className="mx-auto h-5 w-5 text-sky-500" />
                <div className="mt-2 text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>{formatBytes(totals.size)}</div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>可释放空间</div>
              </div>
            </div>
          )}

          <button
            onClick={() => setConfirming(true)}
            disabled={!totals.count || scanning || cleaning}
            className="mt-8 flex items-center gap-2 rounded-xl px-7 py-3 text-[13px] font-semibold text-red-500 disabled:opacity-35"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.18)' }}
          >
            <Trash2 className="h-4 w-4" />
            {cleaning ? '正在清空…' : '立即清空回收站'}
          </button>

          {lastCleaned && !totals.count && (
            <p className="mt-4 text-[12px] text-green-500">
              上次已清理 {formatNumber(lastCleaned.count)} 个项目，释放 {formatBytes(lastCleaned.size)}
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void emptyRecycleBin()}
        title="确认永久清空回收站？"
        description={`将永久删除回收站中的 ${formatNumber(totals.count)} 个项目（${formatBytes(totals.size)}）。清空后无法通过回收站恢复。`}
        confirmLabel="确认永久清空"
        variant="danger"
      />
    </div>
  )
}

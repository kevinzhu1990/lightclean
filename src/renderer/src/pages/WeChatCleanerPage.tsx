import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ExternalLink, FileText, FolderSearch, Image, MessageCircle, Music, RefreshCw, Search, ShieldAlert, Trash2, Video } from 'lucide-react'
import { formatBytes } from '@/lib/utils'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import type { WeChatDataLocation, WeChatMediaCategory, WeChatScanResult } from '@shared/types'

const MEDIA_PAGE_SIZE = 100
const CATEGORY_LABELS: Record<WeChatMediaCategory, string> = {
  image: '图片', video: '视频', document: '文档', audio: '音频', archive: '压缩包', other: '其他附件',
}
const CATEGORY_ICONS = { image: Image, video: Video, document: FileText, audio: Music, archive: Archive, other: FileText }

const COPY = {
  zh: {
    title: '微信聊天记录清理', description: '扫描本机微信聊天数据库和聊天媒体，确认后移入系统回收站或废纸篓。',
    scan: '扫描微信数据', choose: '选择自定义数据目录', scanning: '正在扫描…', close: '请先完全退出微信',
    closeDesc: '微信正在运行。为防止数据库损坏，退出微信后重新扫描才可删除。', found: '发现的数据',
    empty: '未发现微信聊天数据。若微信使用了自定义存储位置，请手动选择微信数据目录。',
    selected: '已选择', delete: '移入回收站', messages: '聊天数据库', media: '聊天文件、图片和视频', other: '其他数据',
    warning: '这是用户聊天内容，不是普通缓存。删除后微信内的本地记录可能消失。项目会将所选目录移入回收站，但仍建议先备份重要内容。',
    confirmTitle: '确认删除所选微信记录？', confirmDesc: '所选聊天数据将移入系统回收站/废纸篓。请核对账号、路径和大小。',
    confirm: '确认移入回收站', deleting: '正在删除…', success: '已将 {{count}} 项微信数据移入回收站', failed: '{{count}} 项删除失败',
    account: '账号/目录', path: '存储路径', date: '最近修改', selectAll: '全选', clear: '清空选择', roots: '扫描位置',
  },
  en: {
    title: 'WeChat History Cleaner', description: 'Find local WeChat messages and media, then move selected data to the system Trash.',
    scan: 'Scan WeChat data', choose: 'Choose custom data folder', scanning: 'Scanning…', close: 'Close WeChat first',
    closeDesc: 'WeChat is running. Quit it completely and scan again before deleting to prevent database corruption.', found: 'Discovered data',
    empty: 'No WeChat chat data was found. Choose the WeChat data folder if you use a custom storage location.',
    selected: 'Selected', delete: 'Move to Trash', messages: 'Chat databases', media: 'Chat files, images and video', other: 'Other data',
    warning: 'This is user chat content, not disposable cache. Removing it can make local history disappear from WeChat. Selected folders are moved to Trash, but you should still back up anything important.',
    confirmTitle: 'Remove the selected WeChat history?', confirmDesc: 'The selected chat data will be moved to the system Trash. Verify the account, path, and size first.',
    confirm: 'Move to Trash', deleting: 'Deleting…', success: 'Moved {{count}} WeChat data items to Trash', failed: '{{count}} items could not be removed',
    account: 'Account/folder', path: 'Storage path', date: 'Last modified', selectAll: 'Select all', clear: 'Clear selection', roots: 'Scanned locations',
  },
}

export function WeChatCleanerPage() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.toLowerCase().startsWith('zh')
  const c = isZh ? COPY.zh : COPY.en
  const [result, setResult] = useState<WeChatScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [customRoot, setCustomRoot] = useState<string>()
  const [scanError, setScanError] = useState('')
  const [fileSelected, setFileSelected] = useState<Set<string>>(new Set())
  const [fileConfirming, setFileConfirming] = useState(false)
  const [fileCategory, setFileCategory] = useState<'all' | WeChatMediaCategory>('all')
  const [olderThanDays, setOlderThanDays] = useState(0)
  const [minimumSizeMb, setMinimumSizeMb] = useState(0)
  const [fileQuery, setFileQuery] = useState('')
  const [mediaPage, setMediaPage] = useState(1)

  const selectedLocations = useMemo(
    () => result?.locations.filter((item) => selected.has(item.id)) ?? [],
    [result, selected],
  )
  const selectedSize = selectedLocations.reduce((sum, item) => sum + item.size, 0)
  const filteredMedia = useMemo(() => {
    const files = result?.mediaFiles ?? []
    const cutoff = olderThanDays ? Date.now() - olderThanDays * 86_400_000 : 0
    const minimumBytes = minimumSizeMb * 1024 * 1024
    const query = fileQuery.trim().toLowerCase()
    return files.filter((file) => {
      if (fileCategory !== 'all' && file.category !== fileCategory) return false
      if (cutoff && file.modifiedAt > cutoff) return false
      if (minimumBytes && file.size < minimumBytes) return false
      if (query && !file.name.toLowerCase().includes(query) && !file.path.toLowerCase().includes(query)) return false
      return true
    })
  }, [result, fileCategory, olderThanDays, minimumSizeMb, fileQuery])
  const filteredMediaSize = filteredMedia.reduce((sum, file) => sum + file.size, 0)
  const selectedMedia = useMemo(
    () => result?.mediaFiles.filter((file) => fileSelected.has(file.id)) ?? [],
    [result, fileSelected],
  )
  const selectedMediaSize = selectedMedia.reduce((sum, file) => sum + file.size, 0)
  const mediaPageCount = Math.max(1, Math.ceil(filteredMedia.length / MEDIA_PAGE_SIZE))
  const visibleMedia = filteredMedia.slice((mediaPage - 1) * MEDIA_PAGE_SIZE, mediaPage * MEDIA_PAGE_SIZE)

  const scan = async (root = customRoot) => {
    setScanning(true)
    setScanError('')
    try {
      const next = await window.lightclean.weChatScan(root)
      setResult(next)
      setSelected(new Set())
      setFileSelected(new Set())
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const message = i18n.language.toLowerCase().startsWith('zh')
        ? `扫描微信数据失败${detail ? `：${detail}` : '，请重新尝试或手动选择微信数据目录。'}`
        : `Unable to scan WeChat data${detail ? `: ${detail}` : '. Try again or choose the data folder manually.'}`
      setScanError(message)
      toast.error(message)
    } finally { setScanning(false) }
  }

  useEffect(() => { void scan() }, [])
  useEffect(() => { setMediaPage(1) }, [fileCategory, olderThanDays, minimumSizeMb, fileQuery])

  const chooseRoot = async () => {
    const root = await window.lightclean.weChatSelectRoot()
    if (!root) return
    setCustomRoot(root)
    await scan(root)
  }

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const remove = async () => {
    setConfirming(false)
    setDeleting(true)
    try {
      const outcome = await window.lightclean.weChatDelete([...selected])
      if (outcome.deleted) toast.success(c.success.replace('{{count}}', String(outcome.deleted)))
      if (outcome.failed) toast.error(c.failed.replace('{{count}}', String(outcome.failed)))
      await scan()
    } finally { setDeleting(false) }
  }

  const removeMediaFiles = async () => {
    setFileConfirming(false)
    setDeleting(true)
    try {
      const outcome = await window.lightclean.weChatDeleteFiles([...fileSelected])
      if (outcome.deleted) toast.success(`已将 ${outcome.deleted} 个文件移入回收站，释放 ${formatBytes(outcome.spaceRecovered)}`)
      if (outcome.failed) toast.error(`${outcome.failed} 个文件清理失败`)
      await scan()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理微信文件失败')
    } finally { setDeleting(false) }
  }

  const kindLabel = (item: WeChatDataLocation) => c[item.kind]

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-white">{c.title}</h1>
          <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>{c.description}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/recycle-bin')} disabled={scanning || deleting} className="rounded-xl px-4 py-2.5 text-[12px] font-medium disabled:opacity-50" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
            <Trash2 className="mr-2 inline h-4 w-4" />{isZh ? '清空回收站' : 'Empty Trash'}
          </button>
          <button onClick={chooseRoot} disabled={scanning || deleting} className="rounded-xl px-4 py-2.5 text-[12px] font-medium disabled:opacity-50" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
            <FolderSearch className="mr-2 inline h-4 w-4" />{c.choose}
          </button>
          <button onClick={() => scan()} disabled={scanning || deleting} className="rounded-xl px-4 py-2.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
            <RefreshCw className={`mr-2 inline h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />{scanning ? c.scanning : c.scan}
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-3 rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}>
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
        <p className="text-[12.5px] leading-5" style={{ color: 'var(--text-secondary)' }}>{c.warning}</p>
      </div>

      {result?.weChatRunning && (
        <div className="mb-5 rounded-2xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="font-semibold text-red-400">{c.close}</div><div className="mt-1 text-[12px] text-red-300/70">{c.closeDesc}</div>
        </div>
      )}

      {scanError && (
        <div className="mb-5 rounded-2xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="font-semibold text-red-400">扫描失败</div>
          <div className="mt-1 text-[12px] text-red-300/70">{scanError}</div>
        </div>
      )}

      {result && result.locations.length > 0 ? (
        <>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-[13px] font-semibold text-white">{c.found} · {result.locations.length}</span>
            <span className="text-[12px] text-sky-600">{formatBytes(result.totalSize)}</span>
            <div className="flex-1" />
            <button onClick={() => setSelected(new Set(result.locations.map((item) => item.id)))} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{c.selectAll}</button>
            <button onClick={() => setSelected(new Set())} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{c.clear}</button>
          </div>
          <div className="overflow-hidden rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}>
            {result.locations.map((item, index) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[0.02]" style={index ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="h-4 w-4 accent-amber-500" />
                <MessageCircle className="h-4 w-4 shrink-0" style={{ color: item.kind === 'messages' ? '#22c55e' : 'var(--accent)' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-white">{item.account}</span><span className="rounded-md px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>{kindLabel(item)}</span></div>
                  <div className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-dim)' }} title={item.path}>{item.path}</div>
                </div>
                <div className="text-right"><div className="text-[13px] font-semibold text-sky-600">{formatBytes(item.size)}</div><div className="mt-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>{item.modifiedAt ? new Date(item.modifiedAt).toLocaleDateString() : '—'}</div></div>
                <button onClick={(event) => { event.preventDefault(); void window.lightclean.weChatOpenLocation(item.id) }} className="p-1 text-zinc-600 hover:text-zinc-300"><ExternalLink className="h-4 w-4" /></button>
              </label>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-end gap-4">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{c.selected}: {selected.size} · {formatBytes(selectedSize)}</span>
            <button onClick={() => setConfirming(true)} disabled={!selected.size || result.weChatRunning || deleting} className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-red-400 disabled:opacity-40" style={{ background: 'rgba(239,68,68,0.12)' }}><Trash2 className="mr-2 inline h-4 w-4" />{deleting ? c.deleting : c.delete}</button>
          </div>
        </>
      ) : result && !scanning ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl p-10 text-center text-[13px]" style={{ border: '1px dashed var(--border-medium)', color: 'var(--text-muted)' }}>
          <FolderSearch className="mb-3 h-8 w-8 opacity-60" />
          <div>{c.empty}</div>
          <button onClick={chooseRoot} className="mt-4 rounded-xl px-4 py-2 text-[12px] font-medium" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
            {c.choose}
          </button>
        </div>
      ) : null}

      {result && result.mediaFiles.length > 0 && (
        <section className="mt-6 rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>聊天文件精细筛选</h2>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>支持按类型、时间、大小和文件名筛选；“其他附件”仅列出1MB以上文件。微信4群聊数据库已加密，无法安全可靠地按群名称映射文件。</p>
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>匹配 {filteredMedia.length} 个 · <span className="font-semibold text-sky-600">{formatBytes(filteredMediaSize)}</span></div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-4">
            <label className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
              <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="搜索文件名或文件夹" className="w-full rounded-xl py-2 pl-9 pr-3 text-[12px] outline-none" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} />
            </label>
            <select value={fileCategory} onChange={(event) => setFileCategory(event.target.value as 'all' | WeChatMediaCategory)} className="rounded-xl px-3 py-2 text-[12px] outline-none" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
              <option value="all">全部类型</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={olderThanDays} onChange={(event) => setOlderThanDays(Number(event.target.value))} className="rounded-xl px-3 py-2 text-[12px] outline-none" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
              <option value={0}>全部时间</option><option value={30}>30天以前</option><option value={90}>3个月以前</option><option value={180}>6个月以前</option><option value={365}>1年以前</option>
            </select>
            <select value={minimumSizeMb} onChange={(event) => setMinimumSizeMb(Number(event.target.value))} className="rounded-xl px-3 py-2 text-[12px] outline-none" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
              <option value={0}>全部大小</option><option value={10}>大于10 MB</option><option value={50}>大于50 MB</option><option value={100}>大于100 MB</option><option value={500}>大于500 MB</option>
            </select>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-[11px]">
            <div className="flex gap-3"><button onClick={() => setFileSelected(new Set(filteredMedia.map((file) => file.id)))} className="text-sky-600 hover:underline">选择全部筛选结果</button><button onClick={() => setFileSelected(new Set())} style={{ color: 'var(--text-muted)' }}>清空选择</button></div>
            <span style={{ color: 'var(--text-muted)' }}>每页显示 {MEDIA_PAGE_SIZE} 个</span>
          </div>

          <div className="mt-3 max-h-[420px] overflow-y-auto rounded-xl" style={{ border: '1px solid var(--border-subtle)' }}>
            {visibleMedia.map((file, index) => {
              const Icon = CATEGORY_ICONS[file.category]
              return (
                <label key={file.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5" style={index ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
                  <input type="checkbox" checked={fileSelected.has(file.id)} onChange={() => setFileSelected((current) => { const next = new Set(current); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next })} className="h-4 w-4 accent-sky-600" />
                  <Icon className="h-4 w-4 shrink-0 text-sky-600" />
                  <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{file.name}</div><div className="mt-0.5 truncate text-[10px]" style={{ color: 'var(--text-dim)' }} title={file.path}>{file.path}</div></div>
                  <span className="rounded-md px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>{CATEGORY_LABELS[file.category]}</span>
                  <div className="w-24 text-right"><div className="text-[12px] font-semibold text-sky-600">{formatBytes(file.size)}</div><div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{new Date(file.modifiedAt).toLocaleDateString()}</div></div>
                </label>
              )
            })}
            {!visibleMedia.length && <div className="p-8 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>没有符合当前条件的文件</div>}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}><button disabled={mediaPage <= 1} onClick={() => setMediaPage((page) => Math.max(1, page - 1))} className="rounded-lg px-3 py-1.5 disabled:opacity-40" style={{ background: 'var(--bg-hover)' }}>上一页</button><span>第 {mediaPage} / {mediaPageCount} 页</span><button disabled={mediaPage >= mediaPageCount} onClick={() => setMediaPage((page) => Math.min(mediaPageCount, page + 1))} className="rounded-lg px-3 py-1.5 disabled:opacity-40" style={{ background: 'var(--bg-hover)' }}>下一页</button></div>
            <div className="flex items-center gap-4"><span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>已选 {fileSelected.size} 个 · {formatBytes(selectedMediaSize)}</span><button onClick={() => setFileConfirming(true)} disabled={!fileSelected.size || result.weChatRunning || deleting} className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-red-500 disabled:opacity-40" style={{ background: 'rgba(239,68,68,0.10)' }}><Trash2 className="mr-2 inline h-4 w-4" />移入回收站</button></div>
          </div>
        </section>
      )}

      {result && <div className="mt-6 text-[10px]" style={{ color: 'var(--text-dim)' }}>{c.roots}: {result.roots.join(' · ')}</div>}
      <ConfirmDialog open={confirming} onCancel={() => setConfirming(false)} onConfirm={remove} title={c.confirmTitle} description={`${c.confirmDesc} ${selected.size} · ${formatBytes(selectedSize)}`} confirmLabel={c.confirm} variant="danger" />
      <ConfirmDialog open={fileConfirming} onCancel={() => setFileConfirming(false)} onConfirm={removeMediaFiles} title="确认清理所选微信文件？" description={`将 ${fileSelected.size} 个文件（${formatBytes(selectedMediaSize)}）移入系统回收站。聊天数据库不会被修改。`} confirmLabel="确认移入回收站" variant="danger" />
    </div>
  )
}

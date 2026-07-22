import type { CleaningSafetyLevel, ScanItem, ScanResult } from './types'

export interface CleaningSafetyInfo {
  level: CleaningSafetyLevel
  reason: string
  impact: string
  recovery: string
}

const PROTECTED_PATHS = [
  /[\\/]windows[\\/]installer(?:[\\/]|$)/i,
  /[\\/]windows[\\/]winsxs(?:[\\/]|$)/i,
  /[\\/]driverstore(?:[\\/]|$)/i,
  /[\\/]wechat files[\\/].*[\\/](?:msg|db_storage)(?:[\\/]|$)/i,
  /[\\/]wechat_files[\\/].*[\\/](?:msg|db_storage)(?:[\\/]|$)/i,
  /[\\/]micromsg[\\/].*[\\/](?:msg|multi|db)(?:[\\/]|$)/i,
]

const PROTECTED_NAMES = /password|login data|bookmark|cookie|session|chat database|message database|installer patch cache|winsxs|driver store/i
const CONFIRM_NAMES = /recycle|trash|prefetch|windows update|delivery optimization|previous windows|memory dump|minidump|crash dump|shader|offline|package|repository|database|shortcut|environment|path entr|installer|redistributable|thumbnail/i
const RECOMMENDED_NAMES = /\btemp(?:orary)?\b|\bcache\b|code cache|gpu cache|\blogs?\b|error report|crash report|trace|diagnostic|telemetry|profiler/i

export function classifyCleaningTarget(category: string, subcategory: string, filePath = ''): CleaningSafetyInfo {
  const name = `${category} ${subcategory}`

  if (PROTECTED_PATHS.some((pattern) => pattern.test(filePath)) || PROTECTED_NAMES.test(name)) {
    return {
      level: 'protected',
      reason: '可能包含账号数据、聊天数据库、安装修复文件或系统受保护内容。',
      impact: '删除后可能造成数据丢失、程序无法修复或系统功能异常。',
      recovery: '轻净不会自动选择或删除；请使用对应软件或系统自带工具处理。',
    }
  }

  if (category === 'recycleBin') {
    return {
      level: 'confirm',
      reason: '回收站中的文件已经删除，但仍可能需要恢复。',
      impact: '清空后将无法通过回收站还原。',
      recovery: '清空前可打开回收站检查；清空后通常不可恢复。',
    }
  }

  if (category === 'shortcut' || category === 'environment' || category === 'database' || CONFIRM_NAMES.test(name)) {
    return {
      level: 'confirm',
      reason: '该项目通常可以处理，但可能影响回滚、诊断、启动速度或开发环境。',
      impact: '删除后可能需要重新下载、重新生成，或失去近期故障诊断信息。',
      recovery: '默认不选；建议确认用途后再操作，并优先使用可恢复方式。',
    }
  }

  if (category === 'browser' || RECOMMENDED_NAMES.test(name)) {
    return {
      level: 'recommended',
      reason: '这是可重新生成的临时文件、普通缓存或历史日志。',
      impact: '首次重新打开相关程序时可能稍慢，但不会删除密码、书签或会话。',
      recovery: '清理内容会由系统或应用按需重新生成。',
    }
  }

  return {
    level: 'confirm',
    reason: '规则尚未将该项目确认为完全可自动清理。',
    impact: '删除后可能需要应用重新生成或重新下载数据。',
    recovery: '默认不选；请先打开位置并确认内容。',
  }
}

export function applyCleaningSafety(result: ScanResult): ScanResult {
  const base = classifyCleaningTarget(result.category, result.subcategory, result.items[0]?.path || '')
  const items: ScanItem[] = result.items.map((item) => {
    const info = classifyCleaningTarget(item.category, item.subcategory, item.path)
    return {
      ...item,
      selected: info.level === 'recommended',
      safety: info.level,
      cleanupReason: info.reason,
      cleanupImpact: info.impact,
      cleanupRecovery: info.recovery,
    }
  })
  const levels = new Set(items.map((item) => item.safety))
  const info = levels.has('protected')
    ? classifyCleaningTarget(result.category, 'Installer Patch Cache', result.items.find((item) => item.safety === 'protected')?.path || '')
    : base

  return {
    ...result,
    items,
    safety: info.level,
    cleanupReason: info.reason,
    cleanupImpact: info.impact,
    cleanupRecovery: info.recovery,
  }
}

export function canCleanItem(item: ScanItem): boolean {
  const info = item.safety
    ? { level: item.safety }
    : classifyCleaningTarget(item.category, item.subcategory, item.path)
  return info.level !== 'protected'
}

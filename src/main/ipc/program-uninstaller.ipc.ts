import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import {
  getInstalledProgramsFull,
  runUninstaller,
  verifyUninstall,
  deleteRegistryKey,
  scanLeftoversForProgram,
} from '../services/program-uninstaller'
import { safeDelete } from '../services/file-utils'
import type {
  InstalledProgram,
  UninstallerListResult,
  UninstallProgress,
  UninstallResult,
  UninstallLeftoverEstimate,
} from '../../shared/types'
import type { WindowGetter } from './index'

let cachedPrograms: InstalledProgram[] = []

export function registerProgramUninstallerIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: UninstallProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.UNINSTALLER_PROGRESS, data)
  }

  ipcMain.handle(IPC.UNINSTALLER_LIST, async (): Promise<UninstallerListResult> => {
    const programs = await getInstalledProgramsFull()
    cachedPrograms = programs
    return { programs, totalCount: programs.length }
  })

  ipcMain.handle(
    IPC.UNINSTALLER_ESTIMATE_LEFTOVERS,
    async (_event, programId: string): Promise<UninstallLeftoverEstimate> => {
      const program = cachedPrograms.find((item) => item.id === programId)
      if (!program) return { programId, itemCount: 0, totalSize: 0, paths: [] }
      const leftovers = await scanLeftoversForProgram(program)
      return {
        programId,
        itemCount: leftovers.length,
        totalSize: leftovers.reduce((sum, item) => sum + item.size, 0),
        paths: leftovers.slice(0, 20).map((item) => item.path),
      }
    },
  )

  ipcMain.handle(
    IPC.UNINSTALLER_UNINSTALL,
    async (_event, programId: string): Promise<UninstallResult> => {
      const program = cachedPrograms.find((p) => p.id === programId)
      if (!program) {
        return {
          success: false,
          programName: 'Unknown',
          exitCode: null,
          error: '程序列表已失效，请刷新后重试。',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0,
        }
      }

      // Phase 1: Run the native uninstaller
      sendProgress({
        phase: 'uninstalling',
        currentProgram: program.displayName,
        progress: 10,
        detail: '正在运行程序自带的卸载器…',
      })

      const exitCode = await runUninstaller(program)

      // Phase 2: Verify the uninstall
      const removed = await verifyUninstall(program.registryKey)

      if (!removed) {
        // Registry key still exists — program is likely still installed.
        // Exit codes: 0 may mean cancelled, 1602/1603 are MSI cancel/fail,
        // 3010 means success but reboot needed (registry clears after reboot).
        const rebootPending = exitCode === 3010
        if (!rebootPending) {
          return {
            success: false,
            programName: program.displayName,
            exitCode,
            error: '卸载可能已取消或失败，程序仍存在于系统安装列表中。',
            leftoversFound: 0,
            leftoversCleaned: 0,
            leftoversSize: 0,
          }
        }
      }

      // Phase 3: Scan for leftovers
      sendProgress({
        phase: 'scanning-leftovers',
        currentProgram: program.displayName,
        progress: 50,
        detail: '正在扫描可能的残留文件…',
      })

      const leftovers = await scanLeftoversForProgram(program)
      const leftoversSize = leftovers.reduce((sum, item) => sum + item.size, 0)

      if (leftovers.length === 0) {
        return {
          success: true,
          programName: program.displayName,
          exitCode,
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0,
          leftoversRecoverable: true,
        }
      }

      // Phase 4: Clean leftovers
      sendProgress({
        phase: 'cleaning-leftovers',
        currentProgram: program.displayName,
        progress: 75,
        detail: `正在把 ${leftovers.length} 个残留项移入回收站…`,
      })

      let cleaned = 0
      let cleanedSize = 0
      for (const item of leftovers) {
        const result = await safeDelete(item.path)
        if (result.success) {
          cleaned++
          cleanedSize += item.size
        }
      }

      return {
        success: true,
        programName: program.displayName,
        exitCode,
        leftoversFound: leftovers.length,
        leftoversCleaned: cleaned,
        leftoversSize: cleanedSize,
        leftoversRecoverable: true,
      }
    },
  )

  ipcMain.handle(
    IPC.UNINSTALLER_FORCE_REMOVE,
    async (_event, programId: string): Promise<UninstallResult> => {
      const program = cachedPrograms.find((p) => p.id === programId)
      if (!program) {
        return {
          success: false,
          programName: 'Unknown',
          exitCode: null,
          error: '程序列表已失效，请刷新后重试。',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0,
        }
      }

      // Phase 1: Delete registry key
      sendProgress({
        phase: 'force-removing',
        currentProgram: program.displayName,
        progress: 10,
        detail: '正在移除失效的程序登记项…',
      })

      const deleted = await deleteRegistryKey(program.registryKey)
      if (!deleted) {
        return {
          success: false,
          programName: program.displayName,
          exitCode: null,
          error: '无法移除程序登记项，请以管理员身份重试。',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0,
        }
      }

      // Phase 2: Scan for leftovers
      sendProgress({
        phase: 'scanning-leftovers',
        currentProgram: program.displayName,
        progress: 40,
        detail: '正在扫描可能的残留文件…',
      })

      const leftovers = await scanLeftoversForProgram(program)

      if (leftovers.length === 0) {
        return {
          success: true,
          programName: program.displayName,
          exitCode: null,
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0,
          leftoversRecoverable: true,
        }
      }

      // Phase 3: Clean leftovers
      sendProgress({
        phase: 'cleaning-leftovers',
        currentProgram: program.displayName,
        progress: 70,
        detail: `正在把 ${leftovers.length} 个残留项移入回收站…`,
      })

      let cleaned = 0
      let cleanedSize = 0
      for (const item of leftovers) {
        const result = await safeDelete(item.path)
        if (result.success) {
          cleaned++
          cleanedSize += item.size
        }
      }

      return {
        success: true,
        programName: program.displayName,
        exitCode: null,
        leftoversFound: leftovers.length,
        leftoversCleaned: cleaned,
        leftoversSize: cleanedSize,
        leftoversRecoverable: true,
      }
    },
  )
}

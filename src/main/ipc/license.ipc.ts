import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { deactivateLicense, getLicenseStatus, redeemLicense } from '../services/license-service'
import {
  getLicenseAdminStatus,
  issueLicenseAsAdmin,
  selectLicenseAdminFile,
} from '../services/license-admin-service'
import {
  getLicenseFeishuConfig,
  saveLicenseFeishuConfig,
  syncRedeemedCodeToFeishu,
  testLicenseFeishuConnection,
} from '../services/license-feishu-sync'
import type { LicenseFeishuConfigInput } from '../../shared/types'

export function registerLicenseIpc(): void {
  ipcMain.handle(IPC.LICENSE_STATUS, () => getLicenseStatus(false))
  ipcMain.handle(IPC.LICENSE_REFRESH, () => getLicenseStatus(true))
  ipcMain.handle(IPC.LICENSE_REDEEM, (_event, code: unknown) => redeemLicense(code))
  ipcMain.handle(IPC.LICENSE_DEACTIVATE, () => deactivateLicense())
  ipcMain.handle(IPC.LICENSE_ADMIN_STATUS, () => getLicenseAdminStatus())
  ipcMain.handle(IPC.LICENSE_ADMIN_SELECT_FILE, (_event, kind: unknown) => {
    if (kind !== 'database' && kind !== 'privateKey') {
      throw new Error('授权资料类型不正确。')
    }
    return selectLicenseAdminFile(kind)
  })
  ipcMain.handle(
    IPC.LICENSE_ADMIN_ISSUE,
    (_event, purchaseCode: unknown, deviceRequestCode: unknown) =>
      issueLicenseAsAdmin(purchaseCode, deviceRequestCode),
  )
  ipcMain.handle(IPC.LICENSE_FEISHU_CONFIG_GET, () => getLicenseFeishuConfig())
  ipcMain.handle(IPC.LICENSE_FEISHU_CONFIG_SAVE, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('飞书配置格式不正确。')
    return saveLicenseFeishuConfig(input as LicenseFeishuConfigInput)
  })
  ipcMain.handle(IPC.LICENSE_FEISHU_TEST, () => testLicenseFeishuConnection())
  ipcMain.handle(IPC.LICENSE_FEISHU_SYNC_CODE, (_event, purchaseCode: unknown) => {
    if (!getLicenseAdminStatus().isAdmin) {
      throw new Error('请先以管理员身份重新启动轻净。')
    }
    if (typeof purchaseCode !== 'string' || !purchaseCode.trim()) {
      throw new Error('请输入需要同步的兑换码。')
    }
    return syncRedeemedCodeToFeishu(purchaseCode.trim())
  })
}

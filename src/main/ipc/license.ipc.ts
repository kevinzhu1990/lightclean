import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { deactivateLicense, getLicenseStatus, redeemLicense } from '../services/license-service'

export function registerLicenseIpc(): void {
  ipcMain.handle(IPC.LICENSE_STATUS, () => getLicenseStatus(false))
  ipcMain.handle(IPC.LICENSE_REFRESH, () => getLicenseStatus(true))
  ipcMain.handle(IPC.LICENSE_REDEEM, (_event, code: unknown) => redeemLicense(code))
  ipcMain.handle(IPC.LICENSE_DEACTIVATE, () => deactivateLicense())
}


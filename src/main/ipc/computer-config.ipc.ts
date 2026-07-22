import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { getComputerConfig } from '../services/computer-config'

export function registerComputerConfigIpc(): void {
  ipcMain.handle(IPC.COMPUTER_CONFIG_GET, (_event, refresh: unknown) =>
    getComputerConfig(refresh === true))
}

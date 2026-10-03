/** Explicit application quit/update must not be swallowed by minimize-to-tray. */
export function shouldMinimizeOnClose(minimizeToTray: boolean, quitting: boolean): boolean {
  return minimizeToTray && !quitting
}

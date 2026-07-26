import { readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, resolve, normalize, sep, isAbsolute } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import type { PlatformStartup } from '../types'
import type { StartupItem, StartupBootTrace } from '../../../shared/types'

const execFileAsync = promisify(execFile)
const HOME = resolve(homedir())

const LIST_LOGIN_ITEMS_SCRIPT = `
const systemEvents = Application('System Events')
JSON.stringify(systemEvents.loginItems().map((item) => ({
  name: item.name(),
  path: item.path()
})))
`

const ADD_LOGIN_ITEM_SCRIPT = `
on run argv
  set appPath to item 1 of argv
  tell application "System Events"
    make login item at end with properties {path:appPath, hidden:false}
  end tell
end run
`

const DELETE_LOGIN_ITEM_SCRIPT = `
on run argv
  set itemName to item 1 of argv
  tell application "System Events" to delete login item itemName
end run
`

function stableId(source: StartupItem['source'], name: string, location: string): string {
  return createHash('sha256').update(`${source}\0${name}\0${location}`).digest('hex').slice(0, 16)
}

export function createDarwinStartup(): PlatformStartup {
  const knownLoginItems = new Map<string, string>()

  return {
    async listItems(): Promise<StartupItem[]> {
      const items: StartupItem[] = []
      knownLoginItems.clear()

      // User Launch Agents
      const userAgentsDir = join(HOME, 'Library', 'LaunchAgents')
      if (existsSync(userAgentsDir)) {
        try {
          const files = await readdir(userAgentsDir)
          for (const file of files) {
            if (!file.endsWith('.plist')) continue
            try {
              const plist = await parsePlistLabel(join(userAgentsDir, file))
              const label = plist.label || basename(file, '.plist')
              const isDisabled = plist.disabled === true

              items.push({
                id: stableId('launch-agent-user', label, join(userAgentsDir, file)),
                name: label,
                displayName: friendlyName(label),
                command: plist.program || plist.programArguments?.[0] || file,
                location: join(userAgentsDir, file),
                source: 'launch-agent-user',
                enabled: !isDisabled,
                publisher: extractPublisher(label),
                impact: 'low',
              })
            } catch { /* skip unparseable plists */ }
          }
        } catch { /* skip */ }
      }

      // Global Launch Agents
      const globalAgentsDir = resolve('/Library/LaunchAgents')
      if (existsSync(globalAgentsDir)) {
        try {
          const files = await readdir(globalAgentsDir)
          for (const file of files) {
            if (!file.endsWith('.plist')) continue
            try {
              const plist = await parsePlistLabel(join(globalAgentsDir, file))
              const label = plist.label || basename(file, '.plist')
              const isDisabled = plist.disabled === true

              items.push({
                id: stableId('launch-agent-global', label, join(globalAgentsDir, file)),
                name: label,
                displayName: friendlyName(label),
                command: plist.program || plist.programArguments?.[0] || file,
                location: join(globalAgentsDir, file),
                source: 'launch-agent-global',
                enabled: !isDisabled,
                publisher: extractPublisher(label),
                impact: 'low',
              })
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }

      // Login Items via JXA. JSON preserves commas and other characters in names,
      // while the path is required to safely re-enable a disabled item.
      try {
        const { stdout } = await execFileAsync('/usr/bin/osascript', [
          '-l', 'JavaScript', '-e', LIST_LOGIN_ITEMS_SCRIPT,
        ], { timeout: 10_000 })

        const loginItems = JSON.parse(stdout) as Array<{ name?: unknown; path?: unknown }>
        for (const loginItem of loginItems) {
          if (typeof loginItem.name !== 'string' || typeof loginItem.path !== 'string') continue
          const name = loginItem.name
          const appPath = loginItem.path
          knownLoginItems.set(name, appPath)
          items.push({
            id: stableId('login-item', name, appPath),
            name,
            displayName: name,
            command: appPath,
            location: 'Login Items',
            source: 'login-item',
            enabled: true,
            publisher: '',
            impact: 'medium',
          })
        }
      } catch { /* skip */ }

      return items
    },

    async toggleItem(
      name: string,
      location: string,
      command: string,
      source: StartupItem['source'],
      enabled: boolean,
    ): Promise<boolean> {
      try {
        if (source === 'launch-agent-user' || source === 'launch-agent-global') {
          // Validate location is within a known LaunchAgents directory
          const allowedDirs = [
            join(HOME, 'Library', 'LaunchAgents'),
            resolve('/Library/LaunchAgents'),
          ]
          const resolved = resolve(normalize(location))
          if (!allowedDirs.some(dir => resolved.startsWith(dir + sep))) {
            return false
          }
          if (enabled) {
            await execFileAsync('/bin/launchctl', ['load', location], { timeout: 10_000 })
          } else {
            await execFileAsync('/bin/launchctl', ['unload', location], { timeout: 10_000 })
          }
          return true
        }
        if (source === 'login-item') {
          if (enabled) {
            const scannedPath = knownLoginItems.get(name)
            if (!scannedPath || scannedPath !== command || !isAbsolute(command)) return false
            await execFileAsync('/usr/bin/osascript', [
              '-e', ADD_LOGIN_ITEM_SCRIPT, '--', command,
            ], { timeout: 10_000 })
          } else {
            if (!knownLoginItems.has(name)) return false
            await execFileAsync('/usr/bin/osascript', [
              '-e', DELETE_LOGIN_ITEM_SCRIPT, '--', name,
            ], { timeout: 10_000 })
          }
          return true
        }
        return false
      } catch {
        return false
      }
    },

    async deleteItem(
      name: string,
      location: string,
      source: StartupItem['source'],
    ): Promise<boolean> {
      try {
        if (source === 'launch-agent-user' || source === 'launch-agent-global') {
          const allowedDirs = [
            join(HOME, 'Library', 'LaunchAgents'),
            resolve('/Library/LaunchAgents'),
          ]
          const resolved = resolve(normalize(location))
          if (!allowedDirs.some(dir => resolved.startsWith(dir + sep))) {
            return false
          }
          // Unload first, then delete the plist file
          try {
            await execFileAsync('/bin/launchctl', ['unload', location], { timeout: 10_000 })
          } catch { /* may already be unloaded */ }
          await unlink(location)
          return true
        }
        if (source === 'login-item') {
          if (!knownLoginItems.has(name)) return false
          await execFileAsync('/usr/bin/osascript', [
            '-e', DELETE_LOGIN_ITEM_SCRIPT, '--', name,
          ], { timeout: 10_000 })
          return true
        }
        return false
      } catch {
        return false
      }
    },

    async getBootTrace(): Promise<StartupBootTrace> {
      return {
        available: false,
        needsAdmin: false,
        totalBootMs: 0,
        mainPathMs: 0,
        startupAppsMs: 0,
        lastBootDate: null,
        entries: [],
      }
    },
  }
}

/** Extract a human-friendly name from a reverse-DNS label like com.apple.foo */
function friendlyName(label: string): string {
  const parts = label.split('.')
  return parts.length > 2 ? parts.slice(2).join('.') : label
}

/** Extract publisher from reverse-DNS label */
function extractPublisher(label: string): string {
  const parts = label.split('.')
  if (parts.length >= 2) return parts[1]
  return ''
}

/** Parse a plist file for Label, Disabled, Program, ProgramArguments using plutil */
async function parsePlistLabel(path: string): Promise<{
  label?: string
  disabled?: boolean
  program?: string
  programArguments?: string[]
}> {
  const { stdout } = await execFileAsync('/usr/bin/plutil', [
    '-convert', 'json', '-o', '-', path,
  ], { timeout: 5_000 })

  const data = JSON.parse(stdout)
  return {
    label: data.Label,
    disabled: data.Disabled === true,
    program: data.Program,
    programArguments: data.ProgramArguments,
  }
}

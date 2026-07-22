#!/usr/bin/env node
// ─── Rule Playground / Dry-Run Mode ─────────────────────────
// Shows what directories a rule would scan/clean on the current
// machine, with sizes and file counts. Nothing is deleted.
// Run: npm run preview-rule -- <app-id>
// Run: npm run preview-rule            (lists all available IDs)

const { readFileSync, readdirSync, statSync, existsSync } = require('fs')
const { homedir, tmpdir, platform } = require('os')
const path = require('path')

const RULES_DIR = path.resolve(__dirname, '..', 'rules')
const currentPlatform = platform()

function resolveVars() {
  const home = homedir()
  const tmp = tmpdir()

  if (currentPlatform === 'win32') {
    return {
      HOME: home,
      LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      APPDATA: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      WINDIR: process.env.WINDIR || 'C:\\Windows',
      PROGRAMDATA: process.env.ProgramData || 'C:\\ProgramData',
      PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
      PROGRAMFILES_X86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      TMPDIR: tmp,
    }
  }
  if (currentPlatform === 'darwin') {
    return {
      HOME: home,
      LIBRARY: path.join(home, 'Library'),
      CACHES: path.join(home, 'Library', 'Caches'),
      APP_SUPPORT: path.join(home, 'Library', 'Application Support'),
      TMPDIR: tmp,
    }
  }
  return {
    HOME: home,
    CONFIG: process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
    CACHE: process.env.XDG_CACHE_HOME || path.join(home, '.cache'),
    LOCAL_SHARE: process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'),
    TMPDIR: tmp,
  }
}

function resolvePath(templatePath, vars) {
  return path.normalize(
    templatePath.replace(/\$\{([A-Z_]+)\}/g, (_, name) => vars[name] || `\${${name}}`)
  )
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getDirStats(dir) {
  let totalSize = 0
  let fileCount = 0

  function walk(d) {
    try {
      for (const entry of readdirSync(d)) {
        const full = path.join(d, entry)
        try {
          const stat = statSync(full)
          if (stat.isFile()) {
            totalSize += stat.size
            fileCount++
          } else if (stat.isDirectory()) {
            walk(full)
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* skip */ }
  }

  walk(dir)
  return { totalSize, fileCount }
}

function loadAllApps() {
  const platformDir = path.join(RULES_DIR, currentPlatform)
  if (!existsSync(platformDir)) {
    console.error(`No rules directory for platform "${currentPlatform}"`)
    process.exit(1)
  }

  const apps = []
  for (const file of ['apps.json', 'gaming.json', 'gpu-cache.json']) {
    const filePath = path.join(platformDir, file)
    if (!existsSync(filePath)) continue
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (data.apps) {
      for (const app of data.apps) {
        apps.push(Object.assign({}, app, { _source: file }))
      }
    }
  }
  return apps
}

function main() {
  const targetId = process.argv[2]
  const apps = loadAllApps()

  if (!targetId || targetId === '--list') {
    console.log(`\n📋 Available rule IDs for ${currentPlatform}:\n`)
    const maxName = Math.max.apply(null, apps.map((a) => a.name.length))
    for (const app of apps) {
      console.log(`  ${app.id.padEnd(25)} ${app.name.padEnd(maxName + 2)} (${app._source})`)
    }
    console.log(`\nUsage: npm run preview-rule -- <app-id>`)
    return
  }

  const app = apps.find((a) => a.id === targetId)
  if (!app) {
    console.error(`\nRule "${targetId}" not found for ${currentPlatform}.`)
    console.error(`Run "npm run preview-rule" to see available IDs.\n`)
    process.exit(1)
  }

  const vars = resolveVars()

  console.log(`\n🔎 Kudu — Rule Preview: ${app.name} (${app.id})\n`)
  console.log(`  Source:  ${currentPlatform}/${app._source}`)
  if (app.childSubdir) console.log(`  childSubdir: ${app.childSubdir}`)
  if (app.description) console.log(`  Description: ${app.description}`)
  console.log()

  let grandTotal = 0
  let grandFiles = 0

  for (const templatePath of app.paths) {
    const resolved = resolvePath(templatePath, vars)
    console.log(`  📁 ${templatePath}`)
    console.log(`     → ${resolved}`)

    if (!existsSync(resolved)) {
      console.log('     ⚪ Does not exist on this machine\n')
      continue
    }

    const stat = statSync(resolved)
    if (stat.isDirectory()) {
      const { totalSize, fileCount } = getDirStats(resolved)
      grandTotal += totalSize
      grandFiles += fileCount
      console.log(`     🟢 Exists — ${fileCount} files, ${formatSize(totalSize)}`)

      // Show top-level contents
      try {
        const children = readdirSync(resolved).slice(0, 10)
        for (const child of children) {
          const childFull = path.join(resolved, child)
          try {
            const s = statSync(childFull)
            const type = s.isDirectory() ? '📂' : '📄'
            console.log(`        ${type} ${child}  (${formatSize(s.isDirectory() ? getDirStats(childFull).totalSize : s.size)})`)
          } catch { /* skip */ }
        }
        const total = readdirSync(resolved).length
        if (total > 10) console.log(`        ... and ${total - 10} more`)
      } catch { /* skip */ }
    } else {
      grandTotal += stat.size
      grandFiles++
      console.log(`     🟢 Exists — single file, ${formatSize(stat.size)}`)
    }
    console.log()
  }

  console.log('─'.repeat(60))
  console.log(`  Total: ${grandFiles} files, ${formatSize(grandTotal)}`)
  console.log(`  ⚠ DRY RUN — nothing was deleted\n`)
}

main()

import { describe, expect, it } from 'vitest'
import { canScanDuplicateDirectory, isProtectedDuplicatePath } from './duplicate-safety'

describe('duplicate cleanup protected paths', () => {
  it('allows drive traversal without allowing drive or system file deletion', () => {
    for (const root of ['C:\\', 'D:\\', '\\\\server\\share\\']) {
      expect(canScanDuplicateDirectory(root, 'win32')).toBe(true)
      expect(isProtectedDuplicatePath(root, 'win32')).toBe(true)
    }
    expect(canScanDuplicateDirectory('relative', 'win32')).toBe(false)
    for (const name of ['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'bootmgr']) {
      expect(isProtectedDuplicatePath(`C:\\${name}`, 'win32')).toBe(true)
    }
  })
  it('protects Windows and application installation trees', () => {
    expect(isProtectedDuplicatePath('C:\\Windows\\System32\\kernel32.dll', 'win32')).toBe(true)
    expect(isProtectedDuplicatePath('C:\\Program Files\\Example\\app.dll', 'win32')).toBe(true)
    expect(isProtectedDuplicatePath('D:\\System Volume Information\\tracking.log', 'win32')).toBe(true)
  })

  it.each([
    'C:\\Users\\Administrator\\AppData\\Local\\OpenAI\\Codex\\bin\\e78bad\\codex.exe',
    'C:\\Users\\Administrator\\AppData\\Local\\OpenAI\\Codex\\bin\\e78bad\\codex-code-mode-host.exe',
    'C:\\Users\\Administrator\\AppData\\Roaming\\Tencent\\wechatXPlugin\\Plugins\\RadiumWMPF\\runtime\\d3dcompiler_47.dll',
    'D:\\Profiles\\Alice\\APPDATA\\Local\\Vendor\\state.json',
    'C:\\Users\\Alice\\AppData\\Roaming\\Vendor\\settings.json',
  ])('excludes per-user application data from duplicate cleanup: %s', (file) => {
    expect(isProtectedDuplicatePath(file, 'win32')).toBe(true)
    expect(canScanDuplicateDirectory(file.slice(0, file.lastIndexOf('\\')), 'win32')).toBe(false)
  })

  it.each(['codex.exe', 'library.DLL', 'driver.sys', 'native.node', 'app.asar', 'library.dylib', 'library.so'])
    ('protects runtime binary %s even outside conventional installation folders', (file) => {
      expect(isProtectedDuplicatePath(`D:\\PortableApps\\Tool\\${file}`, 'win32')).toBe(true)
    })

  it('does not confuse personal files or similar directory names with application data', () => {
    for (const file of [
      'C:\\Users\\Alice\\Documents\\appdata.json',
      'D:\\Archive\\AppData-export\\notes.txt',
      'D:\\Photos\\library.dll.jpg',
      'D:\\Downloads\\manual.exe.pdf',
    ]) expect(isProtectedDuplicatePath(file, 'win32')).toBe(false)
  })

  it('protects application bundles outside macOS Applications', () => {
    expect(canScanDuplicateDirectory('/Users/alice/Downloads/Example.app/Contents/Resources', 'darwin')).toBe(false)
    expect(isProtectedDuplicatePath('/Users/alice/Downloads/Example.app/Contents/MacOS/Example', 'darwin')).toBe(true)
    expect(isProtectedDuplicatePath('/Users/alice/Documents/design.app.png', 'darwin')).toBe(false)
  })

  it('allows ordinary user files and data drives', () => {
    expect(isProtectedDuplicatePath('C:\\Users\\Alice\\Pictures\\photo.jpg', 'win32')).toBe(false)
    expect(isProtectedDuplicatePath('D:\\Media\\Videos\\clip.mp4', 'win32')).toBe(false)
  })

  it('protects macOS system trees while allowing user files', () => {
    expect(isProtectedDuplicatePath('/System/Library/CoreServices/Finder.app', 'darwin')).toBe(true)
    expect(isProtectedDuplicatePath('/Applications/Safari.app', 'darwin')).toBe(true)
    expect(isProtectedDuplicatePath('/Users/alice/Documents/report.pdf', 'darwin')).toBe(false)
  })
})

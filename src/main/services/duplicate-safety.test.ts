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

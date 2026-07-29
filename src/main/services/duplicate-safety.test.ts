import { describe, expect, it } from 'vitest'
import { isProtectedDuplicatePath } from './duplicate-safety'

describe('duplicate cleanup protected paths', () => {
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

import { expect, it } from 'vitest'
import { allocatedFileSize, classifyLargeFile } from './large-file-safety'

const now = 1_800_000_000_000
const old = now - 8 * 86400_000
it.each([
  ['/Users/a/.colima/_lima/_disks/colima/datadisk', 'protected'],
  ['/Users/a/.codex/logs_2.sqlite', 'protected'],
  ['/Users/a/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw', 'protected'],
  ['/Users/a/Library/Containers/com.tencent.xinWeChat/Data/work.dat', 'protected'],
  ['/Users/a/Library/Group Containers/group.example/shared.dat', 'protected'],
  ['/Users/a/Library/Caches/accounts.sqlite-wal', 'protected'],
  ['/Users/a/Library/Caches/old.bin', 'candidate'],
  ['/Users/a/Documents/cache/customer.csv', 'confirm'],
  ['/Users/a/Library/Application Support/影刀/updater/update.zip', 'confirm'],
  ['/Users/a/Chrome-SYCM-Profiles/jinzun/OptGuideOnDeviceModel/model.bin', 'confirm'],
  ['/Users/a/Library/Application Support/Google/GoogleUpdater/agent', 'protected'],
  ['C:\\Windows\\System32\\data.bin', 'protected'],
  ['D:\\Program Files\\Example\\app.dat', 'protected'],
  ['C:\\Users\\a\\AppData\\Local\\Temp\\old.tmp', 'candidate'],
  ['C:\\Users\\a\\AppData\\Local\\Example\\data.bin', 'protected'],
  ['D:\\VMs\\disk.vhdx', 'protected'],
  ['D:\\backups\\photos.zip', 'protected'],
  ['D:\\Documents\\report.pdf', 'confirm'],
  ['/Volumes/External/App.app/Contents/Resources/large.bin', 'protected'],
])('classifies %s as %s', (path, expected) => {
  expect(classifyLargeFile(path, old, now).level).toBe(expected)
})
it('does not bulk recommend recently modified or undated caches', () => {
  for (const modified of [now, now + 1000, NaN]) {
    expect(classifyLargeFile('/Users/a/Library/Caches/old.bin', modified, now).level).toBe('confirm')
  }
})
it('does not invent allocated size on Windows or when block counts are missing', () => {
  expect(allocatedFileSize(0, 'win32')).toBeNull()
  expect(allocatedFileSize(undefined, 'darwin')).toBeNull()
  expect(allocatedFileSize(-1, 'linux')).toBeNull()
  expect(allocatedFileSize(8, 'darwin')).toBe(4096)
  expect(allocatedFileSize(0, 'darwin')).toBe(0)
})

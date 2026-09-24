import { mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
}))
vi.mock('child_process', () => ({
  execFile: vi.fn((_command: string, _args: string[], _options: object, callback: (error: Error | null, output: string) => void) => callback(null, '')),
}))

import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/channels'
import type { WeChatDeleteResult, WeChatScanResult } from '../../shared/types'
import { classifyWeChatMedia, isSafeWeChatMediaPath, normalizeRoots, registerWeChatCleanerIpc, rootsFromConfigDirectory, scanWeChatRoots, validateScannedMediaFile } from './wechat-cleaner.ipc'

const testRoot = join(tmpdir(), `kudu-wechat-test-${process.pid}`)

afterEach(() => rmSync(testRoot, { recursive: true, force: true }))

describe('scanWeChatRoots', () => {
  it('normalizes and deduplicates scan roots without forwarding array callback arguments', () => {
    const root = join(testRoot, 'data')
    expect(normalizeRoots([root, root])).toEqual([root])
  })

  it('finds known message and media folders and totals their files', async () => {
    const account = join(testRoot, 'wxid_example')
    mkdirSync(join(account, 'Msg'), { recursive: true })
    mkdirSync(join(account, 'FileStorage', 'Image'), { recursive: true })
    writeFileSync(join(account, 'Msg', 'MSG0.db'), Buffer.alloc(123))
    writeFileSync(join(account, 'FileStorage', 'Image', 'photo.jpg'), Buffer.alloc(456))

    const result = await scanWeChatRoots([testRoot])

    expect(result).toHaveLength(2)
    expect(result.find((item) => item.kind === 'messages')?.size).toBe(123)
    expect(result.find((item) => item.kind === 'media')?.size).toBe(456)
    expect(result.every((item) => item.account === 'wxid_example')).toBe(true)
  })

  it('does not return unrelated folders', async () => {
    mkdirSync(join(testRoot, 'wxid_example', 'Settings'), { recursive: true })
    writeFileSync(join(testRoot, 'wxid_example', 'Settings', 'config.json'), '{}')
    expect(await scanWeChatRoots([testRoot])).toEqual([])
  })

  it('separates WeChat 4 databases from its media directory', async () => {
    const account = join(testRoot, 'wxid_v4')
    mkdirSync(join(account, 'msg', 'file'), { recursive: true })
    mkdirSync(join(account, 'db_storage'), { recursive: true })
    writeFileSync(join(account, 'msg', 'file', 'photo.jpg'), Buffer.alloc(10))
    writeFileSync(join(account, 'db_storage', 'message.db'), Buffer.alloc(20))

    const mediaFiles: import('../../shared/types').WeChatMediaFile[] = []
    const result = await scanWeChatRoots([testRoot], mediaFiles)
    expect(result.find((item) => item.path.endsWith('msg'))?.kind).toBe('media')
    expect(result.find((item) => item.path.endsWith('db_storage'))?.kind).toBe('messages')
    expect(mediaFiles).toHaveLength(1)
    expect(mediaFiles[0]).toMatchObject({ name: 'photo.jpg', category: 'image', size: 10 })
  })

  it('lists old WeChat attachments but never offers databases as individual files', async () => {
    const account = join(testRoot, 'wxid_old', 'Msg')
    mkdirSync(join(account, 'attach'), { recursive: true })
    writeFileSync(join(account, 'attach', 'report.pdf'), Buffer.alloc(40))
    writeFileSync(join(account, 'MSG0.db'), Buffer.alloc(2 * 1024 * 1024))
    writeFileSync(join(account, 'MSG0.db-wal'), Buffer.alloc(2 * 1024 * 1024))

    const mediaFiles: import('../../shared/types').WeChatMediaFile[] = []
    await scanWeChatRoots([testRoot], mediaFiles)
    expect(mediaFiles.map((item) => item.name)).toEqual(['report.pdf'])
  })

  it('classifies common media and document formats', () => {
    expect(classifyWeChatMedia('C:\\msg\\photo.JPG')).toBe('image')
    expect(classifyWeChatMedia('C:\\msg\\video\\clip.dat')).toBe('video')
    expect(classifyWeChatMedia('C:\\msg\\report.xlsx')).toBe('document')
    expect(classifyWeChatMedia('C:\\msg\\voice.mp3')).toBe('audio')
    expect(classifyWeChatMedia('C:\\msg\\archive.zip')).toBe('archive')
  })

  it('protects database sidecars as well as database files', () => {
    expect(isSafeWeChatMediaPath('C:\\wxid\\msg\\chat.db-journal')).toBe(false)
    expect(isSafeWeChatMediaPath('C:\\wxid\\msg\\chat.sqlite3-shm')).toBe(false)
    expect(isSafeWeChatMediaPath('C:\\wxid\\db_storage\\photo.jpg')).toBe(false)
    expect(isSafeWeChatMediaPath('C:\\wxid\\msg\\photo.jpg')).toBe(true)
  })

  it('discovers the WeChat 4 data root from the Tencent config', () => {
    const config = join(testRoot, 'config')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'account.ini'), 'D:\\')

    expect(rootsFromConfigDirectory(config)).toEqual([
      'D:\\xwechat_files',
      'D:\\WeChat Files',
    ])
  })

  it('accepts a config that already points to xwechat_files', () => {
    const config = join(testRoot, 'config')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'account.ini'), 'D:\\xwechat_files')

    expect(rootsFromConfigDirectory(config)).toEqual(['D:\\xwechat_files'])
  })

  it('rejects a file changed since scanning and protected databases', async () => {
    const path = join(testRoot, 'wxid', 'msg', 'photo.jpg')
    mkdirSync(join(testRoot, 'wxid', 'msg'), { recursive: true })
    writeFileSync(path, Buffer.alloc(10))
    expect(await validateScannedMediaFile({ path, size: 9, modifiedAt: 0 }, [testRoot])).toMatch(/变化/)
    expect(await validateScannedMediaFile({ path: join(testRoot, 'wxid', 'msg', 'chat.db'), size: 10, modifiedAt: 0 }, [testRoot])).toMatch(/数据库|受保护/)
  })

  it('rejects a parent symlink that escapes the verified root', async () => {
    const outside = join(testRoot, 'outside')
    const root = join(testRoot, 'inside')
    mkdirSync(outside, { recursive: true })
    mkdirSync(root, { recursive: true })
    writeFileSync(join(outside, 'photo.jpg'), Buffer.alloc(10))
    symlinkSync(outside, join(root, 'link'), 'junction')
    const path = join(root, 'link', 'photo.jpg')
    expect(await validateScannedMediaFile({ path, size: 10, modifiedAt: statSync(path).mtimeMs }, [root])).toMatch(/范围|链接/)
  })

  it('reports scan progress and can stop before traversing the next batch', async () => {
    const media = join(testRoot, 'wxid', 'FileStorage')
    mkdirSync(media, { recursive: true })
    writeFileSync(join(media, 'photo.jpg'), Buffer.alloc(10))
    let cancelled = false
    const progress: number[] = []
    await expect(scanWeChatRoots([testRoot], [], {
      shouldCancel: () => cancelled,
      onProgress: (value) => { progress.push(value.filesScanned); cancelled = true },
    })).rejects.toThrow('扫描已取消')
    expect(progress.some((count) => count > 0)).toBe(true)
  })

  it('opens a scanned file and reports no freed disk space when moving it to Trash', async () => {
    const file = join(testRoot, 'wxid', 'FileStorage', 'photo.jpg')
    mkdirSync(join(testRoot, 'wxid', 'FileStorage'), { recursive: true })
    writeFileSync(file, Buffer.alloc(10))
    const previousProfile = process.env.USERPROFILE
    const previousAppData = process.env.APPDATA
    const previousOneDrive = process.env.OneDrive
    process.env.USERPROFILE = testRoot
    process.env.APPDATA = join(testRoot, 'AppData')
    delete process.env.OneDrive
    try {
      vi.mocked(ipcMain.handle).mockClear()
      registerWeChatCleanerIpc(() => null)
      const handlers = vi.mocked(ipcMain.handle).mock.calls
      const scan = handlers.find(([channel]) => channel === IPC.WECHAT_SCAN)?.[1] as (_event: unknown, root: string) => Promise<WeChatScanResult>
      const open = handlers.find(([channel]) => channel === IPC.WECHAT_OPEN_LOCATION)?.[1] as (_event: unknown, id: string) => void
      const remove = handlers.find(([channel]) => channel === IPC.WECHAT_DELETE_FILES)?.[1] as (_event: unknown, ids: string[]) => Promise<WeChatDeleteResult>
      const id = (await scan(null, testRoot)).mediaFiles[0].id
      open(null, id)
      expect(shell.showItemInFolder).toHaveBeenCalledWith(file)
      const result = await remove(null, [id])
      expect(result).toMatchObject({ deleted: 1, failed: 0, spaceRecovered: 0 })
      expect(shell.trashItem).toHaveBeenCalledWith(file)
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile
      if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData
      if (previousOneDrive === undefined) delete process.env.OneDrive; else process.env.OneDrive = previousOneDrive
    }
  })
})

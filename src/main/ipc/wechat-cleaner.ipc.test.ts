import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
}))

import { classifyWeChatMedia, normalizeRoots, rootsFromConfigDirectory, scanWeChatRoots } from './wechat-cleaner.ipc'

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

  it('classifies common media and document formats', () => {
    expect(classifyWeChatMedia('C:\\msg\\photo.JPG')).toBe('image')
    expect(classifyWeChatMedia('C:\\msg\\video\\clip.dat')).toBe('video')
    expect(classifyWeChatMedia('C:\\msg\\report.xlsx')).toBe('document')
    expect(classifyWeChatMedia('C:\\msg\\voice.mp3')).toBe('audio')
    expect(classifyWeChatMedia('C:\\msg\\archive.zip')).toBe('archive')
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
})

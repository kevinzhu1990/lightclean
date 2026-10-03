import { it, expect } from 'vitest'
import { Writable } from 'stream'
import { flushCliOutput } from './cli-output'

it('waits for large pipe output before allowing CLI exit', async () => {
  let written = ''
  const output = new Writable({ write(chunk, _encoding, callback) {
    setImmediate(() => { written += chunk.toString(); callback() })
  } })
  const json = JSON.stringify({ items: Array.from({ length: 10000 }, (_, id) => ({ id, path: 'long/cache/path' })) })
  output.write(json)
  await flushCliOutput(output)
  expect(JSON.parse(written).items).toHaveLength(10000)
})

import type { Writable } from 'stream'

/** A queued empty write completes only after earlier pipe output has drained. */
export function flushCliOutput(output: Pick<Writable, 'write'> = process.stdout): Promise<void> {
  return new Promise(resolve => output.write('', () => resolve()))
}

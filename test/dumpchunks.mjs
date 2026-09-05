import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'D:/tranlsater/chunk_capture'
const files = readdirSync(dir).sort()
for (const f of files) {
  const buf = readFileSync(join(dir, f))
  if (buf.length < 30) continue
  const slice = buf.subarray(0, Math.min(buf.length, 48))
  console.log(f, 'len=' + buf.length, slice.toString('hex').match(/.{1,2}/g)?.join(' '))
}

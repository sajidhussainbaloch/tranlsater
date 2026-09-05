import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLevelChunkPayload, encodeLevelChunkPayload } from '../src/translate/chunk.js'

const dir = 'D:/tranlsater/chunk_capture'
const files = readdirSync(dir).filter((f) => f.startsWith('chunk_') && f.endsWith('.bin'))
console.log(`files: ${files.length}`)

let ok = 0
const bySize = new Map<number, { count: number; minN: number; maxN: number; samples: string[] }>()
const failures: string[] = []

for (const f of files) {
  const buf = readFileSync(join(dir, f))
  try {
    const p = parseLevelChunkPayload(buf)
    const re = encodeLevelChunkPayload(p)
    if (!re.equals(buf)) {
      failures.push(`${f}: round-trip mismatch (${buf.length} -> ${re.length})`)
      continue
    }
    const size = buf.length
    let s = bySize.get(size)
    if (!s) {
      s = { count: 0, minN: 99, maxN: 0, samples: [] }
      bySize.set(size, s)
    }
    s.count++
    s.minN = Math.min(s.minN, p.subchunkCount)
    s.maxN = Math.max(s.maxN, p.subchunkCount)
    if (s.samples.length < 3) s.samples.push(`${f}:N=${p.subchunkCount}`)
    ok++
  } catch (e) {
    failures.push(`${f}: ${(e as Error).message}`)
  }
}

console.log(`ok: ${ok}, failures: ${failures.length}`)
if (failures.length) console.log(failures.slice(0, 20).join('\n'))

for (const [size, s] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`size ${size}B: count=${s.count} N=${s.minN}..${s.maxN} ${s.samples.join(' | ')}`)
}

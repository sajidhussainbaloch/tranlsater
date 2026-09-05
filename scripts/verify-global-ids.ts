import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const md = require('minecraft-data') as (v: string) => { blockStates: Array<{ name: string }> }
const states = md('bedrock_1.26.40').blockStates
const byId = (id: number) => (states[id] ? states[id].name.replace(/^minecraft:/, '') : '?')

// scan all captures: id -> count, and per-id sample of chunk coords
const dir = 'D:/tranlsater/chunk_capture'
const files = readdirSync(dir).filter((f) => f.startsWith('chunk_') && f.endsWith('.bin'))
const usage = new Map<number, { count: number; chunks: string[] }>()
for (const f of files) {
  const buf = readFileSync(join(dir, f))
  const m = /chunk_(-?\d+)_(-?\d+)/.exec(f)
  const coord = m ? `${m[1]},${m[2]}` : f
  let pos = 0
  while (pos < buf.length) {
    const header = buf[pos]
    if (header === 0x01) {
      if (pos + 2 > buf.length) break
      add(buf[pos + 1], coord)
      pos += 2
      continue
    }
    const bpb = header >> 1
    if (bpb < 1 || bpb > 6) break
    const wordBytes = (4096 * bpb) / 8
    if (pos + 1 + wordBytes + 1 > buf.length) break
    const count = buf[pos + 1 + wordBytes]
    const entries = count / 2
    if (!Number.isInteger(entries) || entries < 1) break
    for (let i = 0; i < entries; i++) add(buf[pos + 1 + wordBytes + 1 + i], coord)
    pos = pos + 1 + wordBytes + 1 + entries
    while (pos < buf.length && ![0x01, 0x03, 0x05, 0xff].includes(buf[pos])) pos++
  }
}
function add(id: number, coord: string) {
  const e = usage.get(id) || { count: 0, chunks: [] }
  e.count++
  if (!e.chunks.includes(coord)) e.chunks.push(coord)
  usage.set(id, e)
}
console.log('runtime id -> block name (global table) x occurrences, sample chunks:')
for (const [id, e] of [...usage.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(String(id).padStart(4), byId(id).padEnd(34), 'x', String(e.count).padStart(5), '  e.g.', e.chunks.slice(0, 4).join(', '))
}

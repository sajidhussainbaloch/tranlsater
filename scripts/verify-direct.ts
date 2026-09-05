// Exercise the direct-palette path (palette > 256 states) that the real
// captures never hit, plus verify the Bedrock encodeLevelChunkPayload
// round-trip still holds after the new imports.
import { encodeLevelChunkPayload, parseLevelChunkPayload, decodeSubchunkBlocks, encodeSubchunkBlocks } from '../src/translate/chunk.js'
import { buildColumn, encodeMapChunkBody } from '../src/translate/javaChunk.js'
import { Reader } from '../src/java/protocol/buf.js'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function decodeLongs(r: Reader, numLongs: number, bits: number, count: number): number[] {
  const longs: bigint[] = []
  for (let i = 0; i < numLongs; i++) longs.push(r.readLong())
  const vpl = Math.floor(64 / bits)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(Number((longs[Math.floor(i / vpl)] >> BigInt((i % vpl) * bits)) & BigInt((1 << bits) - 1)))
  return out
}

function readContainer(r: Reader): { bits: number; values: number[]; palette: number[] } {
  const bits = r.readByte()
  if (bits === 0) {
    const v = r.readVarInt()
    const len = r.readByte()
    if (len !== 0) throw new Error('single value len')
    return { bits: 0, values: [], palette: [v] }
  }
  if (bits > 8) {
    const n = r.readVarInt()
    return { bits, values: decodeLongs(r, n, bits, 4096), palette: [] }
  }
  const pl = r.readVarInt()
  const palette: number[] = []
  for (let i = 0; i < pl; i++) palette.push(r.readVarInt())
  const n = r.readVarInt()
  return { bits, values: decodeLongs(r, n, bits, 4096), palette }
}

// Build a section with 300 distinct state ids -> forces direct palette (bits>8).
const many = new Array<number>(4096)
for (let i = 0; i < 4096; i++) many[i] = (i % 300) + 1
const body = encodeMapChunkBody(3, 7, [{ stateIds: many }])
const r = new Reader(body)
console.log('coords', r.readInt32BE(), r.readInt32BE())
r.readByte(); r.readByte() // heightmaps
const dataLen = r.readVarInt()
const data = r.readBytes(dataLen)
const dr = new Reader(data)
const count = dr.readInt16BE()
const c = readContainer(dr)
console.log('direct bits', c.bits, 'blockCount', count)
if (c.bits <= 8) throw new Error('expected direct palette, got bits=' + c.bits)
for (let i = 0; i < 4096; i++) if (c.values[i] !== many[i]) throw new Error(`direct mismatch at ${i}: ${c.values[i]} != ${many[i]}`)
console.log('direct palette OK')

// Bedrock round-trip still byte-identical.
const dir = join(process.cwd(), 'chunk_capture')
let ok = 0
let fail = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.bin'))) {
  const orig = readFileSync(join(dir, f))
  const parsed = parseLevelChunkPayload(orig)
  const re = encodeLevelChunkPayload(parsed)
  if (re.equals(orig)) ok++
  else fail++
}
console.log(`bedrock round-trip: ${ok} ok, ${fail} fail`)

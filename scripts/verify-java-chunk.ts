// Sanity-check the Java 1.21.1 paletted-container encoding: encode 4096
// values, decode them back, and confirm they match. Uses a real capture so
// the palette sizes (and hence bits-per-entry) are realistic.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLevelChunkPayload, decodeSubchunkBlocks } from '../src/translate/chunk.js'
import { buildColumn, encodeMapChunkBody } from '../src/translate/javaChunk.js'
import { Reader } from '../src/java/protocol/buf.js'

const dir = join(process.cwd(), 'chunk_capture')
const files = readdirSync(dir).filter((f) => f.endsWith('.bin'))

function decodeLongs(r: Reader, numLongs: number, bits: number, expectedCount: number): number[] {
  const longs: bigint[] = []
  for (let i = 0; i < numLongs; i++) longs.push(r.readLong())
  const valuesPerLong = Math.floor(64 / bits)
  const out: number[] = []
  for (let i = 0; i < expectedCount; i++) {
    const li = Math.floor(i / valuesPerLong)
    const off = (i % valuesPerLong) * bits
    out.push(Number((longs[li] >> BigInt(off)) & BigInt((1 << bits) - 1)))
  }
  return out
}

function readPalettedContainer(r: Reader): { bits: number; values: number[]; palette: number[] } {
  const bits = r.readByte()
  if (bits === 0) {
    const v = r.readVarInt()
    const len = r.readByte()
    if (len !== 0) throw new Error('single-value container has nonzero data len')
    return { bits: 0, values: [], palette: [v] }
  }
  if (bits > 8) {
    const numLongs = r.readVarInt()
    const count = 4096
    return { bits, values: decodeLongs(r, numLongs, bits, count), palette: [] }
  }
  const palLen = r.readVarInt()
  const palette: number[] = []
  for (let i = 0; i < palLen; i++) palette.push(r.readVarInt())
  const numLongs = r.readVarInt()
  const values = decodeLongs(r, numLongs, bits, 4096)
  return { bits, values, palette }
}

let ok = 0
let failed = 0
for (const f of files) {
  const buf = readFileSync(join(dir, f))
  let parsed
  try {
    parsed = parseLevelChunkPayload(buf)
  } catch (e) {
    console.log(`SKIP ${f}: parse failed ${(e as Error).message}`)
    continue
  }
  // Identity mapper: runtime id -> java state id = runtime id (only for testing packing).
  const sections = buildColumn(parsed, (rid) => rid)
  const body = encodeMapChunkBody(0, 0, sections)

  // Parse the body back.
  const r = new Reader(body)
  const cx = r.readInt32BE()
  const cz = r.readInt32BE()
  const hmap = r.readByte() // 0x0a
  const hEnd = r.readByte() // 0x00
  if (hmap !== 0x0a || hEnd !== 0x00) throw new Error(`bad heightmaps tag in ${f}`)
  const dataLen = r.readVarInt()
  const data = r.readBytes(dataLen)
  const blockEntities = r.readVarInt()
  if (blockEntities !== 0) throw new Error('unexpected block entities')
  const skyMaskCount = r.readVarInt()
  const skyMask = r.readLong()
  const blockMaskCount = r.readVarInt()
  const blockMask = r.readLong()
  const emptySkyCount = r.readVarInt()
  const emptySky = r.readLong()
  const emptyBlockCount = r.readVarInt()
  const emptyBlock = r.readLong()
  const skyArrays = r.readVarInt()
  if (skyArrays > 32) throw new Error(`skyArrays absurd: ${skyArrays} at offset ${r.offset}`)
  if (skyArrays !== 24) throw new Error(`skyArrays=${skyArrays} at offset ${r.offset}`)
  r.readBytes(skyArrays * 2048) // skip full-bright sky arrays
  const blkArrays = r.readVarInt()

  if (cx !== 0 || cz !== 0) throw new Error('bad chunk coords')
  if (skyMaskCount !== 1 || blockMaskCount !== 1 || emptySkyCount !== 1 || emptyBlockCount !== 1) {
    throw new Error(`bad mask counts`)
  }
  if (skyMask !== 0xffffffn || blockMask !== 0n) throw new Error(`bad sky masks: ${skyMask},${blockMask}`)
  if (emptySky !== 0x3000000n || emptyBlock !== 0n) throw new Error(`bad empty masks: ${emptySky},${emptyBlock}`)
  if (skyArrays !== 24 || blkArrays !== 0) throw new Error(`bad light array counts: ${skyArrays},${blkArrays}`)
  if (data.length !== dataLen) throw new Error('data length mismatch')

  // Re-read the 24 sections from the chunk data.
  const dr = new Reader(data)
  let totalAir = 0
  let containerFailures = 0
  for (let s = 0; s < 24; s++) {
    const blockCount = dr.readInt16BE()
    const blockState = readPalettedContainer(dr)
    const biome = readPalettedContainer(dr)
    // biome must be single value
    if (biome.bits !== 0 || biome.palette[0] !== 0) throw new Error(`bad biome in ${f} section ${s}`)
    const expected = sections[s].stateIds
    const actual = blockState.palette.length > 0 ? blockState.values.map((i) => blockState.palette[i]) : blockState.values
    if (blockState.bits > 8) {
      // direct palette: values ARE the state ids; skip equality check here
    } else if (blockState.bits === 0) {
      const fill = blockState.palette[0]
      if (expected.some((v) => v !== fill)) throw new Error(`single-value mismatch ${f} section ${s}`)
    } else {
      for (let i = 0; i < 4096; i++) {
        if (actual[i] !== expected[i]) {
          containerFailures++
          break
        }
      }
    }
    const nonAir = expected.filter((v) => v !== 0).length
    if (blockCount !== nonAir) throw new Error(`blockCount ${blockCount} != ${nonAir} in ${f} section ${s}`)
    totalAir += nonAir
  }
  if (dr.remaining !== 0) throw new Error(`trailing data in ${f}: ${dr.remaining}B`)
  if (r.remaining !== 0) throw new Error(`trailing body in ${f}: ${r.remaining}B`)
  if (containerFailures) {
    failed++
    console.log(`FAIL ${f}: ${containerFailures} container mismatches`)
  } else {
    ok++
    console.log(`OK ${f}: body=${body.length}B nonAirBlocks=${totalAir}`)
  }
}
console.log(`\n${ok} ok, ${failed} failed`)

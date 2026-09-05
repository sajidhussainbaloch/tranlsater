// Translate Bedrock chunk data into Java 1.21.1 play packets.
//
// We build the body (not the frame) of:
//   - map_chunk (0x27): chunk + embedded full-bright sky light
//   - chunk_batch_start (0x0d) / chunk_batch_finished (0x0c): 1.20.2+ batch framing
//   - position (0x40): absolute player teleport (from Bedrock move_player)
//   - update_view_position (0x54): view center so the client renders chunks
//
// Java 1.21.1 chunk section wire format (chunkData):
//   for each of the 24 sections (y = -64 + i*16):
//     blockCount     Short        # non-air blocks
//     blockStates    PalettedContainer
//     biomes         PalettedContainer (single-value: biome 0)
//
// PalettedContainer:
//   bits-per-entry Byte
//   if bits == 0:  VarInt single value, Byte data length 0
//   elif bits > 8: VarInt #longs, then longs (direct, global ids)
//   else:          VarInt palette length, VarInt entries, VarInt #longs, longs
//   longs are 64-bit values with entries packed LSB-first,
//   valuesPerLong = floor(64 / bits).

import { Writer } from '../java/protocol/buf.js'
import { decodeSubchunkBlocks } from './chunk.js'
import type { ParsedLevelChunkPayload } from './chunk.js'

const WORLD_SECTIONS = 24 // 384 / 16 (y -64 .. 320)
const SECTION_VOLUME = 4096
const AIR = 0
const BIOME = 0
const GLOBAL_BITS = 15 // direct-palette bits for 1.21.1 (< 2^15 state ids)

// ---------------- Java play packet ids (1.21.1) ----------------
export const JAVA_CLIENTBOUND_MAP_CHUNK = 0x27
export const JAVA_CLIENTBOUND_CHUNK_BATCH_START = 0x0d
export const JAVA_CLIENTBOUND_CHUNK_BATCH_FINISHED = 0x0c
export const JAVA_CLIENTBOUND_POSITION = 0x40
export const JAVA_CLIENTBOUND_UPDATE_VIEW_POSITION = 0x54

/**
 * Pack 4096 values into the Java BitStorage long array.
 * `values` are palette indices (or global ids for direct mode); long data is
 * written big-endian 64-bit with entries packed LSB-first, floor(64/bits) per long.
 */
function packLongs(values: number[], bits: number, maxValue: number): bigint[] {
  const valuesPerLong = Math.floor(64 / bits)
  const numLongs = Math.ceil(values.length / valuesPerLong)
  const longs: bigint[] = []
  for (let li = 0; li < numLongs; li++) {
    let acc = 0n
    for (let i = 0; i < valuesPerLong; i++) {
      const idx = li * valuesPerLong + i
      if (idx >= values.length) break
      const v = BigInt(Math.min(values[idx], maxValue) & maxValue)
      acc |= v << BigInt(i * bits)
    }
    longs.push(acc)
  }
  return longs
}

/** Append a paletted container for `values` (palette indices already) to `w`. */
function writePalettedContainer(w: Writer, values: number[]): void {
  // Map values -> compact palette indices.
  const order: number[] = []
  const index = new Map<number, number>()
  for (const v of values) {
    if (!index.has(v)) {
      index.set(v, order.length)
      order.push(v)
    }
  }
  const palette = order

  if (palette.length === 1) {
    // Single value: byte 0, varint value, byte 0 (no data).
    w.writeByte(0)
    w.writeVarInt(palette[0])
    w.writeByte(0)
    return
  }

  if (palette.length > 256) {
    // Direct: too many states for an indirect palette.
    const maxValue = (1 << GLOBAL_BITS) - 1
    const longs = packLongs(values, GLOBAL_BITS, maxValue)
    w.writeByte(GLOBAL_BITS)
    w.writeVarInt(longs.length)
    for (const l of longs) w.writeLong(l)
    return
  }

  const bits = Math.max(4, Math.ceil(Math.log2(palette.length)))
  const maxValue = (1 << bits) - 1
  const packed = packLongs(values.map((v) => index.get(v) ?? 0), bits, maxValue)
  w.writeByte(bits)
  w.writeVarInt(palette.length)
  for (const p of palette) w.writeVarInt(p)
  w.writeVarInt(packed.length)
  for (const l of packed) w.writeLong(l)
}

interface SectionBlocks {
  /** 4096 java state ids, index = (y*16+z)*16+x */
  stateIds: number[]
}

/** Build a 24-section column; missing Bedrock subchunks become air. */
export function buildColumn(
  parsed: ParsedLevelChunkPayload,
  runtimeToJava: (runtimeId: number) => number
): SectionBlocks[] {
  const sections: SectionBlocks[] = []
  for (let i = 0; i < WORLD_SECTIONS; i++) {
    const sub = parsed.subchunks[i]
    if (sub) {
      const runtime = decodeSubchunkBlocks(sub)
      sections.push({ stateIds: runtime.map(runtimeToJava) })
    } else {
      sections.push({ stateIds: new Array<number>(SECTION_VOLUME).fill(AIR) })
    }
  }
  return sections
}

/** Serialize the chunkData section stream (block count + blocks + biomes). */
function writeSections(w: Writer, sections: SectionBlocks[]): void {
  for (const section of sections) {
    let count = 0
    for (const s of section.stateIds) if (s !== AIR) count++
    w.writeInt16BE(count)
    writePalettedContainer(w, section.stateIds)
    // Biomes: single-value container (biome 0).
    w.writeByte(0)
    w.writeVarInt(BIOME)
    w.writeByte(0)
  }
}

/** Anonymous empty compound (TAG_Compound 0x0a + TAG_End 0x00). */
function writeEmptyHeightmaps(w: Writer): void {
  w.writeByte(0x0a)
  w.writeByte(0x00)
}

/** Full-bright skylight: 2048 bytes of 0xff per section, each length-prefixed. */
function writeFullSkyLight(w: Writer, sectionCount: number): void {
  const section = Buffer.alloc(2048, 0xff)
  for (let i = 0; i < sectionCount; i++) {
    w.writeVarInt(2048)
    w.writeBytes(section)
  }
}

/** Write a BitSet as a VarInt-prefixed array of i64 (big-endian). */
function writeBitSet(w: Writer, longs: bigint[]): void {
  w.writeVarInt(longs.length)
  for (const l of longs) w.writeLong(l)
}

/**
 * Encode the full body of a map_chunk (0x27) packet for a chunk column.
 * All 24 sections get full-bright sky light; the two extra light sections
 * (above/below the world) are marked "empty".
 */
export function encodeMapChunkBody(
  chunkX: number,
  chunkZ: number,
  sections: SectionBlocks[]
): Buffer {
  const w = new Writer()
  w.writeInt32BE(chunkX)
  w.writeInt32BE(chunkZ)

  const sectionsBuf = new Writer()
  writeSections(sectionsBuf, sections)

  writeEmptyHeightmaps(w) // heightmaps: empty NBT
  w.writeVarInt(sectionsBuf.toBuffer().length) // chunkData length
  w.writeBytes(sectionsBuf.toBuffer())
  w.writeVarInt(0) // block entities: none

  const skyMask = (1n << BigInt(WORLD_SECTIONS)) - 1n // bits 0..23
  const emptyMask = (1n << BigInt(WORLD_SECTIONS + 1)) | (1n << BigInt(WORLD_SECTIONS)) // bits 24,25
  writeBitSet(w, [skyMask]) // skyLightMask
  writeBitSet(w, [0n]) // blockLightMask
  writeBitSet(w, [emptyMask]) // emptySkyLightMask
  writeBitSet(w, [0n]) // emptyBlockLightMask
  w.writeVarInt(WORLD_SECTIONS) // skyLight arrays count
  writeFullSkyLight(w, WORLD_SECTIONS) // skyLight arrays
  w.writeVarInt(0) // blockLight arrays: none
  return w.toBuffer()
}

/** Encode a chunk_batch_start body (empty). */
export function encodeChunkBatchStartBody(): Buffer {
  return Buffer.alloc(0)
}

/** Encode a chunk_batch_finished body: VarInt batch size. */
export function encodeChunkBatchFinishedBody(batchSize: number): Buffer {
  const w = new Writer()
  w.writeVarInt(batchSize)
  return w.toBuffer()
}

/** Encode a position (0x40) body: absolute teleport. */
export function encodePositionBody(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  teleportId: number
): Buffer {
  const w = new Writer()
  w.writeDoubleBE(x)
  w.writeDoubleBE(y)
  w.writeDoubleBE(z)
  w.writeFloatBE(yaw)
  w.writeFloatBE(pitch)
  w.writeByte(0) // flags: all absolute
  w.writeVarInt(teleportId)
  return w.toBuffer()
}

/** Encode an update_view_position (0x54) body. */
export function encodeUpdateViewPositionBody(chunkX: number, chunkZ: number): Buffer {
  const w = new Writer()
  w.writeVarInt(chunkX)
  w.writeVarInt(chunkZ)
  return w.toBuffer()
}

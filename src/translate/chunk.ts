/**
 * level_chunk RawPayload decoder for Bedrock protocol 26.40.
 *
 * Empirically reverse-engineered from real captures in chunk_capture/*.bin.
 *
 * Layout (verified against 300+ captured payloads):
 *   payload = [subchunk × N][tail]
 *
 *   subchunk header byte h: bitsPerBlock = h >> 1
 *     h=0x01 (bpb 0): "flat" subchunk = exactly 2 bytes: 0x01 + one palette
 *                     runtime-id byte (all 4096 blocks are that block).
 *     h=0x03 (bpb 1): 512-byte words + palette section.
 *     h=0x05 (bpb 2): 1024-byte words + palette section.
 *
 *   words = 4096 * bpb / 8 bytes, bit-packed into little-endian uint64 words,
 *   block value i sits at bit (i % blocksPerWord) * bpb of word i / blocksPerWord
 *   where blocksPerWord = 64 / bpb. Value 0..palette.length-1 indexes the palette.
 *
 *   palette section = [count byte][entries] with entry count = count / 2
 *     (observed count 0x04 -> 2 entries, 0x06 -> 3 entries). Entries are 1-byte
 *     runtime ids into the start_game block_properties palette.
 *     A handful of subchunks carry one extra byte after the entries
 *     (e.g. trailers `04 2a f6 02`); those bytes are kept in `extra` so
 *     re-encoding is byte-identical.
 *
 *   tail = 0xff × (24 - N) + 0x00   (24 = 384-block world height in subchunks)
 */

export interface SubChunk {
  header: number
  bpb: number
  /** raw word bytes (empty for bpb=0) */
  words: Buffer
  /** runtime ids; 1-byte entries in this protocol range */
  palette: number[]
  /** trailing bytes after the parsed palette (kept for byte-identical round-trip) */
  extra: Buffer
  /** exact original bytes of this subchunk */
  raw: Buffer
}

export interface ParsedLevelChunkPayload {
  subchunkCount: number
  subchunks: SubChunk[]
  /** ff × (24 - N) + 00 */
  tail: Buffer
}

const START_BYTES = new Set([0x01, 0x03, 0x05])

function isStartByte(b: number): boolean {
  return START_BYTES.has(b)
}

export function parseLevelChunkPayload(buf: Buffer): ParsedLevelChunkPayload {
  const subchunks: SubChunk[] = []
  let pos = 0

  while (pos < buf.length) {
    const header = buf[pos]
    if (header === 0x01) {
      // flat subchunk: header + one palette entry
      if (pos + 2 > buf.length) throw new Error(`truncated flat subchunk at ${pos}`)
      const palette = [buf[pos + 1]]
      const raw = buf.subarray(pos, pos + 2)
      subchunks.push({ header, bpb: 0, words: Buffer.alloc(0), palette, extra: Buffer.alloc(0), raw })
      pos += 2
      continue
    }

    const bpb = header >> 1
    if (bpb < 1 || bpb > 6) {
      // end of subchunks reached (tail starts with 0xff, or malformed)
      break
    }

    const wordBytes = (4096 * bpb) / 8
    if (pos + 1 + wordBytes + 1 > buf.length) {
      throw new Error(`truncated subchunk (bpb=${bpb}) at ${pos}`)
    }

    const words = buf.subarray(pos + 1, pos + 1 + wordBytes)
    const count = buf[pos + 1 + wordBytes]
    const entries = count / 2
    if (!Number.isInteger(entries) || entries < 1) {
      throw new Error(`unexpected palette count byte 0x${count.toString(16)} at ${pos}`)
    }

    let end = pos + 1 + wordBytes + 1 + entries
    if (end > buf.length) throw new Error(`palette overrun at ${pos}`)

    // Absorb any bytes after the entries that are not the start of another
    // subchunk and not the start of the tail (0xff).
    while (end < buf.length && !isStartByte(buf[end]) && buf[end] !== 0xff) {
      end++
    }

    const palette = [...buf.subarray(pos + 1 + wordBytes + 1, pos + 1 + wordBytes + 1 + entries)]
    const extra = buf.subarray(pos + 1 + wordBytes + 1 + entries, end)
    const raw = buf.subarray(pos, end)
    subchunks.push({ header, bpb, words, palette, extra, raw })
    pos = end
  }

  return { subchunkCount: subchunks.length, subchunks, tail: buf.subarray(pos) }
}

export function encodeLevelChunkPayload(p: ParsedLevelChunkPayload): Buffer {
  return Buffer.concat([...p.subchunks.map((s) => s.raw), p.tail])
}

/** Decode a subchunk into 4096 block runtime ids (Y = fastest index). */
export function decodeSubchunkBlocks(s: SubChunk): number[] {
  const blocks = new Array<number>(4096)
  if (s.bpb === 0) {
    const fill = s.palette[0] ?? 0
    blocks.fill(fill)
    return blocks
  }
  const blocksPerWord = 64 / s.bpb
  const mask = (1 << s.bpb) - 1
  for (let i = 0; i < 4096; i++) {
    const word = s.words.readBigUInt64LE(Math.floor(i / blocksPerWord) * 8)
    const value = Number((word >> BigInt((i % blocksPerWord) * s.bpb)) & BigInt(mask))
    blocks[i] = value < s.palette.length ? s.palette[value] : (s.palette[0] ?? 0)
  }
  return blocks
}

/** Rebuild a subchunk from 4096 runtime ids (drops `extra`, re-packs palette). */
export function encodeSubchunkBlocks(header: number, blocks: number[]): SubChunk {
  if (header === 0x01) {
    const fill = blocks[0] ?? 0
    const raw = Buffer.from([0x01, fill])
    return { header, bpb: 0, words: Buffer.alloc(0), palette: [fill], extra: Buffer.alloc(0), raw }
  }

  const bpb = header >> 1
  const ids = [...new Set(blocks)]
  const palette = ids.length <= 1 << bpb ? ids : [...new Set(blocks)].slice(0, 1 << bpb)

  const wordBytes = (4096 * bpb) / 8
  const words = Buffer.alloc(wordBytes)
  const blocksPerWord = 64 / bpb
  const mask = (1 << bpb) - 1
  for (let i = 0; i < 4096; i++) {
    let value = palette.indexOf(blocks[i])
    if (value < 0) value = 0
    const wordIdx = Math.floor(i / blocksPerWord)
    const offset = (i % blocksPerWord) * bpb
    const word = words.readBigUInt64LE(wordIdx * 8)
    words.writeBigUInt64LE(word | (BigInt(value & mask) << BigInt(offset)), wordIdx * 8)
  }

  const count = palette.length * 2
  const palBuf = Buffer.from([count, ...palette])
  const raw = Buffer.concat([Buffer.from([header]), words, palBuf])
  return { header, bpb, words, palette, extra: Buffer.alloc(0), raw }
}

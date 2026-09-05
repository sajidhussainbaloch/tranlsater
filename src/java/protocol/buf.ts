// Minimal byte codec for the Minecraft Java Edition protocol.
// We implement this from scratch (see PROJECT_GOAL.md): VarInt/VarLong framing,
// length-prefixed UTF-8 strings, and the fixed-size primitives used by the
// handshake/status/login/play packets.

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export class Writer {
  private bytes: number[] = []

  /** Push a single raw byte. */
  writeByte(v: number): this {
    this.bytes.push(v & 0xff)
    return this
  }

  /** Push raw bytes. */
  writeBytes(b: Uint8Array | number[]): this {
    for (const byte of b) this.bytes.push(byte & 0xff)
    return this
  }

  /** VarInt: 7 bits per byte, MSB = "more bytes follow". */
  writeVarInt(v: number): this {
    let n = v >>> 0
    for (let i = 0; i < 5; i++) {
      const low = n & 0x7f
      n >>>= 7
      this.bytes.push(n === 0 ? low : low | 0x80)
      if (n === 0) return this
    }
    throw new ProtocolError(`VarInt too large: ${v}`)
  }

  /** VarLong: up to 10 bytes. */
  writeVarLong(v: bigint): this {
    let n = v & 0xffffffffffffffffn
    for (let i = 0; i < 10; i++) {
      const low = Number(n & 0x7fn)
      n >>= 7n
      this.bytes.push(n === 0n ? low : low | 0x80)
      if (n === 0n) return this
    }
    throw new ProtocolError('VarLong too large')
  }

  /** String (Text): VarInt byte-length prefix + UTF-8 bytes. */
  writeString(s: string): this {
    const data = Buffer.from(s, 'utf8')
    this.writeVarInt(data.length)
    this.writeBytes(data)
    return this
  }

  writeBoolean(v: boolean): this {
    return this.writeByte(v ? 1 : 0)
  }

  writeInt16BE(v: number): this {
    this.bytes.push((v >> 8) & 0xff, v & 0xff)
    return this
  }

  /** Unsigned short, e.g. the TCP port. */
  writeUint16BE(v: number): this {
    return this.writeInt16BE(v)
  }

  writeInt32BE(v: number): this {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
    return this
  }

  /** 64-bit signed big-endian long. */
  writeLong(v: bigint): this {
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      this.bytes.push(Number((v >> shift) & 0xffn))
    }
    return this
  }

  writeFloatBE(v: number): this {
    const b = Buffer.allocUnsafe(4)
    b.writeFloatBE(v, 0)
    this.writeBytes(b)
    return this
  }

  writeDoubleBE(v: number): this {
    const b = Buffer.allocUnsafe(8)
    b.writeDoubleBE(v, 0)
    this.writeBytes(b)
    return this
  }

  /** 128-bit UUID, big-endian. */
  writeUuid(uuid: string): this {
    const hex = uuid.replace(/-/g, '')
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new ProtocolError(`Bad UUID: ${uuid}`)
    this.writeBytes(Buffer.from(hex, 'hex'))
    return this
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes)
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export class Reader {
  private pos = 0

  constructor(private readonly buf: Buffer) {}

  get offset(): number {
    return this.pos
  }

  get remaining(): number {
    return this.buf.length - this.pos
  }

  private need(n: number): void {
    if (this.remaining < n) {
      throw new ProtocolError(
        `Unexpected end of packet: need ${n} bytes, have ${this.remaining}`
      )
    }
  }

  readByte(): number {
    this.need(1)
    return this.buf[this.pos++]
  }

  readBytes(n: number): Buffer {
    this.need(n)
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return Buffer.from(out)
  }

  readVarInt(): number {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const b = this.readByte()
      value |= (b & 0x7f) << (7 * i)
      if ((b & 0x80) === 0) return value >>> 0
    }
    throw new ProtocolError('VarInt exceeds 5 bytes')
  }

  readVarLong(): bigint {
    let value = 0n
    for (let i = 0; i < 10; i++) {
      const b = this.readByte()
      value |= BigInt(b & 0x7f) << BigInt(7 * i)
      if ((b & 0x80) === 0) return value
    }
    throw new ProtocolError('VarLong exceeds 10 bytes')
  }

  readString(maxBytes = 262144): string {
    const len = this.readVarInt()
    if (len < 0 || len > maxBytes) {
      throw new ProtocolError(`String length out of range: ${len}`)
    }
    return this.readBytes(len).toString('utf8')
  }

  readBoolean(): boolean {
    return this.readByte() !== 0
  }

  readInt16BE(): number {
    this.need(2)
    const v = this.buf.readInt16BE(this.pos)
    this.pos += 2
    return v
  }

  readUint16BE(): number {
    this.need(2)
    const v = this.buf.readUInt16BE(this.pos)
    this.pos += 2
    return v
  }

  readInt32BE(): number {
    this.need(4)
    const v = this.buf.readInt32BE(this.pos)
    this.pos += 4
    return v
  }

  readLong(): bigint {
    this.need(8)
    const v = this.buf.readBigInt64BE(this.pos)
    this.pos += 8
    return v
  }

  readFloatBE(): number {
    this.need(4)
    const v = this.buf.readFloatBE(this.pos)
    this.pos += 4
    return v
  }

  readDoubleBE(): number {
    this.need(8)
    const v = this.buf.readDoubleBE(this.pos)
    this.pos += 8
    return v
  }

  readUuid(): string {
    const hex = this.readBytes(16).toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}

// TCP framing for the Java Edition protocol.
//
// Every packet over the wire is:
//   VarInt(length) VarInt(packetId) payload...
// where `length` = byte count of everything after itself (packet id + payload).
// Since 1.20.2 the relaxed per-connection limit is 1.00 MiB by default, but
// login phase historically allowed up to 3 MiB and clients use a similar cap.
// We accept frames up to a generous bound and reject beyond that.

import { ProtocolError, Reader, Writer } from './buf.js'

export const MAX_FRAME_LENGTH = 3 * 1024 * 1024 // 3 MiB, same as vanilla login limit

export interface FrameHeader {
  /** bytes consumed by the length prefix */
  prefixLength: number
  /** full payload length (packet id + body) */
  payloadLength: number
}

/**
 * Read a VarInt length prefix from the start of `buf`.
 * Returns the header, or null when the buffer does not yet contain the full
 * VarInt. Throws ProtocolError for malformed prefixes (>5 bytes / over limit).
 */
export function readFrameHeader(buf: Buffer): FrameHeader | null {
  // Attempt a best-effort side parse that does not throw on a short buffer.
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (i >= buf.length) return null // need more data
    const b = buf[i]
    value |= (b & 0x7f) << (7 * i)
    if ((b & 0x80) === 0) {
      if (value > MAX_FRAME_LENGTH) {
        throw new ProtocolError(`Frame too large: ${value} bytes`)
      }
      return { prefixLength: i + 1, payloadLength: value }
    }
  }
  throw new ProtocolError('Frame length prefix exceeds 5 bytes')
}

/** Encapsulate a packet id + body into a wire frame. */
export function createFrame(packetId: number, body: Buffer): Buffer {
  const head = new Writer()
  head.writeVarInt(packetId)
  const headBuf = head.toBuffer()
  const frame = new Writer()
  frame.writeVarInt(headBuf.length + body.length)
  frame.writeBytes(headBuf)
  frame.writeBytes(body)
  return frame.toBuffer()
}

/** Read the packet id from a payload buffer (without consuming). */
export function peekPacketId(payload: Buffer): number {
  return new Reader(payload).readVarInt()
}

// Re-exported for the framing consumer.
export { ProtocolError }
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFrame, readFrameHeader, peekPacketId } from '../src/java/protocol/framing.js'
import { ProtocolError, Writer } from '../src/java/protocol/buf.js'

test('frame roundtrip + packet id', () => {
  const body = new Writer().writeString('hello').toBuffer()
  const frame = createFrame(0x12, body)
  const header = readFrameHeader(frame)
  assert.notEqual(header, null)
  const payload = frame.subarray(header!.prefixLength)
  assert.equal(payload.length, header!.payloadLength)
  assert.equal(peekPacketId(payload), 0x12)
})

test('header resolves as soon as the length prefix is complete', () => {
  const frame = createFrame(0x00, new Writer().writeVarInt(42).toBuffer())
  // no data -> no header
  assert.equal(readFrameHeader(Buffer.alloc(0)), null)
  // the length prefix is the first varint; once those bytes arrive the
  // consumer knows the payload size and can wait for the rest
  const header = readFrameHeader(frame.subarray(0, header_prefix_size(frame)))
  assert.notEqual(header, null)
  assert.equal(header!.prefixLength, 1)
  assert.equal(header!.payloadLength, 2)
})

function header_prefix_size(frame: Buffer): number {
  return readFrameHeader(frame)!.prefixLength
}

test('multiple frames in one buffer', () => {
  const a = createFrame(0x01, Buffer.from([0xaa]))
  const b = createFrame(0x02, Buffer.from([0xbb, 0xbb]))
  const joined = Buffer.concat([a, b])
  const h1 = readFrameHeader(joined)
  const rest = joined.subarray(h1!.prefixLength + h1!.payloadLength)
  const h2 = readFrameHeader(rest)
  // payloadLength = packet id varint + body
  assert.equal(h1!.payloadLength, 2)
  assert.equal(h2!.payloadLength, 3)
})

test('oversized frame rejected', () => {
  // craft a length prefix varint > MAX_FRAME_LENGTH (3 MiB)
  const body = Buffer.alloc(3 * 1024 * 1024 + 1, 0)
  const frame = createFrame(0x00, body)
  assert.throws(() => readFrameHeader(frame), ProtocolError)
})
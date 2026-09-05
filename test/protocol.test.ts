import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Reader, Writer, ProtocolError } from '../src/java/protocol/buf.js'

function roundtrip(items: Array<{ name: string; value: number }>): void {
  for (const { name, value } of items) {
    test(`varint roundtrip ${name}`, () => {
      const w = new Writer().writeVarInt(value)
      const r = new Reader(w.toBuffer())
      assert.equal(r.readVarInt(), value >>> 0)
    })
  }
}

roundtrip([
  { name: 'zero', value: 0 },
  { name: 'one', value: 1 },
  { name: '127', value: 127 },
  { name: '128', value: 128 },
  { name: '255', value: 255 },
  { name: '300', value: 300 },
  { name: '16383', value: 16383 },
  { name: '16384', value: 16384 },
  { name: '2097151', value: 2097151 },
  { name: 'max-int32', value: 2147483647 }
])

test('varint known encodings', () => {
  const cases: Array<[number, number[]]> = [
    [0, [0x00]],
    [1, [0x01]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [255, [0xff, 0x01]],
    [300, [0xac, 0x02]],
    [2097151, [0xff, 0xff, 0x7f]],
    [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]]
  ]
for (const [value, bytes] of cases) {
    const w = new Writer()
    w.writeVarInt(value)
    assert.deepEqual([...w.toBuffer()], bytes, `value ${value}`)
  }
})

test('varlong roundtrip boundaries', () => {
  for (const value of [0n, 1n, 127n, 128n, 300n, 0x7ffffffffffn, 0x7fffffffffffffffn]) {
    const w = new Writer()
    w.writeVarLong(value)
    const r = new Reader(w.toBuffer())
    assert.equal(r.readVarLong(), value)
  }
})

test('string roundtrip with unicode', () => {
  for (const s of ['', 'hello', 'héllo ☃', '4chan', '𝔘𝔫𝔦𝔠𝔬𝔡𝔢']) {
    const w = new Writer()
    w.writeString(s)
    const r = new Reader(w.toBuffer())
    assert.equal(r.readString(2048), s)
  }
})

test('string length enforcement', () => {
  const w = new Writer()
  w.writeString('abcd')
  const r = new Reader(w.toBuffer())
  assert.throws(() => r.readString(2), ProtocolError)
})

test('fixed types roundtrip', () => {
  const w = new Writer()
  w.writeUint16BE(25565)
  w.writeInt32BE(-123456)
  w.writeLong(0x0102030405060708n)
  w.writeDoubleBE(64.5)
  w.writeUuid('0f0f9c81-0e5d-4f14-b5a7-6b4e58c2a6f1')
  w.writeBoolean(true)
  const r = new Reader(w.toBuffer())
  assert.equal(r.readUint16BE(), 25565)
  assert.equal(r.readInt32BE(), -123456)
  assert.equal(r.readLong(), 0x0102030405060708n)
  assert.equal(r.readDoubleBE(), 64.5)
  assert.equal(r.readUuid(), '0f0f9c81-0e5d-4f14-b5a7-6b4e58c2a6f1')
  assert.equal(r.readBoolean(), true)
  assert.equal(r.remaining, 0)
})

test('reader catches truncated data', () => {
  const w = new Writer()
  w.writeVarInt(300)
  const r = new Reader(w.toBuffer().subarray(0, 1))
  assert.throws(() => r.readString(16), ProtocolError)
})

test('overflowing varint throws', () => {
  const allContinuation = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80])
  const r = new Reader(allContinuation)
  assert.throws(() => r.readVarInt(), ProtocolError)
})
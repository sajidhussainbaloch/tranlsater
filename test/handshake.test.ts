import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Reader, Writer } from '../src/java/protocol/buf.js'
import {
  decodeHandshake,
  encodeHandshake,
  STATE_STATUS,
  STATE_LOGIN
} from '../src/java/packets/handshake.js'
import type { Handshake } from '../src/java/packets/handshake.js'

test('decodes a real 1.21.1 status handshake from crafted bytes', () => {
  const w = new Writer()
  w.writeVarInt(767)
  w.writeString('localhost')
  w.writeUint16BE(25565)
  w.writeVarInt(STATE_STATUS)
  const hs = decodeHandshake(new Reader(w.toBuffer()))
  assert.equal(hs.protocolVersion, 767)
  assert.equal(hs.serverAddress, 'localhost')
  assert.equal(hs.serverPort, 25565)
  assert.equal(hs.nextState, STATE_STATUS)
})
  test('encode -> decode roundtrip', () => {
  const sample: Handshake = { protocolVersion: 767, serverAddress: 'mc.example.org', serverPort: 25565, nextState: STATE_LOGIN }
  const w = new Writer()
  encodeHandshake(w, sample)
  const out = decodeHandshake(new Reader(w.toBuffer()))
  assert.deepEqual(out, sample)
})

test('login intent decodes nextState=2', () => {
  const w = new Writer()
  w.writeVarInt(767)
  w.writeString('localhost')
  w.writeUint16BE(25565)
  w.writeVarInt(STATE_LOGIN)
  const hs = decodeHandshake(new Reader(w.toBuffer()))
  assert.equal(hs.nextState, STATE_LOGIN)
})
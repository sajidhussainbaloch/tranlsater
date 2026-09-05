// Milestone 1 integration tests.
//
//  Java test client  ->  our proxy  ->  fake Bedrock RakNet server (MOTD)
//
// minecraft-protocol (dev dependency) is an INDEPENDENT Java client — the
// proxy's Java side is implemented from scratch, so this cross-checks our
// implementation against a battle-tested reference.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import mcp from 'minecraft-protocol'
import { JavaServer } from '../src/java/server.js'
import { BedrockStatusPoller } from '../src/bedrock/ping.js'
import { Logger } from '../src/core/logger.js'
import { testConfig, FakeBedrockServer, connect, readFrameFrom, writePacket, RAKNET_MAGIC } from './helpers.js'
import { Reader, Writer } from '../src/java/protocol/buf.js'
import { STATE_STATUS } from '../src/java/packets/handshake.js'

const quiet = new Logger({ packets: false, verbose: false, dumpJavaPackets: false, dumpBedrockPackets: false })

let server: JavaServer | null = null
let proxyPort = 0
const fakeBedrock = new FakeBedrockServer({
  motd: 'Moments Of The Day',
  online: 3,
  max: 7,
  levelName: 'Translator Test Level'
})

test('setup', async () => {
  const bkPort = await fakeBedrock.listen()
  const cfg = testConfig()
  cfg.bedrock = { host: '127.0.0.1', port: bkPort, openAfterPlay: false, deviceOS: 1 }
  cfg.proxy = { ...cfg.proxy, host: '127.0.0.1', port: 0 }
  const poller = new BedrockStatusPoller({ host: cfg.bedrock.host, port: cfg.bedrock.port }, 5000, 2500)
  server = new JavaServer(cfg, quiet, poller)
  proxyPort = await server.start()
  assert.ok(fakeBedrock.port > 0)
})

after(async () => {
  if (server) await server.close()
  fakeBedrock.close()
})

interface PingResult {
  version?: { name?: string; protocol?: number }
  players?: { online?: number; max?: number }
  description?: unknown
}

test('independent minecraft-protocol client sees Java MOTD pulled from Bedrock', async () => {
  const ping = mcp.ping as unknown as (o: { host: string; port: number; version: string }) => Promise<PingResult>
  const status = await ping({ host: '127.0.0.1', port: proxyPort, version: '1.21.1' })
  assert.equal(status.version?.name, '1.21.1')
  assert.equal(status.version?.protocol, 767)
  assert.equal(status.players?.online, 3)
  assert.equal(status.players?.max, 7)
  const desc = typeof status.description === 'string' ? status.description : (status.description as { text?: string })?.text ?? ''
  assert.match(desc, /Moments Of The Day/)
  assert.match(desc, /Translator Test Level/)
})

test('raw wire flow: handshake -> status response -> ping/pong echo', async () => {
  const sock = await connect('127.0.0.1', proxyPort)
  const w = new Writer()
  w.writeVarInt(767)
  w.writeString('localhost')
  w.writeUint16BE(25565)
  w.writeVarInt(STATE_STATUS)
  writePacket(sock, 0x00, w.toBuffer())
  writePacket(sock, 0x00) // status request
  const resp = await readFrameFrom(sock)
  assert.equal(resp.id, 0x00) // Status Response
  const json = new Reader(resp.payload).readString(65536)
  const status = JSON.parse(json) as {
    version: { name: string; protocol: number }
    players: { online: number; max: number }
  }
  assert.equal(status.version.name, '1.21.1')
  assert.equal(status.version.protocol, 767)
  assert.equal(status.players.online, 3)
  assert.equal(status.players.max, 7)

  const pingPayload = 0x0123456789abcdefn
  const pw = new Writer()
  pw.writeLong(pingPayload)
  writePacket(sock, 0x01, pw.toBuffer())
  const pong = await readFrameFrom(sock)
  assert.equal(pong.id, 0x01)
  assert.equal(new Reader(pong.payload).readLong(), pingPayload)
  sock.destroy()
})

test('login intent reaches PLAY via login + configuration (M2)', async () => {
  const state: string[] = []
  const packets: string[] = []
  const client = mcp.createClient({
    host: '127.0.0.1',
    port: proxyPort,
    username: 'M2Probe',
    version: '1.21.1',
    auth: 'offline'
  })
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout reaching play')), 8000)
    client.on('login', () => {
      state.push('login-success')
      packets.push('login')
    })
    client.on('state', (s) => {
      state.push(s)
    })
    client.on('position', () => {
      clearTimeout(t)
      state.push('position')
      resolve()
    })
    client.on('error', (err) => reject(err))
    client.on('kick_disconnect', (packet) => {
      clearTimeout(t)
      reject(new Error(`kicked: ${JSON.stringify(packet)}`))
    })
  })
  client.end()
  assert.ok(state.includes('play'), `expected play state, got ${JSON.stringify(state)}`)
  assert.ok(packets.includes('login'), 'Join Game (login) packet received')
  assert.ok(state.includes('position'), 'Spawn Position reached')
  assert.ok(state.includes('login-success'), 'Login Success processed')
})

test('fake Bedrock server answers RakNet unconnected ping', async () => {
  const sock = dgram.createSocket('udp4')
  const res = (await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no pong')), 2000)
    sock.once('message', (msg) => {
      clearTimeout(t)
      resolve(msg)
    })
    sock.once('error', reject)
    const w = new Writer()
    w.writeByte(0x01)
    w.writeLong(BigInt(Date.now()))
    w.writeBytes(RAKNET_MAGIC)
    w.writeLong(0n)
    sock.send(w.toBuffer(), fakeBedrock.port, '127.0.0.1')
  })) as Buffer
  sock.close()
  assert.equal(res[0], 0x1c)
  assert.ok(res.length > 30)
})
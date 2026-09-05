// Capture the exact clientbound bytes of the vanilla 1.21.1 login + configuration
// phase (and the first play Login / JoinGame packet) from a running offline server.
//
// Purpose: the Java client requires the real `registry_data`/`tags`/feature-flags
// payloads. They are version-specific and effectively impossible to author by hand,
// so we record what a genuine vanilla server sends and replay it verbatim from our
// own proxy (dev-mode offline server). See DEVELOPMENT.md.
//
// Run:  npx tsx tools/capture-config.ts
//
// Environment:
//   CAPTURE_HOST (default 127.0.0.1), CAPTURE_PORT (default 25566),
//   CAPTURE_USER (default "CaptureProbe"), CAPTURE_OUT (default config/registry)
//
// This tool uses only our own codec (src/java/protocol) — no minecraft-protocol.

import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { Writer } from '../src/java/protocol/buf.js'
import { createFrame, readFrameHeader, peekPacketId } from '../src/java/protocol/framing.js'
import { encodeHandshake } from '../src/java/packets/handshake.js'
import { javaProtocolNumber } from '../src/core/versions.js'

const HOST = process.env.CAPTURE_HOST ?? '127.0.0.1'
const PORT = Number(process.env.CAPTURE_PORT ?? 25566)
const USER = process.env.CAPTURE_USER ?? 'CaptureProbe'
const OUT_DIR = process.env.CAPTURE_OUT ?? path.resolve('config', 'registry')
const VERSION = '1.21.1'

// Login state (toClient): 0x02 success, 0x03 compress
const LOGIN_ID_SUCCESS = 0x02
// Login state (toServer): 0x03 login_acknowledged
const LOGIN_SB_ACK = 0x03
// Configuration state (toClient): 0x03 finish_configuration, 0x07 registry_data,
// 0x0c feature_flags, 0x0d tags, 0x0e select_known_packs
const CFG_CB_FINISH = 0x03
const CFG_CB_TAGS = 0x0d
const CFG_CB_SELECT_KNOWN_PACKS = 0x0e
// Configuration state (toServer): 0x03 finish_configuration, 0x07 select_known_packs
const CFG_SB_FINISH = 0x03
const CFG_SB_SELECT_KNOWN_PACKS = 0x07
// Play state (toClient) ids of interest
const PLAY_LOGIN = 0x2b
const PLAY_MAP_CHUNK = 0x27
const PLAY_CHUNK_BIOMES = 0x0e

type Phase = 'login' | 'config' | 'play'

interface Captured {
  id: number
  name: string
  phase: Phase
  payload: Buffer
}

const PLAY_NAMES: Record<number, string> = {
  0x2b: 'login(join_game)',
  0x3e: 'player_info',
  0x40: 'position',
  0x38: 'abilities',
  0x53: 'held_item_slot',
  0x11: 'declare_commands',
  0x27: 'map_chunk',
  0x6c: 'system_chat',
  0x26: 'keep_alive',
  0x19: 'custom_payload',
  0x4b: 'server_data',
  0x1d: 'kick_disconnect',
  0x0c: 'chunk_batch_finished',
  0x0d: 'chunk_batch_start',
  0x0e: 'chunk_biomes',
  0x78: 'tags',
  0x0b: 'difficulty',
  0x47: 'respawn'
}

class CaptureClient {
  private buffer = Buffer.alloc(0)
  private phase: Phase = 'login'
  private frames: Captured[] = []
  private stopAt = Date.now() + 4000

  constructor(private readonly socket: net.Socket) {}

  run(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.on('error', (err) => reject(err))
      this.socket.on('close', () => resolve())
      this.socket.on('data', (chunk) => this.onData(chunk))
      this.socket.setTimeout(90_000, () => this.socket.destroy())
      this.sendHandshake()
      this.sendLoginStart()
    })
  }

  private sendHandshake(): void {
    const w = new Writer()
    encodeHandshake(w, {
      protocolVersion: javaProtocolNumber(VERSION),
      serverAddress: HOST,
      serverPort: PORT,
      nextState: 2 // login
    })
    this.socket.write(createFrame(0x00, w.toBuffer()))
  }

  private sendLoginStart(): void {
    const w = new Writer()
    w.writeString(USER)
    w.writeUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5')
    this.socket.write(createFrame(0x00, w.toBuffer()))
  }

  private send(packetId: number, w: Writer): void {
    this.socket.write(createFrame(packetId, w.toBuffer()))
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const header = readFrameHeader(this.buffer)
      if (!header) return
      const total = header.prefixLength + header.payloadLength
      if (this.buffer.length < total) return
      const payload = this.buffer.subarray(header.prefixLength, total)
      this.buffer = this.buffer.subarray(total)
      this.onFrame(payload)
    }
  }

  private onFrame(payload: Buffer): void {
    const id = peekPacketId(payload)
    if (this.phase === 'login') {
      this.onLoginFrame(id, payload)
    } else if (this.phase === 'config') {
      this.onConfigFrame(id, payload)
    } else {
      this.onPlayFrame(id, payload)
    }
  }

  private onLoginFrame(id: number, payload: Buffer): void {
    this.record(id, payload)
    if (id === LOGIN_ID_SUCCESS) {
      this.send(LOGIN_SB_ACK, new Writer())
      this.phase = 'config'
      console.log('[login] success, sent login_acknowledged -> configuration')
    }
  }

  private onConfigFrame(id: number, payload: Buffer): void {
    this.record(id, payload)
    if (id === CFG_CB_SELECT_KNOWN_PACKS) {
      const w = new Writer()
      w.writeVarInt(0)
      this.send(CFG_SB_SELECT_KNOWN_PACKS, w)
      console.log('[config] responded select_known_packs (empty)')
    } else if (id === CFG_CB_TAGS) {
      this.send(CFG_SB_FINISH, new Writer())
      console.log('[config] tags received, sent finish_configuration')
    } else if (id === CFG_CB_FINISH) {
      this.phase = 'play'
      console.log('[config] finish_configuration -> play')
    }
  }

  private onPlayFrame(id: number, payload: Buffer): void {
    // Skip the bulk chunk payloads; we only want the structural spawn packets.
    if (id === PLAY_MAP_CHUNK || id === PLAY_CHUNK_BIOMES) {
      this.socket.destroy()
      return
    }
    this.record(id, payload)
    // login + a few spawn packets is enough; stop shortly after.
    if (Date.now() > this.stopAt) {
      this.socket.destroy()
    }
  }

  private record(id: number, payload: Buffer): void {
    const name = this.nameFor(id)
    this.frames.push({ id, name, phase: this.phase, payload: Buffer.from(payload) })
    console.log(`[${this.phase}] 0x${id.toString(16).padStart(2, '0')} ${name} (${payload.length} B)`)
  }

  private nameFor(id: number): string {
    if (this.phase === 'login') {
      if (id === 0x00) return 'disconnect'
      if (id === 0x01) return 'encryption_begin'
      if (id === 0x02) return 'success'
      if (id === 0x03) return 'compress'
    } else if (this.phase === 'config') {
      if (id === 0x00) return 'cookie_request'
      if (id === 0x01) return 'custom_payload'
      if (id === 0x02) return 'disconnect'
      if (id === 0x03) return 'finish_configuration'
      if (id === 0x04) return 'keep_alive'
      if (id === 0x05) return 'ping'
      if (id === 0x06) return 'reset_chat'
      if (id === 0x07) return 'registry_data'
      if (id === 0x08) return 'remove_resource_pack'
      if (id === 0x09) return 'add_resource_pack'
      if (id === 0x0a) return 'store_cookie'
      if (id === 0x0b) return 'transfer'
      if (id === 0x0c) return 'feature_flags'
      if (id === 0x0d) return 'tags'
      if (id === 0x0e) return 'select_known_packs'
      if (id === 0x0f) return 'custom_report_details'
      if (id === 0x10) return 'server_links'
    }
    return PLAY_NAMES[id] ?? '0x' + id.toString(16)
  }

  getResult(): Captured[] {
    return this.frames
  }
}

async function main(): Promise<void> {
  const socket = net.connect({ host: HOST, port: PORT })
  const client = new CaptureClient(socket)
  await client.run()
  const frames = client.getResult()
  if (frames.length === 0) {
    console.error('no frames captured')
    process.exit(1)
  }
  writeOut(frames)
}

function writeOut(frames: Captured[]): void {
  const dir = path.join(OUT_DIR, VERSION)
  fs.mkdirSync(dir, { recursive: true })

  // Each phase file is a sequence of records: VarInt(payloadLen) VarInt(id) payload...
  const groups: Record<Phase, Buffer[]> = { login: [], config: [], play: [] }
  const manifest: { id: number; name: string; phase: Phase; size: number }[] = []
  for (const f of frames) {
    const w = new Writer()
    w.writeVarInt(f.id)
    w.writeBytes(f.payload)
    const record = w.toBuffer()
    const rec = new Writer()
    rec.writeVarInt(record.length)
    rec.writeBytes(record)
    const buf = rec.toBuffer()
    groups[f.phase].push(buf)
    manifest.push({ id: f.id, name: f.name, phase: f.phase, size: f.payload.length })
  }

  for (const phase of ['login', 'config', 'play'] as Phase[]) {
    const file = path.join(dir, `${phase}.bin`)
    fs.writeFileSync(file, Buffer.concat(groups[phase]))
    console.log(`wrote ${path.relative(process.cwd(), file)}: ${Buffer.concat(groups[phase]).length} bytes`)
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`wrote manifest.json with ${manifest.length} packets`)
}

void main().catch((err) => {
  console.error('capture failed:', err.message)
  process.exit(1)
})

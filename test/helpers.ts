// Shared test helpers: a minimal wire client + fake Bedrock RakNet server.

import net from 'node:net'
import dgram from 'node:dgram'
import { Reader, Writer } from '../src/java/protocol/buf.js'
import { createFrame, readFrameHeader } from '../src/java/protocol/framing.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import type { Config } from '../src/core/config.js'

export const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex')

export interface Frame {
  id: number
  payload: Buffer
}

/** Send one framed packet to the socket. */
export function writePacket(socket: net.Socket, packetId: number, body?: Buffer): void {
  socket.write(createFrame(packetId, body ?? Buffer.alloc(0)))
}

/** Await one full frame from the socket (blocks until complete or timeout). */
export function readFrameFrom(socket: net.Socket, timeoutMs = 4000): Promise<Frame> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('readFrameFrom timeout'))
    }, timeoutMs)

    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        const header = readFrameHeader(buf)
        if (!header) return
        const total = header.prefixLength + header.payloadLength
        if (buf.length < total) return
        const payload = buf.subarray(header.prefixLength, total)
        buf = buf.subarray(total)
        cleanup()
        const r = new Reader(payload)
        const id = r.readVarInt()
        resolve({ id, payload: payload.subarray(r.offset) })
        return
      }
    }

    function cleanup(): void {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('close', onClose)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('socket closed before frame completed'))
    }
    socket.on('data', onData)
    socket.on('close', onClose)
  })
}

/** Connect a raw TCP socket to a host:port. */
export function connect(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port })
    s.once('connect', () => resolve(s))
    s.once('error', reject)
  })
}

/**
 * A minimal fake Bedrock RakNet server that only answers UnconnectedPing
 * (the MOTD/players query), enough to exercise the Java status forwarder.
 */
export class FakeBedrockServer {
  port = 0
  private readonly sock: dgram.Socket
  private readonly greeting: string

  constructor(
    ad: { motd?: string; online?: number; max?: number; levelName?: string } = {}
  ) {
    this.sock = dgram.createSocket('udp4')
    const motd = ad.motd ?? 'Fake Test MOTD'
    const online = ad.online ?? 3
    const max = ad.max ?? 7
    const level = ad.levelName ?? 'Translator Test Level'
    // header;motd;protocol;version;online;max;serverId;levelName;gamemode;gid;port4;port6
    this.greeting = `MCPE;${motd};42;1.26.40;${online};${max};8${level.length+300000};${level};Survival;1;19132;19133`
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.sock.once('error', reject)
      this.sock.bind(0, '127.0.0.1', () => resolve())
    })
    const addr = this.sock.address() as { address: string; family: string; port: number }
    this.port = addr.port
    this.sock.on('message', (msg, rinfo) => this.onMessage(msg, rinfo))
    return addr.port
  }

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    if (msg.length === 0 || msg[0] !== 0x01) return
    // UnconnectedPing: id, time(8), magic(16), clientGuid(8)
    if (msg.length < 33 || !msg.subarray(9, 25).equals(RAKNET_MAGIC)) return

    const pong = new Writer()
    pong.writeByte(0x1c) // UnconnectedPong
    pong.writeBytes(msg.subarray(1, 9)) // echo time
    pong.writeLong(0x1122334455667788n) // server guid
    pong.writeBytes(RAKNET_MAGIC)
    const name = Buffer.from(this.greeting, 'utf8')
    pong.writeUint16BE(name.length)
    pong.writeBytes(name)
    this.sock.send(pong.toBuffer(), rinfo.port, rinfo.address)
  }

  close(): void {
    this.sock.close()
  }
}

/** Standard test config (listens on 127.0.0.1:0; caller overrides bedrock.port). */
export function testConfig(): Config {
  const cfg = structuredClone(DEFAULT_CONFIG)
  // Tests are hermetic: never open a real Bedrock session on PLAY.
  cfg.bedrock.openAfterPlay = false
  return cfg
}
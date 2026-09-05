// Java Edition TCP listener + per-connection state machine.
//
// Milestone 1 scope:
//   * accept TCP, reassemble length-prefixed frames
//   * parse the HANDSHAKING packet
//   * answer STATUS queries (Status Response JSON + Ping/Pong echo)
//   * reject LOGIN intents cleanly with a LOGIN Disconnect (M2 expands this)
//
// The Bedrock side is not opened for these short-lived connections.

import net from 'node:net'
import { Reader, Writer, ProtocolError } from './protocol/buf.js'
import { createFrame, readFrameHeader } from './protocol/framing.js'
import {
  decodeHandshake,
  PACKET_ID_HANDSHAKE,
  STATE_STATUS,
  STATE_LOGIN
} from './packets/handshake.js'
import {
  SERVERBOUND_STATUS_REQUEST,
  SERVERBOUND_PING_REQUEST,
  CLIENTBOUND_STATUS_RESPONSE,
  CLIENTBOUND_PONG_RESPONSE,
  encodeStatusResponse,
  encodePongResponse,
  decodePingRequest
} from './packets/status.js'
import {
  SERVERBOUND_LOGIN_START,
  SERVERBOUND_LOGIN_ACKNOWLEDGED,
  CLIENTBOUND_LOGIN_SUCCESS,
  decodeLoginStart,
  encodeLoginSuccess
} from './packets/login.js'
import { loadReplayBlobs } from './replay.js'
import type { ReplayBlobs, ReplayPacket } from './replay.js'
import { BedrockSession } from '../bedrock/session.js'
import { Translator, type JavaSink } from '../translate/translator.js'
import { writeTextComponent } from '../translate/nbt.js'
import { javaProtocolNumber } from '../core/versions.js'
import type { Logger } from '../core/logger.js'
import type { Config } from '../core/config.js'
import type { BedrockStatus, BedrockStatusPoller } from '../bedrock/ping.js'

export const STATE = {
  HANDSHAKING: 'handshaking',
  STATUS: 'status',
  LOGIN: 'login',
  CONFIGURATION: 'configuration',
  PLAY: 'play'
} as const

export type ConnectionState = (typeof STATE)[keyof typeof STATE]

// Configuration state packet ids (1.21.1)
const CONFIGURATION_SERVERBOUND_FINISH = 0x03 // ServerboundFinishConfiguration
// Play state packet ids (1.21.1)
const PLAY_CLIENTBOUND_KEEP_ALIVE = 0x26
const PLAY_CLIENTBOUND_KICK_DISCONNECT = 0x1d
const PLAY_SERVERBOUND_KEEP_ALIVE = 0x18

export class JavaServer {
  private server: net.Server

  constructor(
    private readonly cfg: Config,
    private readonly logger: Logger,
    private readonly poller: BedrockStatusPoller | null
  ) {
    this.server = net.createServer((socket) => this.accept(socket))
    this.server.on('error', (err) => logger.error(`TCP server error: ${err.message}`))
  }

  /** Start listening. Resolves with the actual bound port (0 -> ephemeral). */
  start(): Promise<number> {
    const { host, port } = this.cfg.proxy
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, host, () => {
        const addr = this.server.address() as net.AddressInfo
        this.logger.info(`Java listener: ${host}:${addr.port}`)
        resolve(addr.port)
      })
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private accept(socket: net.Socket): void {
    const conn = new JavaConnection(socket, this.cfg, this.logger, this.poller)
    socket.on('error', (err) => this.logger.verbose(`socket error: ${err.message}`))
    socket.on('close', () => conn.onClose())
  }
}

export class JavaConnection {
  state: ConnectionState = STATE.HANDSHAKING
  handshake: ReturnType<typeof decodeHandshake> | null = null
  private buffer = Buffer.alloc(0)
  /** remaining writes before the socket can be safely destroyed (close after drain) */
  private statusResponded = false
  private blobs: ReplayBlobs
  private bedrock: BedrockSession | null = null
  private translator: Translator | null = null
  private username = ''
  private keepAliveTimer: NodeJS.Timeout | null = null
  private keepAliveId = 0n
  private javaChatCb: ((msg: string) => void) | null = null

  constructor(
    private readonly socket: net.Socket,
    private readonly cfg: Config,
    private readonly logger: Logger,
    private readonly poller: BedrockStatusPoller | null
  ) {
    this.blobs = loadReplayBlobs(this.cfg.protocol.java)
    socket.on('data', (chunk) => this.onData(chunk))
    // Vanilla status connections linger; drop dead ones after a while.
    socket.setTimeout(30_000, () => this.close())
  }

  private onData(raw: Buffer | string): void {
    const chunk = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      let header
      try {
        header = readFrameHeader(this.buffer)
      } catch (err) {
        this.logger.warn(`protocol violation from ${this.remote()}: ${(err as Error).message}`)
        this.close()
        return
      }
      if (!header) return // need more bytes

      const total = header.prefixLength + header.payloadLength
      if (this.buffer.length < total) return
      const payload = this.buffer.subarray(header.prefixLength, total)
      this.buffer = this.buffer.subarray(total)

      try {
        const reader = new Reader(payload)
        const packetId = reader.readVarInt()
        this.handlePacket(packetId, reader)
      } catch (err) {
        this.logger.warn(
          `failed to decode packet from ${this.remote()}: ${(err as Error).message}`
        )
        this.close()
        return
      }

      if (this.socket.destroyed) return
    }
  }

  private handlePacket(packetId: number, reader: Reader): void {
    switch (this.state) {
      case STATE.HANDSHAKING:
        if (packetId !== PACKET_ID_HANDSHAKE) throw new ProtocolError(`Unexpected packet 0x${packetId.toString(16)} in handshaking`)
        this.handshake = decodeHandshake(reader)
        this.logger.verbose(
          `handshake: javaProto=${this.handshake.protocolVersion} address=${this.handshake.serverAddress} port=${this.handshake.serverPort} nextState=${this.handshake.nextState}`
        )
        if (this.handshake.nextState === STATE_STATUS) {
          this.state = STATE.STATUS
        } else if (this.handshake.nextState === STATE_LOGIN) {
          this.state = STATE.LOGIN
        } else {
          throw new ProtocolError(`Invalid nextState ${this.handshake.nextState}`)
        }
        break

      case STATE.STATUS:
        this.handleStatus(packetId, reader)
        break

      case STATE.LOGIN:
        this.handleLogin(packetId, reader)
        break

      case STATE.CONFIGURATION:
        this.handleConfiguration(packetId, reader)
        break

      case STATE.PLAY:
        this.handlePlay(packetId, reader)
        break

      default:
        throw new ProtocolError(`Unexpected packet in state ${this.state}`)
    }
  }

  private handleStatus(packetId: number, reader: Reader): void {
    if (packetId === SERVERBOUND_STATUS_REQUEST) {
      if (this.statusResponded) return // ignore duplicate requests
      this.statusResponded = true
      void this.sendStatusResponse()
      return
    }
    if (packetId === SERVERBOUND_PING_REQUEST) {
      const req = decodePingRequest(reader)
      const w = new Writer()
      encodePongResponse(w, req.payload)
      this.logger.packet({ direction: '->C', layer: 'java', name: 'Pong', id: CLIENTBOUND_PONG_RESPONSE, size: 8 })
      this.send(CLIENTBOUND_PONG_RESPONSE, w.toBuffer())
      this.close()
      return
    }
    throw new ProtocolError(`Unexpected status packet 0x${packetId.toString(16)}`)
  }

  private async sendStatusResponse(): Promise<void> {
    const bedrock = this.poller ? await this.poller.get() : null
    const json = buildStatusJson(this.cfg, bedrock)
    const w = new Writer()
    encodeStatusResponse(w, json)
    this.logger.packet({
      direction: '->C',
      layer: 'java',
      name: 'StatusResponse',
      id: CLIENTBOUND_STATUS_RESPONSE,
      size: w.toBuffer().length,
      fields: { text: `motd=${bedrockStatusText(bedrock)}` }
    })
    this.send(CLIENTBOUND_STATUS_RESPONSE, w.toBuffer())
  }

  // -- Login (M2) -----------------------------------------------------------

  private handleLogin(packetId: number, reader: Reader): void {
    if (packetId === SERVERBOUND_LOGIN_START) {
      const start = decodeLoginStart(reader)
      this.username = start.username
      this.logger.verbose(`login start: username=${start.username} uuid=${start.playerUuid}`)
      // Offline mode: acknowledge with the UUID the client presented.
      const w = new Writer()
      encodeLoginSuccess(w, start.playerUuid, start.username)
      this.logger.packet({ direction: '->C', layer: 'java', name: 'LoginSuccess', id: CLIENTBOUND_LOGIN_SUCCESS, size: w.toBuffer().length })
      this.send(CLIENTBOUND_LOGIN_SUCCESS, w.toBuffer())
      return
    }
    if (packetId === SERVERBOUND_LOGIN_ACKNOWLEDGED) {
      // Client agrees to move to the configuration phase.
      this.state = STATE.CONFIGURATION
      this.logger.verbose('login acknowledged -> configuration')
      this.startConfiguration()
      return
    }
    throw new ProtocolError(`Unexpected login packet 0x${packetId.toString(16)}`)
  }

  private async startConfiguration(): Promise<void> {
    // Replay the captured clientbound configuration stream (brand, feature flags,
    // select known packs, registry_data..., tags), then send finish_configuration
    // so the client replies with its own finish (ack) to enter play.
    for (const pkt of this.blobs.config) {
      this.replay(pkt)
    }
  }

  private handleConfiguration(packetId: number, reader: Reader): void {
    if (packetId === CONFIGURATION_SERVERBOUND_FINISH) {
      // Client acked configuration; move to play.
      this.state = STATE.PLAY
      this.logger.info(`player configured, entering PLAY (user reached M2 milestone)`)
      this.startPlay()
      return
    }
    // settings / cookie_response / custom_payload / select_known_packs /
    // keep_alive / pong / resource_pack_receive: the proxy does not need their
    // content yet (M7+). Drain the reader so framing stays aligned.
    void reader
    this.logger.verbose(`configuration packet 0x${packetId.toString(16)} ignored`)
  }

  private startPlay(): void {
    // Replay the captured play stream (Join Game + spawn packets) verbatim so
    // the client enters the world. Chunk payloads were excluded during capture.
    for (const pkt of this.blobs.play) this.replay(pkt)

    // The Java client hard-closes ("timed out") if it stops hearing from us.
    // Server-initiated keep-alive every 15s keeps TLauncher alive.
    this.startKeepAlive()

    // M3: open the real Bedrock session so the player exists on the target
    // world. Translation between the two protocols lands in M4+.
    this.openBedrock()
  }

  private startKeepAlive(): void {
    if (this.keepAliveTimer) return
    this.keepAliveTimer = setInterval(() => {
      if (this.socket.destroyed) {
        this.stopKeepAlive()
        return
      }
      this.keepAliveId = (this.keepAliveId + 1n) & 0x7fffffffffffffffn
      const w = new Writer()
      w.writeLong(this.keepAliveId)
      this.send(PLAY_CLIENTBOUND_KEEP_ALIVE, w.toBuffer())
      this.logger.verbose(`play keep-alive ->C id=${this.keepAliveId}`)
    }, 15_000)
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  private openBedrock(): void {
    if (this.bedrock) return
    if (!this.cfg.bedrock.openAfterPlay) {
      this.logger.verbose('Bedrock session disabled (openAfterPlay=false) — skipping')
      return
    }
    this.logger.info(`opening Bedrock session for ${this.username} -> ${this.cfg.bedrock.host}:${this.cfg.bedrock.port}`)
    this.bedrock = new BedrockSession({
      host: this.cfg.bedrock.host,
      port: this.cfg.bedrock.port,
      version: this.cfg.protocol.bedrock,
      username: this.username || 'Translator',
      logger: this.logger,
      authMode: this.cfg.auth.mode,
      deviceLoginCache: this.cfg.auth.deviceLogin.cache,
      deviceLoginUser: this.cfg.auth.deviceLogin.user,
      deviceOS: this.cfg.bedrock.deviceOS,
      onBedrockDisconnect: (reason) => this.disconnectFromBedrock(reason)
    })
    // M4: live translation between the Java client and this Bedrock session.
    if (!this.translator) {
      this.bedrock.onStartGameData = (data) => this.translator?.onStartGameData?.(data)
      this.translator = new Translator(this.bedrock.client, this.javaSink(), this.logger)
    }
  }

  private javaSink(): JavaSink {
    return {
      send: (packetId, body) => this.send(packetId, body),
      onJavaChatMessage: (cb) => {
        this.javaChatCb = cb
      }
    }
  }

  /** Bedrock session ended (kicked/left server) — kick the Java client so it
   * doesn't keep floating in a world that no longer exists. */
  private disconnectFromBedrock(reason: string): void {
    if (this.socket.destroyed) return
    this.logger.info(`disconnecting Java client: ${reason}`)
    const w = new Writer()
    writeTextComponent(w, reason)
    this.send(PLAY_CLIENTBOUND_KICK_DISCONNECT, w.toBuffer())
    this.close()
  }

  private handlePlay(packetId: number, reader: Reader): void {
    // Keep-alive: echo back. Everything else is ignored for now (M7+).
    if (packetId === PLAY_SERVERBOUND_KEEP_ALIVE) {
      const id = reader.readLong()
      const w = new Writer()
      w.writeLong(id)
      this.send(PLAY_CLIENTBOUND_KEEP_ALIVE, w.toBuffer())
      return
    }
    if (packetId === 0x06 && this.javaChatCb) {
      // Serverbound Chat Message: message string, then fields we can drain.
      const msg = reader.readString(256)
      this.javaChatCb(msg)
      return
    }
    void reader
    this.logger.verbose(`play packet 0x${packetId.toString(16)} ignored`)
  }

  // --------- Replay helpers -------------------------------------------------

  private replay(pkt: ReplayPacket): void {
    this.logger.packet({ direction: '->C', layer: 'java', name: `replay:${pkt.id.toString(16)}`, id: pkt.id, size: pkt.payload.length })
    this.send(pkt.id, pkt.payload)
  }

  private send(packetId: number, body: Buffer): void {
    if (this.socket.destroyed) return
    const frame = createFrame(packetId, body)
    this.socket.write(frame)
  }

  private remote(): string {
    return `${this.socket.remoteAddress ?? '?'}:${this.socket.remotePort ?? '?'}`
  }

  close(): void {
    this.socket.destroy()
  }

  onClose(): void {
    this.stopKeepAlive()
    if (this.bedrock) {
      this.logger.info(`closing Bedrock session for ${this.username}`)
      this.bedrock.close()
      this.bedrock = null
    }
  }
}

// ---------------------------------------------------------------------------
// Status JSON
// ---------------------------------------------------------------------------

function buildStatusJson(cfg: Config, bedrock: BedrockStatus | null): string {
  const protocol = javaProtocolNumber(cfg.protocol.java)
  const right = bedrockStatusText(bedrock)
  const json = {
    version: {
      name: cfg.protocol.java,
      protocol
    },
    players: {
      max: bedrock?.max ?? cfg.proxy.maxPlayers,
      online: bedrock?.online ?? 0,
      sample: []
    },
    description: {
      text: right
    },
    enforcesSecureChat: false,
    previewsChat: false
  }
  return JSON.stringify(json)
}

function bedrockStatusText(bedrock: BedrockStatus | null): string {
  if (!bedrock || !bedrock.motdLine1) {
    return 'Java 1.21.1 -> Bedrock bridge (Bedrock server offline)'
  }
  let text = `${bedrock.motdLine1}`
  if (bedrock.motdLine2) text += ` §7${bedrock.motdLine2}§r`
  return text
}
// Milestone 4: translate packets between the Java client and the Bedrock
// session. M1-M3 replay a static capture; living translation starts here with
// the packets that matter immediately: world time and chat. Chunks/entities
// land in later M4 increments.

import { Writer } from '../java/protocol/buf.js'
import { writeTextComponent } from './nbt.js'
import { translateTextPayload } from './text.js'
import { BedrockBlockMapper } from './blocks.js'
import { parseLevelChunkPayload } from './chunk.js'
import {
  buildColumn,
  encodeMapChunkBody,
  encodeChunkBatchStartBody,
  encodeChunkBatchFinishedBody,
  encodePositionBody,
  encodeUpdateViewPositionBody,
  JAVA_CLIENTBOUND_MAP_CHUNK,
  JAVA_CLIENTBOUND_CHUNK_BATCH_START,
  JAVA_CLIENTBOUND_CHUNK_BATCH_FINISHED,
  JAVA_CLIENTBOUND_POSITION,
  JAVA_CLIENTBOUND_UPDATE_VIEW_POSITION
} from './javaChunk.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../core/logger.js'

// Java 1.21.1 state="play" packet ids.
const JAVA_CLIENTBOUND_UPDATE_TIME = 0x64
const JAVA_CLIENTBOUND_SYSTEM_CHAT = 0x6c

/** Where the Java client's playbound packets go. */
export interface JavaSink {
  /** Send a Java clientbound play packet (id + serialized body). */
  send(packetId: number, body: Buffer): void
  /** Register a callback for serverbound chat from the Java client. */
  onJavaChatMessage(cb: (msg: string) => void): void
}

interface BedrockAny {
  on(event: string, cb: (packet: unknown) => void): unknown
  on(event: string, cb: (packet: any) => void): unknown
  queue(name: string, params: object): void
}

/**
 * Bridges one Java connection and one Bedrock session. Bedrock packet
 * events are translated into Java clientbound packets and written to the
 * Java sink; Java chat travels back to the Bedrock session.
 */
export class Translator {
  private readonly bedrock: BedrockAny
  private readonly java: JavaSink
  private readonly logger: Logger
  /** Block runtime-id -> Java state mapping built from the server's palette. */
  blocks: BedrockBlockMapper | null = null
  /** Increments for every absolute position packet (must match client acks). */
  private teleportId = 0
  /** Last chunk coords sent to the Java client (for view updates). */
  private lastChunkX = 0
  private lastChunkZ = 0
  private hasChunks = false
  private hasView = false
  /** Latest known Bedrock player position (falls back to start_game spawn). */
  private playerPos: { x: number; y: number; z: number } | null = null
  private sentInitialPosition = false

  constructor(bedrock: unknown, java: JavaSink, logger: Logger) {
    this.bedrock = bedrock as BedrockAny
    this.java = java
    this.logger = logger
    this.wire()
  }

  private wire(): void {
    this.bedrock.on('set_time', (raw) => this.translateSetTime(raw))
    this.bedrock.on('text', (raw) => this.translateText(raw))
    this.bedrock.on('start_game', (raw: any) => this.onStartGame(raw))
    this.bedrock.on('level_chunk', (raw: any) => this.onLevelChunk(raw))
    this.bedrock.on('move_player', (raw: any) => this.onMovePlayer(raw))
    this.java.onJavaChatMessage((msg) => this.sendBedrockChat(msg))
  }

  /** Public entry so the server can forward start_game data (palette). */
  onStartGameData(data: any): void {
    this.onStartGame(data)
  }

  private onStartGame(data: any): void {
    if (!Array.isArray(data?.block_properties)) return
    const mapper = new BedrockBlockMapper(data.block_properties)
    this.logger.info(`[blocks] palette mapped: ${mapper.paletteSize} states, ${mapper.unmapped.length} unmapped${mapper.usesLegacyFallback ? ' (legacy fallback)' : ''}${mapper.isComplete ? ' (complete)' : ``}`)
    if (mapper.unmapped.length > 0) {
      const names = mapper.unmapped.slice(0, 10).map((i) => `${i}:${String((data.block_properties[i] as { name?: string })?.name ?? '?')}`).join(', ')
      this.logger.info(`[blocks] first unmapped runtime ids: ${names}`)
    }
    ;(this as { blocks: BedrockBlockMapper | null }).blocks = mapper
    // Remember where the Bedrock server thinks we are so the Java client can
    // be moved there before chunks start arriving (otherwise it floats in the
    // void at the captured replay position).
    const sp = data?.spawn_position ?? data?.player_position
    if (sp && typeof sp.x === 'number' && typeof sp.y === 'number' && typeof sp.z === 'number') {
      this.playerPos = { x: sp.x, y: sp.y, z: sp.z }
      this.logger.info(`[pos] bedrck spawn ${this.playerPos.x.toFixed(1)},${this.playerPos.y.toFixed(1)},${this.playerPos.z.toFixed(1)}`)
    }
  }

  private onLevelChunk(raw: any): void {
    const x = raw?.x ?? '?'
    const z = raw?.z ?? '?'
    const count = raw?.sub_chunk_count ?? '?'
    const cache = raw?.cache_enabled ?? '?'
    const payload = raw?.payload as Buffer | undefined
    this.logger.info(`[chunk] level_chunk x=${x} z=${z} subchunks=${count} cache=${cache} payloadBytes=${payload?.length ?? 0}`)
    if (payload && payload.length > 0) {
      try {
        const parsed = parseLevelChunkPayload(payload)
        const bpbs = parsed.subchunks.map((s) => s.bpb).join(',')
        this.logger.info(`[chunk] parsed: subs=${parsed.subchunkCount} bpb=[${bpbs}] tail=${parsed.tail.length}B`)
        this.sendJavaChunk(x, z, parsed)
      } catch (e) {
        this.logger.warn(`[chunk] parse failed: ${(e as Error).message}`)
      }
      const dir = join(String(process.cwd()), 'chunk_capture')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `chunk_${x}_${z}.bin`)
      writeFileSync(file, payload)
      this.logger.info(`[chunk] payload saved to ${file} (first bytes: ${payload.subarray(0, 24).toString('hex')})`)
    }
  }

  /** Translate a parsed Bedrock chunk column into a Java map_chunk. */
  private sendJavaChunk(x: number, z: number, parsed: ReturnType<typeof parseLevelChunkPayload>): void {
    if (!this.blocks) {
      this.logger.warn(`[chunk] no block mapper yet (start_game not seen); dropping chunk ${x},${z}`)
      return
    }
    const sections = buildColumn(parsed, (runtimeId) => this.blocks!.toJava(runtimeId))
    const body = encodeMapChunkBody(x, z, sections)
    // 1.20.2+ chunks ride inside a batch frame.
    this.java.send(JAVA_CLIENTBOUND_CHUNK_BATCH_START, encodeChunkBatchStartBody())
    this.java.send(JAVA_CLIENTBOUND_MAP_CHUNK, body)
    this.java.send(JAVA_CLIENTBOUND_CHUNK_BATCH_FINISHED, encodeChunkBatchFinishedBody(1))
    this.lastChunkX = x
    this.lastChunkZ = z
    this.hasChunks = true
    this.logger.info(`[chunk] -> Java map_chunk ${x},${z} body=${body.length}B`)
    // First real chunk: move the Java client to the Bedrock position so it is
    // looking at the chunks we are translating (not the captured replay spawn).
    if (!this.sentInitialPosition && this.playerPos) {
      this.sendPlayerPosition(this.playerPos.x, this.playerPos.y, this.playerPos.z)
      this.sentInitialPosition = true
    }
  }

  /** Teleport the Java client and align the view center to a Bedrock position. */
  private sendPlayerPosition(x: number, y: number, z: number): void {
    const teleportId = this.teleportId++
    this.java.send(JAVA_CLIENTBOUND_POSITION, encodePositionBody(x, y, z, 0, 0, teleportId))
    const cx = Math.floor(x / 16)
    const cz = Math.floor(z / 16)
    if (cx !== this.lastChunkX || cz !== this.lastChunkZ || !this.hasView) {
      this.java.send(JAVA_CLIENTBOUND_UPDATE_VIEW_POSITION, encodeUpdateViewPositionBody(cx, cz))
      this.lastChunkX = cx
      this.lastChunkZ = cz
      this.hasView = true
    }
    this.logger.info(`[pos] teleported Java client to ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`)
  }

  /** Translate Bedrock player position into a Java teleport + view update. */
  private onMovePlayer(raw: any): void {
    const pos = raw?.position as { x?: number; y?: number; z?: number } | undefined
    const rot = raw?.rotation as { x?: number; y?: number } | undefined
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.z !== 'number') return
    // Only teleport once we have sent chunks (player is actually in the world).
    if (!this.hasChunks) return
    // Bedrock rotation is (yaw, pitch); Java position expects (yaw, pitch).
    const yaw = typeof rot?.x === 'number' ? rot.x : 0
    const pitch = typeof rot?.y === 'number' ? rot.y : 0
    const teleportId = this.teleportId++
    this.java.send(JAVA_CLIENTBOUND_POSITION, encodePositionBody(pos.x, pos.y, pos.z, yaw, pitch, teleportId))
    const cx = Math.floor(pos.x / 16)
    const cz = Math.floor(pos.z / 16)
    if (cx !== this.lastChunkX || cz !== this.lastChunkZ || !this.hasView) {
      this.java.send(JAVA_CLIENTBOUND_UPDATE_VIEW_POSITION, encodeUpdateViewPositionBody(cx, cz))
      this.lastChunkX = cx
      this.lastChunkZ = cz
      this.hasView = true
    }
  }

  private translateSetTime(raw: unknown): void {
    const time = (raw as { time?: number })?.time ?? 0
    const w = new Writer()
    w.writeLong(0n) // world age
    w.writeLong(BigInt(time >>> 0) & 0x7fffffffffffffn) // time of day
    this.logger.packet({ direction: '->C', layer: 'java', name: 'time', id: JAVA_CLIENTBOUND_UPDATE_TIME, size: w.toBuffer().length })
    this.logger.verbose(`[translate] set_time -> update_time: ${time}`)
    this.java.send(JAVA_CLIENTBOUND_UPDATE_TIME, w.toBuffer())
  }

  private translateText(raw: unknown): void {
    const msg = translateTextPayload(raw)
    if (!msg) return
    const w = new Writer()
    writeTextComponent(w, msg.length > 256 ? msg.slice(0, 256) : msg)
    w.writeByte(0) // isActionBar = false
    this.logger.info(`[translate] Bedrock -> Java chat: ${msg.slice(0, 60)}`)
    this.java.send(JAVA_CLIENTBOUND_SYSTEM_CHAT, w.toBuffer())
  }

  private sendBedrockChat(msg: string): void {
    this.logger.info(`[translate] Java -> Bedrock chat: ${msg.slice(0, 60)}`)
    this.bedrock.queue('text', {
      needs_translation: false,
      category: 'authored',
      type: 'chat',
      source_name: '',
      message: msg,
      xuid: '',
      platform_chat_id: '',
      has_filtered_message: false,
      filtered_message: ''
    })
  }
}
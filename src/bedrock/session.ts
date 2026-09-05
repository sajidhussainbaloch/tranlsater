// Milestone 3: the proxy's Bedrock-side session.
//
// When a Java client reaches PLAY, the proxy opens a real Bedrock connection
// to the configured target (Aternos or the local dev server) so the player
// actually exists on the Bedrock world. This file wraps bedrock-protocol's
// client and surfaces lifecycle events the translation layer (M4+) will feed
// from/to the Java connection.

import { createClient, type Client } from 'bedrock-protocol'
import { bedrockLibraryVersion } from '../core/versions.js'
import type { Logger } from '../core/logger.js'

export interface BedrockSessionOptions {
  host: string
  port: number
  version: string
  username: string
  logger: Logger
  /** 'offline' = no Xbox auth (empty xuid). 'device-login' = real Microsoft/Xbox auth. */
  authMode: 'offline' | 'device-login'
  /** Directory that prismarine-auth uses to store its token cache. */
  deviceLoginCache: string
  /** Account identity used by prismarine-auth for the device-login flow. */
  deviceLoginUser: string
  /** DeviceOS value sent in the login JWT (1 = Android, 7 = Win10). */
  deviceOS: number
  /** Called when the Bedrock connection drops (kicked, server stop). */
  onBedrockDisconnect?: (reason: string) => void
}

export class BedrockSession {
  readonly client: Client
  private readonly logger: Logger
  private closed = false
  onStartGameData?: (data: any) => void

  constructor(private readonly opts: BedrockSessionOptions) {
    this.logger = opts.logger

    const deviceLogin = opts.authMode === 'device-login'
    const clientOptions: Parameters<typeof createClient>[0] & { skinData?: object } = {
      host: opts.host,
      port: opts.port,
      // In device-login mode this username is only the token-cache identity;
      // the on-screen gamertag comes from the authenticated Xbox account.
      username: deviceLogin ? (opts.deviceLoginUser || opts.username) : opts.username,
      version: bedrockLibraryVersion(opts.version) as unknown as never,
      offline: !deviceLogin,
      authTitle: deviceLogin ? undefined : 'MCPE',
      connectTimeout: deviceLogin ? 30_000 : 12_000,
      skinData: {
        DeviceOS: opts.deviceOS,
        DeviceModel: opts.deviceOS === 1 ? 'SM-A528B (Samsung Galaxy A52s)' : 'PrismarineJS'
      },
      ...(deviceLogin
        ? {
            profilesFolder: opts.deviceLoginCache,
            onMsaCode: (code: {
              user_code: string
              verification_uri: string
              expires_in: number
              message: string
            }) =>
              this.logger.info(
                `[auth] Microsoft sign-in required: open ${code.verification_uri} and enter code ${code.user_code} (expires in ${code.expires_in}s)`
              )
          }
        : {})
    }

    this.client = createClient(clientOptions)
    this.wire()
  }

  private wire(): void {
    const c = this.client
    c.on('session', (profile: { name?: string; xuid?: string }) => {
      // xuid/tokens are never logged; the gamertag is safe and useful.
      this.logger.info(
        `[bedrock] authenticated as '${profile.name ?? '?'}'${this.opts.authMode === 'device-login' ? ' (Xbox device login)' : ' (offline)'}`
      )
    })
    c.on('login', () => this.logger.info(`[bedrock] ${this.opts.username} logged in to ${this.opts.host}:${this.opts.port}`))
    c.on('join', () => this.logger.info('[bedrock] joined (play_status login_success)'))
    c.on('start_game', (data: any) => {
      const entityId = data?.runtime_entity_id
      const paletteSize = Array.isArray(data?.block_properties) ? data.block_properties.length : 0
      this.logger.info(`[bedrock] start_game received (entity ${String(entityId)}, block palette: ${paletteSize})`)
      this.onStartGameData?.(data)
    })
    c.on('spawn', () => this.logger.info('[bedrock] spawned (player_spawn)'))
    c.on('error', (e: Error) => this.logger.error(`[bedrock] session error: ${e.message}`))
    c.on('kick', (data: { reason?: string; message?: string }) => {
      const reason = data?.message || data?.reason || 'Disconnected'
      this.onDisconnected(reason)
    })
    c.on('close', () => {
      this.logger.info('[bedrock] session closed')
      this.onDisconnected('Disconnected')
    })
  }

  private onDisconnected(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.logger.info(`[bedrock] session ended: ${reason}`)
    try {
      this.opts.onBedrockDisconnect?.('Disconnected from Bedrock server')
    } catch (err) {
      this.logger.error(`[bedrock] disconnect callback error: ${(err as Error).message}`)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.client.close()
  }
}

// Configuration loader for config/proxy.yml (field names + defaults).
// Version numbers live here — never hard-coded in packet code.

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { LogFlags } from './logger.js'

export interface ProxyConfig {
  host: string
  port: number
  motd: string
  maxPlayers: number
}

export interface BedrockConfig {
  host: string
  port: number
  /** Open a real Bedrock session when a Java client reaches PLAY. Tests disable this. */
  openAfterPlay: boolean
  /**
   * DeviceOS value sent in the Bedrock login JWT (see DeviceOS enum:
   * 1 = Android, 7 = Win10). Some servers drop an existing player when a
   * "PC" session joins the same network; pretending to be Android keeps
   * mobile players from being kicked.
   */
  deviceOS: number
}

export interface AuthConfig {
  mode: 'offline' | 'device-login'
  deviceLogin: {
    user: string
    /** Directory for the prismarine-auth token cache. */
    cache: string
  }
}

export interface DevServerConfig {
  /** Start a local Bedrock dev server as the backend target. */
  enabled: boolean
  host: string
  port: number
}

export interface Config {
  proxy: ProxyConfig
  bedrock: BedrockConfig
  protocol: {
    java: string
    bedrock: string
  }
  auth: AuthConfig
  devServer: DevServerConfig
  debug: LogFlags
}

export const DEFAULT_CONFIG: Config = {
  proxy: { host: '127.0.0.1', port: 25565, motd: 'Java 1.21.1 -> Bedrock 26.40 (translator)', maxPlayers: 100 },
  bedrock: { host: 'saltanatsfsg.aternos.me', port: 40156, openAfterPlay: true, deviceOS: 1 },
  protocol: { java: '1.21.1', bedrock: '26.40' },
  auth: { mode: 'offline', deviceLogin: { user: '', cache: './cache' } },
  devServer: { enabled: false, host: '127.0.0.1', port: 19132 },
  debug: { packets: false, verbose: false, dumpJavaPackets: false, dumpBedrockPackets: false }
}

export function loadConfig(file: string): Config {
  const text = readFileSync(file, 'utf8')
  const raw = parseYaml(text) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_CONFIG)
  const cfg: Config = structuredClone(DEFAULT_CONFIG)

  const proxy = (raw.proxy ?? {}) as Record<string, unknown>
  const bedrock = (raw.bedrock ?? {}) as Record<string, unknown>
  const protocol = (raw.protocol ?? {}) as Record<string, unknown>
  const auth = (raw.auth ?? {}) as Record<string, unknown>
  const debug = (raw.debug ?? {}) as Record<string, unknown>

  if (typeof proxy.host === 'string') cfg.proxy.host = proxy.host
  if (typeof proxy.port === 'number') cfg.proxy.port = proxy.port
  if (typeof proxy.motd === 'string') cfg.proxy.motd = proxy.motd
  if (typeof proxy.maxPlayers === 'number') cfg.proxy.maxPlayers = proxy.maxPlayers

  if (typeof bedrock.host === 'string') cfg.bedrock.host = bedrock.host
  if (typeof bedrock.port === 'number') cfg.bedrock.port = bedrock.port
  if (typeof bedrock.openAfterPlay === 'boolean') cfg.bedrock.openAfterPlay = bedrock.openAfterPlay
  if (typeof bedrock.deviceOS === 'number') cfg.bedrock.deviceOS = bedrock.deviceOS

  if (typeof protocol.java === 'string') cfg.protocol.java = protocol.java
  if (typeof protocol.bedrock === 'string') cfg.protocol.bedrock = protocol.bedrock

  if (auth.mode === 'offline' || auth.mode === 'device-login') cfg.auth.mode = auth.mode
  const dl = (auth.deviceLogin ?? {}) as Record<string, unknown>
  if (typeof dl.user === 'string') cfg.auth.deviceLogin.user = dl.user
  if (typeof dl.cache === 'string') cfg.auth.deviceLogin.cache = dl.cache

  const devServer = (raw.devServer ?? {}) as Record<string, unknown>
  if (typeof devServer.enabled === 'boolean') cfg.devServer.enabled = devServer.enabled
  if (typeof devServer.host === 'string') cfg.devServer.host = devServer.host
  if (typeof devServer.port === 'number') cfg.devServer.port = devServer.port

  if (typeof debug.packets === 'boolean') cfg.debug.packets = debug.packets
  if (typeof debug.verbose === 'boolean') cfg.debug.verbose = debug.verbose
  if (typeof debug.dumpJavaPackets === 'boolean') cfg.debug.dumpJavaPackets = debug.dumpJavaPackets
  if (typeof debug.dumpBedrockPackets === 'boolean') cfg.debug.dumpBedrockPackets = debug.dumpBedrockPackets

  return cfg
}
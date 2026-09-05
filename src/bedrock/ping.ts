// Bedrock-status forwarder.
//
// The Java-side status/ping is answered with the REAL MOTD and player counts of
// the target Bedrock server, fetched over RakNet UDP (unconnected ping) using
// the integrated bedrock-protocol `ping`. When the server is unreachable the
// configured MOTD / zeroed counters are used as a fallback.

import { ping as bedrockPing } from 'bedrock-protocol'

export interface BedrockStatus {
  edition: string
  motdLine1: string
  motdLine2: string
  protocol: number
  version: string
  online: number
  max: number
  gamemode: string
}

export class BedrockStatusPoller {
  private cache: { at: number; status: BedrockStatus } | null = null
  private inflight: Promise<BedrockStatus | null> | null = null

  constructor(
    private readonly opts: { host: string; port: number },
    private readonly ttlMs = 5000,
    private readonly timeoutMs = 2500
  ) {}

  /** Returns a cached/fresh status, or null when the server is unreachable. */
  get(): Promise<BedrockStatus | null> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) {
      return Promise.resolve(this.cache.status)
    }
    if (!this.inflight) {
      this.inflight = this.fetch().finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  private async fetch(): Promise<BedrockStatus | null> {
    try {
      const raw = (await withTimeout(
        bedrockPing({ host: this.opts.host, port: this.opts.port }),
        this.timeoutMs
      )) as { [key: string]: unknown } | null
      if (!raw) return null
      const str = (k: string): string => (typeof raw[k] === 'string' ? (raw[k] as string) : '')
      const num = (k: string): number => (typeof raw[k] === 'number' ? (raw[k] as number) : 0)
      const status: BedrockStatus = {
        edition: str('edition'),
        motdLine1: str('motd'),
        motdLine2: str('levelName'),
        protocol: num('protocol'),
        version: str('version'),
        online: num('playersOnline'),
        max: num('playersMax'),
        gamemode: str('gamemode')
      }
      this.cache = { at: Date.now(), status }
      return status
    } catch {
      return null
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(null)
      }
    )
  })
}
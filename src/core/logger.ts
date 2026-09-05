// Debug logging with the flags from config/proxy.yml:
//   --debug-packets        show packet dumps (Java + Bedrock)
//   --dump-java-packets    Java packets only
//   --dump-bedrock-packets Bedrock packets only
//   --verbose              verbose protocol chatter
//
// Sensitive data (auth tokens, JWT chains, xuid, session ids, keys) is NEVER
// printed. Packet dump hooks only receive sanitized summaries.

export interface LogFlags {
  packets: boolean
  verbose: boolean
  dumpJavaPackets: boolean
  dumpBedrockPackets: boolean
}

export interface PacketDump {
  direction: string
  layer: 'java' | 'bedrock'
  name: string
  id: number
  size: number
  fields?: Record<string, unknown>
}

export class Logger {
  constructor(private readonly flags: LogFlags) {}

  info(msg: string): void {
    console.log(`[INFO ] ${msg}`)
  }

  warn(msg: string): void {
    console.warn(`[WARN ] ${msg}`)
  }

  error(msg: string): void {
    console.error(`[ERROR] ${msg}`)
  }

  verbose(msg: string): void {
    if (this.flags.verbose) console.log(`[VERB ] ${msg}`)
  }

  /** Emit a formatted packet inspection line, honoring the dump flags. */
  packet(dump: PacketDump): void {
    const want =
      dump.layer === 'bedrock'
        ? this.flags.dumpBedrockPackets
        : this.flags.dumpJavaPackets
    if (!this.flags.packets && !want) return
    console.log(`[${dump.layer.toUpperCase()} ${dump.direction}] ${dump.name} id=0x${dump.id.toString(16)} size=${dump.size}`)
    if (dump.fields && this.flags.verbose) {
      for (const [k, v] of Object.entries(dump.fields)) {
        console.log(`    ${k}=${safeStringify(v)}`)
      }
    }
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

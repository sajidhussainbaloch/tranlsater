// Entry point: `tsx src/index.ts [flags]`  (bundle: `npm run start`)
//
// Flags (override config/proxy.yml):
//   --config <path>           yaml config (default ./config/proxy.yml)
//   --debug-packets           dump Java + Bedrock packets
//   --dump-java-packets       dump Java packets only
//   --dump-bedrock-packets    dump Bedrock packets only
//   --verbose                 verbose protocol chatter + packet fields
//   -h, --help                show usage
//
// No user credentials or tokens are ever logged.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_CONFIG, loadConfig, type Config } from './core/config.js'
import { Logger } from './core/logger.js'
import { JavaServer } from './java/server.js'
import { BedrockStatusPoller } from './bedrock/ping.js'
import { startDevServer } from './bedrock/devserver.js'
import type { LogFlags } from './core/logger.js'
import { javaProtocolNumber, bedrockLibraryVersion } from './core/versions.js'

interface CliOptions {
  config: string
  flags: Partial<LogFlags>
  help: boolean
  devServer: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { config: resolve('config/proxy.yml'), flags: {}, help: false, devServer: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--config':
        out.config = resolve(argv[++i] ?? '')
        break
      case '--dev-server':
        out.devServer = true
        break
      case '--debug-packets':
        out.flags.packets = true
        break
      case '--dump-java-packets':
        out.flags.dumpJavaPackets = true
        break
      case '--dump-bedrock-packets':
        out.flags.dumpBedrockPackets = true
        break
      case '--verbose':
        out.flags.verbose = true
        break
      case '-h':
      case '--help':
        out.help = true
        break
      default:
        throw new Error(`Unknown flag: ${a}`)
    }
  }
  return out
}

function printHelp(): void {
  console.log(`j2b-translator — Java client (TLauncher) -> existing Bedrock 26.40 server

Usage:
  npm run preview -- [flags]
  node dist/index.js [flags]

Flags:
  --config <path>           config file (default config/proxy.yml)
  --dev-server              start a local Bedrock dev server as the backend target
  --debug-packets           dump every packet (Java + Bedrock)
  --dump-java-packets       dump Java packets only
  --dump-bedrock-packets    dump Bedrock packets only
  --verbose                 verbose logging incl. packet fields
  -h, --help                this help

No user credentials or tokens are ever logged.`)
}

async function main(): Promise<void> {
  let cli: CliOptions
  try {
    cli = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error((err as Error).message)
    printHelp()
    process.exit(2)
    return
  }
  if (cli.help) {
    printHelp()
    process.exit(0)
    return
  }

  let cfg = DEFAULT_CONFIG
  if (existsSync(cli.config)) {
    cfg = loadConfig(cli.config)
  } else {
    console.warn(`Config not found: ${cli.config} — using defaults (127.0.0.1:25565, Bedrock 127.0.0.1:19132)`)
  }
  cfg = { ...cfg, debug: { ...cfg.debug, ...cli.flags } }
  if (cli.devServer) cfg = { ...cfg, devServer: { ...cfg.devServer, enabled: true } }

  // Validate configured versions early — fail fast with a clear message.
  javaProtocolNumber(cfg.protocol.java)
  bedrockLibraryVersion(cfg.protocol.bedrock)

  const logger = new Logger(cfg.debug)

  // Local dev target replaces the configured Aternos/realms target entirely.
  if (cfg.devServer.enabled) {
    cfg = {
      ...cfg,
      bedrock: { host: cfg.devServer.host, port: cfg.devServer.port, openAfterPlay: true, deviceOS: cfg.bedrock.deviceOS },
      auth: { ...cfg.auth, mode: 'offline' }
    }
    await startDevServer({
      host: cfg.devServer.host,
      port: cfg.devServer.port,
      version: cfg.protocol.bedrock,
      logger
    })
  }

  const poller = new BedrockStatusPoller({ host: cfg.bedrock.host, port: cfg.bedrock.port })

  const server = new JavaServer(cfg, logger, poller)
  await server.start()

  logger.info(`versions: Java ${cfg.protocol.java} <-> Bedrock ${cfg.protocol.bedrock}`)
  logger.info(`Bedrock target: ${cfg.bedrock.host}:${cfg.bedrock.port}${cfg.devServer.enabled ? ' (local dev server)' : ''}`)
  logger.info(`open TLauncher and point it at ${cfg.proxy.host}:${cfg.proxy.port}`)

  const shutdown = (): void => {
    logger.info('shutting down…')
    void server.close().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
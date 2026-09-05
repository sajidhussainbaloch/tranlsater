// Local Bedrock dev server for testing j2b-translator without a real
// Aternos/realms target. Wraps bedrock-protocol's createServer (offline
// auth) with a minimal brain that completes a Bedrock login + spawn so the
// M3/M4 pipeline can be exercised entirely on localhost.
//
// Usage: `tsx src/index.ts --dev-server` (also see --dev-bedrock-port).
// The Java listener still runs; it forwards to the local Bedrock server.

import { Server, type Player, type Options as BedrockOptions } from 'bedrock-protocol'
import { randomUUID } from 'node:crypto'
import { bedrockLibraryVersion } from '../core/versions.js'
import type { Logger } from '../core/logger.js'

// bedrock-protocol's bundled .d.ts lags the runtime: its `Version` union and
// Player event overloads stop at 1.26.10 while the package ships 1.26.40.
// Cast through `unknown` to express the real runtime surface.

type AnyPlayer = Player & {
  on(event: string, cb: (packet?: unknown) => void): unknown
  write(name: string, params: object): void
}

export interface DevServerOptions {
  host: string
  port: number
  version: string
  logger: Logger
  levelName?: string
}

function startGameParams(seed: bigint, levelName: string, version: string): Record<string, unknown> {
  return {
    entity_id: 1n,
    runtime_entity_id: 1n,
    player_gamemode: 'survival',
    player_position: { x: 0, y: 80, z: 0 },
    rotation: { x: 0, z: 0 },
    seed,
    biome_type: 0,
    biome_name: 'plains',
    dimension: 'overworld',
    generator: 1,
    world_gamemode: 'survival',
    hardcore: false,
    difficulty: 1,
    spawn_position: { x: 0, y: 80, z: 0 },
    achievements_disabled: true,
    editor_world_type: 'not_editor',
    created_in_editor: false,
    exported_from_editor: false,
    day_cycle_stop_time: 0,
    edu_offer: 0,
    edu_features_enabled: false,
    edu_product_uuid: '',
    rain_level: 0,
    lightning_level: 0,
    has_confirmed_platform_locked_content: false,
    is_multiplayer: true,
    broadcast_to_lan: true,
    xbox_live_broadcast_mode: 0,
    platform_broadcast_mode: 0,
    enable_commands: true,
    is_texturepacks_required: false,
    gamerules: [],
    experiments: [],
    experiments_previously_used: false,
    bonus_chest: false,
    map_enabled: true,
    permission_level: 'member',
    server_chunk_tick_range: 8,
    has_locked_behavior_pack: false,
    has_locked_resource_pack: false,
    is_from_locked_world_template: false,
    msa_gamertags_only: false,
    is_from_world_template: false,
    is_world_template_option_locked: false,
    only_spawn_v1_villagers: false,
    persona_disabled: false,
    custom_skins_disabled: false,
    emote_chat_muted: false,
    game_version: version,
    limited_world_width: 0,
    limited_world_length: 0,
    is_new_nether: true,
    edu_resource_uri: { button_name: '', link_uri: '' },
    experimental_gameplay_override: false,
    chat_restriction_level: 'none',
    disable_player_interactions: false,
    server_editor_connection_policy: 0,
    allow_anonymous_block_drops_in_editor_worlds: false,
    level_id: 'j2b-dev',
    world_name: levelName,
    premium_world_template_id: '',
    is_trial: false,
    rewind_history_size: 0,
    server_authoritative_block_breaking: false,
    current_tick: 0n,
    enchantment_seed: 0,
    block_properties: [],
    multiplayer_correlation_id: '',
    server_authoritative_inventory: false,
    engine: 'j2b-translator-dev',
    property_data: { type: 'compound', name: '', value: {} },
    block_pallette_checksum: 0n,
    world_template_id: randomUUID(),
    client_side_generation: false,
    block_network_ids_are_hashes: false,
    server_controlled_sound: false,
    has_server_join_info: false,
    server_identifier: '',
    scenario_identifier: '',
    world_identifier: randomUUID(),
    owner_identifier: ''
  }
}

/**
 * Starts a local bedrock-protocol Server. Returns the server handle once
 * listen() succeeds. The server calls logger for lifecycle events.
 */
export async function startDevServer(opts: DevServerOptions): Promise<Server> {
  const { host, port, version, logger, levelName = 'j2b-translator dev' } = opts
  const libraryVersion = bedrockLibraryVersion(version)

  const server = new Server({
    host,
    port,
    version: libraryVersion,
    offline: true,
    maxPlayers: 4,
    motd: { motd: 'j2b-translator local dev', levelName },
    raknetBackend: 'raknet-native'
  } as unknown as BedrockOptions)

  server.on('connect', (rawPlayer: Player) => {
    const player = rawPlayer as AnyPlayer
    const address = (rawPlayer as unknown as { address?: string }).address ?? ''
    logger.info(`[dev-bedrock] connect: ${rawPlayer.profile?.name ?? address}`)

player.on('join', () => {
      logger.info(`[dev-bedrock] join: ${player.profile?.name}`)
      player.write('start_game', startGameParams(12345n, levelName, version))
      player.write('resource_packs_info', {
        must_accept: false,
        has_addons: false,
        has_scripts: false,
        disable_vibrant_visuals: false,
        world_template: { uuid: randomUUID(), version: '0.0.0' },
        texture_packs: []
      })
      logger.info('[dev-bedrock] sent start_game + resource_packs_info')
    })

    let resourcePacksDone = false
    player.on('resource_pack_client_response', () => {
      if (resourcePacksDone) return
      resourcePacksDone = true
      player.write('resource_pack_stack', {
        must_accept: false,
        resource_packs: [],
        game_version: version,
        experiments: [],
        experiments_previously_used: false,
        has_editor_packs: false
      })
      logger.info('[dev-bedrock] sent resource_pack_stack')
    })

    player.on('request_chunk_radius', () => {
      player.write('chunk_radius_update', { chunk_radius: 8 })
      player.write('play_status', { status: 'player_spawn' })
      logger.info('[dev-bedrock] sent chunk_radius_update + player_spawn')
    })

    player.on('spawn', () => {
      logger.info(`[dev-bedrock] spawned: ${rawPlayer.profile?.name}`)
      player.write('play_status', { status: 'player_spawn' })
      // M4 demo: push a chat line + start the world clock so the translator
      // pipe (Bedrock -> Java) is visible on the Java client.
      player.write('text', {
        needs_translation: false,
        category: 'message_only',
        type: 'chat',
        source_name: 'DevServer',
        message: 'Hello from Bedrock dev server (translated over M4 pipe)',
        xuid: '2535460496378702',
        platform_chat_id: '',
        has_filtered_message: false
      })
      const clock = setInterval(() => {
        // Fast cycle so the translation is obviously visible: a full day/night
        // (~24000 ticks) completes every ~48s real time.
        const t = (Math.floor(Date.now() / 1000) * 500) % 24000
        try {
          player.write('set_time', { time: t })
        } catch (err) {
          clearInterval(clock)
          logger.verbose(`[dev-bedrock] clock stopped: ${(err as Error).message}`)
        }
      }, 1000)
      player.once('close', () => clearInterval(clock))
    })

    player.on('packet', (packet: unknown) => {
      const px = (packet as { data?: { name?: string } }) ?? {}
      logger.verbose(`[dev-bedrock] packet: ${px.data?.name ?? '?'}`)
    })
  })

  await server.listen()
  logger.info(`[dev-bedrock] listening on ${host}:${port} (${libraryVersion}, offline)`)
  return server
}

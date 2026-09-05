// Milestone 4 (blocks): Bedrock runtime block id <-> Java blockstate id.
//
// Two registries meet here:
//  - The Bedrock SERVER announces its own ordered block palette in
//    `start_game.block_properties` (array of {name, nbt-state}). The chunk
//    payloads reference those blocks by *index* (the runtime id), so the
//    mapping is produced per-connection, not hardcoded.
//  - GoMine sends an EMPTY palette and references blocks by the CLASSIC
//    legacy block id (0..255, the pre-flattening numeric ids: 1 stone,
//    2 grass_block, 14 gold_ore, 42 iron_block, 246 blue_glazed_terracotta,
//    ...). This was reverse-engineered from live captures: the observed ids
//    (2,14,32,42,46,70,84,246) are all < 256 and decode to a coherent
//    block-test grid under the legacy table, while the global canonical table
//    (air at 13094, water at ~9808) yields nonsense (warped_door/leaf_litter
//    pillars with no air anywhere). So the empty-palette fallback uses the
//    legacy table, not the modern global block-state table.
//  - The Java 1.21.1 client has a fixed global block-state registry. We use
//    the version's defaultState (== minStateId for the canonical state) as
//    the Java blockstate id; stateful refinements (facing, half, waterlogged)
//    come in a later increment.

import { createRequire } from 'node:module'

interface JavaBlock {
  name: string
  defaultState: number
  minStateId: number
  maxStateId: number
}

const require = createRequire(import.meta.url)

let javaDataCache: Map<string, JavaBlock> | null = null

/** Bare-name (no `minecraft:` prefix) -> block entry, from 1.21.1 blocks.json. */
function javaBlocksByName(): Map<string, JavaBlock> {
  if (javaDataCache) return javaDataCache
  const md = require('minecraft-data') as (v: string) => {
    blocksArray: JavaBlock[]
  }
  const data = md('1.21.1')
  const map = new Map<string, JavaBlock>()
  for (const block of data.blocksArray ?? []) map.set(block.name, block)
  javaDataCache = map
  return map
}

/**
 * Classic legacy block ids (0..255) -> Java 1.21.1 block names. Index == the
 * legacy block id GoMine uses as the runtime id in chunk payloads. Names are
 * already the Java 1.21.1 registry names (grass -> short_grass, etc.).
 */
const LEGACY_BLOCK_NAMES: Array<string | undefined> = [
  'air', 'stone', 'grass_block', 'dirt', 'cobblestone', 'oak_planks',
  'oak_sapling', 'bedrock', 'water', 'water', 'lava', 'lava', 'sand',
  'gravel', 'gold_ore', 'iron_ore', 'coal_ore', 'oak_log', 'oak_leaves',
  'sponge', 'glass', 'lapis_ore', 'lapis_block', 'dispenser', 'sandstone',
  'note_block', 'red_bed', 'powered_rail', 'detector_rail', 'sticky_piston',
  'cobweb', 'short_grass', 'dead_bush', 'piston', 'piston_head', 'white_wool',
  undefined, // 36 piston_extension (no Java block)
  'dandelion', 'poppy', 'brown_mushroom', 'red_mushroom', 'gold_block',
  'iron_block', 'stone_slab', 'stone_slab', 'bricks', 'tnt', 'bookshelf',
  'mossy_cobblestone', 'obsidian', 'torch', 'fire', 'spawner', 'oak_stairs',
  'chest', 'redstone_wire', 'diamond_ore', 'diamond_block', 'crafting_table',
  'wheat', 'farmland', 'furnace', 'furnace', 'oak_sign', 'oak_door',
  'ladder', 'rail', 'cobblestone_stairs', 'oak_wall_sign', 'lever',
  'stone_pressure_plate', 'iron_door', 'oak_pressure_plate', 'redstone_ore',
  'redstone_ore', 'redstone_torch', 'redstone_torch', 'stone_button',
  'snow', 'ice', 'snow_block', 'cactus', 'clay', 'sugar_cane', 'jukebox',
  'oak_fence', 'carved_pumpkin', 'netherrack', 'soul_sand', 'glowstone',
  'nether_portal', 'jack_o_lantern', 'cake', 'repeater', 'repeater',
  'white_stained_glass', 'oak_trapdoor', 'infested_stone', 'stone_bricks',
  'brown_mushroom_block', 'red_mushroom_block', 'iron_bars', 'glass_pane',
  'melon', 'pumpkin_stem', 'melon_stem', 'vine', 'oak_fence_gate',
  'brick_stairs', 'stone_brick_stairs', 'mycelium', 'lily_pad',
  'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs',
  'nether_wart', 'enchanting_table', 'brewing_stand', 'cauldron',
  'end_portal', 'end_portal_frame', 'end_stone', 'dragon_egg',
  'redstone_lamp', 'redstone_lamp', 'oak_slab', 'oak_slab', 'cocoa',
  'sandstone_stairs', 'emerald_ore', 'ender_chest', 'tripwire_hook',
  'tripwire', 'emerald_block', 'spruce_stairs', 'birch_stairs',
  'jungle_stairs', 'command_block', 'beacon', 'cobblestone_wall',
  'flower_pot', 'carrots', 'potatoes', 'oak_button', 'player_head',
  'anvil', 'trapped_chest', 'light_weighted_pressure_plate',
  'heavy_weighted_pressure_plate', 'comparator', 'comparator',
  'daylight_detector', 'redstone_block', 'nether_quartz_ore', 'hopper',
  'quartz_block', 'quartz_stairs', 'activator_rail', 'dropper',
  'white_terracotta', 'white_stained_glass_pane', 'acacia_leaves',
  'acacia_log', 'acacia_stairs', 'dark_oak_stairs', 'slime_block',
  'barrier', 'iron_trapdoor', 'prismarine', 'sea_lantern', 'hay_block',
  'white_carpet', 'terracotta', 'coal_block', 'packed_ice', 'sunflower',
  'white_banner', 'white_wall_banner', 'daylight_detector',
  'red_sandstone', 'red_sandstone_stairs', 'red_sandstone_slab',
  'red_sandstone_slab', 'spruce_fence_gate', 'birch_fence_gate',
  'jungle_fence_gate', 'dark_oak_fence_gate', 'acacia_fence_gate',
  'spruce_fence', 'birch_fence', 'jungle_fence', 'dark_oak_fence',
  'acacia_fence', 'spruce_door', 'birch_door', 'jungle_door',
  'acacia_door', 'dark_oak_door', 'end_rod', 'chorus_plant',
  'chorus_flower', 'purpur_block', 'purpur_pillar', 'purpur_stairs',
  'purpur_slab', 'purpur_slab', 'end_stone_bricks', 'beetroots',
  'dirt_path', 'end_gateway', 'repeating_command_block',
  'chain_command_block', 'frosted_ice', 'magma_block',
  'nether_wart_block', 'red_nether_bricks', 'bone_block',
  'structure_void', 'observer', 'white_shulker_box',
  'orange_shulker_box', 'magenta_shulker_box', 'light_blue_shulker_box',
  'yellow_shulker_box', 'lime_shulker_box', 'pink_shulker_box',
  'gray_shulker_box', 'light_gray_shulker_box', 'cyan_shulker_box',
  'purple_shulker_box', 'blue_shulker_box', 'brown_shulker_box',
  'green_shulker_box', 'red_shulker_box', 'black_shulker_box',
  'white_glazed_terracotta', 'orange_glazed_terracotta',
  'magenta_glazed_terracotta', 'light_blue_glazed_terracotta',
  'yellow_glazed_terracotta', 'lime_glazed_terracotta',
  'pink_glazed_terracotta', 'gray_glazed_terracotta',
  'light_gray_glazed_terracotta', 'cyan_glazed_terracotta',
  'purple_glazed_terracotta', 'blue_glazed_terracotta',
  'brown_glazed_terracotta', 'green_glazed_terracotta',
  'red_glazed_terracotta', 'black_glazed_terracotta',
  'white_concrete', 'white_concrete_powder'
]

/**
 * Maps Bedrock runtime block ids to Java blockstate ids for one connection.
 *
 * The palette comes from the Bedrock server's `start_game.block_properties`;
 * index in that array == the runtime id used by level_chunk payloads. When the
 * server sends an empty palette (GoMine), `legacy` mode is used instead:
 * runtime ids are the classic legacy block ids (0..255).
 */
export class BedrockBlockMapper {
  private readonly runtimeToJava: Map<number, number>
  /** Number of mapped block states (palette size, or legacy table size). */
  readonly paletteSize: number
  /** Runtime ids whose Bedrock name had no Java counterpart. */
  readonly unmapped: number[] = []
  /** True when the mapper fell back to the legacy block-id table. */
  readonly usesLegacyFallback: boolean

  constructor(blockProperties: Array<{ name: string; state?: unknown }>) {
    this.usesLegacyFallback = blockProperties.length === 0
    const java = javaBlocksByName()
    this.runtimeToJava = new Map()
    if (this.usesLegacyFallback) {
      this.paletteSize = LEGACY_BLOCK_NAMES.length
      for (let i = 0; i < LEGACY_BLOCK_NAMES.length; i++) {
        this.mapState(i, LEGACY_BLOCK_NAMES[i], java)
      }
    } else {
      this.paletteSize = blockProperties.length
      for (let i = 0; i < blockProperties.length; i++) {
        this.mapState(i, blockProperties[i]?.name, java)
      }
    }
  }

  private mapState(runtimeId: number, name: string | undefined, java: Map<string, JavaBlock>): void {
    if (!name) {
      this.unmapped.push(runtimeId)
      return
    }
    const bare = name.replace(/^minecraft:/i, '')
    const javaBlock = java.get(bare)
    if (javaBlock) {
      this.runtimeToJava.set(runtimeId, javaBlock.defaultState)
    } else {
      this.unmapped.push(runtimeId)
    }
  }

  /** Every runtime id resolved to a Java state. */
  get isComplete(): boolean {
    return this.unmapped.length === 0
  }

  /** Bedrock runtime id -> Java blockstate id (0 = air for unknown). */
  toJava(runtimeId: number): number {
    return this.runtimeToJava.get(runtimeId) ?? 0
  }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { BedrockBlockMapper } from '../src/translate/blocks.js'

const require = createRequire(import.meta.url)

test('block mapper maps runtime ids to Java default states', () => {
  const mapper = new BedrockBlockMapper([
    { name: 'minecraft:air', state: {} },
    { name: 'minecraft:stone', state: {} },
    { name: 'minecraft:diamond_ore', state: {} },
    { name: 'minecraft:oak_log', state: {} }
  ])
  assert.equal(mapper.paletteSize, 4)
  assert.equal(mapper.isComplete, true)
  assert.equal(mapper.toJava(0), 0)
  assert.equal(mapper.toJava(1), 1)
  assert.equal(mapper.toJava(3), 131)
  assert.ok(mapper.toJava(2) > 0)
})

test('unmapped bedrock blocks become air and are reported', () => {
  const mapper = new BedrockBlockMapper([
    { name: 'minecraft:stone', state: {} },
    { name: 'minecraft:nonexistent_block_xyz', state: {} }
  ])
  assert.equal(mapper.isComplete, false)
  assert.deepEqual(mapper.unmapped, [1])
  assert.equal(mapper.toJava(1), 0)
})

test('runtime id out of palette bounds maps to air', () => {
  const mapper = new BedrockBlockMapper([{ name: 'minecraft:stone', state: {} }])
  assert.equal(mapper.toJava(99), 0)
})

test('empty palette falls back to the legacy classic block-id table', () => {
  const mapper = new BedrockBlockMapper([])
  assert.equal(mapper.usesLegacyFallback, true)
  assert.ok(mapper.paletteSize > 200, `legacy table too small: ${mapper.paletteSize}`)
  const air = mapper.toJava(0)
  // Legacy ids observed in live GoMine captures must resolve to their blocks.
  assert.equal(mapper.toJava(2), javaDefaultState('grass_block'))
  assert.equal(mapper.toJava(14), javaDefaultState('gold_ore'))
  assert.equal(mapper.toJava(42), javaDefaultState('iron_block'))
  assert.equal(mapper.toJava(46), javaDefaultState('tnt'))
  assert.equal(mapper.toJava(84), javaDefaultState('jukebox'))
  assert.equal(mapper.toJava(246), javaDefaultState('blue_glazed_terracotta'))
  // Out-of-table ids still fall back to air.
  assert.equal(mapper.toJava(999), air)
  assert.equal(mapper.toJava(0), air)
})

function javaDefaultState(name: string): number {
  const md = require('minecraft-data') as (v: string) => { blocksArray: Array<{ name: string; defaultState: number }> }
  const block = md('1.21.1').blocksArray.find((b) => b.name === name)
  assert.ok(block, `java block ${name} should exist in minecraft-data 1.21.1`)
  return block.defaultState
}
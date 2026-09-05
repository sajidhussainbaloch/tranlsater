import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const md = require('minecraft-data')('1.21.1')
const t = md.protocol.play.toClient.types
const map = t.packet[1][0].type[1].mappings
const find = (name) => {
  for (const [id, n] of Object.entries(map)) if (n === name) return id
  return '?'
}
for (const n of ['map_chunk', 'position', 'login', 'spawn_position', 'update_view_position', 'chunk_batch_start', 'chunk_batch_finished', 'unload_chunk', 'update_light', 'block_change', 'multi_block_change']) {
  console.log(n, '=', find(n))
}

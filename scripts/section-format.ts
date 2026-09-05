import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const md = require('minecraft-data')('1.21.1')
const t = md.protocol.play.toClient.types
for (const n of ['packet_chunk_batch_start', 'packet_chunk_batch_finished', 'packet_spawn_position', 'packet_update_view_position', 'packet_update_light', 'packet_login']) {
  console.log(n, ':', JSON.stringify(t[n]).slice(0, 700))
  console.log()
}

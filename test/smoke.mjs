// Manual smoke check. Run AFTER starting `node dist/index.js`:
//   node test/smoke.mjs
// Pings the Java endpoint using the reference client and prints the result.

import mcp from 'minecraft-protocol'

const host = process.env.SMOKE_HOST ?? '127.0.0.1'
const port = Number(process.env.SMOKE_PORT ?? 25565)

const ping = mcp.ping
const status = await ping({ host, port:Number(port), version: '1.21.1' })

function desc(d) {
  return typeof d === 'string' ? d : d?.text ?? JSON.stringify(d)
}

console.log('Java version :', status.version?.name, '(protocol', status.version?.protocol + ')')
console.log('Players      :', status.players?.online + '/' + status.players?.max)
console.log('MOTD         :', desc(status.description))
process.exit(0)
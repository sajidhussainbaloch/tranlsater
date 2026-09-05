// Chat lab: connect to the real GoMine server as an Xbox device-logined client
// and try different text packet shapes to find which one GoMine accepts.
// Uses the same auth cache the proxy uses (cache/).

import { createClient } from 'bedrock-protocol'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const host = 'saltanatsfsg.aternos.me'
const port = 40156
const version = '1.26.40'
const cache = join(__dirname, '..', 'cache')

const c = createClient({
  host, port, version, offline: false,
  authTitle: undefined,
  flow: 'live',
  profilesFolder: cache,
  connectTimeout: 30_000,
  username: 'musaboffical',
  skinData: { DeviceOS: 1, DeviceModel: 'SM-A528B (Samsung Galaxy A52s)' }
})

let joined = false
const variant = process.env.CHAT_VARIANT || 'a'

c.on('session', p => console.log('[auth] session as', p.name, 'xuid', p.xuid))
c.on('join', () => console.log('[join] play_state login'))
c.on('spawn', () => {
  console.log('[spawn] ready — sending text variant', variant)
  if (joined) return
  joined = true
  setTimeout(() => {
    try {
      const ph = variant === 'c' ? 'raw' : 'chat'
      const cat = variant === 'b' ? 'authored' : 'message_only'
      const cpn = variant === 'c' ? { type: 'raw', needs_translation: false, category: 'message_only', message: 'go' } : { type: ph, needs_translation: false, category: cat, source_name: variant === 'd' ? 'Player' : '', message: 'go', xuid: variant === 'b' ? String(c.entity?.xuid ?? '') : '', platform_chat_id: '', has_filtered_message: false, filtered_message: '' }
      const orig = c.serializer.createPacketBuffer.bind(c.serializer)
      c.serializer.createPacketBuffer = (packet) => {
        if (packet.name === 'text') {
          // GoMine's text.go expects the OLD layout: type(1=chat), bool translation,
          // source_name, message, xuid, platform_chat_id (no category field).
          const enc = new TextEncoder()
          const msg = enc.encode('go')
          const body = Buffer.concat([
            Buffer.from([9]), // text packet id
            Buffer.from([1]), // type chat
            Buffer.from([0]), // needs_translation false
            Buffer.from([0]), // source_name ""
            Buffer.from([msg.length]), Buffer.from(msg),
            Buffer.from([0]), // xuid ""
            Buffer.from([0])  // platform_chat_id ""
          ])
          console.log('[old-format text]', body.toString('hex'))
          return body
        }
        return orig(packet)
      }
      c.queue('text', cpn)
      console.log('[sent] variant', variant)
    } catch (e) { console.error('[send-error]', e.message) }
  }, 1500)
})

let lastPackets = []
c.on('packet', (des) => {
  lastPackets.push(String(des?.data?.name ?? '?'))
  if (lastPackets.length > 20) lastPackets.shift()
})
c.on('packet_violation_warning', p => console.log('[VIOLATION]', JSON.stringify(p)))

c.on('text', p => console.log('[recv text]', JSON.stringify(p)))
c.on('kick', d => { console.log('KICK:', JSON.stringify(d)); process.exit(0) })
c.on('error', e => console.log('ERROR:', e.message))
c.on('close', () => { console.log('CLOSED. last packets:', lastPackets.join(', ')); process.exit(0) })

setTimeout(() => { console.log('TIMEOUT (no kick — variant', variant, 'worked). packets:', lastPackets.join(', ')); process.exit(0) }, 25_000)
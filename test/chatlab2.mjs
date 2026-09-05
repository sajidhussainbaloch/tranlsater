// chatlab2: empirically test many raw text-packet payload layouts against the
// real GoMine server. One connection per candidate, records violation/kick/success.
import { createClient } from 'bedrock-protocol'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cache = join(__dirname, '..', 'cache')
const host = 'saltanatsfsg.aternos.me'
const port = 40156
const version = '1.26.40'

// payload hex AFTER the packet id (0x09). 
const CANDIDATES = {
  A_mcdata_default:  '0000010002676f000000',
  B_mcdata_authored: '0001010002676f000000',
  C_uint32body_chat: '0001000000000002676f000000',
  D_uint32body_filtflag: '0001000000000002676f00000000',
  E_gomine_old:      '01000002676f0000',
  F_no_filtered:     '0000010002676f0000',
  G_cat1_type1_nofilt: '0001010002676f0000',
  H_uint32body_translate: '0002000000000e636861742e747970652e746578740102676f000000'
}

function run (name, payloadHex) {
  return new Promise(resolve => {
    const payload = Buffer.from(payloadHex, 'hex')
    const c = createClient({
      host, port, version, offline: false,
      authTitle: undefined, flow: 'live',
      profilesFolder: cache,
      connectTimeout: 30_000,
      username: 'musaboffical',
      skinData: { DeviceOS: 1, DeviceModel: 'SM-A528B (Samsung Galaxy A52s)' }
    })
    let sent = false
    const result = { name, violation: null, kick: null, text: null, success: false }

    const finish = (extra) => {
      if (c.finished) return
      c.finished = true
      Object.assign(result, extra)
      try { c.close() } catch {}
      console.log(JSON.stringify(result))
      resolve(result)
    }

    c.on('session', p => console.log(`[${name}] auth as`, p.name))
    c.on('spawn', () => {
      if (sent) return
      sent = true
      setTimeout(() => {
        const orig = c.serializer.createPacketBuffer.bind(c.serializer)
        c.serializer.createPacketBuffer = (packet) => {
          if (packet.name === 'text') return Buffer.concat([Buffer.from([0x09]), payload])
          return orig(packet)
        }
        c.queue('text', {})
        console.log(`[${name}] sent ${payload.toString('hex')}`)
      }, 1500)
    })

    c.on('packet_violation_warning', p => finish({ violation: p }))
    c.on('text', p => finish({ text: p }))
    c.on('kick', d => finish({ kick: d }))
    c.on('error', e => console.log(`[${name}] error:`, e.message))
    c.on('close', () => { if (!c.finished) console.log(`[${name}] closed (no outcome recorded)`) })

    setTimeout(() => finish({ success: true }), 15_000)
  })
}

for (const [name, hex] of Object.entries(CANDIDATES)) {
  await run(name, hex)
  await new Promise(r => setTimeout(r, 1500))
}
console.log('DONE')

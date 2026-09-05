// Capture relay: phone -> PC (19132) -> real Aternos server.
// Dumps the raw bytes of every 'text' packet the phone sends upstream,
// plus the parsed view if parseable.

import { Relay } from 'bedrock-protocol'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const relay = new Relay({
  host: '0.0.0.0',
  port: 19132,
  version: '1.26.40',
  offline: true,
  authTitle: undefined,
  flow: 'live',
  profilesFolder: join(__dirname, '..', 'cache'),
  destination: {
    host: 'saltanatsfsg.aternos.me',
    port: 40156,
    offline: false
  },
  motd: { motd: 'Capture Relay', levelName: 'Capture' }
})

// Override the server deserializer's readPacket to dump raw text bytes.
// We wrap RelayPlayer.readPacket — it receives the raw single-packet buffer.
const RelayPlayer = relay.RelayPlayer
class CapturePlayer extends RelayPlayer {
  readPacket (packet) {
    // packet is a single game packet buffer (already decompressed). Packet id 9 = text
    const first = packet[0]
    if (first === 9 || first === 0x09) {
      console.log('[CAPTURE] text packet RAW HEX:', packet.toString('hex'))
      console.log('[CAPTURE] text packet DECODED:', packet.slice(0, 400).toString('utf8').replace(/[^\x20-\x7E]/g, '.'))
      try {
        const des = this.server.deserializer.parsePacketBuffer(packet)
        console.log('[CAPTURE] parsed name:', des.data.name, JSON.stringify(des.data.params))
      } catch (e) {
        console.log('[CAPTURE] parse failed:', e.message)
      }
    }
    return super.readPacket(packet)
  }
}
relay.RelayPlayer = CapturePlayer

relay.on('connect', player => {
  console.log('==> Phone connected from', player.connection.address)

  // Bypass XBL verification but keep the phone's real public key for the ECDH handshake.
  const origDecode = player.decodeLoginJWT.bind(player)
  player.decodeLoginJWT = (authTokens, skinTokens, authToken = '') => {
    try {
      const real = origDecode(authTokens, skinTokens, authToken)
      console.log('[auth] VERIFIED real chain, key:', String(real.key).slice(0, 20))
      return real
    } catch (e) {
      console.log('[auth] verification failed, bypassing:', e.message)
      // Extract the phone's public key (x5u) from the first JWT header so ECDH still works.
      let pubKey = null
      try {
        const [header] = authTokens?.[0].split('.') || []
        pubKey = JSON.parse(Buffer.from(header, 'base64').toString('utf8')).x5u || null
      } catch {}
      return {
        key: pubKey,
        userData: {
          extraData: {
            XUID: '0',
            displayName: 'musaboffical',
            identity: '00000000-0000-0000-0000-000000000000'
          }
        },
        skinData: {}
      }
    }
  }

  player.on('loggingIn', d => {
    console.log('[login] protocol version:', d.params.protocol_version)
    try {
      const t = d.params.tokens
      const ident = JSON.parse(t.identity)
      console.log('[login] AuthenticationType:', ident.AuthenticationType)
      console.log('[login] Token head:', String(ident.Token).slice(0, 120))
      // decode header of token
      const [header] = String(ident.Token).replace(/^MCToken\s+/i, '').split('.')
      const hjson = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
      console.log('[login] token header alg:', hjson.alg, 'x5u head:', String(hjson.x5u).slice(0, 40))
    } catch (e) {
      console.log('[login] dump failed:', e.message)
    }
  })
  player.on('login', u => console.log('[login] user:', JSON.stringify(u.user)))
  player.on('join', () => console.log('[join] phone authenticated, opening upstream'))
  player.on('error', e => console.log('[player error]', e.stack || e.message))
  player.on('close', r => console.log('[player close]', r))
  player.on('packet', d => console.log('[phone->relay packet]', d.data?.name))
  player.on('server.client_handshake', () => console.log('[key exchange] started'))
  player.on('serverbound', ({ name, params }, des) => {
    if (name === 'text') {
      console.log('[serverbound text]', JSON.stringify(params))
    }
  })
})

relay.on('error', e => console.log('[relay error]', e.stack || e.message))

relay.on('join', (downstream, upstream) => {
  console.log('==> Relay joined upstream as', upstream.options.username)
})

relay.listen()
console.log('Listening on 0.0.0.0:19132 — connect your phone to 192.168.100.9:19132 and send a chat message.')

setInterval(() => {}, 1000)

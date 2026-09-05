// Dev probe: start our JavaServer (M2) and connect with our OWN codec client,
// verifying the login -> config -> play replay alignment byte-for-byte.
import net from 'node:net'
import { JavaServer } from '../dist/java/server.js'
import { Logger } from '../dist/core/logger.js'
import { testConfig } from '../test/helpers.js'
import { Writer, Reader } from '../dist/java/protocol/buf.js'
import { createFrame, readFrameHeader, peekPacketId } from '../dist/java/protocol/framing.js'
import { encodeHandshake } from '../dist/java/packets/handshake.js'

const logger = new Logger({ packets: true, verbose: true, dumpJavaPackets: false, dumpBedrockPackets: false })
const cfg = testConfig()
cfg.proxy = { ...cfg.proxy, host: '127.0.0.1', port: 0 }
const server = new JavaServer(cfg, logger, null)
const port = await server.start()
console.log(`proxy on ${port}`)

const sock = net.connect({ host: '127.0.0.1', port })
let buf = Buffer.alloc(0)
let seq = 'login'
const received = []

sock.on('data', (c) => {
  buf = Buffer.concat([buf, c])
  for (;;) {
    const h = readFrameHeader(buf)
    if (!h) return
    const total = h.prefixLength + h.payloadLength
    if (buf.length < total) return
    const p = buf.subarray(h.prefixLength, total)
    buf = buf.subarray(total)
    onFrame(p)
  }
})

function onFrame(p) {
  const id = peekPacketId(p)
  received.push({ id, size: p.length, seq })
  if (seq === 'login') {
    if (id === 0x02) {
      const r = new Reader(p)
      r.readVarInt()
      r.readUuid()
      const user = r.readString()
      console.log('LOGIN SUCCESS, username =', user)
      sock.write(createFrame(0x03, Buffer.alloc(0))) // login_acknowledged
      seq = 'config'
    }
  } else if (seq === 'config') {
    if (id === 0x0e) {
      const w = new Writer()
      w.writeVarInt(0)
      sock.write(createFrame(0x07, w.toBuffer())) // select_known_packs empty
    } else if (id === 0x0d) {
      sock.write(createFrame(0x03, Buffer.alloc(0))) // finish_configuration
    } else if (id === 0x03) {
      seq = 'play'
    }
  } else if (seq === 'play') {
    if (id === 0x2b) {
      const r = new Reader(p)
      r.readVarInt()
      console.log('JOIN GAME received (entityId =', r.readVarInt(), ')')
      console.log(`total frames: ${received.length}`)
      for (const f of received.filter((x) => x.seq !== 'play')) {
        const name = f.id === 0x02 ? 'success' : f.id === 0x03 ? (f.seq === 'login' ? '?' : 'finish_config') : '0x' + f.id.toString(16)
        console.log(`  [${f.seq}] 0x${f.id.toString(16).padStart(2, '0')} ${name} (${f.size})`)
      }
      sock.destroy()
      void server.close()
      process.exit(0)
    }
  }
}

sock.on('error', (e) => {
  console.log('ERR', e.message)
  process.exit(1)
})
sock.on('end', () => {
  console.log('socket ended')
  process.exit(0)
})

const w = new Writer()
encodeHandshake(w, { protocolVersion: 767, serverAddress: 'localhost', serverPort: 25565, nextState: 2 })
sock.write(createFrame(0x00, w.toBuffer()))
const w2 = new Writer()
w2.writeString('Probe')
w2.writeUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5')
sock.write(createFrame(0x00, w2.toBuffer()))

setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 10000)

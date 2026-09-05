// Loads captured packet blobs recorded by tools/capture-config.ts.
//
// Each phase .bin file is a sequence of records:
//   VarInt(payloadLen) VarInt(packetId) payload...
// where payloadLen = byte length of (packetId + payload).
//
// The proxy replays the `config` and `play` blobs verbatim so that a real
// 1.21.1 client receives the exact registry_data/tags/feature-flags the server
// must send to enter the world. Data lives under config/registry/<version>/.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Reader } from './protocol/buf.js'

export interface ReplayPacket {
  id: number
  payload: Buffer
}

export interface ReplayBlobs {
  login: ReplayPacket[]
  config: ReplayPacket[]
  play: ReplayPacket[]
}

/** Read the captured packet stream for `version` from `config/registry/<version>/`. */
export function loadReplayBlobs(version: string, baseDir = process.cwd()): ReplayBlobs {
  const dir = path.join(baseDir, 'config', 'registry', version)
  return {
    login: readPhase(dir, 'login'),
    config: readPhase(dir, 'config'),
    play: readPhase(dir, 'play')
  }
}

function readPhase(dir: string, phase: string): ReplayPacket[] {
  let buf: Buffer
  try {
    buf = readFileSync(path.join(dir, `${phase}.bin`))
  } catch {
    return []
  }
  const reader = new Reader(buf)
  const out: ReplayPacket[] = []
  while (reader.remaining > 0) {
    const recLen = reader.readVarInt()
    if (recLen <= 0 || recLen > reader.remaining) {
      throw new Error(`corrupt ${phase}.bin: bad record length ${recLen}`)
    }
    const rec = new Reader(reader.readBytes(recLen))
    const id = rec.readVarInt()
    // The record embeds the wire frame id varint (VarInt(id) VarInt(id) body);
    // strip the inner one so `createFrame` re-encodes a single id.
    rec.readVarInt()
    const payload = rec.readBytes(rec.remaining)
    out.push({ id, payload })
  }
  return out
}
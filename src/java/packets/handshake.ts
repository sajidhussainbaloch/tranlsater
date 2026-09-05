// HANDSHAKING state packet (Java Edition protocol).
//
// The very first packet a client sends:
//   +----------------+----------------------------------------------------+
//   | Field          | Type            | Notes                            |
//   +----------------+----------------------------------------------------+
//   | protocolVersion| VarInt          | int, e.g. 767 for 1.21.1         |
//   | serverAddress  | String (max 255)| what the player typed            |
//   | serverPort     | Unsigned Short    | TCP port they connected to       |
//   | nextState      | VarInt          | 1 = status, 2 = login            |
//   +----------------+----------------------------------------------------+

import { Reader, Writer } from '../protocol/buf.js'

export const PACKET_ID_HANDSHAKE = 0x00

export const STATE_STATUS = 1
export const STATE_LOGIN = 2

export interface Handshake {
  protocolVersion: number
  serverAddress: string
  serverPort: number
  nextState: number
}

export function decodeHandshake(reader: Reader): Handshake {
  const protocolVersion = reader.readVarInt()
  const serverAddress = reader.readString(255)
  const serverPort = reader.readUint16BE()
  const nextState = reader.readVarInt()
  return { protocolVersion, serverAddress, serverPort, nextState }
}

export function encodeHandshake(writer: Writer, hs: Handshake): void {
  writer.writeVarInt(hs.protocolVersion)
  writer.writeString(hs.serverAddress)
  writer.writeUint16BE(hs.serverPort)
  writer.writeVarInt(hs.nextState)
}
// LOGIN state packets (Java Edition protocol, 1.20.5+ layout).
//
//   Serverbound:
//     Login Start       0x00  Username, Player UUID
//     Login Acknowledged 0x03  (no payload) — client says "enter configuration"
//   Clientbound:
//     Disconnect        0x00  String reason
//     Success           0x02  UUID, username, property array, strictErrorHandling
//
// Flow (offline mode, no encryption): client sends Login Start, server answers
// Login Success, client sends Login Acknowledged, both move to CONFIGURATION.

import { Writer } from '../protocol/buf.js'
import type { Reader } from '../protocol/buf.js'

export const SERVERBOUND_LOGIN_START = 0x00
export const SERVERBOUND_LOGIN_ACKNOWLEDGED = 0x03
export const CLIENTBOUND_LOGIN_DISCONNECT = 0x00
export const CLIENTBOUND_LOGIN_SUCCESS = 0x02

export interface LoginStart {
  username: string
  playerUuid: string
}

/** Decode Login Start: String username + 128-bit UUID. */
export function decodeLoginStart(reader: Reader): LoginStart {
  const username = reader.readString(16) // Mojang profile name limit
  const playerUuid = reader.readUuid()
  return { username, playerUuid }
}

/** Encode a clean login-phase kick message (chat component JSON). */
export function encodeLoginDisconnect(writer: Writer, reasonText: string): void {
  writer.writeString(JSON.stringify({ text: reasonText }))
}

/**
 * Encode Login Success.
 * `properties` is the profile property array (name/value/signature triplets).
 * Offline-mode: client profile, ha own UUID; server decides the UUID to use.
 */
export function encodeLoginSuccess(writer: Writer, uuid: string, username: string): void {
  writer.writeUuid(uuid)
  writer.writeString(username)
  writer.writeVarInt(0) // properties (profile keys) — empty in offline mode
  writer.writeBoolean(false) // strictErrorHandling
}
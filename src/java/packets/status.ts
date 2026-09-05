// STATUS state packets (Java Edition protocol, stable 1.7 -> 1.21.x+).
//
//   Serverbound:
//     Status Request  0x00  (no payload)
//     Ping Request    0x01  Long payload (client-generated number)
//   Clientbound:
//     Status Response 0x00  String statusJson
//     Pong Response   0x01  Long payload (echo of ping)
//
// statusJson shape (what 1.21.1 expects):
//   { version: {name, protocol}, players: {max, online, sample[]},
//     description: <text component>, favicon?: base64 }

import type { Reader, Writer } from '../protocol/buf.js'

export const SERVERBOUND_STATUS_REQUEST = 0x00
export const SERVERBOUND_PING_REQUEST = 0x01
export const CLIENTBOUND_STATUS_RESPONSE = 0x00
export const CLIENTBOUND_PONG_RESPONSE = 0x01

export interface StatusRequest {}
export interface PingRequest {
  payload: bigint
}

export function decodeStatusRequest(reader: Reader): StatusRequest {
  void reader
  return {}
}

export function decodePingRequest(reader: Reader): PingRequest {
  return { payload: reader.readLong() }
}

export function encodeStatusResponse(writer: Writer, statusJson: string): void {
  writer.writeString(statusJson)
}

export function encodePongResponse(writer: Writer, payload: bigint): void {
  writer.writeLong(payload)
}
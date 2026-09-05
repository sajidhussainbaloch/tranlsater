// Minimal NBT writer for Java chat components (system_chat content).
// Encodes the `{text:"..."}` JSON-ish component the client accepts as an
// anonymous compound tag: 0x0a compound, entries, 0x00 end.

import { Writer } from '../java/protocol/buf.js'

export function writeTextComponent(w: Writer, text: string): void {
  w.writeByte(0x0a) // TAG_Compound (anonymous, no name)
  w.writeByte(0x08) // TAG_String
  writeNbtString(w, 'text')
  writeNbtString(w, text)
  w.writeByte(0x00) // TAG_End
}

function writeNbtString(w: Writer, s: string): void {
  const bytes = Buffer.from(s, 'utf8')
  w.writeInt16BE(bytes.length)
  w.writeBytes(bytes)
}

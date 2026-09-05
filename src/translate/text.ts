// Milestone 4: resolve Bedrock `text` translation messages into readable
// text for the Java side. The Bedrock server normally sends a translation
// *key* (e.g. `chat.type.sleeping`) plus parameters; the Bedrock client
// resolves it locally. The Java client has no such key, so we translate the
// handful of keys the proxy cares about here.

/** Bedrock translation key -> English template. `%s` / `%1$s` are substituted. */
const TRANSLATIONS: Record<string, string> = {
  'chat.type.sleeping': '%s is sleeping',
  'multiplayer.playersSleeping': '%s/%s players sleeping',
  'tile.bed.noSleep': 'You can only sleep at night',
  'chat.type.announcement': '[%s] %s',
  'chat.type.emote': '* %s %s',
  'chat.type.text': '<%s> %s',
  'chat.type.whisper': '%s whispers to you: %s',
  'chat.type.whisper.to': 'You whisper to %s: %s',
  'chat.type.admin': '[%s: %s]',
  'multiplayer.player.joined': '%s joined the game',
  'multiplayer.player.left': '%s left the game',
  'multiplayer.stopSleeping': 'Leaving bed'
}

/** Substitute %s (sequential) and %1$s-style (indexed) placeholders. */
function fill(template: string, params: string[]): string {
  if (params.length === 0) return template
  let out = template.replace(/%(\d+)\$s/g, (_, i) => params[Number(i) - 1] ?? '')
  let i = 0
  out = out.replace(/%s/g, () => params[i++] ?? '')
  return out
}

/**
 * Turn a Bedrock `text` packet payload into text fit for the Java client.
 * Returns `null` when there is nothing worth forwarding.
 */
export function translateTextPayload(raw: unknown): string | null {
  const p = (raw ?? {}) as {
    message?: string
    type?: string
    needs_translation?: boolean
    source_name?: string
    parameters?: unknown
  }
  let msg = typeof p.message === 'string' ? p.message : ''
  if (!msg) return null

  const params = Array.isArray(p.parameters) ? p.parameters.map(String) : []
  const source = typeof p.source_name === 'string' && p.source_name ? p.source_name : ''

  // A translation-keyed message: `params` present, or explicitly flagged, or
  // the message merely *looks* like a key (dotted lowercase). Resolve against
  // our table; fall back to the raw message so nothing useful is dropped.
  const looksLikeKey = /^[a-z0-9_.]+$/.test(msg) && msg.includes('.')
  if (params.length > 0 || p.needs_translation === true || looksLikeKey) {
    const translated = TRANSLATIONS[msg]
    if (translated) return fill(translated, params)
  }

  // A real chat line: Bedrock `chat` type carries the display name in
  // source_name and the contents in message.
  if (source && p.type === 'chat') {
    return `<${source}> ${msg}`
  }
  return msg
}
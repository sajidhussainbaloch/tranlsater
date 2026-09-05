import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateTextPayload } from '../src/translate/text.js'

test('translates a sleep translation message with params', () => {
  assert.equal(
    translateTextPayload({ type: 'translation', needs_translation: true, message: 'chat.type.sleeping', parameters: ['Steve'] }),
    'Steve is sleeping'
  )
})

test('translates players-sleeping counter', () => {
  assert.equal(
    translateTextPayload({ type: 'translation', message: 'multiplayer.playersSleeping', parameters: ['1', '2'] }),
    '1/2 players sleeping'
  )
})

test('passes through plain chat text unchanged', () => {
  assert.equal(translateTextPayload({ type: 'raw', message: 'hello world' }), 'hello world')
})

test('prefixes source name for chat lines', () => {
  assert.equal(translateTextPayload({ type: 'chat', message: 'hi', source_name: 'Alex' }), '<Alex> hi')
})

test('returns null for empty message', () => {
  assert.equal(translateTextPayload({ message: '' }), null)
  assert.equal(translateTextPayload({}), null)
})

test('falls back to raw message for unknown keys', () => {
  assert.equal(translateTextPayload({ type: 'translation', message: 'unknown.key.here', parameters: ['x'] }), 'unknown.key.here')
})
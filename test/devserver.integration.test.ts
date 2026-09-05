// Milestone 3/4 dev-host integration test.
//
//  bedrock-protocol client  ->  our local dev Bedrock server
//
// The local dev server (src/bedrock/devserver.ts) is the test target for the
// M3+ pipeline so tests don't need to wait on an external Aternos server.
// It must complete: RakNet connect -> login -> start_game -> resource pack
// handshake -> spawn.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from 'bedrock-protocol'
import { startDevServer } from '../src/bedrock/devserver.js'
import { Logger } from '../src/core/logger.js'

const quiet = new Logger({ packets: false, verbose: false, dumpJavaPackets: false, dumpBedrockPackets: false })

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 2000)
}

test('local dev Bedrock server completes offline login -> start_game -> spawn', async (t) => {
  const server = await startDevServer({
    host: '127.0.0.1',
    port: randomPort(),
    version: '26.40',
    logger: quiet
  })
  t.after(() => void server.close())

  const client = createClient({
    host: '127.0.0.1',
    port: (server as unknown as { options?: { port?: number } }).options?.port ?? 0,
    username: 'DevTest',
    version: '1.26.40' as unknown as never,
    offline: true,
    skipPing: true,
    followPort: false,
    conLog: () => {}
  })
  t.after(() => client.close())

  const got: string[] = []
  // bedrock-protocol's client types are stale; listen loosely.
  const anyClient = client as unknown as {
    on(event: string, cb: (p?: unknown) => void): unknown
  }
  anyClient.on('start_game', () => got.push('start_game'))

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout, got ${got.join(',')}`)), 8000)
    anyClient.on('spawn', () => {
      clearTimeout(timeout)
      got.push('spawn')
      resolve()
    })
    anyClient.on('error', (e) => {
      clearTimeout(timeout)
      reject(new Error(`client error: ${(e as Error)?.message ?? String(e)}`))
    })
  })

  assert.ok(got.includes('start_game'), `expected start_game, got ${got.join(',')}`)
  assert.ok(got.includes('spawn'), `expected spawn, got ${got.join(',')}`)
})
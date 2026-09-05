# Development

Development is milestone-driven. Each milestone follows the same loop:

```
explain protocol → show packet structure → implement → test → run → fix → document (here + PROTOCOL_MAPPING.md) → next
```

## Commands

| Task              | Command                                     |
| ----------------- | ------------------------------------------- |
| install           | `npm install`                               |
| typecheck         | `npm run typecheck`                         |
| build             | `npm run build`                             |
| run (source)      | `npm run preview -- [flags]`   |
| run (built)       | `npm start [flags]`            |
| tests             | `npm test`                                  |
| manual smoke ping | start proxy, then `node test/smoke.mjs`     |

## Milestone 1 (implemented — Java listener + status/ping)

### Protocol involved

Java Edition handshake & status over TCP. Length-prefixed VarInt frames:
`VarInt(len) VarInt(packetId) payload`.

State machine reachable now:

```
handshaking ──nextState=1──► status ── request/ping ──► respond, reply
handshaking ──nextState=2──► login  ── clean reject (M2 will replace)
```

### What was written

- `src/java/protocol/buf.ts` — Writer/Reader with VarInt, VarLong, MC string, UUID,
  boolean, ints, longs, floats, doubles.
- `src/java/protocol/framing.ts` — frame (de)serialization and header parsing;
  3 MiB cap.
- `src/java/packets/{handshake,status,login}.ts` — packet models + codecs.
- `src/java/server.ts` — TCP server + per-connection state machine, status JSON built
  from Bedrock MOTD.
- `src/bedrock/ping.ts` — RakNet unconnected-ping → MOTD/player counts, cached,
  fallback when the Bedrock server is down.
- `src/core/{config,logger,versions}.ts`, `src/index.ts` — config/CLI/debug flags.

### What was tested

- Byte-exact VarInt encodings (`0`, `127`, `128`, `300`, `2^21-1`, `INT32_MAX`).
- VarLong/String/UUID/fixed types round-trips.
- Frame fragmentation and multi-frame buffers.
- Handshake decode from crafted 1.21.1 bytes; encode/decode equality.
- Integration: independent `minecraft-protocol` client → our sever → fake Bedrock
  RakNet server; raw wire status/ping/pong; login rejected cleanly.

Result: 29/29 tests green.

```
npm test
→ # tests 29, pass 29, fail 0
```

### Manual smoke

```
npm run build
Start-Process node dist/index.js                # or: npm run preview
node test/smoke.mjs                            # reference client queries the endpoint
```

Expected with no Bedrock server reachable:

```
Java version : 1.21.1 (protocol 767)
Players      : 0/100
MOTD         : Java 1.21.1 -> Bedrock bridge (Bedrock server offline)
```

### Notes

- `minecraft-protocol` is a **dev-only** test client (independent cross-check).
  The proxy's own Java protocol implementation in `src/java/` is from scratch.
- `bedrock-protocol` (dependency) is the integrated Bedrock transport that
  Milestones 3+ use through `src/bedrock/`.

## Milestone 2 (next)

Java login/configuration: `login_start`, `login_success`, `set_compression` (optional),
`login_acknowledged`, then configuration phase (`registry_data`, `update_tags`,
`known_packs`, `finish_configuration`) — enough to reach `play` per the configured
Java version. Same loop: document → implement → test → verify.
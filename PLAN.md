# PLAN.md — Java-Client → Bedrock-Server Translator

Milestone plan for the project (see `PROJECT_GOAL.md` for the objective). One milestone at a
time. For every milestone: explain protocol → show packet structure → implement → test
→ run → fix → document in `DEVELOPMENT.md` / `PROTOCOL_MAPPING.md`.

## Targets

| Item            | Value                                   |
| --------------- | --------------------------------------- |
| Java client     | Minecraft Java 1.21.1 (protocol 767)    |
| Bedrock server  | Minecraft Bedrock 26.40                 |
| Java listener   | 127.0.0.1:25565 (configurable)          |
| Bedrock target  | configurable in `config/proxy.yml`      |
| Language        | TypeScript / Node.js                    |
| Bedrock network | integrated `bedrock-protocol` (RakNet)  |
| Java protocol   | implemented from scratch in this repo   |

## Architecture

```
src/
├── java_protocol/         our own Java Edition protocol implementation
│   ├── protocol/          varint, datatypes, frame codec
│   ├── packets/           handshake, status, (later) login/config/play
│   └── server.ts          TCP listener + connection state machine
├── bedrock_protocol/      wrapper around integrated bedrock-protocol
│   └── ping.ts            MOTD/Ping forwarder (status)
├── core/                  shared/none-of-both code
│   ├── config.ts          proxy.yml loader
│   ├── debug.ts           --debug-packets / --dump-* / --verbose
│   └── session.ts         (M5) PlayerSession internal model
├── translator/            (M5+) Java <-> internal <-> Bedrock mappings
├── test/
└── docs/                  DEVELOPMENT, PROTOCOL_MAPPING, ARCHITECTURE, AUTH
```

## Pipeline

```
decoder → structured packet → internal model → transformer → encoder
```

Every mapping documented in `PROTOCOL_MAPPING.md` with the same diagram the spec
requires:

```
Java packet → Decode → Internal representation → Transform → Bedrock packet → Encode
```

### Milestones

- M1 — Java TCP listener + handshake parser + status/ping (THIS MILESTONE).
- M2 — Java login + configuration phase (Login Start/Success, registry/tags/packs,
  Client Information, Finish Configuration) — purely to reach PLAY.
- M3 — Bedrock 26.40 client connection over RakNet (offline dev mode).
- M4 — Bedrock login + NetworkSettings/encryption + resource packs.
- M5 — Bridge Java session to Bedrock session via internal `PlayerSession`.
- M6 — Spawn: Bedrock Start Game → Java Join Game/Player Info/Position.
- M7 — Movement both directions (Java Set Player Position ↔ Bedrock MovePlayer).
- M8 — World/chunks: Bedrock LevelChunk(block runtime palette) → Java chunk format,
      block-states, block entities.
- M9 — Block interaction (break/place/use) + updates both ways.
- M10 — Inventory/items: Java windows ↔ Bedrock ItemStackRequest/Response.
- M11 — Entities: Java metadata/attributes ↔ Bedrock AddEntity metadata.
- M12 — Chat/commands: Java chat ↔ Bedrock Text; CommandRequest/Response.

## Rules

1. Bedrock server and world are never modified.
2. Version numbers live in `config/proxy.yml`, never hard-coded.
3. Coordinates/blocks/items are converted via explicit Internal-model functions.
4. No auth bypass; see `AUTH.md`.
5. No Geyser dependency.
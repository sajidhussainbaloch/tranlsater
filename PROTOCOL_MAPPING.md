# Protocol Mapping

Every translation is documented with the same diagram:

```
Java packet
    ↓ decode
Internal representation
    ↓ transform
Bedrock packet
    ↓ encode
(wire bytes)
```

Templates exist for both directions. Java and Bedrock packets are assumed to have
**different structures**; nothing is mechanically copied 1:1.

## Mapping template

### Java → Bedrock

```
[Java] packet {fields}
    │ decode               src/java/packets/<file>.ts
    ▼
{internal fields}
    │ translate          src/translator/<domain>.ts
    ▼
[Bedrock] packet {fields}
    │ encode               bedrock-protocol data schema (per version)
    ▼
wire
```

### Bedrock → Java

Reverse direction, same template.

## Milestone 1 (status & handshake)

Java protocol, states: `handshaking`, `status`, `login`, `configuration`, `play`.

### Handshake (C→S, handshaking, id 0x00) — `src/java/packets/handshake.ts`

| Field           | Type          | Notes                        |
| --------------- | ------------- | ---------------------------- |
| protocolVersion | VarInt        | 767 = Java 1.21.1             |
| serverAddress   | String (≤255)| hostname typed by the player |
| serverPort      | UnsignedShort | TCP port                     |
| nextState       | VarInt        | 1 = status, 2 = login         |

Bytes for a status ping (`localhost:25565`, proto 767):

```
00 ff 05 09 6c 6f 63 61 6c 68 6f 73 74 63 dd 01
^1  └─767──┘ └─"localhost"──────── ┘ └port┘ └1┘
                      └── prefix len
```

### Status: request/response/ping/pong

| Direction | ID  | Name            | Payload                  |
| --------- | --- | --------------- | ------------------------- |
| C→S       | 0x00 | Status Request  | — (empty)                 |
| S→C       | 0x00 | Status Response | String JSON               |
| C→S       | 0x01 | Ping Request    | Long (client timestamp)   |
| S→C       | 0x01 | Pong Response   | Long (echo)                |

Status response JSON (what we send with Bedrock info merged):

```json
{
  "version": { "name": "1.21.1", "protocol": 767 },
  "players": { "max": 7, "online": 3, "sample": [] },
  "description": { "text": "Fake Test MOTD §7Translator Test Level" },
  "enforcesSecureChat": false,
  "previewsChat": false
}
```

`max`/`online`/`motd` come from the Bedrock RakNet UnconnectedPong of the target
server; the fallback configuration when it is offline.

### Bedrock MOTD fetch (RakNet unconnected)

```
C: 0x01  time(8)  magic(16)  clientGuid(8)   → UDP 19132
S: 0x1c  time(8)  serverGuid(8)  magic(16)  string(ushort-len + serverName)
serverName = "MCPE;<motd>;<protocol>;<version>;<online>;<max>;<id>;<level>;..."
```

Implemented via `bedrock-protocol`'s `ping()` in `src/bedrock/ping.ts`.

## Java 1.21.1 ↔ Bedrock 26.40 compatibility (design, M3+)

Java Edition and Bedrock Edition are **completely divergent games** sharing only a
name. Nothing is assumed 1:1. Two hard data facts drive every translation:

| Registry       | Java 1.21.1 (`minecraft-data("1.21.1")`) | Bedrock 26.40 (`minecraft-data("bedrock_1.26.40")`) |
| -------------- | ---------------------------------------- | --------------------------------------------------- |
| blocks         | 1060                                     | 1356                                                |
| items          | 1333                                     | 1933                                             |
| entities       | 130                                     | 122                                                 |
| blockstates    | Java state id = block_id * 16 + meta-ish  | Bedrock **runtime id** (per-world-palette, large flat space) |
| block id space | ~7500 blockstates                         | 16913 runtime states    |
| items          | integer id (registry-ordered)             | negative "runtime id" (−1125 …) via ItemComponentId  |

### Structural differences (do NOT assume equivalence)

- **Block states**: Java encodes `blockId+meta` / palette per chunk; Bedrock uses a
  global **block runtime id** plus a per-chunk palette remapping. One Java block state
  maps to exactly one Bedrock runtime state, but the **splitting is different**
  (`chiseled_bookshelf` has directional+occupied state bits on Bedrock, etc.).
- **Items**: Java stack encodes NBT (custom data, enchantments, components in 1.20.5+).
  Bedrock sends item components via `ItemStackRequest/Response` and a runtime item id.
- **Entities**: Bedrock distinguishes `AddEntity` (spawns) from AddItemEntity /
  AddPlayer / AddPainting. Java has one `SpawnEntity`. Bijective? No: Bedrock has
  `minecraft:npc`, mass of feature-only mobs (Warden exists both), and Java has
  feature mobs absent from Bedrock (e.g. Breeze, Bogged in 1.21.1 — Bedrock carries
  equivalents only from 1.21.0+; verify per version).
- **Registries**: Java sends full registry+tags to client at config (handled by M2
  replay). Bedrock sends its own palette/blockstates on StartGame. Nothing is shared.
- **Gamemode/difficulty/biome** ids differ numerically; maps need tables, not math.

### Compatibility layer contract (src/translator/*, M5+)

Every table is **version-pinned and data-driven** (minecraft-data for both sides —
Java `"1.21.1"` and Bedrock `"bedrock_1.26.40"`), with explicit fallbacks:

```
Java value (block id / state / item / entity / biome / effect)
    │  lookup  key = { versionPair, javaId }          KEEP source key for unknown → map table
    ▼
InternalCanonical  (pure canonical id, e.g. "block:chiseled_bookshelf", slot 0..n)
    │  lookup  key = { versionPair, bedrockId }
    ▼
Bedrock value  (blockRuntimeId / itemRuntimeId / entityId / biomeId)
```

Unknown values (no key in either table) fall through **unmodified** when the target
accepts raw ids (Bedrock runtime id), or to a configured fallback (a substitute
block/entity/item + optional log line) when it does not. All conversions log to a
`converter` logger group.

```
Mapping entries in src/translator/tables/<domain>.<version>.ts, e.g.
  block.java2internal("1.21.1"):  Map<number, {internal}>
  block.internal2bedrock():      Map<internal, {bedrock, runtimeId}>
```

Tables are **generated by a once-off script** (`tools/generate-mappings.ts`) that
reads `minecraft-data` for both games and emits `Map`s + JSON; hand edits live in
`src/translator/overrides.<version>.ts` for cases the generator can't infer
(e.g. `minecraft:grass_block` ↔ Bedrock `grass`).

### Fallback policy (what can't be represented)

| Not representable on the other side                                    | Fallback                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Java block with no Bedrock equivalent (e.g. `fire_coral_block`)        | nearest biome-faithful Bedrock block + `INFO`                              |
| Bedrock block with no Java equivalent (some item components)           | drop extra components; keep base item                                 |
| Java item NBT/component not expressible in Bedrock                     | keep only plain item; strip NBT (log)                                    |
| Java entity style Bedrock can't spawn                             | `clear` + `summon` alternative actor or nothing (M11)                    |
| Bedrock metadata tag Java client can't render                      | skip tag; keep position/metadata that renders                            |

Every placeholder decision must appear in PROTOCOL_MAPPING.md with a concrete tuple
(Java id → internal → Bedrock id) plus the fallback path and why.

## Placeholders (milestones 3→12)

| Milestone | Bedrock packet(s)                      | Java packet(s)                        |
| --------- | -------------------------------------- | ------------------------------------- |
| M3-M4     | RakNet Connect, NetworkSettings, Login, ServerToClientHandshake | (§M2) Login Start / Success |
| M6        | StartGame, PlayStatus, LevelChunk start | Player Info, Join Game, Pos/Rot       |
| M7        | MovePlayer, PlayerAuthInput            | Set Player Position, TeleportConfirm   |
| M8        | LevelChunk sub-chunks, block palette, UpdateBlock, BlockActor | Chunk Data, Block Update, Block Entity Data |
| M9        | PlayerAction, ItemUse, UpdateBlock     | Player Digging, Use Item, Block Update |
| M10       | ItemStackRequest/Response, InventoryContent | Container/Slot/Window, Set Slot   |
| M11       | AddEntity, Entity Metadata, Attributes | Spawn Entity, Entity Metadata, Attributes |
| M12       | Text, CommandRequest/Response, AvailableCommands | Chat, Serverbound Chat, System Chat |

The exact field layouts for these are pinned to the configured versions as they
land (`bedrock-protocol` data + minecraft-data for the Java side) — never guessed.

## Raw byte references

Wire-level implementations live in `src/java/protocol/*`. Round-trip and
byte-exact tests: `test/protocol.test.ts`, `test/handshake.test.ts`.
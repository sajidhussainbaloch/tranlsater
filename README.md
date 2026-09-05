# Java Edition → Bedrock Edition Translator

A protocol translation proxy that lets a **Minecraft Java Edition client (TLauncher)**
connect to and play on an **existing Minecraft Bedrock Edition server** — without
converting or touching the Bedrock server/world in any way.

```
Java client (TLauncher 1.21.1)
        │ Java protocol (our own implementation)
        ▼
    ┌─────────────────────────┐
    │  j2b translator (this)  │
    └─────────────────────────┘
        │ Bedrock protocol (RakNet/UDP via bedrock-protocol)
        ▼
Bedrock 26.40 server (unchanged, world intact)
```

## Status — Milestone 1 (implemented & tested)

Java-side listener, handshake parser, and **server-list status/ping**, where the MOTD
and player counts are pulled live from your Bedrock server via RakNet unconnected-ping.

- ❌ Java login / play — **Milestone 2** (not yet)
- ❌ Bedrock connection — **Milestone 3+** (not yet)

## Versions

| Role                | Default    | Configurable |
| ------------------- | ---------- | ------------ |
| Java (presented)    | 1.21.1     | `config/proxy.yml → protocol.java` |
| Java protocol       | 767        | via `src/core/versions.ts` registry |
| Bedrock (target)    | 26.40      | `config/proxy.yml → protocol.bedrock` |

## Build & run

```bash
npm install
npm run build        # tsc -> dist/
npm start            # or: npm run preview (tsx, no build needed)

# with packet debugging
npm run preview -- --debug-packets --verbose
```

Then point TLauncher (any offline profile, version **1.21.1**) at
`127.0.0.1:25565`. The server list shows the Java name/MOTD ported live from your
Bedrock server.

## Configuration

`config/proxy.yml` (defaults shown):

```yaml
proxy:
  host: 127.0.0.1
  port: 25565
  motd: "Java 1.21.1 -> Bedrock 26.40 (translator)"   # fallback when Bedrock is offline
  maxPlayers: 100

bedrock:
  host: 127.0.0.1    # your Bedrock 26.40 server
  port: 19132

protocol:
  java: "1.21.1"
  bedrock: "26.40"

debug:
  packets: false
  verbose: false
  dumpJavaPackets: false
  dumpBedrockPackets: false
```

CLI flags: `--verbose --dump-java-packets --dump-bedrock-packets --debug-packets
--config <path> --help`.

## Testing

```bash
npm test
```

29 tests: VarInt/VarLong/string/UUID codecs, TCP framing, handshake decode from
crafted byte-exact 1.21.1 packets, plus integration against an independent
reference client (`minecraft-protocol`, a dev-only dependency) and a minimal fake
Bedrock RakNet server for the MOTD forwarder.

## Security

- **No authentication bypass.** See `AUTH.md`.
- **No credential/token logging** — packet dumps only print sanitized summaries.
- Login/play are not yet implemented (M2), so no game traffic is accepted yet.

## Known limitations (Milestone 1)

- Status only; login intentionally rejected with a clean message (M2 replaces it).
- Bedrock version 26.40 protocol data comes from bedrock-protocol; a server on a
  different Bedrock minor may respond differently to the unconnected ping.

## License

MIT — see `LICENSE`. Not affiliated with Mojang or Microsoft.
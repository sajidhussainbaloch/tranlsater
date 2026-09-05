# Architecture

Goal statement: see `PROJECT_GOAL.md`.

## Overall data flow

The proxy is a **bilingual interpreter**, not a byte forwarder. Every packet on either
side is decoded into a structural form, passed through transformation into a
protocol-independent model, then re-encoded in the target protocol.

```
┌──────────────┐   Java codec   ┌──────────────────────┐   Bedrock codec   ┌──────────────────────┐
│ Java client  │ ◄═ raw TCP ═►  │  JavaProtocol endpoint│ ◄═ RakNet/UDP ══► │  Bedrock server       │
│ (TLauncher)  │  frames        │  (this repo)          │                   │  (26.40, untouched)  │
└──────────────┘                └──────────┬───────────┘                   └──────────────────────┘
                                           │
                          internal model (PlayerSession)
                                           │
                Java─Internal─Bedrock function tables / translators
```

## Repository layout

```
src/
├── java/                 our own Java Edition protocol (from scratch)
│   ├── protocol/         buf.ts (VarInt/VarLong/strings/primitives),
│   │                     framing.ts (length-prefixed TCP frames)
│   ├── packets/          handshake.ts, status.ts, login.ts  (M1 set)
│   └── server.ts         TCP listener + per-connection state machine
├── bedrock/              seam to the integrated Bedrock protocol library
│   └── ping.ts           RakNet unconnected-ping MOTD forwarder (uses bedrock-protocol)
├── core/                 version-agnostic plumbing
│   ├── config.ts         proxy.yml loader (typed, defaults)
│   ├── logger.ts         flags-aware logging, sanitized packet dumps
│   └── versions.ts       Java version → protocol-number registry
│                         Bedrock alias → bedrock-protocol version string
├── index.ts              CLI: --config --debug-* --verbose --help
test/                     codec + integration tests
config/proxy.yml          runtime configuration
```

## Java-side state machine

```
handshaking → status        (M1: done)
handshaking → login → configuration → play   (M2+)
```

- `JavaServer` owns the `net.Server`.
- `JavaConnection` reassembles frames (`readFrameHeader`), strips the packet id,
  runs the current-state handler.

## Version strategy

- `protocol.java` → numeric id via `src/core/versions.ts` (currently 1.21.1 → 767).
- `protocol.bedrock` → bedrock-protocol library version (currently `26.40` → `1.26.40`,
  which is its CURRENT_VERSION).
- Add a new version = add a registry entry + (for Java) any packet-layout deltas,
  never edit packet code with hard-coded version checks.

## Debugging & security

- `--dump-java-packets`, `--dump-bedrock-packets`, `--debug-packets`, `--verbose` are
  wired through `core/logger.ts`. Only sanitized summaries are printed; never the JWT
  chain, tokens, session ids, or keys (see also `AUTH.md`).
- The integrated `bedrock-protocol` package drives the RakNet transport and the
  Bedrock codec on that side (Milestone 3+).

## Future: internal model

From Milestone 5, a `core/session/PlayerSession` (see `PLAN.md`) is the only thing
both protocol sides may write to:

```
PlayerSession
├── javaConnection / bedrockConnection
├── uuid / username
├── position(x,y,z) / rotation(yaw,pitch) / dimension / gamemode
├── health / inventory
└── connectionState
```

Conversions are explicit functions: `JavaPosition → InternalPosition`,
`InternalPosition → BedrockPosition`, `JavaBlockState → InternalBlockState`,
`InternalBlockState → BedrockBlockState`, and the same for items (M8–M10).
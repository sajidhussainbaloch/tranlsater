# PROJECT_GOAL.md

## Objective

> Allow a Minecraft Java Edition client running through TLauncher to connect through this proxy and play on an existing Minecraft Bedrock Edition 26.40 server without converting the Bedrock server or world.

## Direction (fixed, non-negotiable)

```
TLauncher / Minecraft Java Edition client
        │  Java Edition protocol (TCP, our own implementation)
        ▼
THIS TRANSLATOR PROXY
        │  Bedrock Edition protocol (RakNet/UDP via integrated bedrock-protocol)
        ▼
EXISTING BEDROCK EDITION 26.40 SERVER   ← never modified, world untouched
```

The proxy acts:

- toward the Java client as a normal (virtual) Java server on `127.0.0.1:25565`;
- toward the Bedrock server as a normal (virtual) Bedrock client.

## What this project is NOT

- NOT a Java Edition server.
- NOT Geyser, and does not use Geyser as the core translator.
- NOT a converter of the Bedrock server or world.
- NOT a packet forwarder — the two protocols are actually decoded into a shared
  internal model and re-encoded on the other side.
- NOT an auth bypass. No token/credential theft, no spoofing other players.

## Versions (configurable, just defaults)

| Role                    | Version            | Protocol |
| ----------------------- | ------------------ | -------- |
| Java client presented   | Minecraft Java 1.21.1 | 767      |
| Bedrock server emulated | Minecraft Bedrock 26.40   | handled by bedrock-protocol |

Version numbers are configurable in `config/proxy.yml`, never hard-coded.

## The critical translation requirement

The two editions use different coordinate/block/item representations. The proxy
explicitly converts:

```
Java position/blockstate/item → Internal model → Bedrock counterpart
Bedrock position/blockstate/item → Internal model → Java counterpart
```

We never assume a Java packet equals a Bedrock packet.
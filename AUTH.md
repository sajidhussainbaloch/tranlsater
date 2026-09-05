# Authentication policy

Short version: **no bypass, no theft, no spoofing.** The translator connects to the
Bedrock server exactly like a normal Bedrock client — under an identity that is
either explicitly offline (dev) or genuinely owned by the person running it.

## Hard rules — never do

- Extract, store, or log another account's tokens (OAuth/Xbox token, Minecraft
  session token, xuid, UUID).
- Capture credentials the user types anywhere.
- Impersonate another player.
- Disable server authentication just to "make it work" against a server whose owner
  wants authentication enforced.
- Steal or extract tokens from any local Minecraft installation.

## What we do

- Connect with the identity of the account that runs the proxy when the server
  requires authentication.
- Support an **explicit offline dev mode** for servers that allow anonymous
  connections (`offline: true` in bedrock-protocol / a local test server with
  authentication disabled). This is for development only and is clearly documented.

## Milestones

| Milestone | Config mode      | Behavior |
| --------- | ---------------- | -------- |
| M3–M4     | `auth.mode: offline`   | self-signed JWT chain, no Xbox login. For dev/test servers only. |
| M14       | `auth.mode: device-login` | real Microsoft Xbox device-login on the user's own device (documented public OAuth device-code flow). Tokens stay in the user-provided cache file (`auth.deviceLogin.cache`) and are never logged. |

`config/proxy.yml → auth.mode` selects one of the two. The default (current
milestone) is `offline`.

## Logging guarantee

Even with `--debug-packets`/`--verbose` fully on, the proxy never prints JWT
chains, tokens, session ids, xuid, or keys. The debug pipeline only carries
sanitized summaries (see `src/core/logger.ts`).

## Dev-mode note

If the Bedrock 26.40 server runs with authentication enabled and you don't want to
enable `device-login` yet, test against a **local server in offline mode** — do not
fake or bypass the live server's authentication.
# Discord NSFW Media Bot

A modular, age-restricted Discord media bot implemented directly against the
Discord HTTP API v10 and Gateway v10. The active runtime does not use
`discord.js`, Eris, Oceanic, or another comprehensive Discord client wrapper.
Its two focused runtime dependencies are the low-level `ws` WebSocket
transport and Chalk for portable ANSI terminal styling.

The original implementation is preserved byte-for-byte in `archive/legacy/`.
A complete `llms-full.txt` may be kept at the repository root as a local
Discord API reference, but it is intentionally ignored and never committed.

## Runtime behavior

- The main entry point automatically loads and validates every command.
- It bulk-overwrites the configured application-command scope on every start.
- It then connects to Gateway v10, identifies, heartbeats, resumes interrupted
  sessions, and routes raw dispatch events.
- An atomic heartbeat lease permits only one local bot process. If an isolated
  host still uses the same token, callback-conflict detection makes the losing
  Gateway session yield instead of continuously racing interactions.
- Media commands acknowledge interactions before Discord's three-second
  deadline, query their own explicit provider pools, and fall back to the next
  provider when a source fails.
- ABD reads only `url_japan`, downloads from the exact Osaka host, and
  re-uploads the media as a native Discord attachment. Its transport remains
  hostname-verified and may tolerate certificate expiry only; its Link button
  opens the validated Osaka media URL directly.
- Free accounts receive 60 successful media requests per rolling minute and
  1,000 per UTC day. Premium accounts remove the minute ceiling and receive
  5,000 per UTC day. Failed provider/Discord executions do not consume media
  quota, and concurrent requests reserve capacity before contacting a host.
- Provider circuits open after consecutive upstream failures, skip that host
  for 30–120 seconds, and allow one subsequent real request as the recovery
  probe. The runtime never races or prefetches redundant provider requests.
- Media footers show only the requesting user's display name and avatar;
  Discord renders the timestamp beside them. Every successful media response
  includes Refresh and Link buttons.
- All 37 media commands are registered as age-restricted commands and are also
  rejected at runtime in guild channels that are not marked NSFW.
- Direct messages retain the legacy behavior; Discord's own age gate still
  applies to age-restricted application commands.

## Commands

Media commands:

`/4k`, `/anal`, `/ass`, `/blowjob`, `/boobs`, `/breeding`, `/buttplug`,
`/cages`, `/cosplay`, `/cum`, `/ecchi`, `/ero`, `/feet`, `/fuck`, `/gif`, `/gonewild`,
`/hentai`, `/kitsune`, `/legs`, `/maid`, `/midriff`, `/milf`, `/neko`,
`/paizuri`, `/petgirls`, `/pussy`, `/pussylick`, `/selfie`, `/smothering`,
`/socks`, `/solo`, `/tentacle`, `/thigh`, `/threesome`, `/uniform`, `/waifu`,
and `/yuri`.

Utility commands:

- `/help` provides autocomplete, pagination, command details, and fuzzy modal
  search.
- `/invite` generates a least-permission bot installation URL.
- `/ping` reports Gateway latency, interaction roundtrip, uptime, memory,
  platform, and guild count.
- `/premium [user]` reports Free/Premium status and remaining account-wide
  quotas. Its Subscribe/Manage link is paired with an emoji-only refresh
  button that updates the existing message from the latest usage snapshot.
  Premium membership currently comes from a deployment allowlist.

Command options preserve the original choices and include the new `/buttplug`
style grouping:

- `/anal`, `/ass`, `/blowjob`, `/boobs`, `/buttplug`, `/feet`, and `/thigh`: optional
  `style` choice (`Anime` or `Real`).
- `/solo`: optional `gender` choice (`female` or `male`).
- `/threesome`: optional `type` choice (`fff`, `ffm`, or `mmf`).
- `/help`: optional autocompleted `command` value.

## Configuration

Use Replit Secrets or your host's secret manager. The runtime intentionally
does not load `.env` files.

Required:

- `DISCORD_BOT_TOKEN`: Discord bot token. Existing deployments may continue
  using the legacy `BOT_TOKEN` alias.
- `DISCORD_CLIENT_ID`: the 17-20 digit Discord application ID. Existing
  deployments may continue using the legacy `CLIENT_ID` alias.

The Discord-specific names take precedence when both forms exist. Prefer them
in full-stack hosts such as Google AI Studio, where a generic `CLIENT_ID` may
already refer to an unrelated Google OAuth credential.

Provider credentials:

- `WAIFU_IM_KEY`: API key used with `Authorization: ApiKey ...` and
  `Accept-Version: v7`.
- `NEKOBOT_AUTHORIZATION`: value sent in NekoBot's `Authorization` header.

Optional:

- `COMMAND_REGISTRATION_MODE`: `global` (default), `guild`, or `both`.
- `TESTING_GUILD_ID`: required when registration mode is `guild` or `both`.
- `WAIFU_PICS`: set to `true` to enable the preserved Waifu.pics endpoints;
  default is `false` because that service was disabled in the legacy runtime.
- `MEDIA_TIMEOUT_MS`: provider timeout; default `15000`.
- `MAX_MEDIA_BYTES`: local ceiling; default `10485760` (10 MiB). The runtime
  also respects a lower `attachment_size_limit` sent with an interaction.
- `PREMIUM_USER_IDS`: optional comma-separated Discord user-ID allowlist.
- `RATE_LIMIT_STATE_FILE`: persisted quota state; default
  `.runtime/rate-limits.json`. The containing runtime directory is ignored by
  Git.
- `INSTANCE_LOCK_FILE`: local single-process lease; default
  `.runtime/bot-instance.lock`.
- `INSTANCE_LOCK_STALE_MS`: age after which a lease from an unreachable old
  container can be reclaimed; default `30000`.
- `SHUTDOWN_DRAIN_MS`: time to let active work finish before provider requests
  are cancelled; default `5000`.
- `SHUTDOWN_SETTLE_MS`: additional Discord response settle window; default
  `2000`.
- `SHUTDOWN_HARD_TIMEOUT_MS`: force-close fallback; default `12000`.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `LOG_COLORS`: `auto` (default), `always`, or `never`. Auto mode enables ANSI
  styling in capable terminals and Replit consoles. Standard `FORCE_COLOR` and
  `NO_COLOR` variables are also honored.
- `LOG_FORMAT`: `pretty` (default) or `json` for structured log collectors.
- `CONSOLE_LOG_FILE`: persistent plain-text console capture used by the Replit
  start supervisor; default `logs/discord-bot-console.txt`.

## Run on Replit, Google AI Studio, or Node.js

1. Add the required secrets to the environment.
2. Install dependencies with `npm install`.
3. Run `npm start` or press Replit's **Start bot** button.

No separate command-registration script is needed. The startup sequence does
that automatically before connecting the bot. The normal start command also
mirrors all bot stdout and stderr to `logs/discord-bot-console.txt`; Replit's
visible terminal may truncate old lines, but this file does not.

Create a timestamped snapshot of all captured history at any time with:

```sh
npm run logs:export
```

The command prints the exported `.txt` path. Both the active log and exports
are ignored by Git and created with owner-only permissions. `npm run
start:direct` remains available for diagnostics, but intentionally bypasses
the persistent capture supervisor.

### Google AI Studio Build mode

Add `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` under **Settings → Secrets**.
They are read only by the server-side Node runtime. Build mode may restart the
development server and pre-warm preview paths while code, dependencies, or
secrets change; those lifecycle messages are not Discord errors.

If the preview reports that a dashboard response begins with `<!doctype`, the
backend was unavailable and the preview received its HTML fallback while the
process was restarting. Check the backend log for the first startup error. A
valid `DISCORD_CLIENT_ID` contains digits only; a Google OAuth client ID ending
in `apps.googleusercontent.com` is not interchangeable.

AI Studio's development container is suitable for testing. A published AI
Studio app is a Cloud Run service, while this bot expects one continuously
running Gateway owner. Before production deployment, configure one always-on
instance and a maximum of one instance, or use a dedicated worker host, to
avoid duplicate Gateway consumers and scale-to-zero disconnects.

## Emoji customization

Every UI, command, custom Discord, and terminal emoji is defined in
`src/config/emojis.js`. No presentation glyph is hardcoded elsewhere under
`src/`, so changing that one file updates the complete application consistently.

## Verification

Run:

```sh
npm run validate
```

This performs syntax and text/binary checks, verifies the complete legacy
archive against its source commit, rejects high-level Discord wrappers in the
active runtime, and executes the unit and parity test suites.

See [APIs.md](./APIs.md) for the complete provider contract and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the runtime design. The
[command parity report](./docs/COMMAND_PARITY.md) records every archived media
mapping, and [troubleshooting](./docs/TROUBLESHOOTING.md) covers interaction
acknowledgement errors and deployment performance.

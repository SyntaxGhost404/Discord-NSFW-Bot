# Architecture

## Startup

`index.js` validates configuration, acquires an atomic single-instance lease,
and starts `BotApplication`.

1. `single-instance-lease.js` creates an owner-only lock with an atomic
   create, local PID validation, stale-container recovery, and heartbeat.
2. `command-loader.js` imports every command module and validates its public
   Discord command shape.
3. `command-registration.js` bulk-overwrites the configured global and/or test
   guild command collection.
4. `DiscordGatewayClient` calls `GET /gateway/bot` and opens Gateway v10.
5. After `HELLO`, the client starts randomized heartbeats and sends `IDENTIFY`.
6. Raw `INTERACTION_CREATE` and `MESSAGE_CREATE` dispatches are routed to the
   corresponding brain modules.

There is no manual post-deployment registration command.

## Discord transport

`src/discord/rest-client.js` owns raw HTTP API v10 requests. It serializes calls
per normalized route/major resource, learns shared bucket hashes from Discord,
honors `retry_after` for 429 responses, and tracks global limits. POST requests
use at-most-once delivery by default; idempotent methods retain bounded
transient retries. Interaction/webhook tokens are replaced by one-way
fingerprints in internal keys and redacted templates in logs and errors. The
bot token is never sent to interaction webhook routes.

`src/discord/gateway-client.js` owns the WebSocket lifecycle. It implements
Gateway JSON payloads directly: heartbeat and ACK handling, sequence tracking,
IDENTIFY, READY state, RESUME, RECONNECT, INVALID_SESSION, exponential
reconnect delay, and fatal close-code handling. No compression is requested,
so binary Gateway payloads are treated as a protocol error.

## Terminal logging

`src/lib/logger.js` provides one shared structured terminal format for every
subsystem. Chalk assigns distinct portable ANSI styles to boot, event,
success, informational, warning, error, and debug records. Child loggers retain
their application/subsystem context, errors keep stack traces, Replit and TTY
color support is detected automatically, and JSON output remains available
for external log collectors.

All terminal symbols, embed icons, button emojis, navigation glyphs, bullets,
and custom Discord emoji strings come from `src/config/emojis.js`. Static and
unit checks reject presentation glyphs anywhere else in the active source.

On Replit, `scripts/start-with-logs.mjs` supervises `index.js`, mirrors raw
stdout and stderr to the terminal, strips ANSI controls from the persisted
copy, and appends it to `logs/discord-bot-console.txt`. The active file is never
rotated implicitly, so terminal history is not discarded. `logs:export`
creates point-in-time text snapshots without interrupting the bot.

## Interaction routing

The router handles command, component, autocomplete, and modal interaction
types. Long-running media commands immediately send a deferred callback, then
edit the original interaction response through the webhook endpoint. Refresh
buttons encode only the command option state needed to reproduce a request.

Initial callbacks use at-most-once semantics: the responder locks before the
HTTP request begins and does not retry ambiguous transport or server failures.
A bounded 15-minute interaction-ID cache suppresses replayed Gateway
dispatches. Already-acknowledged and expired interaction codes are treated as
terminal, while legacy `refresh_*` component IDs remain migration-compatible.

`InteractionConflictMonitor` uses callback state and elapsed time to separate a
real three-second expiry from cross-process ownership races. An initial `40060`
or two unusually early `10062` responses prove another live token consumer;
the losing application enters the normal graceful shutdown path. This handles
isolated hosts that cannot see the local single-instance lease and prevents an
endless callback race.

Guild media requests pass both Discord's command-level `nsfw` registration and
a runtime channel check. Direct-message contexts preserve the original bot's
behavior.

## Account quotas

`GlobalRateLimiter` keys usage by Discord user ID only, so DMs, group DMs, and
all guilds share one account quota. Free utility commands have a two-second
cooldown; Premium utility commands have none. Free media has a rolling
60-success window plus a 1,000-success UTC-day cap. Premium removes the minute
limit and has a 5,000-success UTC-day cap.

Media capacity is reserved before any provider request. A reservation commits
only after the original Discord response is successfully edited with media;
all provider, parsing, download, and Discord response failures roll it back.
This provides concurrency safety without charging failed attempts. Successful
usage is atomically persisted to the ignored `.runtime/` directory.

`/premium` renders the current target snapshot with tier-aware Subscribe or
Manage controls. Its emoji-only refresh component stores the target and
original viewer IDs in a bounded custom ID, applies the normal utility
cooldown, acknowledges with a deferred message update, and edits the same
message from a new local quota snapshot.

## Command brain

Each public command has its own file in `src/commands/`. Media command files
explicitly declare their complete source lists and option groups. Shared
execution mechanics—deferral, fallback, embeds, attachments, and refresh
buttons—live in `media-command.js`.

This keeps category ownership visible without copying a large interaction
implementation into every command.

## Provider brain

Each provider has one transport/parser module in `src/brain/providers/`.
Provider calls use bounded timeouts and download limits. A failed provider is
logged and the command tries the next source in its own declared pool.

Provider pools are randomized by default to preserve legacy behavior. Commands
that declare `orderedSources`, currently `/cosplay`, retain strict primary then
fallback order. Its adapters dynamically discover the full feed depth, choose
a fresh random page and feed item without persistent seed or offset state, and
extract media directly from that feed. They never load gallery or album pages.
Downloaded image bytes are re-uploaded as native Discord attachments while the
Link button keeps the validated raw source URL.

The `/buttplug` Real adapter is intentionally cover-feed-only. It discovers the
PornPics item ceiling, chooses one fresh exact offset, and promotes the selected
main thumbnail's CDN path to `/1280/` without opening a gallery. It downloads
that one exact-host asset into bounded memory, rejects undersized or non-image
responses and unsafe redirects, and uploads successful bytes as a native
Discord attachment. The Link button keeps the validated raw `/1280/` URL. If
the CDN returns a datacenter block page, the adapter fails closed and the
normal command fallback may continue; the runtime does not add proxying, TLS
impersonation, speculative probes, or background work. One immediate retry of
the same media URL is permitted only after a transport-level `NETWORK_ERROR`;
it never repeats feed discovery or retries a received response.

Each provider also has an independent consecutive-failure circuit. It opens
for a randomized 30–120 seconds after three failures. Once the interval
elapses, only one genuine user request becomes a half-open probe; concurrent
requests keep skipping that provider. Success closes the circuit and failure
reopens it. No timer generates speculative network traffic.

ABD intentionally reads only `url_japan` and contacts the exact Osaka hostname;
the other response mirrors are ignored and there is no mirror fallback loop.
That one exact hostname may tolerate `CERT_HAS_EXPIRED`, but the raw TLS socket
must still pass hostname identity checking and may not report any other trust
error. Successful bytes are uploaded as a Discord attachment and the upstream
URL is not placed in the embed; the adjacent Link button opens the validated
Osaka media URL directly.

`manifest.js` records endpoint templates and the complete Sex.com niche list.
`APIs.md` records all active parameters and headers in human-readable form.
`COMMAND_PARITY.md` records the archived command-to-provider audit.

## Files and binary safety

The runtime never writes downloaded media to disk. Buffers are held in memory
only long enough to submit a multipart Discord response. `.gitignore` excludes
media, archives, build output, caches, bytecode, crash files, and executable
artifacts. `.gitattributes` marks source/document formats as text.

`scripts/check.mjs` rejects binary extensions and NUL bytes, checks Git's
numstat for binary changes, verifies every archived file against the original
commit, ensures the local `llms-full.txt` reference is untracked, and prevents
high-level Discord wrappers from entering active code.

## Shutdown lifecycle

SIGINT, SIGTERM, fatal Gateway state, uncaught exceptions, and unhandled
rejections enter one idempotent shutdown path. The router first rejects new
work, active requests receive a drain window, remaining provider I/O is
cancelled, Discord responses receive a separate settle window, REST and
Gateway transports close, and quota state flushes. A hard timeout force-closes
both transports if any task refuses to settle. The runtime releases the process
lease only after this sequence finishes, with an idempotent startup-failure
fallback around the application lifecycle.

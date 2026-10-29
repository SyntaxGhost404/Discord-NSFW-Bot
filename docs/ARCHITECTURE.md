# Architecture

The bot is one Cloudflare Worker (`src/index.js`) with two Durable Object
classes and a cron trigger. All Discord traffic uses the raw HTTP API v10 and
Gateway v10; no Discord client library is involved.

```
Discord ──HTTPS POST /interactions──▶ Worker fetch()
                                        │ verify Ed25519, route, UserQuota DO (reserve)
                                        ├─ inline response (help, autocomplete, modal, invite, refusals)
                                        └─ media, /ping, /premium: start the work at once
                                              ├─ ready ≤ ~1.5 s, no file ─▶ the message is the inline response
                                              └─ upload or slower ─▶ deferred response + ctx.waitUntil()
                                                    └─ PATCH /webhooks/{app}/{token}/messages/@original
                                        (media providers: fetch, bounded; quota commit/rollback afterwards)

Cron (every minute) ──▶ Worker scheduled()
                          ├─ sync application commands (once per isolate)
                          └─ DiscordGateway DO per shard ──WebSocket──▶ Discord Gateway
                                ├─ presence (online)
                                └─ MESSAGE_CREATE exact mention ──▶ POST /channels/{id}/messages
```

## Request path

`src/index.js` serves `GET /` (health text) and accepts interactions on
`POST /interactions` (and `POST /`). `src/http/interactions.js`:

1. Rejects the request with `401` unless `X-Signature-Ed25519` verifies over
   the exact `X-Signature-Timestamp` + raw body bytes
   (`src/http/signature.js`, Web Crypto `Ed25519`; the imported key is cached
   per isolate).
2. Parses the interaction and hands it to `InteractionRouter`.
3. Returns the router's response body as JSON and passes any follow-up task
   (a webhook edit, a quota commit) to `ctx.waitUntil()`.

`src/runtime.js` builds the per-isolate objects once per `env`: config,
structured logger, router, circuit breaker, quota client, and REST clients.

## Interaction routing

`src/brain/interaction-router.js` maps commands, components, autocomplete,
and modals to the command modules in `src/commands/` (a static registry in
`src/commands/index.js`, since Workers bundles have no filesystem). Commands
return response descriptors from `src/discord/responses.js`:

- inline: `reply`, `ephemeral`, `updateMessage`, `modal`,
  `autocompleteResult`;
- deferred: `deferred(task)` for commands and `deferredUpdate(task)` for
  components, where `task` runs after the acknowledgement;
- `respondWhenReady(prepare)`, used by media commands, `/ping`, and
  `/premium`, where `prepare` builds the finished message.

For `respondWhenReady`, the router starts `prepare` at once and waits for it
until 1.5 seconds after the request arrived, or 2.4 seconds after Discord
created the interaction, whichever is sooner. A message that is ready by
then and has no file becomes the initial response (a new message for
commands, an in-place update for components), which saves both the loading
state and the follow-up edit. Otherwise the router sends a deferred response
and edits the message in when `prepare` finishes; the work is never started
twice. A message with a file always takes that path, because a file cannot
be sent in the HTTP response, and `prepare` reports when a download starts
(`willUpload`) so the acknowledgement does not wait for it.

Before a command runs, the router applies the NSFW guard
(`src/brain/nsfw-guard.js`) and the quota gate. Deferred tasks are wrapped so
they never reject inside `waitUntil`: a failure edits the loading message into
an error embed, and expired interactions are logged as warnings. Legacy
`refresh_*` button IDs from the original bot still route to the right command
and option.

Deferred responses are processed by Discord after the HTTP reply arrives, so
a very fast follow-up edit could reach Discord first. `InteractionWebhook`
retries `10015`/`10008`/`404` after 250 ms and then 750 ms during the first
five seconds to cover that window, and bounds each edit's timeout to the
30-second `waitUntil` window. Interaction webhooks never carry the bot token.

## Media pipeline

`src/brain/media-command.js` defines every media command from a declarative
source list or option groups. A request:

1. picks the source pool (selected option group, a random group for `/solo`
   and `/threesome`, or all groups) and shuffles it unless the command is
   ordered (`/cosplay`);
2. creates a `MediaHttpClient` (`src/brain/providers/http.js`) with a deadline
   of `MEDIA_DEADLINE_MS` minus a 4-second upload reserve, a per-request
   timeout, a byte ceiling (the smaller of `MAX_MEDIA_BYTES` and the
   interaction's `attachment_size_limit`), and a subrequest budget of
   `MAX_SUBREQUESTS` minus two;
3. tries providers until one returns a usable result, skipping providers whose
   circuit is open and stopping when the deadline or budget is exhausted;
4. builds the message with the embed and Refresh and Link buttons, which the
   router sends as the initial response or as an edit of it; downloaded
   media goes with an edit as a `multipart/form-data` upload referenced as
   `attachment://media.<ext>`.

Sources switched off by `WAIFU_PICS` or `AHOTTIE` are removed from the pool
in step 1, before any request.

The HTTP client streams bodies with a running byte count (compressed bodies
can inflate past `Content-Length`), validates hosts before and after
redirects, distinguishes provider `TIMEOUT` from invocation
`DEADLINE_EXCEEDED`, and, for downloads that will be embedded, identifies the
image by magic bytes so block pages served as `200` are never uploaded. A
provider must send its response headers within 4 seconds (8 for the cosplay
feed pages), so a stalled host fails over without waiting out the full
timeout. `textPrefix()` reads only the start of a file, unpacking gzip on the
way, and cancels the rest of the transfer; `/cosplay` uses it for the site's
image sitemaps. Only
JPEG, PNG, GIF, and WebP are accepted, because Discord embeds only those.
Downloads that match a known "image unavailable" placeholder are rejected,
and `/cosplay` also requires at least 300 pixels in each direction, read from
the image header. It retries with other images, and its Ahottie fallback is
off unless `AHOTTIE=true`.

Downloaded media is uploaded rather than linked whenever Discord would
otherwise have to fetch it after the message is posted. For a linked image,
Discord fills in the size only if it can fetch the image while the message is
being created. Otherwise the message shows a loading spinner until a
background job finishes. The Waifu archive is served too slowly for the first
case, so its originals are uploaded, and they render as soon as the message
appears.

`ProviderCircuitBreaker` opens a provider after three consecutive failures for
a random 30–120 seconds, then lets one real request probe it. Deadline and
budget exhaustion are neutral; the breaker lives in isolate memory, so each
isolate learns independently.

## Media is fetched only for a request

No media, listing, or provider API is read outside a user's request: there
are no prefetches, background refills, or media alarms. The only work after
the response is the user's own request finishing (a webhook edit and the
quota commit). An earlier version kept `/cosplay` links ready in a
`CosplayPool` Durable Object; its class is deleted by the `v3` migration in
`wrangler.jsonc`.

Each isolate keeps a few facts that its own requests learned, in memory
only:

- the PornPics gallery count, for an hour, so later `/buttplug` requests
  skip the category page;
- cosplay image servers that just failed, for ten minutes, and the cosplay
  feed's page count, for an hour;
- the provider circuit breaker below.

The Waifu archive's index is bundled with the code
(`src/brain/providers/waifu-archive-index.js`), because the archive is
frozen. Image bytes are never cached.

## Quotas

`UserQuota` (`src/durable/user-quota.js`) is one SQLite-backed Durable Object
per Discord user ID, holding the state from
`src/brain/rate-limit/quota-state.js`:

- `reserveMedia` checks the minute window and UTC-day cap, counting pending
  reservations, so concurrent requests cannot overshoot;
- `commitMedia` charges a reservation once media was displayed;
  `rollbackMedia` releases it on any failure; unclaimed reservations expire
  after two minutes;
- `consumeUtility` enforces the two-second free utility cooldown;
- `snapshot` feeds `/premium`.

The Worker decides Premium status from `PREMIUM_USER_IDS` and passes it in;
time always comes from the object. `QuotaClient`
(`src/brain/rate-limit/quota-client.js`) bounds each gate call to 1.5 seconds
and fails open, so a slow quota store can never make Discord's three-second
acknowledgement deadline fail.

## Gateway Durable Object

Interactions arrive over HTTP, so the Gateway exists only for what HTTP cannot
deliver: online presence and `MESSAGE_CREATE` for the exact-mention welcome
reply. `DiscordGateway` (`src/durable/discord-gateway.js`) runs one instance
per shard, named `shard-<id>-of-<count>`.

- **Start and keepalive.** The cron trigger calls `ensureRunning` on every
  shard each minute. The object also sets a 30-second alarm that checks
  liveness and reconnects if needed; both count as incoming events, which
  keeps the object far inside the ~70-second idle eviction window.
- **Connection.** It opens an outbound WebSocket with `fetch()` and
  `Upgrade: websocket`, heartbeats on Discord's interval with initial jitter,
  answers heartbeat requests, treats a missed ACK as a zombie connection, and
  reconnects with exponential backoff.
- **Resume.** Session ID, resume URL, and sequence are persisted (the sequence
  every alarm and after each mention reply), so after a restart or deploy the
  object resumes instead of identifying, and replayed events cannot trigger a
  second reply. A resumable reconnect closes with code 4000, because 1000/1001
  would invalidate the session.
- **IDENTIFY budget.** Discord resets the bot token after 1,000 IDENTIFY calls
  in 24 hours. The object refuses to identify after 50 per shard per day, or
  when `GET /gateway/bot` reports fewer than 25 session starts remaining.
- **Fatal codes.** 4004, 4010, 4011, 4012, 4013, and 4014 stop the shard and
  are recorded with a fingerprint of the token, the intents, and the shard
  count; changing any of those clears the stop automatically.
- **Intents.** `GATEWAY_MODE=full` identifies with `GUILD_MESSAGES |
  DIRECT_MESSAGES` (4608). Exact mentions carry their content without the
  privileged `MESSAGE_CONTENT` intent. `presence` identifies with no intents.

## Command registration

`src/brain/command-registration.js` builds the payload from the registry and
compares it with Discord's copy field by field (ignoring server-side defaults
such as IDs, versions, and null localizations). It bulk-overwrites only when
they differ. The cron runs this once per isolate, so a deployment that
changes commands is registered within a minute; `npm run register` does the
same from the command line, and `--force` always overwrites.

## Configuration and logging

`src/config.js` validates `env` once per binding object: snowflakes, the
64-character public key, registration and Gateway modes, and clamped numeric
limits. Legacy `DISCORD_CLIENT_ID`/`CLIENT_ID`/`BOT_TOKEN` names are still
accepted.

`src/lib/logger.js` writes structured objects that Workers Logs indexes, with
an indexed `kind` field (`boot`, `event`, `success`, …). Tokens in interaction
and webhook paths, `Bot …` headers, and sensitive field names are redacted
recursively, including inside errors.

## Files and safety

Media is only ever held in memory for the length of one request. The runtime
code under `src/` imports no Node built-ins and has no npm dependencies.
`scripts/check.mjs` rejects Discord wrappers, Node imports in runtime code,
presentation glyphs outside `src/config/emojis.js`, binary artifacts, tracked
`.dev.vars`, and anything shaped like a bot token.

# Troubleshooting

## Interaction error 40060

`40060: Interaction has already been acknowledged` means Discord received an
initial callback for that interaction before the failing callback arrived.
An interaction may receive only one initial response, and that response must
be sent within three seconds.

The July 10 console sample is conclusive: the interaction snowflakes were
created only about 250 milliseconds before this process routed them, and
Discord rejected its callback roughly 320-360 milliseconds later. That is far
inside the three-second deadline. The bot still produced the visible Discord
response because another live Gateway process using the same `BOT_TOKEN`
acknowledged it first.

The runtime protects this boundary in seven ways:

1. An atomic heartbeat lease prevents a second process in the same Replit
   filesystem from opening another Gateway session. Dead local owners are
   detected by PID; leases from replaced containers expire safely.
2. The responder locks synchronously before starting its callback request.
3. All POSTs default to at-most-once behavior and do not retry ambiguous
   transport or 5xx failures. The first request may have reached Discord even
   if its HTTP response was lost. Explicit Discord 429 rejections still honor
   `retry_after` safely.
4. Interaction IDs are retained for 15 minutes in a bounded 10,000-entry cache
   so a replayed Gateway dispatch cannot execute twice in one process.
5. Discord codes `40060`, `10062` (unknown interaction), and `10015` (expired
   interaction webhook) are terminal and never trigger another callback.
6. Known terminal interaction outcomes are logged as concise diagnostics with
   no exception stack and cannot become unhandled promise rejections.
7. `40060` on an initial callback immediately proves a competing consumer. Two
   sub-2.5-second `10062` responses in one minute provide the same evidence.
   The losing process stops accepting work and gracefully closes its Gateway
   session, leaving the process that successfully responded online.

Every router path and the detached Gateway listener also have a final rejection
boundary, preventing an interaction failure from becoming an unhandled promise
rejection.

Local files cannot coordinate isolated deployment filesystems. Keep exactly
one Replit workspace Run or Deployment active for this token. Stop every old
runner, deployment revision, autoscaled replica, or process on another host,
then start only the intended deployment. If the other process cannot be found,
reset the bot token in Discord's Developer Portal and update only the intended
deployment secret.

## Old refresh buttons

Messages created by the archived bot use IDs such as
`refresh_anal_Anime`, while new messages use compact `m:` IDs. The router
accepts both formats, including the archived style, gender, and threesome
state, so refresh buttons on pre-migration messages continue to work.

Buttons from unrelated or removed versions still receive the ephemeral
message `This interaction is no longer available.` This is intentional.

## Unknown interaction 10062

Discord invalidates an interaction token if the initial callback does not
arrive within three seconds. Media commands defer before making any provider
request, so repeated `10062` errors usually indicate host event-loop stalls,
severe network delay to Discord, or multiple competing processes rather than a
slow media API. The ownership monitor distinguishes sub-2.5-second rejections
from genuine deadline misses and only yields after confirmed conflict evidence.

## N-SFW / ABD images and expired Osaka certificate

The ABD API returns multiple URLs for the same object. By deployment policy,
the provider adapter reads only `url_japan` and ignores every alternate mirror;
there is no fallback loop. The exact Osaka hostname uses a compatibility
downloader that:

1. Performs an independent certificate hostname check.
2. Accepts only the `CERT_HAS_EXPIRED` validation result.
3. Rejects self-signed, untrusted-chain, not-yet-valid, substituted-host, and
   every other TLS condition.
4. Enforces the interaction attachment limit, local byte ceiling, timeout,
   shutdown cancellation, and exact host allowlist.
5. Uploads the result to Discord as a native attachment and gives the adjacent
   Link button the validated Osaka URL.

This preserves native Discord rendering without disabling TLS verification
globally. If the certificate is renewed, the same path accepts the normally
authorized connection without any code or configuration change.

## PornPics images and CDN block pages

The `/buttplug` Real provider resolves one high-resolution PornPics cover and
downloads it once into bounded memory. A successful image is uploaded to
Discord as a native attachment, so Discord never needs to fetch the PornPics
CDN URL to render the embed. The adjacent Link button still opens the original
validated `/1280/` asset.

An occasional `NETWORK_ERROR: fetch failed` means the selected CDN connection
failed before a usable HTTP response arrived. The adapter immediately retries
that same selected media URL once without repeating feed discovery, choosing a
second image, or issuing parallel work. Future diagnostics include the nested
socket or DNS code when Node exposes one, such as `ECONNRESET`. Received HTML
blocks, HTTP statuses, timeouts, invalid redirects, and shutdown cancellation
are not retried.

This only succeeds when the bot host itself receives the image bytes. Some
datacenter networks receive a small HTTP 200 `text/html` “Site Unavailable”
page from `cdni.pornpics.com` even though a residential browser can open the
same URL. The adapter rejects that page and unsafe redirects rather than
uploading invalid data. It does not use proxy pools or transport-identity
bypasses. If logs report a PornPics non-image payload, the hosting network is
still denied by the upstream CDN; use the Anime source or a host the provider
permits until its access policy changes.

## Google AI Studio Build mode

Google AI Studio Build mode runs the project in a managed development
container and may restart the backend or pre-warm preview paths whenever code,
dependencies, or secrets change. `Server restarting`, `Server stopped`,
`Server started`, and `Pre-warming` are platform lifecycle messages.

Configure these server-side secrets under **Settings → Secrets**:

```text
DISCORD_BOT_TOKEN=<Discord bot token>
DISCORD_CLIENT_ID=<17-20 digit Discord application ID>
```

The legacy Replit names `BOT_TOKEN` and `CLIENT_ID` remain supported, but the
Discord-specific names take precedence. This avoids a collision with Google
OAuth credentials commonly also called `CLIENT_ID`. A value ending in
`apps.googleusercontent.com`, a placeholder, or a quoted label is not a
Discord application ID.

`Unexpected token '<'` from a dashboard status fetch means the preview tried
to parse JSON while the backend was unavailable and received an HTML fallback.
Fix the first backend startup error; the preview message is secondary. Do not
weaken credential validation or keep a misconfigured bot process alive merely
to suppress the preview error.

AI Studio publishing creates a Cloud Run service. This Discord bot needs one
continuous Gateway owner, so a production service must not scale to zero or
above one instance. Use one always-on instance with a one-instance maximum, or
run the bot on a dedicated worker host. Build mode itself is appropriate for
temporary testing, but its edit-driven restarts will disconnect and resume the
Gateway normally.

## Persistent Replit console history

`npm start` launches the bot through `scripts/start-with-logs.mjs`. It mirrors
stdout and stderr to the colorized Replit terminal while appending a color-free
copy to:

```text
logs/discord-bot-console.txt
```

The file starts capturing before `index.js` launches and appends a run boundary
on every restart, so older lines remain available after Replit truncates its UI
buffer. To create a timestamped, stable export while the bot is still running:

```sh
npm run logs:export
```

The command prints the resulting path under `logs/exports/`. To choose a custom
relative or absolute destination, run `npm run logs:export -- my-export.txt`.
The active file and snapshots are ignored by Git and use owner-only file
permissions. A command started with `npm run start:direct` is not captured.

## Performance expectations

The raw Discord implementation primarily improves startup time, memory use,
dependency count, and control over acknowledgements. Once a command is
deferred, external provider latency and media download/upload time dominate.

Provider fallback is deliberately sequential. The bot never races several
media APIs for one command, which protects CPU, memory, bandwidth, provider
quotas, and other users. Node's Fetch implementation already pools ordinary
HTTP connections, and media is kept in bounded memory without filesystem or
conversion work.

Consecutive upstream failures now open a provider-specific circuit for 30–120
seconds. Recovery is tested by one real request after that interval; the bot
does not generate background probes. Account quotas are also checked before
provider work, which protects upstreams and host resources without charging
failed media attempts.

If production metrics later show sustained load, the safest next additions
are a bounded media-work queue and latency metrics per provider. Parallel
provider racing and unbounded response caching are not recommended for this
workload.

## Cooldowns and quota state

Free media quota is 60 successful displays per rolling 60 seconds and 1,000
per UTC day. Premium removes the minute ceiling and allows 5,000 per UTC day.
Free utility slash commands use a two-second cooldown. All contexts share the
same user-ID record.

State is persisted to `RATE_LIMIT_STATE_FILE` (default
`.runtime/rate-limits.json`). Keep this path on durable storage if daily limits
must survive deployment replacement. One bot process is expected; multiple
replicas require a shared transactional store before they can coordinate the
same quotas safely.

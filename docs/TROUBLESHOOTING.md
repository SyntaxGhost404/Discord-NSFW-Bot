# Troubleshooting

Start with the logs. `npm run tail` streams them live, and **Workers Logs** in
the Cloudflare dashboard keeps them searchable. Every record is a JSON object
with `level`, `kind`, and `message` fields, so the messages quoted below can be
searched for directly. Set `LOG_LEVEL=debug` for more detail.

## Discord will not save the Interactions Endpoint URL

Before saving the URL, Discord sends one correctly signed `PING` and one
request with an invalid signature. The Worker must answer the first with a
`PONG` and the second with `401`.

1. Open `https://<worker>.workers.dev/` in a browser. It should say "Discord
   NSFW Media Bot is running." If it does not, the Worker is not deployed or
   its `workers.dev` route is disabled.
2. The URL must end in `/interactions` (the bare origin also works). Any other
   path returns `404`.
3. `DISCORD_PUBLIC_KEY` must be the **Public Key** from the Developer Portal's
   General Information page: 64 hexadecimal characters. The bot token, client
   secret, and application ID will not work.
   - Key missing: every POST returns `500`, and the log says
     "DISCORD_PUBLIC_KEY is not configured, so interactions cannot be
     verified."
   - Key malformed, or another setting invalid: every POST returns `500`, and
     the log says "Invalid Worker configuration." with the reason in
     `error.message`.
   - Key from another application: every request, including Discord's valid
     `PING`, gets `401`.
4. `wrangler secret put` takes effect immediately. Save the URL in the portal
   again afterwards.

## "The application did not respond"

Discord shows this when the Worker does not acknowledge an interaction within
three seconds.

- **No Interactions Endpoint URL.** Without one, Discord delivers interactions
  over the Gateway, and this bot answers interactions only over HTTP. Set the
  URL as described above.
- **Invalid configuration.** Every interaction fails while the logs show
  "Invalid Worker configuration." Fix the setting named in `error.message`.
- **Wrong application.** `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, and
  `DISCORD_BOT_TOKEN` must all belong to the same application.

## The reply is stuck on "is thinking…"

The acknowledgement arrived, but the edit with the result did not. Search the
logs for the interaction ID.

- **"Deferred interaction task failed."** The task threw an error, and the bot
  tried to replace the loading message with a generic error. The log includes
  the error.
- **Invocation outcome `exceededCpu`.** On the Workers Free plan an invocation
  is stopped after 10 ms of CPU, background work included. The HTML-scraping
  sources (`/cosplay`, `/buttplug` with the Real style, and Porngifs.tv in
  `/gif`) use the most. A Paid plan removes the limit in practice; see
  [Free vs. Paid plans](../README.md#free-vs-paid-plans).
- **"Discord interaction expired before the follow-up could be delivered."**
  The interaction token was no longer valid (Discord code `10015`, `10008`,
  `10062`, or `40060`), usually because the loading message was deleted.
  This is logged as a warning and needs no action.

## A media command shows an error

The embed text says which case applies:

| Message | Meaning |
| --- | --- |
| Every available media source timed out. Please try again shortly. | A provider exceeded `MEDIA_TIMEOUT_MS`, or the request ran out of `MEDIA_DEADLINE_MS`. |
| The required media provider is not configured. Check the provider secrets. | Every source for the command is disabled. Commands served only by NekoBot (`/4k`, `/gonewild`, `/kitsune`, `/midriff`, `/tentacle`, `/thigh`, and the Real style of `/anal`, `/blowjob`, and `/feet`) need `NEKOBOT_AUTHORIZATION`. |
| No media source returned a usable result. Please try again. | Every source answered, but none produced usable media. |

Each failed attempt is logged as "Media source failed; trying the next
configured source." with the `provider` and an error `code`:

| Code | Meaning |
| --- | --- |
| `HTTP_ERROR` | The provider answered with an error status (`error.status`). |
| `INVALID_RESPONSE` | The expected field was missing, or a download was not a JPEG, PNG, GIF, or WebP image (for example, an HTML block page served with status `200`). |
| `PLACEHOLDER_IMAGE` | The download was a known "image unavailable" stand-in, such as imgbox's "Thumbnail Temporarily Unavailable" picture. |
| `IMAGE_TOO_SMALL` | The image was smaller than the source's minimum size (300 pixels in each direction for `/cosplay`). |
| `UNEXPECTED_HOST` | The provider returned or redirected to a host outside its allowlist. |
| `TOO_LARGE` | The file was larger than `MAX_MEDIA_BYTES` or the server's upload limit. |
| `TIMEOUT` | The provider took longer than its per-request timeout. |
| `DEADLINE_EXCEEDED` | The media request's overall deadline ran out. |
| `BUDGET_EXHAUSTED` | The request used its `MAX_SUBREQUESTS` allowance. |
| `NETWORK_ERROR` | The connection failed before an HTTP response arrived. |
| `CIRCUIT_OPEN` | The provider failed three times in a row and is skipped for 30–120 seconds in this isolate (logged once as "Media provider circuit opened after consecutive failures."). |
| `PROVIDER_DISABLED` | A required secret is missing, or `WAIFU_PICS` or `AHOTTIE` is off. Logged at `debug` level, because both are off by default. |

### N-SFW (ABD) failures

The N-SFW API (`api.n-sfw.com`) and its image host (`data.n-sfw.com`) can fail
independently. If the logs show `TIMEOUT` or `HTTP_ERROR` for `n-sfw.com` on
`data.n-sfw.com` URLs, the image host is struggling; this happened with
CloudFront `504` errors during testing in October 2026. Each N-SFW download is
capped at six seconds so that other providers still have time. While the host
is down, commands served only by N-SFW fail: `/breeding`, `/cages`, `/legs`,
`/petgirls`, `/smothering`, `/socks`, and the Anime style of `/buttplug` and
`/feet`.

### `/cosplay` and dead album covers

Both cosplay feeds link to many images that no longer load. Every cosplay
image is downloaded before it is posted, so the bot checks the real file: the
HTTP status, a JPEG, PNG, GIF, or WebP signature, at least 1 KiB, at least 300
pixels in each direction, and no match with a known placeholder. A rejected
image is replaced with another one, up to three per provider. Set
`LOG_LEVEL=debug` to see each rejection as "Rejected a cosplay image; trying
another." with its `code`.

- **Hentai-cosplay-xxx (primary).** Several of its image servers answer `502`
  for every file. The `CosplayPool` object checks each server before adding
  its links and drops a server for 30 minutes when a download reports it
  down. Without the pool, each retry reads a new random feed page, which
  almost always lands on a working server.
- **Ahottie (fallback, off by default).** Its images are hosted on imgbox. In
  October 2026 imgbox answered every request with the same "Thumbnail
  Temporarily Unavailable" picture, which is rejected as `PLACEHOLDER_IMAGE`.
  Ahottie is therefore skipped unless `AHOTTIE=true`, so `/cosplay` relies on
  Hentai-cosplay-xxx alone and shows the error embed if all three of its
  attempts fail. Turn Ahottie back on only once imgbox serves real images
  again.

`/cosplay` normally answers in about a second, because its links come from
the `CosplayPool` object. If it takes several seconds again, check the logs:

- **"Cosplay pool did not answer in time; reading the feed directly."** or
  **"Cosplay pool call failed; reading the feed directly."** The pool took
  longer than one second or returned an error. The request still works, just
  at the old speed.
- **"Cosplay pool refill failed."** The pool could not read the site, and it
  tries again a minute later. A pool that has run dry is refilled
  automatically once the site answers again.

If a host starts sending a new stand-in picture, add its byte size and SHA-256
to `KNOWN_PLACEHOLDERS` in `src/brain/providers/http.js`:

```sh
curl -s "<image URL>" -o placeholder.bin
wc -c < placeholder.bin
sha256sum placeholder.bin
```

### Sites that refuse Cloudflare's network

Some sites refuse requests from datacenter networks, or answer them with a
block page that still has status `200`. The magic-byte check keeps a block
page from ever being posted, the attempt is logged as `HTTP_ERROR` (often
`403`) or `INVALID_RESPONSE`, and the command moves on to its next source. The
bot does not use proxies or try to get around these blocks. `/buttplug` with
the Real style uses only PornPics, so it fails while PornPics refuses the
Worker.

### Expected noise

- Porngifs IDs have gaps. Up to four random IDs are tried per request, so an
  occasional `porngifs.com` failure is normal.
- Some Porngifs.tv pages contain only WebM clips, which Discord cannot embed.
  Up to three pages are tried, so an occasional `porngifs.tv`
  `INVALID_RESPONSE` is normal.

## Cooldown notices and quotas

Free accounts get 60 media results per rolling minute and 1,000 per UTC day,
plus a two-second cooldown on utility commands. Premium accounts have no
minute limit and get 5,000 per UTC day. Add Premium users to
`PREMIUM_USER_IDS` and redeploy. If you edit the variable in the dashboard
instead, the next `wrangler deploy` overwrites it with the value in
`wrangler.jsonc`.

- **"Quota store did not answer in time; continuing without metering."** or
  **"Quota store call failed; continuing without metering."** A `UserQuota`
  Durable Object call took longer than 1.5 seconds or failed. The request
  continues without quota checks, so a storage problem never blocks commands.
- **`/premium` shows "Usage data is temporarily unavailable".** Same cause; the
  plan is still shown correctly.
- Failed media attempts are never charged. A reservation that is never
  committed (for example, because the invocation was stopped) expires after
  two minutes.

## The bot shows offline or ignores mentions

The Gateway Durable Object starts on the first cron run after a deployment, so
allow a minute. The dashboard should list the `* * * * *` cron under the
Worker's **Settings → Triggers → Cron Triggers**, and **Settings → Trigger
Events → View events** shows recent runs.

- **"Gateway session is not running."** The log's `reason` says why:
  - `GATEWAY_MODE is off`: set `GATEWAY_MODE` to `full` or `presence`.
  - `DISCORD_BOT_TOKEN is not configured`: set the secret.
  - `Discord closed the session with fatal code …`: see the table below.
- **"Discord Gateway stopped after a non-recoverable close."** Discord closed
  the connection with a code that reconnecting cannot fix. The stop is lifted
  on the first cron run after the token, intents, or shard count change.

  | Code | Meaning | Fix |
  | --- | --- | --- |
  | `4004` | Authentication failed (or `GET /gateway/bot` returned `401`). | Update `DISCORD_BOT_TOKEN`. |
  | `4010` | Invalid shard. | Check `GATEWAY_SHARD_COUNT`. |
  | `4011` | Sharding required. | Increase `GATEWAY_SHARD_COUNT`. |
  | `4012` | Invalid API version. | Update the bot. |
  | `4013` | Invalid intents. | Check `GATEWAY_MODE`. |
  | `4014` | Disallowed intents. | Use `GATEWAY_MODE=presence`. The intents used by `full` are not privileged, so this should not occur. |

- **"Refusing to IDENTIFY to protect the bot token."** Discord resets a bot's
  token after 1,000 IDENTIFY calls in 24 hours. Each shard stops identifying
  after 50 in a day, or when Discord reports fewer than 25 session starts
  left, and tries again at `retryAt`. Many IDENTIFY calls mean sessions keep
  dropping. Look at the close codes in "Discord Gateway connection closed."
  entries, and check that no other process (an old deployment, or
  `wrangler dev`) is using the same token.
- **Online, but mentions get no reply.** The welcome card is sent only when
  `GATEWAY_MODE=full` and the message is nothing but the mention (`@Bot`, with
  no other text). The bot needs View Channel, Send Messages, Embed Links, and
  Read Message History in that channel; Discord requires Read Message History
  for replies. Failures are logged as "Could not reply to a bot mention."
  with Discord's error code.

An open Gateway connection keeps its Durable Object active all day (about
10,800 GB-s per day). If that is too much for your plan, use
`GATEWAY_MODE=off`. Commands keep working, but the bot shows offline and does
not answer mentions.

## Commands are missing or out of date

- After a deployment, the next cron run compares the registered commands with
  the code and bulk-overwrites them if anything differs. The log says
  "Refreshed application commands." when it changes something. Run
  `npm run register` to register immediately, or `npm run register -- --force`
  to overwrite even when nothing appears to differ.
- Discord clients cache commands. Reload the client (Ctrl+R) if the list does
  not change.
- Media commands are age-restricted. Discord shows them only to users who are
  18 or older, and only in age-restricted channels, or in DMs after the user
  turns on age-restricted commands in their own settings.
- `COMMAND_REGISTRATION_MODE=guild` or `both` registers into
  `TESTING_GUILD_ID`. Switching back to `global` leaves the guild copies in
  place. Remove them with a bulk overwrite of `[]` to
  `PUT /applications/{application.id}/guilds/{guild.id}/commands`, or they
  will appear twice in that server.

## Old buttons

Refresh buttons on messages posted by the original bot use IDs such as
`refresh_anal_Anime`. They still work, including the saved style, gender, and
threesome type. Buttons from versions that no longer exist get the ephemeral
reply "This interaction is no longer available.", which is intentional.

## Moving from the Node.js/Replit version

- **Stop the old process.** Once the Interactions Endpoint URL is set, Discord
  stops sending interactions over the Gateway, so the old bot can no longer
  answer commands. It still holds its own Gateway session, so it keeps
  showing the bot online, answers every mention a second time, and uses
  IDENTIFY calls from the same daily limit.
- **Settings.** The old `DISCORD_CLIENT_ID`, `CLIENT_ID`, and `BOT_TOKEN` names
  are still accepted. `.env`, `RATE_LIMIT_STATE_FILE`, and the console log
  files are gone; use Worker secrets and Workers Logs instead.
- **Quotas start fresh.** The old `.runtime/rate-limits.json` file is not
  imported. Usage is now kept per user in `UserQuota` Durable Objects.
- **`40060` conflicts are gone.** The old "Interaction has already been
  acknowledged" errors came from two processes reading the same Gateway
  stream. Over HTTP, interactions go only to the endpoint, so there is no
  second consumer to race.

## Local development

- `npm run dev` reads `.dev.vars`, and its values override `wrangler.jsonc`
  `vars`. A missing or incomplete file causes the configuration errors above.
- Calling the local cron route starts the Gateway with the token in
  `.dev.vars`, and the object's alarm keeps it running (local state persists in
  `.wrangler/`). If production uses the same token, add `GATEWAY_MODE=off` to
  `.dev.vars`; otherwise the bot holds two sessions and answers every mention
  twice.
- Discord cannot reach `localhost`. Use a tunnel such as
  `cloudflared tunnel --url http://localhost:8787` and point a test
  application's Interactions Endpoint URL at the tunnel URL plus
  `/interactions`.
- If a deployment fails with a Durable Objects migration error, keep the
  `new_sqlite_classes` migration in `wrangler.jsonc`: new Durable Object
  namespaces must use SQLite storage.

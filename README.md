# Discord NSFW Media Bot for Cloudflare Workers

An age-restricted Discord media bot that runs entirely on Cloudflare Workers.
It talks to Discord directly through HTTP interactions, the HTTP API v10, and
Gateway v10. There is no `discord.js`, Eris, Oceanic, `discord-interactions`, or
other Discord wrapper, and the deployed Worker has no runtime dependencies:
everything uses Web-standard APIs (`fetch`, Web Crypto, `FormData`,
WebSockets) plus Workers bindings.

## How it runs on Workers

- **Interactions over HTTP.** Discord POSTs every slash command, button,
  autocomplete, and modal to the Worker's `/interactions` endpoint. Each
  request's Ed25519 signature is verified with Web Crypto before anything is
  parsed; invalid signatures get `401`, as Discord's endpoint checks require.
- **Answers in the first response.** Help pages, autocomplete, modals,
  invites, NSFW-channel refusals, and cooldown notices are answered inline in
  the HTTP response. Media, `/ping`, and `/premium` start their work at once
  and send the finished message as that same response when it is ready within
  about 1.5 seconds and needs no upload, so most linked media appears with no
  loading state at all. Uploads and slower results acknowledge first (uploads
  as soon as their download starts) and are edited in from
  `ctx.waitUntil()`.
- **A bounded media pipeline.** Each media request tries its command's
  providers in order (shuffled, except `/cosplay`) inside a 24-second deadline
  and a subrequest budget sized for the Workers Free plan. A provider that
  sends no response headers within 4 seconds is dropped for the next one, and
  a per-isolate circuit breaker skips providers that keep failing. Providers
  that no longer work are switched off by a variable and skipped before any
  request (see [Configuration](#configuration)).
- **Quotas in Durable Objects.** Each Discord user has a SQLite-backed
  `UserQuota` Durable Object, so DMs, group DMs, and every server share one
  strongly consistent quota. Capacity is reserved before any provider is
  contacted and charged only when media is actually displayed.
- **Every `/cosplay` album, with nothing to look up.** The bot ships a
  catalog of all ~312,000 albums on the cosplay site
  (`src/brain/providers/cosplay-catalog.txt`), so a request picks a random
  album and image in well under a millisecond and downloads only that image,
  about half a second in total. The site's own listings are too large to
  read within the Free plan's CPU limit, so the catalog is built from them
  ahead of time (see [Refreshing the `/cosplay` catalog](#refreshing-the-cosplay-catalog)).
- **Media is fetched only for a request.** Nothing is prefetched or refreshed
  in the background, and the `/cosplay` catalog is rebuilt only when you run
  its script. Each isolate remembers only small facts its own requests
  learned, such as a gallery's size or an image server that is down.
- **Optional Gateway presence.** A `DiscordGateway` Durable Object keeps one
  outbound Gateway WebSocket per shard so the bot appears online and answers a
  message that is only an @mention with the welcome card. Sessions resume
  across restarts, and IDENTIFY calls are strictly budgeted to protect the
  token.
- **Cron maintenance.** A once-a-minute Cron Trigger keeps the Gateway objects
  running and re-registers application commands whenever a deployment changes
  them.

## Commands

Media commands (all registered as age-restricted):

`/4k`, `/anal`, `/ass`, `/blowjob`, `/boobs`, `/breeding`, `/buttplug`,
`/cages`, `/cosplay`, `/cum`, `/ecchi`, `/ero`, `/feet`, `/fuck`, `/gif`,
`/gonewild`, `/hentai`, `/kitsune`, `/legs`, `/maid`, `/midriff`, `/milf`,
`/neko`, `/paizuri`, `/petgirls`, `/pussy`, `/pussylick`, `/selfie`,
`/smothering`, `/socks`, `/solo`, `/tentacle`, `/thigh`, `/threesome`,
`/uniform`, `/waifu`, and `/yuri`.

Options:

- `/anal`, `/ass`, `/blowjob`, `/boobs`, `/buttplug`, `/feet`, `/thigh`:
  optional `style` (`Anime` or `Real`).
- `/solo`: optional `gender` (`female` or `male`).
- `/threesome`: optional `type` (`fff`, `ffm`, or `mmf`).

Utility commands:

- `/help` — paginated directory, command details, autocomplete, and a fuzzy
  search modal.
- `/invite` — least-permission installation link.
- `/ping` — interaction roundtrip, Discord API latency, Gateway heartbeat,
  edge location, isolate uptime, guild count, and Worker version.
- `/premium [user]` — Free/Premium plan and live remaining quota, with an
  in-place refresh button.

Every media response has **Refresh** and **Link** buttons. Guild media
commands are refused outside age-restricted channels (threads inherit their
parent's setting); DMs follow Discord's own age gate.

## Limits and quotas

- Free accounts: 60 successful media requests per rolling minute and 1,000 per
  UTC day. Premium accounts: no minute ceiling and 5,000 per UTC day.
- Free accounts have a two-second cooldown on utility commands.
- Failed provider attempts and failed Discord edits are never charged.
- Premium membership comes from the `PREMIUM_USER_IDS` allowlist.

## Deploy

Requirements: a Cloudflare account (the Workers Free plan works; see
[Free vs. Paid plans](#free-vs-paid-plans)), Node.js 22.12 or newer, and a
Discord application with a bot user.

1. Install dependencies and sign in to Cloudflare:

   ```sh
   npm install
   npx wrangler login
   ```

2. Store the credentials as Worker secrets. The application ID and public key
   are on the Developer Portal's **General Information** page; the token is on
   the **Bot** page.

   ```sh
   npx wrangler secret put DISCORD_APPLICATION_ID
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put NEKOBOT_AUTHORIZATION
   ```

3. Deploy:

   ```sh
   npm run deploy
   ```

   Wrangler prints the Worker URL, for example
   `https://discord-nsfw-bot.<your-subdomain>.workers.dev`.

4. In the Developer Portal, set **General Information → Interactions Endpoint
   URL** to `https://discord-nsfw-bot.<your-subdomain>.workers.dev/interactions`
   and save. Discord sends a signed PING (and a deliberately invalid one) to
   verify the endpoint before it accepts the URL.

5. Wait up to a minute. The cron trigger registers the commands and starts the
   Gateway session, after which the bot shows as online. To register
   immediately instead, run `npm run register` with the same credentials in
   `.dev.vars` or your shell.

If the same token was previously run by the old Node.js/Replit version, stop
that process. With an Interactions Endpoint URL configured, Discord no longer
delivers interactions over the Gateway, but an old process would still answer
mentions and hold a Gateway session.

## Refreshing the `/cosplay` catalog

`/cosplay` picks from `src/brain/providers/cosplay-catalog.txt`, a list of
every album in hentai-cosplay-xxx.com's image sitemaps. The site adds about
1,300 albums a month, and the catalog includes them after a rebuild, so
refresh it every month or so:

```sh
npm run catalog:cosplay -- --cache ../cosplay-sitemaps
npm run deploy
```

The script reads only the sitemap listings (about 180 MB of gzip from some
700 files), never images, and takes a few minutes. It replaces the catalog
only when every sitemap could be read; a file that the site's index lists but
does not serve is left out with a warning. `--cache` keeps the downloads in a
directory outside the repository for a day, so an interrupted run can resume.
Albums the site has removed since the last build need no action: their
download fails the image check and another album is picked.

## Configuration

Secrets (set with `wrangler secret put`, or in `.dev.vars` locally):

| Name | Required | Purpose |
| --- | --- | --- |
| `DISCORD_APPLICATION_ID` | yes | Application ID (legacy `DISCORD_CLIENT_ID`/`CLIENT_ID` also accepted). |
| `DISCORD_PUBLIC_KEY` | yes | Ed25519 key used to verify interaction requests. |
| `DISCORD_BOT_TOKEN` | yes | Command registration, Gateway session, mention replies, `/ping` (legacy `BOT_TOKEN` accepted). |
| `NEKOBOT_AUTHORIZATION` | for NekoBot | `Authorization` header for nekobot.xyz; without it NekoBot sources are skipped. |

Variables (in `wrangler.jsonc` → `vars`). A provider that stops working is
switched off with its variable rather than removed, so setting the variable
to `"true"` and redeploying brings it back:

| Name | Default | Purpose |
| --- | --- | --- |
| `COMMAND_REGISTRATION_MODE` | `global` | `global`, `guild`, or `both`. |
| `TESTING_GUILD_ID` | empty | Required for `guild` or `both`. |
| `GATEWAY_MODE` | `full` | `full` = online presence + mention replies; `presence` = online only (no message events); `off` = HTTP interactions only. |
| `GATEWAY_SHARD_COUNT` | `1` | Gateway shards; Discord requires sharding past 2,500 servers. |
| `GATEWAY_ACTIVITY` | empty | Optional custom status text. |
| `PREMIUM_USER_IDS` | empty | Comma-separated Premium user IDs. |
| `WAIFU_PICS` | `false` | Turns the Waifu.pics sources back on. Off because the API refuses every connection (October 2026). |
| `AHOTTIE` | `false` | Turns Ahottie back on as the `/cosplay` fallback. Off because its images are hosted on imgbox, which serves only placeholders (October 2026). |
| `MEDIA_TIMEOUT_MS` | `10000` | Per-request provider timeout. |
| `MEDIA_DEADLINE_MS` | `24000` | Total time for a media request, inside the 30 s `waitUntil()` window. |
| `MAX_MEDIA_BYTES` | `10485760` | Largest re-uploaded file; a lower interaction `attachment_size_limit` wins. |
| `MAX_SUBREQUESTS` | `45` | Outbound fetches per media request (Free plan allows 50 per invocation). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

## Free vs. Paid plans

Everything runs on the Workers Free plan, with these trade-offs:

- **CPU:** Free invocations get 10 ms of CPU. JSON providers use about 1–2 ms.
  The scraping sources (`/buttplug` Real, `/gif`) use more, so they read as
  little as possible, and `/cosplay` picks from its bundled catalog in well
  under a millisecond. The Paid plan's 30-second default removes that
  concern.
- **Subrequests:** Free invocations may make 50. `MAX_SUBREQUESTS=45` keeps
  room for the Discord edit; on Paid you can raise it.
- **Gateway duration:** an open Gateway WebSocket keeps its Durable Object
  active around the clock, about 10,800 GB-s per day. That fits the Free
  plan's 13,000 GB-s daily allowance and the Paid plan's 400,000 GB-s monthly
  allowance, but it is most of the Free budget. Use `GATEWAY_MODE=off` for an
  HTTP-only bot (commands still work; the bot shows offline and ignores
  mentions).

## Local development

```sh
cp .dev.vars.example .dev.vars   # then fill in the values
npm run dev                      # http://localhost:8787
curl "http://localhost:8787/cdn-cgi/local/scheduled"   # run the cron once
```

Discord can only reach a public URL, so to receive real interactions locally,
expose port 8787 with a tunnel (for example `cloudflared tunnel --url
http://localhost:8787`) and use that URL plus `/interactions` as the endpoint.

## Testing

```sh
npm test            # Vitest inside workerd (Durable Objects included)
npm run check       # static checks: no Discord wrappers, Workers-safe imports, no binaries or tokens
npm run validate    # both
npm run test:live   # opt-in: real providers and the real Discord API via .dev.vars
```

The default suite never touches the network: credentials are replaced with
test values, outbound `fetch` is mocked strictly, and the Gateway is exercised
against a fake Discord Gateway built from a `WebSocketPair`. `test:live` runs
every provider for real and, when `LIVE_TEST_CHANNEL_ID` is set in
`.dev.vars`, posts the bot's message shapes with harmless content to that
channel and deletes them.

## Logs

`observability` is enabled in `wrangler.jsonc`, so structured JSON logs (with
tokens redacted) appear in **Workers Logs** in the Cloudflare dashboard. Stream
them live with `npm run tail`.

## Emoji customization

Every UI, command, and custom Discord emoji lives in `src/config/emojis.js`.
`npm run check` rejects presentation glyphs anywhere else in `src/`.

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — request flow, Durable
  Objects, Gateway lifecycle, and command registration.
- [APIs.md](./APIs.md) — every provider endpoint, header, and the
  command-to-provider matrix.
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — endpoint
  verification, timeouts, provider outages, Gateway issues.

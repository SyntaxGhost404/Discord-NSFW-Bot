# User Lookup

Look up the public profile of any Discord user by ID. A small web app on the
Cloudflare Workers Free plan, built from Discord's API documentation. Not
affiliated with Discord.

## What it shows

Everything Discord's [Get User](https://discord.com/developers/docs/resources/user#get-user)
route returns to a bot, laid out and explained:

- **Names.** Display name, username, and the legacy discriminator where an
  account still has one.
- **Account type.** User, bot, or Discord's own system account.
- **Created.** The date and time the account was made, read from its ID, and
  how long ago that was.
- **Snowflake.** The ID broken down as the docs describe: timestamp, internal
  worker ID, internal process ID, and increment.
- **Images.** Avatar and banner in every format the CDN offers (PNG, JPG,
  WebP, and GIF and animated WebP for animated ones), each at the largest
  size, 4096. The banner color, and the default avatar Discord would show,
  with its index.
- **Collectibles.** The avatar decoration (with its image, SKU, and expiry)
  and the nameplate (asset, SKU, palette, label, and expiry).
- **Server tag.** The tag, whether it is shown, the server ID, and the badge
  in every format.
- **Display name style.** Font, effect, and colors, when set.
- **Flags.** Every documented public flag, named and drawn as its own icon.
  A bit the docs do not name is shown as an unlisted flag with its number.
- **Other fields.** Anything Discord sends that the docs do not describe
  (such as `banner_color` and `clan`), as it came.
- **Raw JSON.** The full answer, with a copy button.

IDs, usernames, hashes, colors, and the raw JSON each have a copy button.
Every lookup has its own address (`/80351110224678912`), so it can be shared,
and the back button returns to the one before. A pasted mention such as
`<@80351110224678912>` works too.

## How it works

- `public/` is the page: plain HTML, CSS, and JavaScript modules with no build
  step, served as static assets. Any path that is not a file serves
  `index.html`, so lookup links work.
- `src/worker.js` runs only for `/api/*` and answers one route,
  `GET /api/users/<id>`. It checks the ID before anything else (15 to 20
  digits, at most 64 bits, and not dated in the future), then asks
  `https://discord.com/api/v10/users/<id>` with the bot token and the
  `DiscordBot (url, version)` User-Agent the docs ask for.
- The bot token lives in the `DISCORD_BOT_TOKEN` secret and never reaches the
  browser. The bot does not need to join any server or have any intents.
- Profiles are kept for 5 minutes and IDs without an account for 1 minute,
  in Cloudflare's cache and in the browser, so repeat lookups do not ask
  Discord again.
- Each visitor gets 20 lookups a minute per Cloudflare location (the Rate
  Limiting binding in `wrangler.jsonc`), so nobody can spend the bot's
  Discord limits.
- When Discord answers 429 the Worker waits as long as it says, and when it
  rejects the token the Worker stops asking for a minute. Answers with 401,
  403, or 429 count toward Discord's temporary IP ban (10,000 in 10 minutes),
  so they are never repeated blindly.
- Each lookup is one request to Discord and a few milliseconds of CPU, well
  within the Free plan (100,000 requests a day, 10 ms CPU per request, 50
  subrequests).

## When things go wrong

The page says what happened instead of a catch-all error, and offers Try again
only where that can help:

- An empty entry, something that is not a number, a number too large to be an
  ID, or an ID dated in the future, each named, without asking Discord.
- "No account has this ID", which also covers IDs of servers, channels, and
  messages, and deleted accounts.
- Too many lookups from one visitor, or Discord limiting the bot, with how
  long to wait.
- A missing or rejected bot token.
- Discord refusing, failing, taking too long, or sending an answer that cannot
  be read; offline; and no connection.

## Deploy

You need Node.js 22.12 or newer, a Cloudflare account (Free is enough), and a
Discord application with a bot.

1. In the [Discord Developer Portal](https://discord.com/developers/applications),
   create an application, open **Bot**, and copy its token.
2. Then:

```sh
npm ci
npx wrangler login
npx wrangler secret put DISCORD_BOT_TOKEN
npm run deploy
```

Wrangler prints the app's `workers.dev` address. The Rate Limiting binding's
`namespace_id` (`1001`) must be unique within your Cloudflare account; change
it in `wrangler.jsonc` if another Worker already uses it.

## Development

Put the token in `.dev.vars` (never committed):

```sh
DISCORD_BOT_TOKEN=your-bot-token
```

```sh
npm run dev       # local server at http://localhost:8787
npm test          # Worker and page tests in workerd
npm run check     # static checks
npm run validate  # both
```

Tests use a placeholder token and mock every request to Discord, so they never
reach it. `npm run check` enforces the app's rules: no en or em dashes and no
emoji in any file, no accent colors in the banned hues (pink, purple, violet,
blue, and orange), no `innerHTML` or similar APIs, only local scripts in the
page, no hosts beyond Discord's API and CDN, and no secrets in files that
would be committed.

## Privacy and safety

- The page loads only its own files. Its Content Security Policy allows
  scripts and styles from the app alone and images only from
  `cdn.discordapp.com`. There are no third-party scripts, web fonts, or
  analytics.
- Images load straight from Discord's CDN, without a referrer.
- Only public profile data is shown: what Discord's API gives any bot. No
  user tokens are used, and nothing is stored beyond the short caches above.
- Pages ask search engines not to index them, and the app cannot be framed.

## Limits

- Discord's API gives bots a user's public profile only. Status, activity,
  bio, connections, and server membership need a shared server, the gateway,
  or a user token, and are out of scope.
- The docs give no image address for nameplates, so a nameplate is shown as
  data only.
- Flags the docs do not name are shown by bit number, not guessed.

## Design notes

- **Onyx-inspired.** A near-black background with neutral surfaces a few
  steps apart, white for the primary action, and one green accent for focus.
  No shadows, glows, blur, or floating cards.
- **Continuous curvature.** Every container, card, input, button, chip,
  avatar, and thumbnail has squircle corners. Browsers that support
  `corner-shape: squircle` draw them natively; elsewhere each element gets
  the same shape as a clip path that follows its size
  (`public/js/squircle-path.js`).
- **Icons and copy.** Inline SVG icons drawn for this app, the system font,
  and short labels.

## License

[MIT](LICENSE)

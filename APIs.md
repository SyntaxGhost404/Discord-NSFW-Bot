# Media providers

This file lists every provider endpoint, parameter, and header the bot uses,
and which commands use them. Each media command declares its sources in its
own module under `src/commands/`; the adapters live in `src/brain/providers/`.

## How requests run on Workers

Every provider request goes through `MediaHttpClient`
(`src/brain/providers/http.js`):

- **Time.** Each request has a timeout of `MEDIA_TIMEOUT_MS` (10 s by default).
  The whole media request must finish within `MEDIA_DEADLINE_MS` (24 s) minus
  4 s kept back for the Discord upload, inside the 30-second `waitUntil()`
  window.
- **Subrequests.** A media request may make `MAX_SUBREQUESTS` (45) outbound
  fetches minus two kept back for Discord. The Free plan allows 50 per
  invocation.
- **Size.** Bodies are streamed with a running byte count: 1 MiB for JSON,
  2 MiB for HTML (3 MiB for the cosplay feeds, 512 KiB for PornPics offset
  JSON). Downloads are capped at the smaller of `MAX_MEDIA_BYTES` and the
  interaction's `attachment_size_limit`.
- **Hosts.** Where an adapter declares allowed hosts, they are checked before
  the request and again after redirects.
- **Images.** A download that will be uploaded must start with JPEG, PNG, GIF,
  or WebP magic bytes, whatever its `Content-Type` says, because Discord embeds
  only those formats. This also keeps HTML block pages served with status
  `200` from being posted.
- **Delivery.** URL results are put straight into the embed and Discord fetches
  them. Downloaded results are uploaded with the edit as `media.<ext>` and
  referenced as `attachment://media.<ext>`. The Link button always opens the
  provider's URL.
- **Credentials.** Only NekoBot and Waifu.im receive a secret, and only in
  their own headers. Media hosts never receive credentials, and the Discord bot
  token is never sent to a provider.

Failures fall through to the command's next source. See
[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md#a-media-command-shows-an-error)
for the error codes.

## Purrbot

`GET https://api.purrbot.site/v2/img/nsfw/{category}/{format}`, embedded by
URL. The response must have no `error` and a `link`. The original bot used the
deprecated `https://purrbot.site/api/img/...` host; the paths are unchanged.

Paths used: `anal/gif`, `blowjob/gif`, `cum/gif`, `fuck/gif`, `neko/gif`,
`neko/img`, `pussylick/gif`, `solo/gif`, `solo_male/gif`,
`threesome_fff/gif`, `threesome_ffm/gif`, `threesome_mmf/gif`, and
`yuri/gif`.

## N-SFW.com (ABD)

Base URL `https://api.n-sfw.com`. No API key.

`GET /nsfw/{category}` returns one random image object (`type` is the
category; uploads are limited to JPEG, PNG, and GIF):

```json
{
  "uploaded": "2026-10-03T11:27:58.514Z",
  "name": "a04f846ae997….png",
  "original_name": "a04f846ae997….png",
  "type": "{category}",
  "nsfw": true,
  "verified": true,
  "sha256": "a04f846ae997…",
  "mime": "image/png",
  "size": 2555086,
  "width": 1920,
  "height": 1080,
  "animated": false,
  "file": "a04f846ae997….png",
  "url": "https://data.n-sfw.com/nsfw/{category}/a04f846ae997….png"
}
```

The adapter (`src/brain/providers/abd.js`):

- accepts the response only from `api.n-sfw.com`;
- requires `url` to be plain HTTPS on exactly `data.n-sfw.com`, with a path
  under `/nsfw/`;
- rejects a `mime` Discord cannot embed, and a `size` above the download cap,
  without downloading anything;
- downloads the file from `data.n-sfw.com` only, within 6 s (or
  `MEDIA_TIMEOUT_MS` if that is lower), and requires at least 1 KiB that
  passes the image check;
- uploads it as an attachment and gives the Link button the `data.n-sfw.com`
  URL.

Downloading rather than embedding the URL means a slow or failing image host
is noticed in time to fall back, instead of producing an embed that never
loads. The API's other endpoints (`/endpoints`, `/many/…`,
`/many-optimized/…`, `/recent`, `/upload`) are not used.

Categories used: `anal`, `ass`, `blowjob`, `breeding`, `buttplug`, `cages`,
`ecchi`, `feet`, `legs`, `masturbation`, `milf`, `neko`, `paizuri`,
`petgirls`, `selfie`, `smothering`, `socks`, and `yuri`.

## Waifu.im

`GET https://api.waifu.im/images?IncludedTags={tag}&IsNsfw=True` with
`Accept-Version: v7`, embedded by URL from `items[0].url`. When
`WAIFU_IM_KEY` is set, `Authorization: ApiKey {WAIFU_IM_KEY}` is added;
anonymous requests also work.

Tags used: `ass`, `ecchi`, `ero`, `hentai`, `maid`, `milf`, `oppai`, `oral`,
`paizuri`, `selfies`, `uniform`, and `waifu`.

## Waifu.pics

`GET https://api.waifu.pics/nsfw/{category}`, embedded by URL from `url`.
Disabled unless `WAIFU_PICS=true`, as in the original deployment; disabled
sources are skipped without a request.

Categories used: `blowjob`, `neko`, and `waifu`.

## Sex.com

`GET https://www.sex.com/portal/api/gifs/search` with:

- `sexual-orientation=straight`
- `order=likeCount`
- `search={random niche}`
- `page={random 1–10}`
- `limit=40`
- `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36`

A random item from `data` is used: its `uri`, with a final `.webp` changed to
`.gif`, is appended to `https://imagex1.sx.cdn.live` and embedded by URL. The
Link button opens `https://www.sex.com/pin/{id}/`.

Niches: `Amateur`, `Anal`, `Asian`, `Big Tits`, `Blonde`, `Blowjob`,
`Brunette`, `Creampie`, `Cumshot`, `Hardcore`, `Latina`, `Lesbian`, `MILF`,
`Masturbation`, `Threesome`, `Ass`, `BBW`, `BDSM`, `Double Penetration`,
`Ebony`, `Female Ejaculation`, `Fisting`, `Footjob`, `Gangbang`, `Hairy`,
`Handjob`, `Hentai`, `Lingerie`, `Public Sex`, `Pussy`, and `Toys`.

## Oboobs.ru and Obutts.ru

| | Oboobs | Obutts |
| --- | --- | --- |
| Random | `http://api.oboobs.ru/boobs/0/1/random/` | `http://api.obutts.ru/butts/0/1/random/` |
| By ID | `http://api.oboobs.ru/boobs/get/{id}/` | `http://api.obutts.ru/butts/get/{id}/` |
| Media | `http://media.oboobs.ru/{preview}` | `http://media.obutts.ru/{preview}` |

The first array item supplies `id` and `preview`; the media URL is embedded
directly. These services only offer plain HTTP. Nothing secret is sent.

## NekoBot.xyz

`GET https://nekobot.xyz/api/image?type={type}` with
`Authorization: {NEKOBOT_AUTHORIZATION}`, embedded by URL from `message` when
`success` is `true`. Without the secret, NekoBot sources are skipped.

Types used: `4k`, `anal`, `ass`, `blowjob`, `boobs`, `feet`, `gonewild`,
`hass`, `hboobs`, `hentai`, `hentai_anal`, `hkitsune`, `hmidriff`, `hthigh`,
`hyuri`, `lewdneko`, `paizuri`, `pgif`, `pussy`, `tentacle`, and `thigh`.

## Nekos API v4

`GET https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags={tag}`,
embedded by URL from `[0].url`.

Tags used: `anal`, `catgirl`, `maid`, `masturbating`, `pussy`, `threesome`,
and `yuri`.

## Porngifs.com

`GET https://cdn.porngifs.com/img/{id}` with a random `id` from 1 to 39,239
and the headers `Accept: image/*`, `Referer: https://porngifs.com/`, and a
browser `User-Agent`. Only `cdn.porngifs.com` is allowed, the body must be
over 1 KiB and pass the image check, and the file is uploaded as an
attachment. Some IDs are gaps, so up to four IDs are tried; the provider stops
early when the deadline or subrequest budget runs out.

The original bot resolved `porngifs.com` and connected with a custom TLS
server name. Workers `fetch` has no such option, and the CDN serves
`cdn.porngifs.com` directly over HTTPS with a valid certificate, so the request
is now a plain `fetch`.

## Porngifs.tv

`GET https://porngifs.tv/?action=ajax&mode=async&function=get_block&block_id=list_videos_most_recent_videos&sort_by=post_date&from={page}`
with a random `page` from 1 to 2,603, `X-Requested-With: XMLHttpRequest`, and
a browser `User-Agent`.

`data-webp` values ending in `.webp` or `.gif` are collected; the feed's
`.webm` clips are ignored because Discord cannot embed them. One is chosen at
random, downloaded from `porngifs.tv` or a subdomain, checked, and uploaded
as an attachment. Up to three pages are tried.

## Cosplay feeds

`/cosplay` tries Hentai-cosplay-xxx first and Ahottie only if it fails. Both
read the feed's page count, pick a random page, choose one image on it,
download it, and upload it as an attachment. Gallery and album pages are never
opened.

### Hentai-cosplay-xxx.com

Feed: `https://hentai-cosplay-xxx.com/search/page/{page}/`.

The page count comes from the `a.last` pagination link, falling back to the
highest page link. Images are taken only from `ul#image-list`, preferring
`data-original`/`data-full`, then the largest `srcset` entry, then lazy and
plain `src` attributes. `/p={width}/` and `/p={width}x{height}/` resize
segments are removed. Only HTTPS images on `hentai-cosplay-xxx.com` and its
subdomains are accepted. The download sends
`Referer: https://hentai-cosplay-xxx.com/`, because the image CDN refuses
hotlinks without it.

### Ahottie.top

Feed: `https://ahottie.top/tags/Cosplay?page={page}`.

The page count is the highest `page=` value on the first page. Images are
taken only from inside `/albums/…` links, scanning a bounded window after
each link so that pages over a megabyte stay cheap on CPU. Imgbox thumbnails
(`thumbsN.imgbox.com/…_t.jpg`) are promoted to their originals
(`imagesN.imgbox.com/…_o.jpg`), and only Imgbox hosts are downloaded from.

## PornPics.com

`/buttplug` with the Real style uses PornPics; Anime uses N-SFW `buttplug`.
Without a style, both are tried in random order.

1. `GET https://www.pornpics.com/butt-plug/` and read `P_MAX`, which counts
   rotator pages of ten galleries each.
2. Pick a random offset from `0` to `P_MAX * 10 - 1`. The first 20 offsets are
   read from the cover images already on that page. Higher offsets, or a
   missing cover, use one request to
   `https://www.pornpics.com/butt-plug/?offset={offset}` and take `t_url_460`,
   or else `t_url`, from the first JSON item.
3. Accept only HTTPS covers on exactly `cdni.pornpics.com`, rewrite the
   `/300/` or `/460/` size segment to `/1280/`, and download that with
   `Referer: https://www.pornpics.com/butt-plug/`. A `NETWORK_ERROR` is retried
   once on the same URL; nothing else is retried.
4. Upload the image as an attachment; the Link button opens the `/1280/` URL.

Individual gallery pages are never requested. PornPics may refuse datacenter
networks; the image check rejects block pages, and no proxy or workaround is
used.

## Commands and their sources

Sources are tried in random order until one works, except `/cosplay`, which
keeps its order. When a style command (`style: Anime`/`Real`) is used without
the option, the sources of both styles are combined. `/solo` and `/threesome`
without an option pick one group at random, including a Nekos API group that
is only reachable that way.

| Command | Option | Sources |
| --- | --- | --- |
| `/4k` | | NekoBot `4k` |
| `/anal` | `style: Anime` | Purrbot `anal/gif`, N-SFW `anal`, NekoBot `hentai_anal`, Nekos API `anal` |
| `/anal` | `style: Real` | NekoBot `anal` |
| `/ass` | `style: Anime` | N-SFW `ass`, Waifu.im `ass`, NekoBot `hass` |
| `/ass` | `style: Real` | Obutts, NekoBot `ass` |
| `/blowjob` | `style: Anime` | Purrbot `blowjob/gif`, Waifu.pics `blowjob`, N-SFW `blowjob`, Waifu.im `oral` |
| `/blowjob` | `style: Real` | NekoBot `blowjob` |
| `/boobs` | `style: Anime` | Waifu.im `oppai`, NekoBot `hboobs` |
| `/boobs` | `style: Real` | Oboobs, NekoBot `boobs` |
| `/breeding` | | N-SFW `breeding` |
| `/buttplug` | `style: Anime` | N-SFW `buttplug` |
| `/buttplug` | `style: Real` | PornPics |
| `/cages` | | N-SFW `cages` |
| `/cosplay` | | Hentai-cosplay-xxx, then Ahottie |
| `/cum` | | Purrbot `cum/gif` |
| `/ecchi` | | N-SFW `ecchi`, Waifu.im `ecchi` |
| `/ero` | | Waifu.im `ero` |
| `/feet` | `style: Anime` | N-SFW `feet` |
| `/feet` | `style: Real` | NekoBot `feet` |
| `/fuck` | | Purrbot `fuck/gif` |
| `/gif` | | Sex.com, Porngifs.com, NekoBot `pgif`, Porngifs.tv |
| `/gonewild` | | NekoBot `gonewild` |
| `/hentai` | | Waifu.im `hentai`, NekoBot `hentai` |
| `/kitsune` | | NekoBot `hkitsune` |
| `/legs` | | N-SFW `legs` |
| `/maid` | | Waifu.im `maid`, Nekos API `maid` |
| `/midriff` | | NekoBot `hmidriff` |
| `/milf` | | N-SFW `milf`, Waifu.im `milf` |
| `/neko` | | Purrbot `neko/gif`, Purrbot `neko/img`, Waifu.pics `neko`, N-SFW `neko`, Nekos API `catgirl`, NekoBot `lewdneko` |
| `/paizuri` | | N-SFW `paizuri`, Waifu.im `paizuri`, NekoBot `paizuri` |
| `/petgirls` | | N-SFW `petgirls` |
| `/pussy` | | Nekos API `pussy`, NekoBot `pussy` |
| `/pussylick` | | Purrbot `pussylick/gif` |
| `/selfie` | | N-SFW `selfie`, Waifu.im `selfies` |
| `/smothering` | | N-SFW `smothering` |
| `/socks` | | N-SFW `socks` |
| `/solo` | `gender: female` | Purrbot `solo/gif`, N-SFW `masturbation` |
| `/solo` | `gender: male` | Purrbot `solo_male/gif` |
| `/solo` | none (random group) | Nekos API `masturbating` |
| `/tentacle` | | NekoBot `tentacle` |
| `/thigh` | `style: Anime` | NekoBot `hthigh` |
| `/thigh` | `style: Real` | NekoBot `thigh` |
| `/threesome` | `type: fff` | Purrbot `threesome_fff/gif` |
| `/threesome` | `type: ffm` | Purrbot `threesome_ffm/gif` |
| `/threesome` | `type: mmf` | Purrbot `threesome_mmf/gif` |
| `/threesome` | none (random group) | Nekos API `threesome` |
| `/uniform` | | Waifu.im `uniform` |
| `/waifu` | | Waifu.pics `waifu`, Waifu.im `waifu` |
| `/yuri` | | Purrbot `yuri/gif`, N-SFW `yuri`, NekoBot `hyuri`, Nekos API `yuri` |

`test/commands.test.js` asserts this exact mapping, and
`npm run test:live` calls every distinct source for real.

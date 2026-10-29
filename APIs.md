# Media providers

This file lists every provider endpoint, parameter, and header the bot uses,
and which commands use them. Each media command declares its sources in its
own module under `src/commands/`; the adapters live in `src/brain/providers/`.

## How requests run on Workers

Every provider request goes through `MediaHttpClient`
(`src/brain/providers/http.js`):

- **Time.** Each request has a timeout of `MEDIA_TIMEOUT_MS` (10 s by default),
  and a provider must start answering (send its response headers) within 4 s,
  or 8 s for the cosplay feed pages, which the site builds slowly. A stalled
  host therefore fails over after 4 s instead of 10, while a large download
  that has started is not cut short. The whole media request must finish
  within `MEDIA_DEADLINE_MS` (24 s) minus 4 s kept back for the Discord
  upload, inside the 30-second `waitUntil()` window.
- **Subrequests.** A media request may make `MAX_SUBREQUESTS` (45) outbound
  fetches minus two kept back for Discord. The Free plan allows 50 per
  invocation.
- **Size.** Bodies are streamed with a running byte count: 1 MiB for JSON,
  2 MiB for HTML (3 MiB for the cosplay feeds, 512 KiB for PornPics offset
  JSON). The cosplay sitemaps are read only up to their first 96 KiB,
  unpacked on the way, and the rest of the transfer is cancelled. Downloads
  are capped at the smaller of `MAX_MEDIA_BYTES` and the interaction's
  `attachment_size_limit`.
- **Hosts.** Where an adapter declares allowed hosts, they are checked before
  the request and again after redirects.
- **Images.** A download that will be uploaded must start with JPEG, PNG, GIF,
  or WebP magic bytes, whatever its `Content-Type` says, because Discord embeds
  only those formats. This also keeps HTML block pages served with status
  `200` from being posted. A download that matches a known "image
  unavailable" placeholder (`KNOWN_PLACEHOLDERS` in `http.js`, matched by size
  and SHA-256) is rejected too, and an adapter can require a minimum pixel
  size, read from the image header without decoding it.
- **Delivery.** URL results are put straight into the embed and Discord fetches
  them. When such a result is ready within about 1.5 seconds, it is the
  interaction's initial response, so it appears without a loading state.
  Downloaded results are uploaded with an edit as `media.<ext>` and
  referenced as `attachment://media.<ext>`; their loading message is sent as
  soon as the download starts. The Link button always opens the provider's
  URL.
- **Switched-off providers.** Waifu.pics (`WAIFU_PICS`) and Ahottie
  (`AHOTTIE`) are off by default because they no longer work. Their sources
  are dropped from a command's list before anything is requested, and each
  can be turned back on by setting its variable to `"true"`.
- **Credentials.** Only NekoBot receives a secret, and only in its own
  header. Media hosts never receive credentials, and the Discord bot
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

## Waifu archive (self-hosted Waifu.im library)

Waifu.im shut down on 17–18 October 2026. Its sources now use a self-hosted
copy of the full Waifu.im library: 4,279 images from the maintainer's final
database export, stored in R2 and served by the `waifu-im-shim` Worker. No key
is needed.

`GET https://waifu-im-shim.trinitymoin.workers.dev/images?IncludedTags={tag}&IsNsfw=True`
returns up to five random matches in the Waifu.im v7 shape:

```json
{ "items": [{ "id": 337, "url": "https://waifu-im-shim.trinitymoin.workers.dev/337.jpeg", "is_nsfw": true }] }
```

The archive is frozen, so the bot ships an index of it
(`src/brain/providers/waifu-archive-index.js`, generated from the export by
`scripts/build-waifu-archive-index.mjs`): the 3,025 NSFW images under the 12
tags the bot uses, with each file's size. The adapter
(`src/brain/providers/waifu-archive.js`) picks a random indexed image that is
small enough to upload and downloads it straight from
`https://waifu-im-shim.trinitymoin.workers.dev/{id}.{ext}`, so no search
request is needed. If that file is missing (`404`), too large, not an image,
or a known placeholder, the adapter falls back to the search above. From the
search it accepts only items whose `url` is HTTPS on the archive's own host
with an `/{id}.{ext}` image path, and tries them in order on the same terms.
A timeout or `5xx` error stops at once, because the archive itself is
struggling. The original bytes are uploaded unchanged, and the Link button
opens the file on the archive. The archive ignores `Accept-Version` and
`Authorization`, so neither is sent.

The file is uploaded rather than linked because of how Discord renders
linked images. Discord fills in a linked image's size only if it can fetch
the image while the message is being created. NekoBot and Purrbot images
manage that, but archive images never did, so their messages showed a loading
spinner until a background job finished. That took about 4 seconds in tests
and up to minutes in practice. An uploaded image is sized and served by
Discord's own CDN, so it renders as soon as the message appears.

Tags used, with the number of NSFW images each has in the archive: `ass`
(414), `ecchi` (2,138), `ero` (3,014), `hentai` (883), `maid` (191), `milf`
(468), `oppai` (956), `oral` (145), `paizuri` (146), `selfies` (178),
`uniform` (274), and `waifu` (3,024).

## Waifu.pics

`GET https://api.waifu.pics/nsfw/{category}`, embedded by URL from `url`.
Disabled unless `WAIFU_PICS=true`, as in the original deployment; disabled
sources are skipped without a request. In live tests in October 2026 every
connection to `api.waifu.pics` failed.

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

`/cosplay` uses Hentai-cosplay-xxx. Ahottie is a fallback that is off unless
`AHOTTIE=true`, because its images are currently dead (see below). Each
chooses a random image, downloads it, and uploads it as an attachment.
Gallery and album pages are never opened, and nothing is read before a user
asks.

Many album covers on both feeds are dead, so every download is checked before
it is used. It must be a JPEG, PNG, GIF, or WebP of at least 1 KiB, at least
300 pixels in each direction, and not a known placeholder. A rejected image
is replaced by another one, up to three images per provider, and only then
does the command move on. The rejections are logged at `debug` level as
"Rejected a cosplay image; trying another."

### Hentai-cosplay-xxx.com

The site lists every image in gzip-compressed image sitemaps
(`robots.txt` → `sitemap_index_images_detail.xml` →
`https://hentai-cosplay-xxx.com/sitemap_images_detail_{file}.xml.gz`, 708
files of about 500 albums each, in upload order). Each image entry carries
twelve language links, a title, and a caption, so a file unpacks to 4–16 MB
of XML, and unpacking one costs 4–17 ms of CPU: more than a Free-plan request
may use, so the bot cannot read whole files while a user waits.

**Album catalog (main path).** `npm run catalog:cosplay`
(`scripts/build-cosplay-catalog.mjs`) reads every sitemap once and writes
`src/brain/providers/cosplay-catalog.txt`, the list of every album. Image
URLs follow `https://static{n}.hentai-cosplay-xxx.com/upload/{yyyymmdd}/{group}/{album}/{number}.{ext}`,
so an album needs only its server, date, group, ID, and image numbers: about
10 bytes. The sitemaps split large albums into entries of 100 images; those
count once. The script reads listings only, never images. The catalog built
on 29 October 2026 holds 312,399 albums and 12.5 million images in 3.3 MB.

The catalog ships as a text module, so it is never parsed as code. A request
picks a random album, every album equally likely, and a random image in it,
which costs well under a millisecond of CPU (it decodes one line of at most
32 albums). It downloads that image with
`Referer: https://hentai-cosplay-xxx.com/`, because the image CDN refuses
hotlinks without it, and checks it as below. No listing is read. In a live
test on 29 October 2026, 15 of 15 requests delivered a photo with a single
request each, with a median of 0.39 seconds (the sitemap method below: 0.94
seconds), from albums uploaded between 2016 and 2025.

The site adds about 1,300 albums a month; they appear once the catalog is
rebuilt (see [Refreshing the /cosplay catalog](./README.md#refreshing-the-cosplay-catalog)).
An album the site has removed fails the download check, and another one is
picked. If two catalog images in one request are gone from the site, the
catalog is probably out of date: the rest of that request reads the live
sitemaps and logs "Cosplay catalog images are missing on the site; reading
the sitemaps instead."

**Live sitemaps (fallback).** The provider picks a random file from 1 to 708,
reads only its first 96 KiB of XML (a few KB of gzip), and cancels the
transfer. It takes the `<image:loc>` URLs, removes `/p={width}/` and
`/p={width}x{height}/` resize segments, keeps only HTTPS images on
`hentai-cosplay-xxx.com` and its subdomains, and downloads one at random. The
files are cached at Cloudflare's edge and answer in about 0.2–0.6 seconds,
but a prefix reaches only each file's first ten or so albums, about 2% of
the site.

**Feed pages (last resort).** If no sitemap can be read, or one lists no
usable image, the provider reads feed pages instead and logs "Cosplay
sitemaps are unavailable; reading feed pages instead." A feed page is built
on demand and takes 0.5–4.5 seconds. The feed is `https://hentai-cosplay-xxx.com/search/page/{page}/`,
with page 1 requested at its final address,
`https://hentai-cosplay-xxx.com/search/` (the numbered address redirects
there, and every redirect hop counts as a subrequest). The page count comes
from the `a.last` pagination link, falling back to the highest page link,
and is remembered for an hour. Images are taken only from `ul#image-list`,
preferring `data-original`/`data-full`, then the largest `srcset` entry, then
lazy and plain `src` attributes.

The images are spread over 17 image servers (`static`, `static2`, …,
`static17`). Earlier in October 2026, four of them (`static10`, `static11`,
`static13`, and `static15`) answered `502` for all or nearly all files. When
a download fails that way, the server is skipped for ten minutes, and the
next image comes from an album on another server.

### Ahottie.top

Feed: `https://ahottie.top/tags/Cosplay?page={page}`.

The page count is the highest `page=` value on the first page. Images are
taken only from inside `/albums/…` links, scanning a bounded window after
each link so that pages over a megabyte stay cheap on CPU. Imgbox thumbnails
(`thumbsN.imgbox.com/…_t.jpg`) are promoted to their originals
(`imagesN.imgbox.com/…_o.jpg`), and only Imgbox hosts are downloaded from.
Retries use other images from the page already read, because each page is
over a megabyte of HTML.

In October 2026 imgbox answered every tested image, thumbnail or original,
with the same 8,091-byte, 240×240 "Thumbnail Temporarily Unavailable" JPEG,
and `imgbox.com` itself reported "under heavy load". Ahottie is therefore
disabled by default, the same way as Waifu.pics: while `AHOTTIE` is `false`,
it is skipped without any request. If imgbox recovers, set `AHOTTIE` to
`"true"` in `wrangler.jsonc` and redeploy. The placeholder is the first entry
in `KNOWN_PLACEHOLDERS`, so it can never be posted even with Ahottie on.

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

   The gallery count changes slowly, so an isolate remembers it for an hour.
   Until then, later requests skip step 1 and the 53 KB page, and read one
   random offset from `1` to `P_MAX * 10 - 1` directly (a 9 KB response);
   offset `0` is the category page itself. If that offset no longer holds a
   gallery, the count is read again in the same request. A cached request
   took about 0.1 seconds in a live test, against about 1 second with the
   page.
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
keeps its order. Sources marked *(off)* are switched off by default and
skipped without a request. When a style command (`style: Anime`/`Real`) is used without
the option, the sources of both styles are combined. `/solo` and `/threesome`
without an option pick one group at random, including a Nekos API group that
is only reachable that way.

| Command | Option | Sources |
| --- | --- | --- |
| `/4k` | | NekoBot `4k` |
| `/anal` | `style: Anime` | Purrbot `anal/gif`, N-SFW `anal`, NekoBot `hentai_anal`, Nekos API `anal` |
| `/anal` | `style: Real` | NekoBot `anal` |
| `/ass` | `style: Anime` | N-SFW `ass`, Waifu archive `ass`, NekoBot `hass` |
| `/ass` | `style: Real` | Obutts, NekoBot `ass` |
| `/blowjob` | `style: Anime` | Purrbot `blowjob/gif`, Waifu.pics `blowjob` *(off)*, N-SFW `blowjob`, Waifu archive `oral` |
| `/blowjob` | `style: Real` | NekoBot `blowjob` |
| `/boobs` | `style: Anime` | Waifu archive `oppai`, NekoBot `hboobs` |
| `/boobs` | `style: Real` | Oboobs, NekoBot `boobs` |
| `/breeding` | | N-SFW `breeding` |
| `/buttplug` | `style: Anime` | N-SFW `buttplug` |
| `/buttplug` | `style: Real` | PornPics |
| `/cages` | | N-SFW `cages` |
| `/cosplay` | | Hentai-cosplay-xxx, then Ahottie *(off)* |
| `/cum` | | Purrbot `cum/gif` |
| `/ecchi` | | N-SFW `ecchi`, Waifu archive `ecchi` |
| `/ero` | | Waifu archive `ero` |
| `/feet` | `style: Anime` | N-SFW `feet` |
| `/feet` | `style: Real` | NekoBot `feet` |
| `/fuck` | | Purrbot `fuck/gif` |
| `/gif` | | Sex.com, Porngifs.com, NekoBot `pgif`, Porngifs.tv |
| `/gonewild` | | NekoBot `gonewild` |
| `/hentai` | | Waifu archive `hentai`, NekoBot `hentai` |
| `/kitsune` | | NekoBot `hkitsune` |
| `/legs` | | N-SFW `legs` |
| `/maid` | | Waifu archive `maid`, Nekos API `maid` |
| `/midriff` | | NekoBot `hmidriff` |
| `/milf` | | N-SFW `milf`, Waifu archive `milf` |
| `/neko` | | Purrbot `neko/gif`, Purrbot `neko/img`, Waifu.pics `neko` *(off)*, N-SFW `neko`, Nekos API `catgirl`, NekoBot `lewdneko` |
| `/paizuri` | | N-SFW `paizuri`, Waifu archive `paizuri`, NekoBot `paizuri` |
| `/petgirls` | | N-SFW `petgirls` |
| `/pussy` | | Nekos API `pussy`, NekoBot `pussy` |
| `/pussylick` | | Purrbot `pussylick/gif` |
| `/selfie` | | N-SFW `selfie`, Waifu archive `selfies` |
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
| `/uniform` | | Waifu archive `uniform` |
| `/waifu` | | Waifu.pics `waifu` *(off)*, Waifu archive `waifu` |
| `/yuri` | | Purrbot `yuri/gif`, N-SFW `yuri`, NekoBot `hyuri`, Nekos API `yuri` |

`test/commands.test.js` asserts this exact mapping, and
`npm run test:live` calls every distinct source for real.

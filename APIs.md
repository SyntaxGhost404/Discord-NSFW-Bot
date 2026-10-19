# Active media APIs and exact contracts

This file records every endpoint, query parameter, header, category, and tag
used by the original commands and retained in the rebuilt runtime. Provider
selection is declared in each individual file under `src/commands/`; transport
implementations live under `src/brain/providers/`.

## 1. Purrbot

Method: `GET`. Response field: `link`.

- `https://purrbot.site/api/img/nsfw/anal/gif`
- `https://purrbot.site/api/img/nsfw/blowjob/gif`
- `https://purrbot.site/api/img/nsfw/cum/gif`
- `https://purrbot.site/api/img/nsfw/fuck/gif`
- `https://purrbot.site/api/img/nsfw/neko/gif`
- `https://purrbot.site/api/img/nsfw/neko/img`
- `https://purrbot.site/api/img/nsfw/pussylick/gif`
- `https://purrbot.site/api/img/nsfw/solo/gif`
- `https://purrbot.site/api/img/nsfw/solo_male/gif`
- `https://purrbot.site/api/img/nsfw/threesome_fff/gif`
- `https://purrbot.site/api/img/nsfw/threesome_ffm/gif`
- `https://purrbot.site/api/img/nsfw/threesome_mmf/gif`
- `https://purrbot.site/api/img/nsfw/yuri/gif`

## 2. N-SFW.COM (ABD)

Method: `GET`. The adapter reads only the `url_japan` response field and ignores
every other declared mirror. Media must be downloaded successfully from the
exact Osaka host and is always re-uploaded as a native Discord attachment;
Discord never renders the upstream URL directly inside the embed.

Base: `https://api.n-sfw.com/nsfw/{category}`

Retained categories:

`anal`, `ass`, `blowjob`, `breeding`, `buttplug`, `cages`, `ecchi`, `feet`,
`legs`, `masturbation`, `milf`, `neko`, `paizuri`, `petgirls`, `selfie`,
`smothering`, `socks`, and `yuri`.

The Osaka route is restricted to the exact `n-sfw.ap-osaka-1.s3.ink` hostname,
performs a separate certificate hostname check, and tolerates only Node's
`CERT_HAS_EXPIRED` authorization result. Self-signed certificates, untrusted
chains, hostname mismatches, redirects to undeclared hosts, and every other TLS
error remain blocked. No credentials or Discord tokens are sent to media hosts,
downloads remain size/time bounded, and the Link button points to the validated
Osaka media URL.

## 3. Waifu.im v7

Method: `GET`.

Endpoint: `https://api.waifu.im/images`

Exact query parameters:

- `IncludedTags={tag}`
- `IsNsfw=True`

Exact headers:

- `Authorization: ApiKey ${WAIFU_IM_KEY}`
- `Accept-Version: v7`

Retained tags:

`ass`, `ecchi`, `ero`, `hentai`, `maid`, `milf`, `oppai`, `oral`, `paizuri`,
`selfies`, `uniform`, and `waifu`.

Response path: `items[0].url`.

## 4. Waifu.pics

Method: `GET`. Response field: `url`. Disabled by default, matching the legacy
Replit configuration; enable with `WAIFU_PICS=true`.

- `https://api.waifu.pics/nsfw/blowjob`
- `https://api.waifu.pics/nsfw/neko`
- `https://api.waifu.pics/nsfw/waifu`

## 5. Sex.com GIF search

Method: `GET`.

Endpoint: `https://www.sex.com/portal/api/gifs/search`

Exact query parameters:

- `sexual-orientation=straight`
- `order=likeCount`
- `search={random niche}`
- `page={random integer from 1 through 10}`
- `limit=40`

The exact archived browser header is sent:

`User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36`

A random item is selected from `data`; its `uri` has a terminal `.webp`
changed to `.gif`, then is appended to `https://imagex1.sx.cdn.live`. The link
button uses `https://www.sex.com/pin/{id}/`.

Retained niches:

`Amateur`, `Anal`, `Asian`, `Big Tits`, `Blonde`, `Blowjob`, `Brunette`,
`Creampie`, `Cumshot`, `Hardcore`, `Latina`, `Lesbian`, `MILF`, `Masturbation`,
`Threesome`, `Ass`, `BBW`, `BDSM`, `Double Penetration`, `Ebony`,
`Female Ejaculation`, `Fisting`, `Footjob`, `Gangbang`, `Hairy`, `Handjob`,
`Hentai`, `Lingerie`, `Public Sex`, `Pussy`, and `Toys`.

## 6. Oboobs.ru and Obutts.ru

Method: `GET`.

Oboobs:

- Random: `http://api.oboobs.ru/boobs/0/1/random/`
- By ID: `http://api.oboobs.ru/boobs/get/{id}/`
- Media: `http://media.oboobs.ru/{preview}`

Obutts:

- Random: `http://api.obutts.ru/butts/0/1/random/`
- By ID: `http://api.obutts.ru/butts/get/{id}/`
- Media: `http://media.obutts.ru/{preview}`

The first array item supplies `id` and `preview`. Plain HTTP is retained because
it is part of the original provider contract; no credentials are sent.

## 7. NekoBot.xyz

Method: `GET`.

Endpoint: `https://nekobot.xyz/api/image?type={type}`

Header: `Authorization: ${NEKOBOT_AUTHORIZATION}`.

Retained types:

`4k`, `anal`, `ass`, `blowjob`, `boobs`, `feet`, `gonewild`, `hass`, `hboobs`,
`hentai`, `hentai_anal`, `hkitsune`, `hmidriff`, `hthigh`, `hyuri`, `lewdneko`,
`paizuri`, `pgif`, `pussy`, `tentacle`, and `thigh`.

The response must have `success=true`; media is read from `message`. The old
hard-coded authorization value was not copied into active code. It remains in
the byte-for-byte legacy archive and must now be supplied through the host's
secret manager.

## 8. Nekos API v4

Method: `GET`.

Endpoint template:

`https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags={tag}`

Exact parameters:

- `limit=1`
- `rating=explicit,suggestive`
- `tags={tag}`

Retained tags: `anal`, `catgirl`, `maid`, `masturbating`, `pussy`, `threesome`,
and `yuri`. Response path: `[0].url`.

## 9. Porngifs.com

Method: `GET` against media path `https://cdn.porngifs.com/img/{randomId}`.
`randomId` is retained as an integer from 1 through 39,239. Up to 15 IDs are
tried.

The original implementation's DNS/SNI route is retained without disabling
certificate verification:

- Resolve `porngifs.com`.
- Connect to the resolved address using TLS `servername=cdn.porngifs.com`.
- Request `/img/{randomId}`.
- Send `Host: cdn.porngifs.com`.
- Send `Referer: https://porngifs.com/`.
- Send a browser-style `User-Agent` and `Accept: image/*`.
- Accept only bounded payloads larger than 1 KiB and upload them as native
  attachments.

## 10. Porngifs.tv

Method: `GET`.

Endpoint:

`https://porngifs.tv/?action=ajax&mode=async&function=get_block&block_id=list_videos_most_recent_videos&sort_by=post_date&from={randomPage}`

Exact query parameters:

- `action=ajax`
- `mode=async`
- `function=get_block`
- `block_id=list_videos_most_recent_videos`
- `sort_by=post_date`
- `from={random integer from 1 through 2603}`

Headers: `X-Requested-With: XMLHttpRequest` and a browser-style `User-Agent`.
Up to 15 pages are tried. `data-webp` values ending in `.webp` or `.gif` are
collected, one is selected randomly, downloaded within the active attachment
limit, and uploaded using its real content type.

## 11. Cosplay HTML feeds

The `/cosplay` command uses an ordered provider pool. The primary provider is
always attempted first; Ahottie is contacted only after a primary failure.
Neither adapter opens an individual gallery or album page.

### Hentai-cosplay-xxx.com (primary)

Feed template:

`https://hentai-cosplay-xxx.com/search/page/{page}/`

On every command or Refresh execution, the adapter reads the current
pagination ceiling from the feed's `a.last` link, generates a fresh
cryptographically random page from the complete `1..maximum` range, and reads
that feed page. Page 1 is reused when it is the randomly selected page.

Only image/source elements inside `ul#image-list` are considered. The adapter
never requests the `/image/...` gallery links. It removes `/p={width}/` and
`/p={width}x{height}/` path wrappers, resolves protocol-relative CDN URLs,
rejects non-HTTPS and foreign hosts, de-duplicates the resulting raw URLs, and
selects uniformly from the complete candidate array.

### Ahottie.top (fallback)

Feed template:

`https://ahottie.top/tags/Cosplay?page={page}`

The maximum page is read dynamically from the index pagination on every
fallback execution. A fresh page is selected across the complete range. Only
image elements already contained by `/albums/...` links in the index payload
are parsed; the album URLs themselves are never requested. Direct
`imagesN.imgbox.com` URLs are accepted, while Imgbox thumbnail URLs are promoted
from `thumbsN`/`_t` to their `imagesN`/`_o` originals.

Both feeds and media downloads have host allowlists, shutdown-aware timeouts,
and byte ceilings. The selected image is downloaded once, verified as an image,
and uploaded as a native Discord attachment so the embed renders immediately.
The Link button retains the resolved raw media URL. No browser automation,
prefetching, speculative request, or background crawl is used.

## 12. PornPics.com butt-plug cover feed

The `/buttplug` command now exposes the same optional `style` choice as
`/ass` and `/anal`. `Anime` selects only the retained N-SFW `buttplug`
endpoint. `Real` selects only PornPics. With no selection, the shared command
brain flattens and shuffles the two one-source groups, giving each source one
equal first choice and preserving the established fallback behavior.

Discovery endpoint:

`https://www.pornpics.com/butt-plug/`

The adapter reads `P_MAX` from the initial HTML and treats it as ten gallery
items per rotator page. A fresh cryptographically random item offset is chosen
from `0..(P_MAX * 10 - 1)` on every command or Refresh execution. For offsets
below 20, the already-loaded main feed supplies the corresponding gallery
thumbnail. Higher offsets use one bounded request to:

`https://www.pornpics.com/butt-plug/?offset={offset}`

The first JSON item at that exact offset supplies `t_url_460`, with `t_url` as
the secondary field. The adapter never requests `g_url` or any individual
gallery page. If an expected initial thumbnail is absent, the same exact-offset
JSON route is used once instead.

Only HTTPS image URLs on the exact `cdni.pornpics.com` host are accepted.
`/300/` and `/460/` path prefixes are replaced with `/1280/` while all shard
segments and the filename remain unchanged. The bot normally performs one
bounded download from that exact CDN host with image-oriented request headers.
If that media request fails with a transport-level `NETWORK_ERROR` before a
usable response is received, the same selected URL is attempted once more;
feed discovery, random selection, and offset JSON are not repeated.
The response must meet the minimum-size check, declare a supported `image/*`
content type, and finish on another valid HTTPS `/1280/` URL on the same exact
host. The bytes stay in memory and are uploaded to Discord as a native
attachment; the embed uses `attachment://media.<extension>`, while the Link
button retains the selected raw `/1280/` URL.

An HTTP 200 block page such as `text/html` is rejected as a provider failure
instead of being sent to Discord as a blank image. HTTP responses, timeouts,
shutdown cancellation, validation failures, and block pages are never retried.
The adapter performs no proxying, TLS impersonation, speculative probe, or
attempt to bypass the CDN's datacenter access policy. Feed and media responses
remain host-allowlisted, shutdown-aware, and byte-bounded.

## Command-to-provider preservation

Every command source is explicit in its own module. The provider parity tests
cover all of the categories above, including style/gender/type source groups.
The `/gif` pool remains an equal top-level choice between Sex.com,
Porngifs.com, NekoBot `pgif`, and Porngifs.tv before fallback is applied.

`/cosplay` is a new active command rather than an archived provider mapping.
The PornPics `Real` group is an intentional extension to the archived
`/buttplug` command; its original N-SFW source remains unchanged in the
`Anime` group. Both extensions have dedicated executable transport and command
tests.

The experimental endpoint studies in `archive/legacy/studies/` are preserved
as research documents. They were not active command implementations in the old
runtime and are therefore not silently promoted into production providers.

# Archived command parity report

This report is generated from the active verification contract, not from
assumptions about similarly named commands. The test harness loads every
archived CommonJS command with mocked `discord.js` builders and provider
functions, executes every explicit option group across the archived random
source ranges, captures the provider calls that are actually reachable, and
compares them with the corresponding modern command declaration.

## Media command matrix

| Command | Archived provider calls reproduced by the modern command |
| --- | --- |
| `/4k` | NekoBot `4k` |
| `/anal` | Anime: Purrbot `anal/gif`, N-SFW `anal`, NekoBot `hentai_anal`, Nekos v4 `anal`; Real: NekoBot `anal` |
| `/ass` | Anime: N-SFW `ass`, Waifu.im `ass`, NekoBot `hass`; Real: Obutts, NekoBot `ass` |
| `/blowjob` | Anime: Purrbot `blowjob/gif`, Waifu.pics `blowjob`, N-SFW `blowjob`, Waifu.im `oral`; Real: NekoBot `blowjob` |
| `/boobs` | Anime: Waifu.im `oppai`, NekoBot `hboobs`; Real: Oboobs, NekoBot `boobs` |
| `/breeding` | N-SFW `breeding` |
| `/buttplug` | Anime: retained N-SFW `buttplug`; Real: active PornPics butt-plug cover-feed extension |
| `/cages` | N-SFW `cages` |
| `/cosplay` | New active command: Hentai-cosplay-xxx.com feed, then Ahottie feed only as fallback |
| `/cum` | Purrbot `cum/gif` |
| `/ecchi` | N-SFW `ecchi`, Waifu.im `ecchi` |
| `/ero` | Waifu.im `ero` |
| `/feet` | Anime: N-SFW `feet`; Real: NekoBot `feet` |
| `/fuck` | Purrbot `fuck/gif` |
| `/gif` | Sex.com with all 31 archived niches, Porngifs.com, NekoBot `pgif`, Porngifs.tv |
| `/gonewild` | NekoBot `gonewild` |
| `/hentai` | Waifu.im `hentai`, NekoBot `hentai` |
| `/kitsune` | NekoBot `hkitsune` |
| `/legs` | N-SFW `legs` |
| `/maid` | Waifu.im `maid`, Nekos v4 `maid` |
| `/midriff` | NekoBot `hmidriff` |
| `/milf` | N-SFW `milf`, Waifu.im `milf` |
| `/neko` | Purrbot `neko/gif` and `neko/img`, Waifu.pics `neko`, N-SFW `neko`, Nekos v4 `catgirl`, NekoBot `lewdneko` |
| `/paizuri` | N-SFW `paizuri`, Waifu.im `paizuri`, NekoBot `paizuri` |
| `/petgirls` | N-SFW `petgirls` |
| `/pussy` | Nekos v4 `pussy`, NekoBot `pussy` |
| `/pussylick` | Purrbot `pussylick/gif` |
| `/selfie` | N-SFW `selfie`, Waifu.im `selfies` |
| `/smothering` | N-SFW `smothering` |
| `/socks` | N-SFW `socks` |
| `/solo` | Female: Purrbot `solo/gif`, N-SFW `masturbation`; Male: Purrbot `solo_male/gif`; random third group: Nekos v4 `masturbating` |
| `/tentacle` | NekoBot `tentacle` |
| `/thigh` | Anime: NekoBot `hthigh`; Real: NekoBot `thigh` |
| `/threesome` | Purrbot `threesome_fff/gif`, `threesome_ffm/gif`, and `threesome_mmf/gif`; random fourth group: Nekos v4 `threesome` |
| `/uniform` | Waifu.im `uniform` |
| `/waifu` | Waifu.pics `waifu`, Waifu.im `waifu` |
| `/yuri` | Purrbot `yuri/gif`, N-SFW `yuri`, NekoBot `hyuri`, Nekos v4 `yuri` |

The remaining archived commands—`/help`, `/invite`, and `/ping`—are utility
commands and contain no NSFW provider implementation. The modern `/premium`
utility adds account-plan and quota visibility without changing any media
mapping. The hidden `intro` module handles mention-message components and is
intentionally not an application command.

`/cosplay` has no archived counterpart. Its row documents an intentional active
extension and is excluded from the byte-for-byte legacy execution comparison.
For `/buttplug`, the parity harness compares the archived N-SFW call with the
modern `Anime` group and separately requires the exact PornPics declaration in
the new `Real` group. Dedicated tests enforce both scraper contracts.

## Provider transport verification

The tests also exercise the provider layer independently of command mapping:

- all endpoint templates, tags, categories, and response fields;
- NekoBot and Waifu.im authorization/version headers;
- the exact Sex.com query object, 31-niche list, browser header, page range,
  WebP-to-GIF conversion, CDN URL, and watch URL;
- Oboobs and Obutts random/by-ID paths and media URL templates;
- N-SFW `url_japan`/exact-Osaka selection and bounded native attachment
  download, with every alternate mirror intentionally ignored;
- cosplay full-depth pagination discovery, one-feed media extraction, wrapper
  cleaning, candidate de-duplication, fresh random offsets, ordered fallback,
  exact host validation, and native attachment rendering;
- PornPics `P_MAX` item-range discovery, exact random offsets, initial-feed
  cover selection, offset JSON parsing, `/1280/` promotion, exact CDN-host
  validation, gallery-navigation exclusion, bounded image download, native
  attachment rendering, one same-URL network retry, blocked-HTML rejection,
  and raw Link preservation;
- Porngifs.com DNS lookup, direct-IP connection, SNI, Host/Referer/Accept
  headers, ID range, size floor, and 15-attempt limit;
- Porngifs.tv AJAX parameters, headers, page range, HTML extraction, CDN host
  validation, size floor, and native content type;
- Purrbot, Waifu.pics, and Nekos v4 response shapes.

Run `npm run validate` to repeat the complete audit.

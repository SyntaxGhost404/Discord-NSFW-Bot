# Cosplay Viewer

A mobile-first, ad-free viewer for hentai-cosplay-xxx.com that runs on the
Cloudflare Workers Free plan. It shows the site's albums and videos without
the site's ads, pop-ups, trackers, or scripts. Adults only.

## What it does

- **Age gate first.** A full-screen check asks visitors to confirm they are 18
  or older before anything is fetched or shown. The answer is kept on the
  device, so each browser asks once.
- **Feed.** Covers, titles, and dates in a grid that keeps loading as you
  scroll, in any of the site's eleven orders: most recent, most popular, most
  downloaded, most liked, most bookmarked, recently popular, recent downloads,
  recent likes, recent bookmarks, most recent videos, and most popular videos.
  The download, like, and bookmark rankings also come per day, week, month,
  or year.
- **Search** across album names, with the number of results.
- **Albums on one page.** Every photo of an album at full size, in the
  album's order, in one continuous list, even for albums with more than 1,600
  photos. Photos load as they come near the screen.
- **Photo viewer.** Swipe between photos, pinch or double tap to zoom, drag to
  pan, and swipe down to close. With a mouse and keyboard: arrow keys, Escape,
  the wheel to move between photos, and Ctrl with the wheel to zoom.
- **Videos** play in the browser's own player where it supports HLS streams
  (Safari on iPhone, iPad, and Mac, and Chrome on Android). Other browsers
  show the poster and a short note.
- **Feels like an app.** The back button and back gesture close the photo
  viewer, the sort sheet, and the album in that order, a swipe from the left
  edge goes back, and every feed, search, album, and video has its own link.
  It can be added to the home screen.

## Privacy and safety

- The page loads only its own files. Its Content Security Policy allows
  scripts and styles from the app alone, images only from the site's image
  servers, and video only from its video servers. There are no inline
  scripts, third-party scripts, web fonts, or analytics.
- The Worker reads a fixed set of pages on the site (lists, search results,
  album story pages, and video pages) and returns only the fields the app
  shows, as JSON. It never passes on the site's HTML or scripts. Unknown
  sorts, ranges, pages, and album names are refused before the site is
  contacted, so the Worker cannot be used as an open proxy.
- Every image and stream address the Worker returns must match the site's
  image or video servers; anything else is dropped.
- Photos and video load straight from those servers, without a referrer.
  They see your IP address, as with any image on the web.
- Pages ask search engines not to index them, and the app cannot be framed by
  other sites.

## How it works

- `public/` is the app: plain HTML, CSS, and JavaScript modules with no build
  step. Workers static assets serve it at no cost, and any path that is not a
  file serves `index.html`, so links such as `/album/<slug>` work.
- `src/worker.js` runs only for `/api/*` (`run_worker_first` in
  `wrangler.jsonc`):
  - `GET /api/feed?sort=<sort>&range=<day|week|month|year>&page=<n>`
  - `GET /api/search?q=<text>&page=<n>`
  - `GET /api/album/<slug>`
  - `GET /api/video/<slug>`
- Each API request reads one page from the site. A list page holds 20 items.
  Albums come from the site's story view, which names every photo at once,
  so an album of any size takes one request.
- `src/parse.js` reads those pages with plain string scans. In local
  measurements, the story page of a 1,626 photo album (about 1 MB) parses in
  about 5 ms on a cold start and 2 ms after that, within the Free plan's
  10 ms CPU limit.
- Lists are cached for 2 minutes and albums and videos for a day: the Worker
  asks Cloudflare's cache to keep the site's pages where edge caching applies,
  and browsers reuse the answers for the same time. The app also keeps
  answers in memory while it is open.

## Deploy

You need Node.js 22.12 or newer and a Cloudflare account. The Free plan is
enough, and there are no secrets or bindings to set up.

```sh
npm ci
npx wrangler login
npm run deploy
```

Wrangler prints the app's `workers.dev` address. To use your own domain, add a
custom domain to the `cosplay-viewer` Worker in the Cloudflare dashboard.

Workers Cache (`"cache": { "enabled": true }` in `wrangler.jsonc`) could
answer repeated API requests without running the Worker, but it also makes
every request count toward the plan's daily request limit, including requests
for the app's own files, which are otherwise free. It is off for that reason.

## Development

```sh
npm run dev       # local server at http://localhost:8787
npm test          # Worker, parser, and client tests in workerd
npm run check     # static checks
npm run validate  # both
```

Tests mock every outbound request, so they never reach the site.
`npm run check` enforces the app's rules: no en or em dashes and no emoji in
any file, no accent colors in the banned hues (pink, purple, violet, blue,
and orange), no `innerHTML` or similar APIs, only local scripts in the page,
no third-party hosts, and no secrets in files that would be committed.

## Design notes

- **Continuous curvature.** Every container, card, button, chip, sheet,
  badge, and photo has squircle corners: a short circular arc eased into each
  straight edge by curves, so the curvature changes gradually instead of
  jumping where the edge meets the corner (smoothing 0.6). Browsers that
  support `corner-shape: squircle` draw them natively, with the radius scaled
  by 1.75 so both kinds look the same (measured in Chromium). Elsewhere, each
  element gets the same shape as a clip path that follows its size. The math
  is in `public/js/squircle-path.js`.
- **Color.** A true black background, neutral gray surfaces a few steps
  apart, white for primary actions, and one green accent for focus and
  selection. No shadows, glows, blur, or floating layers.
- **Type and icons.** The system font, inline SVG icons drawn for this app,
  and short labels.

## Limits

- The app depends on the site's markup. If the site changes its pages,
  `src/parse.js` needs an update; the tests describe the markup it expects.
- Video needs a browser that plays HLS on its own, because the site's streams
  do not allow other players to load them.
- The site's image servers block some automated browsers. Regular browsers
  are not affected.

## Personal use

This is a personal viewer for content hosted by hentai-cosplay-xxx.com. It
does not host, store, or change that content. Respect the site's terms and
the laws where you live.

## License

[MIT](LICENSE)

# Cosplay Viewer

A mobile-first, ad-free viewer for hentai-cosplay-xxx.com that runs on the
Cloudflare Workers Free plan. It shows the site's albums and videos without
the site's ads, pop-ups, trackers, or scripts. Adults only.

## What it does

- **Age gate first.** A full-screen check asks visitors to confirm they are 18
  or older before anything is fetched or shown. The answer is kept on the
  device, so each browser asks once.
- **Provider switcher.** The header shows the active provider's address with
  a small chevron button right beside it. The button opens a sheet listing
  the providers, built from the same parts as the sort sheet. Hentai Cosplay
  is the default. The second entry, Placeholder, is there to try switching:
  it has no source yet, so the viewer says so and requests nothing for it.
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
  viewer, the sort and provider sheets, and the album in that order, a swipe
  from the left edge goes back, and every feed, search, album, and video has
  its own link. It can be added to the home screen.

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
- `public/js/providers.js` lists the providers. A feed's address names its
  provider (`/?provider=placeholder`) unless it is the default one, so
  existing links still work. Switching providers replaces the address, like
  a sort change. Only Hentai Cosplay has a Worker behind it so far.
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
  and browsers reuse the answers for the same time. A page the site says it
  does not have is kept for a minute, and errors are never cached, so a
  passing problem on the site does not stick. The app also keeps answers in
  memory while it is open, except ones that may soon change.

## When things go wrong

The viewer says what actually happened, as far as it can tell, instead of
one catch-all message, and offers Try again only where that can help.

- **Searches.** "The site found no albums" when the site answered with an
  empty results page, with a hint that fits what was typed (one letter, a
  symbol, several words). "The site didn't return a results page" when the
  site answered "not found", as it does for some searches; the site gives no
  reason, so the viewer does not guess one, and it does not reword searches
  to get around it. Searches with no letters or numbers are explained without
  asking the site.
- **Searches the site limits.** For some searches the site sends a couple of
  albums per page while claiming thousands of results, a total that changes
  from page to page. The viewer says the results fill in slowly, hides the
  unreliable count, spaces out its requests, and keeps reading past the
  albums the site repeats.
- **Sorts and rankings.** An empty ranking says which range is empty ("Nothing
  ranked today yet"). A list that keeps repeating itself stops, and says why.
- **Failures.** Offline, a site that is slow, down, or turning requests
  away, and the viewer being over its own request limit are each named. A
  list that failed offline loads again by itself once the browser is back
  online.
- **Albums and videos.** A removed album or video says so, with no Try
  again. An album without photos and a video page without a stream say so
  too, and a stream that fails while playing can be loaded again.
- **Images.** A photo that fails to load says so and loads again on a tap,
  in the album and in the photo viewer. If several fail and none loads, a
  note says the site's image server is refusing them. A cover tries the
  other size before giving up.
- **Pages the viewer cannot read.** When the site sends a page the parser
  does not understand, the viewer says so and logs it to the Worker's logs
  (`Unreadable list page`, `Unreadable page`), the sign that `src/parse.js`
  needs an update.
- **The age gate** says the answer is saved only when the browser can save
  it.
- **A provider without a source** says it isn't connected yet, without
  search, sorts, or a Try again button, and nothing is requested for it.

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
  and short labels. The provider's name in the header is 20px where it fits
  and shrinks on narrow screens down to 15px; only below that is it cut
  short. In Roboto, Android's font, `hentai-cosplay-xxx.com` fits whole on a
  360px-wide phone at 15.5px.

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

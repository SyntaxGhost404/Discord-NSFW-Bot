// Every word the interface shows, in one place. Keep them short and plain.

export const SORT_LABELS = Object.freeze({
  recent: 'Most recent',
  popular: 'Most popular',
  downloads: 'Most downloaded',
  likes: 'Most liked',
  bookmarks: 'Most bookmarked',
  'recently-popular': 'Recently popular',
  'recent-downloads': 'Recent downloads',
  'recent-likes': 'Recent likes',
  'recent-bookmarks': 'Recent bookmarks',
  videos: 'Most recent videos',
  'popular-videos': 'Most popular videos',
});

export const SORT_GROUPS = Object.freeze([
  { label: 'Albums', sorts: ['recent', 'popular', 'downloads', 'likes', 'bookmarks', 'recently-popular', 'recent-downloads', 'recent-likes', 'recent-bookmarks'] },
  { label: 'Videos', sorts: ['videos', 'popular-videos'] },
]);

// Sorts the site also ranks per day, week, month, or year.
export const RANGED_SORTS = new Set(['downloads', 'likes', 'bookmarks']);

export const RANGE_LABELS = Object.freeze({ all: 'All time', day: 'Today', week: 'This week', month: 'This month', year: 'This year' });

export const TEXT = Object.freeze({
  app: 'Cosplay',
  gateTitle: 'Adults only',
  gateBody: 'This app shows sexual content. Enter only if you are 18 or older.',
  gateEnter: "I'm 18 or older",
  gateLeave: 'Leave',
  gateNote: 'Your answer is saved on this device.',
  search: 'Search',
  searchPlaceholder: 'Search albums',
  cancel: 'Cancel',
  clear: 'Clear',
  sort: 'Sort',
  back: 'Back',
  close: 'Close',
  toTop: 'Back to top',
  retry: 'Try again',
  end: 'End of list.',
  endOfResults: 'End of results.',
  albumEnd: 'End of album.',
  photoMissing: "Photo didn't load.",
  tapToRetry: 'Tap to try again.',
  gateUnsaved: "This browser can't save your answer, so you'll be asked again.",
  video: 'Video',
  photoViewer: 'Photo viewer',
  previous: 'Previous photo',
  next: 'Next photo',
});

// What the viewer says when something comes back empty or goes wrong. Each
// says only what the viewer can tell, and what the visitor can do about it.
export const NOTICE = Object.freeze({
  errors: Object.freeze({
    offline: { title: "You're offline.", hint: "This loads again when you're back online." },
    network: { title: "Couldn't connect.", hint: 'Check your connection and try again.' },
    timeout: { title: 'The site took too long to answer.', hint: 'Try again in a moment.' },
    unreachable: { title: "Couldn't reach the site.", hint: 'It may be down. Try again in a moment.' },
    blocked: { title: 'The site turned the request away.', hint: 'This usually passes. Try again later.' },
    upstream: { title: 'The site had a problem.', hint: 'Try again in a moment.' },
    moved: { title: 'The site sent an unexpected answer.', hint: 'Try again later.' },
    busy: { title: 'Too many requests right now.', hint: 'Wait a minute, then try again.' },
    server: { title: 'The viewer ran into a problem.', hint: 'Try again in a moment.' },
    unreadable: { title: "The viewer couldn't read the site's page.", hint: 'The site may have changed its pages, and the viewer needs an update to read them.' },
  }),
  gone: Object.freeze({
    album: { title: 'This album is no longer on the site.', hint: 'It may have been removed.' },
    video: { title: 'This video is no longer on the site.', hint: 'It may have been removed.' },
  }),
  invalid: { title: "This link isn't valid.", hint: 'Go back and pick another.' },
  search: Object.freeze({
    refused: (q) => `The site didn't return a results page for “${q}”.`,
    empty: (q) => `The site found no albums for “${q}”.`,
    nothing: { title: 'Searches need letters or numbers.', hint: 'Try a name or a word from a title.' },
    fewerOrDifferent: 'Try fewer or different words.',
    different: 'Try a different word.',
    fewer: 'Try fewer words.',
    longer: 'Try at least two letters.',
    symbols: 'Try it without symbols.',
    spelling: 'Check the spelling or try another word.',
    limited: 'The site sends this search a few albums at a time, so results fill in slowly.',
  }),
  feed: Object.freeze({
    missing: { title: "The site doesn't have this list right now.", hint: 'Try another sort.' },
    empty: { title: 'This list is empty right now.', hint: 'Try another sort.' },
    noVideos: { title: 'No videos here right now.', hint: 'Try again later.' },
    ranged: (range) => `Nothing ranked ${range} yet.`,
    longerRange: 'Try a longer time range.',
    repeating: 'The site kept sending albums already shown, so the list stops here.',
    coversDown: { title: "Covers aren't loading from the site's image server.", hint: 'Try again later or on another network.' },
  }),
  album: Object.freeze({
    empty: { title: 'This album has no photos on the site.', hint: 'They may have been removed.' },
    photosDown: { title: "Photos aren't loading from the site's image server.", hint: 'Try again later or on another network.' },
  }),
  video: Object.freeze({
    noStream: { title: "This video isn't available to play.", hint: "The site's page has no stream for it." },
    // The site's streams play only in browsers with HLS built in.
    noHls: { title: "This browser can't play this video.", hint: "It plays in Safari, and in Chrome on Android." },
    failed: { title: "The video didn't load.", hint: 'The stream may be busy. Try again.' },
  }),
});

// Ranges as they read inside a sentence: "Nothing ranked this week yet."
export const RANGE_PHRASES = Object.freeze({ day: 'today', week: 'this week', month: 'this month', year: 'this year' });

export function photos(count) {
  return `${count.toLocaleString()} ${count === 1 ? 'photo' : 'photos'}`;
}

export function results(count) {
  return `${count.toLocaleString()} ${count === 1 ? 'result' : 'results'}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function day(iso) {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

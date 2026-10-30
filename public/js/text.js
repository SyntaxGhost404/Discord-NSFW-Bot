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
  loadError: "Couldn't load.",
  albumError: "Couldn't load this album.",
  videoError: "Couldn't load this video.",
  retry: 'Try again',
  empty: 'Nothing here yet.',
  noResults: 'No albums match.',
  end: 'End of list.',
  albumEnd: 'End of album.',
  photoMissing: "Photo didn't load.",
  noHls: "This browser can't play this video. Try Safari or Chrome on Android.",
  video: 'Video',
  photoViewer: 'Photo viewer',
  previous: 'Previous photo',
  next: 'Next photo',
});

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

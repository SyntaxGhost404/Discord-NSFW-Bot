// When Discord says to wait, or rejects the bot token, this isolate stops
// asking it for a while. Requests that end in 401, 403, or 429 count toward
// Discord's temporary ban on IP addresses (10,000 per 10 minutes).

let state = { until: 0, error: null };

export const pause = {
  // Stop asking for `ms` milliseconds; lookups meanwhile fail with `error`.
  start(error, ms) {
    state = { until: Date.now() + ms, error };
  },
  // The error to answer with and the seconds left, or null.
  current() {
    const left = state.until - Date.now();
    return left > 0 ? { error: state.error, seconds: Math.ceil(left / 1000) } : null;
  },
  clear() {
    state = { until: 0, error: null };
  },
};

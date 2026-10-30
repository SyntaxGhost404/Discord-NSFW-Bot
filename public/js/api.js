// Calls to the Worker's JSON routes. Answers are kept in memory for the
// session, so going back to a list or reopening an album is instant. A
// failed call rejects with an error whose `code` says what went wrong (see
// notices.js), and answers that may soon change are not kept.

const MAXIMUM_ENTRIES = 80;
const KEEP = new Set(['ok', 'empty', 'end']);
const answers = new Map();

const failure = (code, status = 0) => Object.assign(new Error(`Request failed: ${code}`), { code, status });

async function call(path) {
  let response;
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' } });
  } catch {
    throw failure(navigator.onLine === false ? 'offline' : 'network');
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: an error page from the platform, not from the Worker.
  }
  // 429 from the platform: the viewer itself is over its request limit.
  if (!response.ok || !body) throw failure(body?.error ?? (response.status === 429 ? 'busy' : 'server'), response.status);
  return body;
}

function request(path) {
  const known = answers.get(path);
  if (known) {
    answers.delete(path);
    answers.set(path, known);
    return known;
  }
  const answer = call(path);
  answers.set(path, answer);
  answer.then((body) => {
    if (body.state && !KEEP.has(body.state)) answers.delete(path);
  }, () => answers.delete(path));
  while (answers.size > MAXIMUM_ENTRIES) answers.delete(answers.keys().next().value);
  return answer;
}

export const api = {
  feed: ({ sort, range, page }) => request(`/api/feed?${new URLSearchParams({ sort, page: String(page), ...(range ? { range } : {}) })}`),
  search: ({ q, page }) => request(`/api/search?${new URLSearchParams({ q, page: String(page) })}`),
  album: (slug) => request(`/api/album/${encodeURIComponent(slug)}`),
  video: (slug) => request(`/api/video/${encodeURIComponent(slug)}`),
};

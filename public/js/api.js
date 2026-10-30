// Calls to the Worker's JSON routes. Answers are kept in memory for the
// session, so going back to a list or reopening an album is instant.

const MAXIMUM_ENTRIES = 80;
const answers = new Map();

function request(path) {
  const known = answers.get(path);
  if (known) {
    answers.delete(path);
    answers.set(path, known);
    return known;
  }
  const answer = fetch(path, { headers: { Accept: 'application/json' } }).then(async (response) => {
    if (!response.ok) throw Object.assign(new Error(`Request failed with ${response.status}.`), { status: response.status });
    return response.json();
  });
  answers.set(path, answer);
  answer.catch(() => answers.delete(path));
  while (answers.size > MAXIMUM_ENTRIES) answers.delete(answers.keys().next().value);
  return answer;
}

export const api = {
  feed: ({ sort, range, page }) => request(`/api/feed?${new URLSearchParams({ sort, page: String(page), ...(range ? { range } : {}) })}`),
  search: ({ q, page }) => request(`/api/search?${new URLSearchParams({ q, page: String(page) })}`),
  album: (slug) => request(`/api/album/${encodeURIComponent(slug)}`),
  video: (slug) => request(`/api/video/${encodeURIComponent(slug)}`),
};

// The Worker's one route. A failed lookup rejects with an error whose `code`
// names what went wrong (see NOTICES in text.js).

const failure = (code, body = null) => Object.assign(new Error(`Lookup failed: ${code}`), {
  code,
  reason: typeof body?.reason === 'string' ? body.reason : null,
  retryAfter: Number.isFinite(body?.retry_after) ? body.retry_after : null,
});

export async function lookupUser(id) {
  let response;
  try {
    response = await fetch(`/api/users/${id}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw failure(navigator.onLine === false ? 'offline' : 'network');
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: an error page from the platform, not from the Worker.
  }
  if (response.ok && body?.user) return body;
  throw failure(body?.error ?? (response.status === 429 ? 'slow_down' : 'server'), body);
}

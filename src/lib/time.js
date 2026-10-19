export function sleep(milliseconds, signal = null) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, Math.max(0, milliseconds));
    function abort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Resolves with `fallback` instead of rejecting when the work is too slow, so
// callers on Discord's three-second acknowledgement path can fail open.
export async function withTimeout(promise, milliseconds, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3_600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds % 60}s`;
}

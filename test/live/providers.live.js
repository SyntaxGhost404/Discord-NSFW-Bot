import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { commands } from '../../src/commands/index.js';
import { configFor } from '../../src/config.js';
import { fetchMedia } from '../../src/brain/providers/index.js';
import { MediaHttpClient } from '../../src/brain/providers/http.js';
import { createCosplayCatalog } from '../../src/brain/providers/cosplay-catalog.js';
import cosplayCatalogText from '../../src/brain/providers/cosplay-catalog.txt';

// Every distinct source used by any media command, fetched for real from
// inside workerd. Media stays in memory; nothing is posted anywhere.
function distinctSources() {
  const seen = new Map();
  for (const command of commands.values()) {
    if (!command.media) continue;
    const sources = [...(command.media.sources ?? []), ...Object.values(command.media.groups ?? {}).flat()];
    for (const source of sources) {
      const key = `${source.provider}:${source.endpoint ?? source.type ?? source.tag ?? ''}`;
      if (!seen.has(key)) seen.set(key, { key, source, commands: [] });
      seen.get(key).commands.push(command.data.name);
    }
  }
  return [...seen.values()];
}

describe('live providers', () => {
  it('reports which upstream sources answer right now', async () => {
    const config = configFor(env);
    const cosplayCatalog = createCosplayCatalog(cosplayCatalogText);
    const report = [];
    for (const { key, source, commands: users } of distinctSources()) {
      const http = new MediaHttpClient({ timeoutMs: config.mediaTimeoutMs, maximumBytes: config.maxMediaBytes, deadline: Date.now() + 25_000 });
      const startedAt = Date.now();
      try {
        const result = await fetchMedia(source, { http, config, cosplayCatalog, maxMediaBytes: config.maxMediaBytes, logger: null });
        report.push({ key, ok: true, ms: Date.now() - startedAt, delivery: result.buffer ? `attachment ${result.contentType} ${result.buffer.byteLength}B` : 'url', url: result.url.slice(0, 90), users: users.join(',') });
      } catch (error) {
        report.push({ key, ok: false, ms: Date.now() - startedAt, error: `${error.code}: ${error.message}`.slice(0, 120), users: users.join(',') });
      }
    }
    console.log(JSON.stringify(report, null, 1));
    const working = report.filter((entry) => entry.ok).length;
    console.log(`working sources: ${working}/${report.length}`);
    expect(working).toBeGreaterThan(0);
  });
});

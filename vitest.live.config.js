import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Opt-in live checks against real providers and the real Discord API, using
// the credentials in .dev.vars. Run with `npm run test:live`.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { GATEWAY_MODE: 'off', LOG_LEVEL: 'error' } },
    }),
  ],
  test: {
    include: ['test/live/**/*.live.js'],
    testTimeout: 180_000,
  },
});

import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with a placeholder token. Outbound fetch is
// mocked in every test, so no suite reaches Discord.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: { DISCORD_BOT_TOKEN: 'test-token' } } })],
  test: {
    include: ['test/**/*.test.js'],
  },
});

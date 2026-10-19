import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with the real Durable Object classes. Every
// credential is replaced with a test value so no suite can reach the live bot.
// Gateway objects only connect when a test calls them, against a fake Gateway.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          DISCORD_APPLICATION_ID: '111111111111111111',
          DISCORD_PUBLIC_KEY: 'd0687e9a59a439a7e6a0c6c34a0c5693227dd47408ae54e1aff4013b742f01a3',
          DISCORD_BOT_TOKEN: 'test-bot-token',
          NEKOBOT_AUTHORIZATION: 'test-nekobot-authorization',
          GATEWAY_MODE: 'full',
          PREMIUM_USER_IDS: '999999999999999999',
          LOG_LEVEL: 'error',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
  },
});

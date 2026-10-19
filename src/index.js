import { handleInteractionRequest } from './http/interactions.js';
import { runtimeFor } from './runtime.js';
import { runScheduled } from './scheduled.js';

export { CosplayPool } from './durable/cosplay-pool.js';
export { DiscordGateway } from './durable/discord-gateway.js';
export { UserQuota } from './durable/user-quota.js';

const INTERACTION_PATHS = new Set(['/', '/interactions']);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return new Response('Discord NSFW Media Bot is running. Point the Interactions Endpoint URL at /interactions.\n', {
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      });
    }
    if (!INTERACTION_PATHS.has(pathname)) return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }

    let runtime;
    try {
      runtime = runtimeFor(env);
    } catch (error) {
      console.error({ level: 'error', message: 'Invalid Worker configuration.', error: { name: error.name, message: error.message } });
      return new Response('Worker configuration is invalid.', { status: 500 });
    }
    return handleInteractionRequest(request, ctx, runtime);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduled(runtimeFor(env)));
  },
};

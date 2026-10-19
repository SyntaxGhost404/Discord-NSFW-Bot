import { verifyDiscordRequest } from './signature.js';

const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json;charset=UTF-8' });

// Discord's Interactions Endpoint URL. Every request is signature-checked
// before parsing; the acknowledgement is returned inline as the HTTP response
// body and any slower work continues through ctx.waitUntil().
export async function handleInteractionRequest(request, ctx, runtime) {
  const { config, logger, router } = runtime;
  if (!config.publicKey) {
    logger.error('DISCORD_PUBLIC_KEY is not configured, so interactions cannot be verified.');
    return new Response('Interactions endpoint is not configured.', { status: 500 });
  }

  const receivedAt = Date.now();
  const { valid, body } = await verifyDiscordRequest(request, config.publicKey);
  if (!valid) return new Response('invalid request signature', { status: 401 });

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response('invalid JSON body', { status: 400 });
  }

  const outcome = await router.route(interaction, { ...runtime, receivedAt, cf: request.cf ?? null });
  if (!outcome) return new Response('unsupported interaction type', { status: 400 });
  if (outcome.task) ctx.waitUntil(outcome.task);
  return new Response(JSON.stringify(outcome.response), { headers: JSON_HEADERS });
}

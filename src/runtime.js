import { commands } from './commands/index.js';
import { configFor } from './config.js';
import { InteractionRouter } from './brain/interaction-router.js';
import { ProviderCircuitBreaker } from './brain/providers/circuit-breaker.js';
import { createCosplayCatalog } from './brain/providers/cosplay-catalog.js';
import cosplayCatalogText from './brain/providers/cosplay-catalog.txt';
import { QuotaClient } from './brain/rate-limit/quota-client.js';
import { DiscordRest } from './discord/rest.js';
import { createLogger } from './lib/logger.js';

const runtimes = new WeakMap();
// A text module, so it is never parsed as code; it is indexed on first use.
// Node scripts such as npm run register never import this file.
const cosplayCatalog = createCosplayCatalog(cosplayCatalogText);

// Long-lived objects are built once per isolate and binding set. Module scope
// survives between requests in the same isolate, which lets the provider
// circuit breaker and Discord bucket memory learn across requests.
export function runtimeFor(env) {
  let runtime = runtimes.get(env);
  if (runtime) return runtime;

  const config = configFor(env);
  const logger = createLogger(config.logLevel);
  const fetchImpl = (...args) => fetch(...args);
  runtime = Object.freeze({
    config,
    env,
    logger,
    commands,
    fetch: fetchImpl,
    router: new InteractionRouter({ commands, logger }),
    circuitBreaker: new ProviderCircuitBreaker({ logger }),
    cosplayCatalog,
    quota: new QuotaClient({ namespace: env.USER_QUOTA, premiumUserIds: config.premiumUserIds, logger }),
    rest: new DiscordRest({ token: config.botToken, fetchImpl, logger }),
    webhookRest: new DiscordRest({ fetchImpl, logger }),
  });
  runtimes.set(env, runtime);
  return runtime;
}

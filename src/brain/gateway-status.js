import { shardName } from '../gateway/protocol.js';
import { withTimeout } from '../lib/time.js';

const STATUS_TIMEOUT_MS = 2_000;

// Reads shard 0's live state for diagnostics. Never throws: an unavailable
// Gateway object is reported as null.
export async function gatewayStatus(context) {
  const { config, env } = context;
  if (config.gateway.mode === 'off') return { mode: 'off', connected: false };
  if (!env?.GATEWAY) return null;
  try {
    const stub = env.GATEWAY.getByName(shardName(0, config.gateway.shardCount));
    const status = await withTimeout(stub.status(), STATUS_TIMEOUT_MS, null);
    return status ? { ...status, mode: config.gateway.mode } : null;
  } catch (error) {
    context.logger.warn('Could not read the Gateway session status.', { error });
    return null;
  }
}

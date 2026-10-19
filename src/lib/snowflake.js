import { DISCORD_EPOCH } from '../discord/constants.js';

export function snowflakeTimestamp(snowflake) {
  return Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH);
}

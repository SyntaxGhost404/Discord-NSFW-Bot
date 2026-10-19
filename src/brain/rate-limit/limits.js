export const FREE_MINUTE_LIMIT = 60;
export const FREE_DAILY_LIMIT = 1_000;
export const PREMIUM_DAILY_LIMIT = 5_000;
export const MINUTE_WINDOW_MS = 60_000;
export const FREE_UTILITY_COOLDOWN_MS = 2_000;

export function limitsFor(premium) {
  return Object.freeze({
    premium,
    minute: premium ? null : FREE_MINUTE_LIMIT,
    daily: premium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT,
    utilityCooldownMs: premium ? 0 : FREE_UTILITY_COOLDOWN_MS,
  });
}

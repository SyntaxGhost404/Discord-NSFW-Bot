import { DurableObject } from 'cloudflare:workers';
import * as quota from '../brain/rate-limit/quota-state.js';

const STATE_KEY = 'quota';

// One instance per Discord user ID, so DMs, group DMs and every guild share a
// single account quota with strongly consistent, serialized updates. The
// Worker decides Premium status and passes it in; time always comes from
// the object itself.
export class UserQuota extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = quota.freshState(Date.now());
    this.userId = null;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get(STATE_KEY);
      this.state = quota.normalizeState(saved, Date.now());
      this.userId = typeof saved?.userId === 'string' ? saved.userId : null;
    });
  }

  async reserveMedia({ userId, premium = false } = {}) {
    const now = Date.now();
    const result = quota.reserve(this.state, { premium, now, id: crypto.randomUUID() });
    if (result.allowed) await this.#save(userId);
    return { ...result, snapshot: quota.snapshot(this.state, { premium, now, userId }) };
  }

  async commitMedia({ userId, reservationId, premium = false } = {}) {
    const committed = quota.commit(this.state, { id: reservationId, premium, now: Date.now() });
    if (committed) await this.#save(userId);
    return committed;
  }

  async rollbackMedia({ userId, reservationId } = {}) {
    const released = quota.rollback(this.state, { id: reservationId });
    if (released) await this.#save(userId);
    return released;
  }

  async consumeUtility({ userId, premium = false } = {}) {
    const now = Date.now();
    const result = quota.consumeUtility(this.state, { premium, now });
    if (result.allowed) await this.#save(userId);
    return { ...result, snapshot: quota.snapshot(this.state, { premium, now, userId }) };
  }

  snapshot({ userId, premium = false } = {}) {
    return quota.snapshot(this.state, { premium, now: Date.now(), userId: userId ?? this.userId });
  }

  async #save(userId) {
    if (typeof userId === 'string') this.userId = userId;
    await this.ctx.storage.put(STATE_KEY, { ...quota.serialize(this.state), userId: this.userId });
  }
}

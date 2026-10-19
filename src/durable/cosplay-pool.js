import { DurableObject } from 'cloudflare:workers';
import { configFor } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { randomInteger, shuffle } from '../lib/random.js';
import { MediaHttpClient, SubrequestBudget, sniffImageType } from '../brain/providers/http.js';
import { hostIsFailing, mediaRequestHeaders, readFeedCeiling, readFeedPage } from '../brain/providers/cosplay-feed.js';
import { HENTAI_COSPLAY_FEED } from '../brain/providers/hentai-cosplay-xxx.js';

const TARGET_SIZE = 30;
const LOW_WATER = 20;
// A few links from each of many random pages keep consecutive images varied.
const LINKS_PER_PAGE = 5;
const PAGES_PER_REFILL = 4;
const REFILL_DELAY_MS = 1_000;
const RETRY_DELAY_MS = 60_000;
const DEAD_HOST_MS = 30 * 60 * 1_000;
const CEILING_TTL_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const REFILL_DEADLINE_MS = 60_000;
const SUBREQUESTS_PER_REFILL = 40;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// One shared object that keeps direct image links from random
// hentai-cosplay-xxx.com feed pages ready for /cosplay. The site builds every
// feed page on demand, which takes 0.5-4.5 seconds, so pages are read here in
// background alarms instead of while a user waits. Only links are stored:
// each image is still downloaded and checked when it is requested. Before a
// page's links are added, one ranged request confirms that their image server
// is up, because several of the site's servers answer 502 for every file.
export class CosplayPool extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.links = [];
    this.deadHosts = {};
    this.ceiling = null;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['links', 'deadHosts', 'ceiling']);
      this.links = Array.isArray(stored.get('links')) ? stored.get('links') : [];
      this.deadHosts = stored.get('deadHosts') ?? {};
      this.ceiling = stored.get('ceiling') ?? null;
    });
  }

  get logger() {
    if (!this.cachedLogger) {
      let level = 'info';
      try {
        level = configFor(this.env).logLevel;
      } catch {
        // An invalid configuration is reported by the call that read it.
      }
      this.cachedLogger = createLogger(level, { subsystem: 'cosplay-pool' });
    }
    return this.cachedLogger;
  }

  // Hands out one random prepared link, or null when none is ready, and
  // starts a refill once the pool runs low.
  async take() {
    this.#forgetRecoveredHosts(Date.now());
    let link = null;
    if (this.links.length > 0) {
      [link] = this.links.splice(randomInteger(0, this.links.length - 1), 1);
      await this.#save();
    }
    if (this.links.length < LOW_WATER) await this.#scheduleRefill(REFILL_DELAY_MS);
    return link;
  }

  // A download showed that this link's image server is down: drop every link
  // on it and keep it out of the pool for a while.
  async reportDeadHost(url) {
    const host = hostOf(url);
    if (!host) return;
    this.#markDead(host, Date.now());
    await this.#save();
    if (this.links.length < LOW_WATER) await this.#scheduleRefill(REFILL_DELAY_MS);
  }

  status() {
    return { size: this.links.length, deadHosts: Object.keys(this.deadHosts).sort(), ceiling: this.ceiling?.value ?? null };
  }

  async alarm() {
    let added = 0;
    try {
      added = await this.#refill();
    } catch (error) {
      this.logger.warn('Cosplay pool refill failed.', { error });
    }
    // Alarms are retried only a few times on errors, so the next run is
    // always scheduled here: soon while filling, later after a failed run.
    if (this.links.length < TARGET_SIZE) await this.#scheduleRefill(added > 0 ? REFILL_DELAY_MS : RETRY_DELAY_MS);
  }

  async #refill() {
    const feed = HENTAI_COSPLAY_FEED;
    const http = new MediaHttpClient({
      timeoutMs: REQUEST_TIMEOUT_MS,
      maximumBytes: 64 * 1024,
      deadline: Date.now() + REFILL_DEADLINE_MS,
      budget: new SubrequestBudget(SUBREQUESTS_PER_REFILL),
    });
    const ceiling = await this.#readCeiling(http);
    let added = 0;
    for (let pages = 0; pages < PAGES_PER_REFILL && this.links.length < TARGET_SIZE; pages += 1) {
      const page = randomInteger(1, ceiling);
      let urls;
      try {
        urls = await readFeedPage(http, feed, page);
      } catch (error) {
        if (error?.code === 'BUDGET_EXHAUSTED' || error?.code === 'DEADLINE_EXCEEDED') break;
        this.logger.debug('Cosplay pool could not read a feed page.', { page, code: error?.code });
        continue;
      }
      const known = new Set(this.links.map((link) => link.url));
      const fresh = shuffle(urls.filter((url) => !known.has(url) && !this.#isDead(hostOf(url), Date.now())));
      const live = await this.#liveHosts(http, feed, fresh);
      const chosen = fresh.filter((url) => live.has(hostOf(url))).slice(0, LINKS_PER_PAGE);
      this.links.push(...chosen.map((url) => ({ url, page })));
      added += chosen.length;
      await this.#save();
    }
    this.logger.debug('Cosplay pool refilled.', { added, size: this.links.length });
    return added;
  }

  async #readCeiling(http) {
    const now = Date.now();
    if (this.ceiling && now - this.ceiling.checkedAt < CEILING_TTL_MS) return this.ceiling.value;
    const { ceiling } = await readFeedCeiling(http, HENTAI_COSPLAY_FEED);
    this.ceiling = { value: ceiling, checkedAt: now };
    return ceiling;
  }

  // Reads the first bytes of one link per image server on the page.
  async #liveHosts(http, feed, urls) {
    const samples = new Map();
    for (const url of urls) {
      const host = hostOf(url);
      if (host && !samples.has(host)) samples.set(host, url);
    }
    const live = new Set();
    for (const [host, url] of samples) {
      try {
        const bytes = await http.peek(url, { headers: mediaRequestHeaders(feed), allowedHosts: feed.mediaHosts });
        if (sniffImageType(bytes)) live.add(host);
      } catch (error) {
        if (hostIsFailing(error)) this.#markDead(host, Date.now());
      }
    }
    return live;
  }

  #isDead(host, now) {
    return (this.deadHosts[host] ?? 0) > now;
  }

  #markDead(host, now) {
    this.deadHosts[host] = now + DEAD_HOST_MS;
    this.links = this.links.filter((link) => hostOf(link.url) !== host);
  }

  #forgetRecoveredHosts(now) {
    for (const [host, until] of Object.entries(this.deadHosts)) {
      if (until <= now) delete this.deadHosts[host];
    }
  }

  async #scheduleRefill(delayMs) {
    const at = Date.now() + delayMs;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  async #save() {
    await this.ctx.storage.put({ links: this.links, deadHosts: this.deadHosts, ceiling: this.ceiling });
  }
}

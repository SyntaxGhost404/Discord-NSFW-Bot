const EARLY_UNKNOWN_INTERACTION_MS = 2_500;
const UNKNOWN_INTERACTION_THRESHOLD = 2;
const CONFLICT_WINDOW_MS = 60_000;

export const InteractionFailureKind = Object.freeze({
  COMPETING_CONSUMER: 'competing-consumer',
  POSSIBLE_COMPETING_CONSUMER: 'possible-competing-consumer',
  MISSED_DEADLINE: 'missed-deadline',
  EXPIRED_WEBHOOK: 'expired-webhook',
  UNAVAILABLE: 'unavailable',
});

export function classifyInteractionFailure(error, {
  responseState,
  elapsedMs = Number.POSITIVE_INFINITY,
  interactionAgeMs = null,
} = {}) {
  const code = Number(error?.code);
  const initialCallbackFailed = responseState === 'unavailable';
  const freshInteraction = elapsedMs < EARLY_UNKNOWN_INTERACTION_MS
    && (!Number.isFinite(interactionAgeMs) || interactionAgeMs < EARLY_UNKNOWN_INTERACTION_MS);

  if (code === 40060 && initialCallbackFailed) {
    return Object.freeze({
      kind: InteractionFailureKind.COMPETING_CONSUMER,
      code,
      confirmed: true,
    });
  }
  if (code === 10062 && initialCallbackFailed && freshInteraction) {
    return Object.freeze({
      kind: InteractionFailureKind.POSSIBLE_COMPETING_CONSUMER,
      code,
      confirmed: false,
    });
  }
  if (code === 10062 && initialCallbackFailed) {
    return Object.freeze({
      kind: InteractionFailureKind.MISSED_DEADLINE,
      code,
      confirmed: false,
    });
  }
  if (code === 10015 || (code === 10062 && !initialCallbackFailed)) {
    return Object.freeze({
      kind: InteractionFailureKind.EXPIRED_WEBHOOK,
      code,
      confirmed: false,
    });
  }
  return Object.freeze({
    kind: InteractionFailureKind.UNAVAILABLE,
    code: Number.isFinite(code) ? code : null,
    confirmed: false,
  });
}

export class InteractionConflictMonitor {
  constructor({
    logger,
    onConflict = null,
    now = Date.now,
    conflictWindowMs = CONFLICT_WINDOW_MS,
    unknownThreshold = UNKNOWN_INTERACTION_THRESHOLD,
  }) {
    this.logger = logger.child({ subsystem: 'interaction-ownership' });
    this.onConflict = onConflict;
    this.now = now;
    this.conflictWindowMs = conflictWindowMs;
    this.unknownThreshold = unknownThreshold;
    this.earlyUnknownFailures = [];
    this.triggered = false;
  }

  record({
    error,
    command,
    source,
    interactionId,
    responseState,
    elapsedMs,
    interactionAgeMs = null,
  }) {
    const classification = classifyInteractionFailure(error, {
      responseState,
      elapsedMs,
      interactionAgeMs,
    });
    const normalizedElapsedMs = Number.isFinite(elapsedMs)
      ? Math.max(0, Math.round(elapsedMs))
      : null;
    const normalizedInteractionAgeMs = Number.isFinite(interactionAgeMs)
      ? Math.max(0, Math.round(interactionAgeMs))
      : null;
    const diagnostic = Object.freeze({
      ...classification,
      command,
      source,
      interactionId,
      responseState,
      elapsedMs: normalizedElapsedMs,
      interactionAgeMs: normalizedInteractionAgeMs,
    });

    if (classification.kind === InteractionFailureKind.COMPETING_CONSUMER) {
      this.#trigger(diagnostic);
    } else if (classification.kind === InteractionFailureKind.POSSIBLE_COMPETING_CONSUMER) {
      const now = this.now();
      this.earlyUnknownFailures = this.earlyUnknownFailures
        .filter((timestamp) => now - timestamp < this.conflictWindowMs);
      this.earlyUnknownFailures.push(now);
      if (this.earlyUnknownFailures.length >= this.unknownThreshold) {
        this.#trigger({ ...diagnostic, confirmed: true });
      } else if (!this.triggered) {
        this.logger.warn('Discord rejected a fresh interaction callback unusually early.', {
          code: classification.code,
          command,
          source,
          interactionId,
          callbackElapsedMs: diagnostic.elapsedMs,
          interactionAgeMs: diagnostic.interactionAgeMs,
          conflictEvidence: `${this.earlyUnknownFailures.length}/${this.unknownThreshold}`,
          likelyCause: 'another process is using the same BOT_TOKEN',
        });
      }
    } else if (classification.kind === InteractionFailureKind.MISSED_DEADLINE) {
      this.logger.warn('Discord invalidated an interaction before its initial callback arrived.', {
        code: classification.code,
        command,
        source,
        interactionId,
        callbackElapsedMs: diagnostic.elapsedMs,
        interactionAgeMs: diagnostic.interactionAgeMs,
        deadlineMs: 3_000,
      });
    } else if (classification.kind === InteractionFailureKind.EXPIRED_WEBHOOK) {
      this.logger.debug('Discord interaction webhook is no longer available.', {
        code: classification.code,
        command,
        source,
        interactionId,
        responseState,
      });
    } else {
      this.logger.warn('Discord interaction is no longer available.', {
        code: classification.code,
        command,
        source,
        interactionId,
        responseState,
      });
    }

    return diagnostic;
  }

  #trigger(diagnostic) {
    if (this.triggered) return;
    this.triggered = true;
    this.logger.warn('Another live bot process acknowledged this interaction first; yielding this duplicate Gateway session.', {
      code: diagnostic.code,
      command: diagnostic.command,
      source: diagnostic.source,
      interactionId: diagnostic.interactionId,
      callbackElapsedMs: diagnostic.elapsedMs,
      interactionAgeMs: diagnostic.interactionAgeMs,
      action: 'keep exactly one Replit Run or Deployment active for this BOT_TOKEN',
    });
    try {
      const result = this.onConflict?.(diagnostic);
      Promise.resolve(result).catch((error) => {
        this.logger.error('Failed to yield the competing Gateway session.', { error });
      });
    } catch (error) {
      this.logger.error('Failed to yield the competing Gateway session.', { error });
    }
  }
}

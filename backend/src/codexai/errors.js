// One error type for every AI provider, so the orchestrator can show the right plain-language limitation.
export class AiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;           // AUTH | RATE_LIMIT | QUOTA | BUSY | NETWORK | UPSTREAM | MODEL_NOT_FOUND | BAD_INPUT | NOT_CONFIGURED | DISABLED | PAID_BLOCKED | TIMEOUT
    Object.assign(this, extra); // status, retryAfterSec …
  }
}

// What a person sees. Never includes keys, URLs or provider response bodies.
export function friendly(err, { engineLabel = 'This AI engine', admin = false } = {}) {
  const code = err?.code;
  if (code === 'LIMIT') return err.message;       // our own free-plan guard rails already carry a plain-language message
  const m = {
    NOT_CONFIGURED: `${engineLabel} isn't set up on this server yet.`,
    DISABLED: `${engineLabel} is switched off by the admin right now.`,
    AUTH: admin ? `${engineLabel}: the provider rejected the API key. Check it in the server settings.` : `${engineLabel} is unavailable right now. The admin has been notified in the dashboard.`,
    RATE_LIMIT: `${engineLabel} has reached its free usage limit for now. Please try again later — free plans reset on a schedule and are not unlimited.`,
    QUOTA: `${engineLabel} has used up today's free allowance. It resets at 00:00 UTC. Free generation is limited, not unlimited.`,
    BUSY: `${engineLabel} is busy right now. Please try again in a moment.`,
    NETWORK: `${engineLabel} couldn't be reached. Please try again.`,
    TIMEOUT: `${engineLabel} took too long to answer. Please try again.`,
    UPSTREAM: `${engineLabel} had a problem on the provider side. Please try again.`,
    MODEL_NOT_FOUND: admin ? `${engineLabel}: the selected model wasn't found on the provider. Pick another in the admin dashboard.` : `${engineLabel} is unavailable right now.`,
    PAID_BLOCKED: `${engineLabel} would need a paid plan, and CHEX is in free-only mode, so it was not used.`,
    BAD_INPUT: err?.message || 'That request could not be processed.',
  };
  return m[code] || `${engineLabel} could not complete that. Please try again.`;
}

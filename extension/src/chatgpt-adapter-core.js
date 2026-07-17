export class StableResponseTracker {
  constructor({ previousText = "", stableRequired = 2 } = {}) {
    this.previousText = clean(previousText);
    this.stableRequired = stableRequired;
    this.lastText = "";
    this.stable = 0;
  }

  observe(value, { generating = false } = {}) {
    const text = clean(value);
    if (!text || text === this.previousText) return { done: false, text };
    if (text === this.lastText) this.stable += 1;
    else {
      this.lastText = text;
      this.stable = 0;
    }
    return { done: !generating && this.stable >= this.stableRequired, text, stable: this.stable };
  }
}

export function classifyProviderState({ hasComposer, bodyText = "" } = {}) {
  const text = clean(bodyText).toLowerCase();
  if (/verify you are human|captcha|cloudflare|security check|challenge/.test(text)) {
    return { state: "challenge_required", ready: false, retryable: false };
  }
  if (!hasComposer && /log in|sign in|đăng nhập/.test(text)) {
    return { state: "login_required", ready: false, retryable: true };
  }
  if (/rate limit|too many requests|try again later|reached.*limit/.test(text)) {
    return { state: "rate_limited", ready: false, retryable: true };
  }
  if (hasComposer) return { state: "ready", ready: true, retryable: false };
  return { state: "dom_incompatible", ready: false, retryable: false };
}

export function normalizeModelCandidates(values) {
  const accepted = /^(?:GPT(?:-[A-Za-z0-9. -]+)?|ChatGPT(?:\s+[A-Za-z0-9. -]+)?|o\d(?:[A-Za-z0-9. -]+)?|Auto|Thinking|Fast)$/i;
  const output = [];
  for (const value of values || []) {
    const label = clean(value);
    if (!label || !accepted.test(label) || output.some((item) => item.toLowerCase() === label.toLowerCase())) continue;
    output.push(label);
  }
  return output.slice(0, 20);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}


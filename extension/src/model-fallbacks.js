// Model fallback combos for LLM routing
// When primary model fails, use fallback chain

export const MODEL_FALLBACK_CHAINS = {
  // TheRouter aggregator aliases
  "gpt-5.4": ["gpt-4o", "gpt-4.1", "gpt-4-turbo"],
  "gpt-5.5": ["gpt-4o", "gpt-4.1", "gpt-4-turbo"],
  "gpt-5.4-pro": ["gpt-4o", "claude-sonnet-4", "gemini-2.5-flash"],
  "gpt-5.4-mini": ["gpt-4o-mini", "gpt-4o", "claude-haiku-4.5"],
  "gpt-5.2": ["gpt-4o", "gpt-4.1"],
  "gpt-5.3-codex": ["gpt-4o", "claude-sonnet-4"],
  
  // Claude variants
  "claude-opus-4.8": ["claude-opus-4", "gpt-4o", "gemini-2.5-flash"],
  "claude-sonnet-5": ["claude-sonnet-4", "gpt-4o", "gemini-2.5-flash"],
  
  // Gemini variants
  "gemini-3.5-flash": ["gemini-2.5-flash", "gpt-4o", "claude-sonnet-4"],
  
  // OpenRouter style aliases
  "openai/gpt-5.3-codex": ["gpt-4o", "claude-sonnet-4"],
  "openai/gpt-5.2": ["gpt-4o", "gpt-4.1"],
};

// Default fallback chain when model not in map
const DEFAULT_FALLBACK_CHAIN = ["gpt-4o", "gpt-4.1", "gpt-4-turbo"];

export function getFallbackChain(modelId) {
  const normalizedId = String(modelId || "").toLowerCase().trim();
  
  // Check exact match first
  for (const [key, chain] of Object.entries(MODEL_FALLBACK_CHAINS)) {
    if (key.toLowerCase() === normalizedId) return chain;
  }
  
  // Check partial matches (for aliases like gpt-5.4-pro, gpt-5.4-mini)
  for (const [key, chain] of Object.entries(MODEL_FALLBACK_CHAINS)) {
    if (normalizedId.startsWith(key.toLowerCase().replace(/\.\*$/, ""))) {
      return chain;
    }
  }
  
  // Return default chain for unknown models
  return DEFAULT_FALLBACK_CHAIN;
}

export function isValidModel(modelId) {
  const validModels = [
    "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4o-mini",
    "claude-opus-4", "claude-sonnet-4", "claude-haiku-4.5",
    "gemini-2.5-flash", "gemini-2.5-pro",
    "kimi-k2", "qwen3-coder"
  ];
  
  const normalized = String(modelId || "").toLowerCase().trim();
  return validModels.some(m => m.toLowerCase() === normalized || normalized.startsWith(m.toLowerCase()));
}

export function getRouterAliases() {
  return Object.keys(MODEL_FALLBACK_CHAINS);
}
// model-fallbacks-enhanced.js
// Extended model fallback combos với FREE_PROVIDER_IDS integration
// Khi primary model thất bại, tự động fallback tới free tier providers

import { MODEL_FALLBACK_CHAINS, getFallbackChain as getBaseFallbackChain } from './model-fallbacks.js';

// Free tier provider chains
export const FREE_TIER_FALLBACKS = {
  // Free tier priority chains (ordered by preference)
  "freebuff": ["freebuff/gpt-4", "freebuff/gpt-3.5", "gpt-4o"],
  "opencode": ["opencode/auto", "opencode/gpt-4", "gpt-4o"],
  "deepseek": ["deepseek-chat", "deepseek-coder", "gpt-4o"],
  "glm": ["glm-4", "glm-3-turbo", "gpt-4o"],
  "openrouter": ["openrouter/auto", "openrouter/gpt-4", "gpt-4o"],
  
  // Free tier chains cho từng model category
  "gpt-4o-free": ["freebuff/gpt-4", "opencode/auto", "openrouter/gpt-4"],
  "gpt-4-free": ["freebuff/gpt-4", "deepseek-chat", "glm-4"],
  "claude-free": ["opencode/claude", "openrouter/claude", "gpt-4o"],
};

// Extended fallback chains including free tier
export const EXTENDED_FALLBACK_CHAINS = {
  ...MODEL_FALLBACK_CHAINS,
  
  // Free tier chains
  "gpt-5.4": ["gpt-4o", "freebuff/gpt-4", "opencode/auto", "gpt-4.1"],
  "gpt-5.5": ["gpt-4o", "freebuff/gpt-4", "deepseek-chat", "gpt-4.1"],
  "gpt-4o": ["gpt-4o", "freebuff/gpt-4", "opencode/auto", "gpt-4.1"],
  
  // Direct free tier aliases
  "free": ["freebuff", "opencode", "deepseek", "glm", "openrouter"],
  "free-best": ["freebuff/gpt-4", "opencode/auto", "deepseek-chat", "glm-4"],
};

// Get fallback chain with free tier support
export function getFallbackChain(modelId, options = {}) {
  const { includeFreeTier = true, freeTierOnly = false } = options;
  
  // If free tier only, return free tier chains
  if (freeTierOnly) {
    const freeChain = FREE_TIER_FALLBACKS[modelId];
    if (freeChain) return freeChain;
    // Default free chain
    return ["freebuff/gpt-4", "opencode/auto", "deepseek-chat", "glm-4"];
  }
  
  // Get base chain
  const baseChain = EXTENDED_FALLBACK_CHAINS[modelId] || getBaseFallbackChain(modelId);
  
  // If include free tier, append free providers to chain
  if (includeFreeTier) {
    return [...baseChain, ...getFreeTierAppend()];
  }
  
  return baseChain;
}

// Free tier providers to append when quota available
function getFreeTierAppend() {
  return ["freebuff/gpt-4", "opencode/auto", "deepseek-chat"];
}

// Get free tier providers list
export async function getFreeTierProviders() {
  try {
    const res = await fetch("http://localhost:20128/v1/free-tier/providers");
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Return cached/default providers
  }
  
  return ["freebuff", "opencode", "deepseek", "glm", "openrouter"];
}

// Check if provider is free tier
export function isFreeTierProvider(providerId) {
  const freeProviders = ["freebuff", "opencode", "deepseek", "glm", "openrouter", "agentrouter"];
  return freeProviders.includes(providerId.toLowerCase());
}

// Get provider model mapping
export const PROVIDER_MODEL_MAP = {
  freebuff: {
    models: ["gpt-4", "gpt-3.5-turbo", "claude-3.5-sonnet"],
    default: "gpt-4"
  },
  opencode: {
    models: ["auto", "gpt-4", "claude-3.5-sonnet", "gemini-pro"],
    default: "auto"
  },
  deepseek: {
    models: ["deepseek-chat", "deepseek-coder"],
    default: "deepseek-chat"
  },
  glm: {
    models: ["glm-4", "glm-3-turbo"],
    default: "glm-4"
  },
  openrouter: {
    models: ["auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4"],
    default: "auto"
  }
};

export function getRouterAliases() {
  return [...Object.keys(EXTENDED_FALLBACK_CHAINS)];
}
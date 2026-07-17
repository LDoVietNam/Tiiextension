// model-auto-select.js - Wrapper around model-selector.js for popup integration
// Provides simplified auto-select interface for UI

import { getModelSelector } from './model-selector.js';
import { storage } from './browser-polyfill.js';

const FREE_PROVIDERS = ['groq', 'kira', 'openrouter', 'iflow'];
const PAID_PROVIDERS = ['deepseek', 'together', 'anthropic'];

export async function autoSelectModel(userMessage = '') {
  const selector = getModelSelector();
  const task = selector.analyzeTask(userMessage);
  
  // Try to get saved tokens first
  const tokensObj = await storage.local.get('tokens') || {};
  const savedTokens = tokensObj.tokens || {};
  const availableProviders = [];
  
  // Priority: free providers with tokens → any free provider → paid providers
  for (const provider of [...FREE_PROVIDERS, ...PAID_PROVIDERS]) {
    if (savedTokens[provider] || FREE_PROVIDERS.includes(provider)) {
      availableProviders.push(provider);
    }
  }
  
  // Get model selection with provider hint
  const result = await selector.selectModel(userMessage, {
    constraints: { maxCost: 0.5, maxLatency: 10000 },
    availableModels: availableProviders.map(p => ({ id: p }))
  });
  
  return {
    model: result.selected,
    provider: availableProviders[0] || null,
    task: result.task,
    confidence: result.confidence,
    fallbackChain: result.fallbackChain,
    source: 'auto-select',
    profile: result.profile
  };
}
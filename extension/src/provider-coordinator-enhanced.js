// provider-coordinator-enhanced.js
// Extended provider coordinator with fallback chain support
// Integrates with OmniRoute FREE_PROVIDER_IDS strategies

import {
  createProviderCoordinator
} from './provider-coordinator.js';
import {
  callWithFreeTierFallback,
  syncFreeProviders,
  getProviderOrder
} from './provider-gateway-enhanced.js';

// Extended coordinator with fallback chain
export function createEnhancedCoordinator(adapter, opts = {}) {
  const base = createProviderCoordinator(adapter, opts);
  
  // Extended request with fallback
  async function requestWithFallback(tabId, request, options = {}) {
    const { strategy = "priority", freeTierOnly = false, maxRetries = 3 } = options;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await callWithFreeTierFallback(request.messages, {
          model: request.model,
          strategy,
          freeTierOnly
        });
        
        if (result?.ok) {
          return {
            ...result,
            attempt: attempt + 1,
            strategy
          };
        }
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        // Wait before retry (exponential backoff)
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
  }
  
  // Get free tier status
  async function getFreeTierStatus() {
    const providers = await syncFreeProviders();
    return {
      totalProviders: providers?.length || 0,
      lastSync: opts._freeProvidersSync || null,
      quotaUsage: opts._quotaUsage || {}
    };
  }
  
  // Get suggested provider (least-used)
  async function suggestProvider() {
    const order = await getProviderOrder("least-used");
    return order[0];
  }
  
  return {
    ...base,
    requestWithFallback,
    getFreeTierStatus,
    suggestProvider
  };
}

// Export singleton for extension use
let _enhancedCoordinator = null;

export function getEnhancedCoordinator(adapter, opts = {}) {
  if (!_enhancedCoordinator) {
    _enhancedCoordinator = createEnhancedCoordinator(adapter, opts);
  }
  return _enhancedCoordinator;
}

// Usage tracking for UI
export function trackUsage(provider, model, tokens) {
  const key = `${provider}:${model}`;
  const current = opts._quotaUsage?.get(key) || 0;
  opts._quotaUsage?.set(key, current + tokens);
}
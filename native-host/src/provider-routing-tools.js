export function createProviderRoutingTools(stateStore, context = {}) {
  const events = context.events || null;
  const audit = context.audit || null;

  function scoreProvider(provider) {
    const scores = {
      health: provider.status === "available" ? 100 : 0,
      latency: provider.latencyMs || 0,
      failures: provider.failureCount || 0,
      circuitBroken: provider.circuitBroken ? 100 : 0,
      capabilityMatch: (provider.requiredCapabilities || []).length ? 100 : 50
    };

    let score = 0;
    if (scores.health > 0) score += 40;
    score -= Math.min(20, scores.failures);
    score -= Math.min(20, Math.floor(scores.latency / 100));
    if (scores.circuitBroken > 0) score = 0;
    score += scores.capabilityMatch;

    return Math.max(0, score);
  }

  async function routeProvider({ provider: providerId = "auto", model: modelId = "auto", capability, requiredCapabilities = [] } = {}) {
    const state = stateStore.state || { providers: [] };
    const candidates = state.providers.filter(p => {
      if (providerId !== "auto" && p.providerId !== providerId) return false;
      if (requiredCapabilities.length > 0) {
        const hasAll = requiredCapabilities.every(c => p.capabilities?.includes(c));
        if (!hasAll) return false;
      }
      if (capability && !(p.capabilities || []).includes(capability)) return false;
      return p.status === "available" || p.status === "ready";
    });

    if (candidates.length === 0) {
      return { selected: null, reason: "no_eligible_providers", candidates: 0 };
    }

    const scored = candidates.map(p => ({
      ...p,
      score: scoreProvider(p),
      eligible: p.status !== "unavailable" && !p.circuitBroken
    })).sort((a, b) => b.score - a.score);

    const selected = scored.find(p => p.eligible);

    await audit?.append({
      type: "provider.routed",
      provider: selected?.providerId,
      model: selected?.modelId,
      score: selected?.score
    });

    return {
      selected: selected ? {
        providerId: selected.providerId,
        modelId: selected.modelId,
        url: selected.url,
        apiKey: selected.apiKey ? "REDACTED" : undefined,
        capabilities: selected.capabilities,
        status: selected.status,
        latencyMs: selected.latencyMs,
        failureCount: selected.failureCount,
        circuitBroken: selected.circuitBroken
      } : null,
      reason: selected ? "selected" : "circuit_broken",
      score: selected?.score || 0,
      candidates: scored.length
    };
  }

  async function listRoutableProviders({ status } = {}) {
    const state = stateStore.state || { providers: [] };
    const providers = state.providers
      .filter(p => !status || p.status === status)
      .map(p => ({
        ...p,
        score: scoreProvider(p),
        eligible: p.status !== "unavailable" && !p.circuitBroken,
        providerId: p.providerId || p.provider,
        modelId: p.modelId || p.model
      }));

    return { providers: providers.sort((a, b) => b.score - a.score) };
  }

  async function providerMetrics({ key } = {}) {
    const state = stateStore.state || { providers: [], providerMetrics: {} };

    const metrics = state.providerMetrics || {};
    const candidates = Object.entries(metrics).map(([k, m]) => ({
      key: k,
      ...m
    }));

    if (key) {
      const found = candidates.find(c => c.key === key);
      return { metrics: found || null };
    }

    return { metrics: candidates };
  }

  async function resetProviderCircuit({ key } = {}) {
    const state = stateStore.state || { providers: [], providerMetrics: {} };

    const provider = state.providers.find(p => {
      const pid = p.providerId || p.provider;
      return pid === key || p.modelId === key;
    });

    if (!provider) {
      return { ok: false, error: "Provider not found", key };
    }

    provider.circuitBroken = false;
    provider.failureCount = 0;
    provider.lastFailureAt = null;

    await audit?.append({ type: "provider.circuit_reset", key });

    return { ok: true, key, reset: true };
  }

  const definitions = [
    ["route_provider", "Chọn Web LLM session tốt nhất theo model, provider, capability, health và lịch sự lỗi.", { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, capability: { type: "string" }, requiredCapabilities: { type: "array", items: { type: "string" } } } }],
    ["list_routable_providers", "Liệt kê provider Web LLM kèm health, score, độ trễ và circuit breaker.", { type: "object", properties: { status: { type: "string" } } }],
    ["provider_metrics", "Đọc success rate, latency, failure streak và circuit state của provider.", { type: "object", properties: { key: { type: "string" } } }],
    ["reset_provider_circuit", "Đặt lại circuit breaker của provider sau khi người dùng khắc phục session.", { type: "object", properties: { key: { type: "string" } }, required: ["key"] }]
  ].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

  return { definitions, async call(name, args = {}) {
    const handlers = { routeProvider, listRoutableProviders, providerMetrics, resetProviderCircuit };
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown routing tool: ${name}`);
    return handler(args);
  }};
}
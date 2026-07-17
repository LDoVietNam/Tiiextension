// model-selector.js
// Intelligent model selection for AI agents
// Pattern: Agent-driven model choice based on task complexity, cost, latency
// Instead of forcing user to pick, the extension auto-selects optimal model

import { ROUTER_MODEL_MAP, PROVIDER_FALLBACK_ORDER, GATEWAY_CANDIDATES, getProviderConfig } from './provider-presets.js';
import { MODEL_FALLBACK_CHAINS } from './model-fallbacks.js';

// Task complexity → preferred model tier
const TASK_PROFILES = {
  trivial: {
    // Simple Q&A, formatting, translation
    preferred: ["gpt-4o-mini", "gemini-2.5-flash", "claude-haiku-4.5"],
    maxCost: 0.1,
    maxLatency: 2000
  },
  simple: {
    // Standard chat, summarization, basic coding
    preferred: ["gpt-4o", "claude-sonnet-4", "gemini-2.5-flash"],
    maxCost: 0.5,
    maxLatency: 5000
  },
  moderate: {
    // Multi-step reasoning, code generation, analysis
    preferred: ["gpt-5.4", "claude-sonnet-4", "gemini-2.5-pro"],
    maxCost: 2.0,
    maxLatency: 15000
  },
  complex: {
    // Deep reasoning, architecture, debugging large systems
    preferred: ["gpt-5.4-pro", "claude-opus-4.8", "o3"],
    maxCost: 10.0,
    maxLatency: 30000
  },
  creative: {
    // Writing, brainstorming, roleplay
    preferred: ["gpt-5.5", "claude-opus-4", "gemini-2.5-pro"],
    maxCost: 3.0,
    maxLatency: 10000
  },
  code: {
    // Programming tasks
    preferred: ["gpt-5.4", "claude-opus-4.8", "qwen3-coder", "kimi-k2"],
    maxCost: 2.0,
    maxLatency: 12000
  }
};

// Keywords to detect task type from prompt
const TASK_KEYWORDS = {
  trivial: ["translate", "format", "fix typo", "capitalize", "count", "list", "what is", "định dạng", "dịch"],
  simple: ["summarize", "explain", "write email", "draft", "tóm tắt", "giải thích", "viết"],
  moderate: ["implement", "debug", "refactor", "analyze", "design", "triển khai", "phân tích", "code"],
  complex: ["architect", "optimize system", "security audit", "reverse engineer", "scale", "kiến trúc", "bảo mật"],
  creative: ["story", "poem", "brainstorm", "character", "truyện", "thơ", "sáng tạo"],
  code: ["function", "class", "algorithm", "api", "database", "test", "typescript", "python", "javascript"]
};

// Available models (from gateway health check or static list)
let _availableModels = null;
let _availableAt = 0;
const MODEL_CACHE_TTL = 60000;

export function getModelSelector() {
  return {
    selectModel,
    analyzeTask,
    setAvailableModels,
    getAvailableModels,
    buildFallbackChain,
    scoreModel
  };
}

/**
 * Analyze task type from goal text.
 * Pattern: keyword-based heuristic classification
 */
function analyzeTask(goal = "") {
  const text = String(goal).toLowerCase();
  const scores = {};
  
  for (const [type, keywords] of Object.entries(TASK_KEYWORDS)) {
    scores[type] = keywords.filter(kw => text.includes(kw.toLowerCase())).length;
  }
  
  // Code detection: presence of code blocks or programming terms
  if (text.includes("```") || /\b(func|def|class|import|const|var|let)\b/.test(text)) {
    scores.code += 2;
  }
  
  // Length-based complexity
  const words = text.split(/\s+/).length;
  if (words > 200) scores.complex += 1;
  else if (words > 50) scores.moderate += 1;
  
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const taskType = best[1] > 0 ? best[0] : "simple";
  
  return {
    type: taskType,
    confidence: best[1] / Math.max(1, Object.values(scores).reduce((a, b) => a + b, 0)),
    scores,
    wordCount: words
  };
}

/**
 * Select optimal model for a task.
 * Pattern: task profile → preferred models → filter by availability → score
 */
async function selectModel(goal, { constraints = {}, availableModels = null } = {}) {
  const task = analyzeTask(goal);
  const profile = TASK_PROFILES[task.type] || TASK_PROFILES.simple;
  
  // Get available models
  const available = availableModels || await getAvailableModels();
  const availableSet = new Set(available.map(m => m.id || m));
  
  // Filter preferred by availability
  const candidates = profile.preferred.filter(m => availableSet.has(m) || availableSet.has(ROUTER_MODEL_MAP[m] || m));
  const modelPool = candidates.length > 0 ? candidates : available;
  
  // Score each candidate
  const scored = modelPool.map(modelId => ({
    model: modelId,
    score: scoreModel(modelId, task, profile, constraints)
  })).sort((a, b) => b.score - a.score);
  
  const selected = scored[0]?.model || profile.preferred[0] || "gpt-4o";
  const chain = buildFallbackChain(selected);
  
  return {
    selected,
    task: task.type,
    confidence: task.confidence,
    fallbackChain: chain,
    scored: scored.slice(0, 5),
    profile: {
      maxCost: profile.maxCost,
      maxLatency: profile.maxLatency
    }
  };
}

/**
 * Score a model for a task.
 * Higher = better fit.
 */
function scoreModel(modelId, task, profile, constraints = {}) {
  let score = 0;
  
  // Base: is it in preferred list?
  const idx = profile.preferred.indexOf(modelId);
  if (idx !== -1) score += 100 - idx * 10;
  
  // Cost preference
  if (constraints.maxCost) {
    const cost = estimateCost(modelId);
    if (cost <= constraints.maxCost) score += 20;
    else score -= 30;
  }
  
  // Latency preference
  if (constraints.maxLatency) {
    const latency = estimateLatency(modelId);
    if (latency <= constraints.maxLatency) score += 10;
    else score -= 10;
  }
  
  // Task-type affinity
  score += taskAffinity(modelId, task.type);
  
  // User preference
  if (constraints.preferredModel === modelId) score += 50;
  
  return Math.max(0, score);
}

// Model affinity scores per task type
const AFFINITY = {
  trivial: { "gpt-4o-mini": 30, "gemini-2.5-flash": 25, "claude-haiku-4.5": 25 },
  simple: { "gpt-4o": 30, "claude-sonnet-4": 28, "gemini-2.5-flash": 25 },
  moderate: { "gpt-5.4": 30, "claude-sonnet-4": 28, "gemini-2.5-pro": 25 },
  complex: { "gpt-5.4-pro": 35, "claude-opus-4.8": 32, "o3": 30 },
  creative: { "gpt-5.5": 30, "claude-opus-4": 28, "gemini-2.5-pro": 25 },
  code: { "gpt-5.4": 30, "claude-opus-4.8": 32, "qwen3-coder": 28, "kimi-k2": 25 }
};

function taskAffinity(modelId, taskType) {
  return AFFINITY[taskType]?.[modelId] || 0;
}

// Rough cost estimates (USD per 1K tokens)
const COST_ESTIMATE = {
  "gpt-4o-mini": 0.01,
  "gemini-2.5-flash": 0.015,
  "claude-haiku-4.5": 0.02,
  "gpt-4o": 0.05,
  "claude-sonnet-4": 0.06,
  "gemini-2.5-pro": 0.07,
  "gpt-5.4": 0.1,
  "gpt-5.5": 0.15,
  "claude-opus-4.8": 0.5,
  "gpt-5.4-pro": 0.8,
  "o3": 1.0,
  "qwen3-coder": 0.05,
  "kimi-k2": 0.08
};

function estimateCost(modelId) {
  return COST_ESTIMATE[modelId] || 0.1;
}

// Rough latency estimates (ms)
const LATENCY_ESTIMATE = {
  "gpt-4o-mini": 1500,
  "gemini-2.5-flash": 1200,
  "claude-haiku-4.5": 1800,
  "gpt-4o": 3000,
  "claude-sonnet-4": 3500,
  "gemini-2.5-pro": 4000,
  "gpt-5.4": 6000,
  "gpt-5.5": 7000,
  "claude-opus-4.8": 12000,
  "gpt-5.4-pro": 18000,
  "o3": 25000,
  "qwen3-coder": 5000,
  "kimi-k2": 6000
};

function estimateLatency(modelId) {
  return LATENCY_ESTIMATE[modelId] || 5000;
}

/**
 * Build fallback chain for a model.
 * Uses model-fallbacks.js chains, then provider fallback order.
 */
function buildFallbackChain(modelId) {
  // Check explicit chains
  if (MODEL_FALLBACK_CHAINS[modelId]) {
    return [modelId, ...MODEL_FALLBACK_CHAINS[modelId]];
  }
  
  // Check router aliases
  const routerModel = ROUTER_MODEL_MAP[modelId];
  if (routerModel && MODEL_FALLBACK_CHAINS[routerModel]) {
    return [modelId, ...MODEL_FALLBACK_CHAINS[routerModel]];
  }
  
  // Default
  return [modelId, "gpt-4o", "gpt-4.1"];
}

/**
 * Set available models (from gateway discovery).
 */
function setAvailableModels(models) {
  _availableModels = models;
  _availableAt = Date.now();
}

/**
 * Get available models (cached).
 */
async function getAvailableModels() {
  const now = Date.now();
  if (_availableModels && now - _availableAt < MODEL_CACHE_TTL) {
    return _availableModels;
  }
  
  // Try gateway discovery
  try {
    const { fetchGatewayModels } = await import('./provider-gateway.js');
    const result = await fetchGatewayModels();
    if (result?.models?.length) {
      _availableModels = result.models.map(id => ({ id }));
      _availableAt = now;
      return _availableModels;
    }
  } catch {
    /* ignore */
  }
  
  // Fallback: static list
  const staticList = [
    "gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-5.4", "gpt-5.5",
    "claude-haiku-4.5", "claude-sonnet-4", "claude-opus-4.8",
    "gemini-2.5-flash", "gemini-2.5-pro",
    "grok-2", "deepseek-chat", "qwen3-coder", "kimi-k2"
  ];
  _availableModels = staticList.map(id => ({ id }));
  _availableAt = now;
  return _availableModels;
}
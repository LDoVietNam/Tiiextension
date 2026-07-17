// TheRouter/Tirouter provider presets for extension
// Tirouter AI Gateway Hub: CLIProxyAPI (20128, OpenAI-compatible) + OmniRoute (1807, 160+ providers)
// The gateway already aggregates ChatGPT/Claude/Gemini/Grok/DeepSeek as OpenAI-compatible models,
// so "multi-site AI chat" becomes "select model from gateway" instead of per-site DOM adapters.

// Auto-discovery candidates (checked at runtime, first reachable wins priority).
export const GATEWAY_CANDIDATES = [
  { id: "tirouter-local", baseUrl: "http://localhost:20128/v1", apiKey: null, type: "gateway", autodiscover: true },
  { id: "omniroute-local", baseUrl: "http://localhost:1807/v1", apiKey: null, type: "gateway", autodiscover: true },
  // Freebuff2API: third-party OpenAI-compatible proxy for freebuff.com (codebuff backend).
  // Repo: https://github.com/Quorinex/Freebuff2API  — run locally before enabling.
  // Token: obtain from https://freebuff.llm.pm or `npx freebuff login` CLI.
  { id: "freebuff", baseUrl: "http://localhost:8080/v1", apiKey: null, type: "gateway", autodiscover: true },
];

export const PROVIDER_ENDPOINTS = {
  chatgpt_web: {
    baseUrl: "content-script", // handled by chatgpt-content.js (real browser model, fallback)
    apiKey: null,
    type: "browser",
  },
  tirouter: {
    // CLIProxyAPI - unified OpenAI/Gemini/Claude/Grok compatible gateway
    baseUrl: "http://localhost:20128/v1",
    apiKey: null,
    type: "gateway",
  },
  therouter: {
    baseUrl: "http://localhost:1807/v1",
    apiKey: null,
    type: "gateway",
  },
  omniroute: {
    baseUrl: "https://router.trepremium.online/v1",
    apiKey: null,
    type: "router",
  },
  kira: {
    baseUrl: "https://kiraai.vn/api/v1",
    apiKey: null,
    type: "router",
  },
  therouterai: {
    baseUrl: "https://api.therouter.ai/v1",
    apiKey: null,
    type: "router",
  },
  // Freebuff2API — unofficial OpenAI-compatible proxy for freebuff.com / codebuff.com backend.
  // Provides free LLM access (open-source models, ad-supported).
  // Setup: docker run -p 8080:8080 quorinex/freebuff2api  OR  npx freebuff2api
  // Token: set FREEBUFF_TOKEN env var in the proxy, or pass via apiKey here after login.
  // Docs: https://github.com/Quorinex/Freebuff2API
  freebuff: {
    baseUrl: "http://localhost:8080/v1",
    apiKey: null, // loaded from chrome.storage.local key "freebuffToken" at runtime
    type: "gateway",
    notes: "Requires Freebuff2API proxy running locally + valid freebuff auth token",
  },
  // OpenRouter — unified API for 200+ models (free + paid).
  // Docs: https://openrouter.ai/docs
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: null, // user must provide OPENROUTER_API_KEY
    type: "router",
    notes: "Free tier available with rate limits; paid models require credits",
  },
  // Groq — free tier, very fast inference (Meta Llama, etc.)
  // Docs: https://console.groq.com/docs/quickstart
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: null, // user must provide GROQ_API_KEY
    type: "router",
    notes: "Free tier with rate limits; very fast inference",
  },
  // Together AI — free credits for new users
  // Docs: https://docs.together.ai/docs/quickstart
  together: {
    baseUrl: "https://api.together.xyz/v1",
    apiKey: null, // user must provide TOGETHER_API_KEY
    type: "router",
    notes: "Free credits for new users; supports Llama, Mixtral, etc.",
  },
  // Google AI Studio — free tier for Gemini models
  // Docs: https://ai.google.dev/docs
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: null, // user must provide GOOGLE_API_KEY
    type: "router",
    notes: "Free tier with rate limits; Gemini Pro/Flash",
  },
  // Mistral AI — free tier available
  // Docs: https://docs.mistral.ai/getting-started/quickstart
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: null, // user must provide MISTRAL_API_KEY
    type: "router",
    notes: "Free tier available; Mistral 7B, Mixtral, etc.",
  },
  // Hugging Face Inference — free tier for public models
  // Docs: https://huggingface.co/inference-api
  huggingface: {
    baseUrl: "https://api-inference.huggingface.co/v1",
    apiKey: null, // user must provide HF_API_TOKEN
    type: "router",
    notes: "Free tier with rate limits; requires HF token",
  },
  // DeepSeek — free tier available
  // Docs: https://platform.deepseek.com/docs
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: null, // user must provide DEEPSEEK_API_KEY
    type: "router",
    notes: "Free tier available; DeepSeek Chat, Coder, etc.",
  },
  // Cerebras — free tier, very fast Llama inference
  // Docs: https://cerebras.ai/docs
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    apiKey: null, // user must provide CEREBRAS_API_KEY
    type: "router",
    notes: "Free tier available; very fast inference",
  },
  // SambaNova — free tier for Llama models
  // Docs: https://docs.sambanova.ai/getting-started/quick-start
  sambanova: {
    baseUrl: "https://api.sambanova.ai/v1",
    apiKey: null, // user must provide SAMBANOVA_API_KEY
    type: "router",
    notes: "Free tier available; Llama 3.1, etc.",
  },
  // Chutes AI — free API for open-source models
  // Docs: https://chutes.ai/docs
  chutes: {
    baseUrl: "https://api.chutes.ai/v1",
    apiKey: null, // user must provide CHUTES_API_KEY
    type: "router",
    notes: "Free tier available; Llama, Mistral, etc.",
  },
  // GitHub Models — free tier with GitHub account
  // Docs: https://github.blog/2024-07-23-github-models/
  github: {
    baseUrl: "https://models.inference.ai.azure.com/v1",
    apiKey: null, // github PAT with models:read scope
    type: "router",
    notes: "Free tier with GitHub account; Llama, GPT, etc.",
  },
  // Cohere — free tier available
  // Docs: https://docs.cohere.com/docs/getting-started
  cohere: {
    baseUrl: "https://api.cohere.ai/v1",
    apiKey: null, // user must provide COHERE_API_KEY
    type: "router",
    notes: "Free tier available; Command R+, etc.",
  },
  // Cloudflare AI — Workers AI free tier
  // Docs: https://developers.cloudflare.com/workers-ai/
  cloudflare: {
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    apiKey: null, // user must provide CLOUDFLARE_API_TOKEN
    type: "router",
    notes: "Free tier with rate limits; Llama, Mistral, etc.",
  },
};

// Alias -> gateway model id. Gateway exposes ChatGPT/Claude/Gemini/Grok as OpenAI-compatible models.
export const ROUTER_MODEL_MAP = {
  "gpt-5.4": "openai/gpt-5.2",
  "gpt-5.5": "openai/gpt-5.2",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4.1": "openai/gpt-4.1",
  "claude": "anthropic/claude-3.5-sonnet",
  "claude-opus": "anthropic/claude-3-opus",
  "gemini": "google/gemini-1.5-pro",
  "gemini-flash": "google/gemini-1.5-flash",
  "grok": "xai/grok-2",
  "deepseek": "deepseek/deepseek-chat",
  // Freebuff2API model aliases (codebuff backend, open-source models)
  "freebuff": "claude-3-5-sonnet-20241022",
  "freebuff-sonnet": "claude-3-5-sonnet-20241022",
  "freebuff-haiku": "claude-3-5-haiku-20241022",
  // OpenRouter free models
  "openrouter/auto": "openrouter/auto",
  "openrouter/llama-3.1-70b": "meta-llama/llama-3.1-70b-instruct",
  // Groq free models
  "groq/llama-3.1-70b": "llama-3.1-70b-versatile",
  "groq/llama-3.1-8b": "llama-3.1-8b-instant",
  "groq/mixtral-8x7b": "mixtral-8x7b-32768",
  // Together AI free models
  "together/llama-3.1-70b": "meta-llama/Llama-3.1-70B-Instruct",
  "together/llama-3.1-8b": "meta-llama/Llama-3.1-8B-Instruct",
  // Google AI Studio
  "google/gemini-1.5-pro": "gemini-1.5-pro",
  "google/gemini-1.5-flash": "gemini-1.5-flash",
  // Mistral AI
  "mistral/mistral-7b": "mistral-7b-instruct-v0.3",
  "mistral/mixtral-8x7b": "mixtral-8x7b-instruct-v0.1",
  // Hugging Face
  "huggingface/mistral-7b": "mistralai/Mistral-7B-Instruct-v0.3",
  // DeepSeek
  "deepseek-chat": "deepseek-chat",
  "deepseek-coder": "deepseek-coder",
  // Cerebras
  "cerebras/llama-3.1-70b": "llama-3.1-70b",
  // SambaNova
  "sambanova/llama-3.1-70b": "Meta-Llama-3.1-70B-Instruct",
  // Chutes AI
  "chutes/llama-3.1-70b": "llama-3.1-70b",
  // GitHub Models
  "github/llama-3.1-70b": "Meta-Llama-3.1-70B-Instruct",
  "github/gpt-4o": "gpt-4o",
  // Cohere
  "cohere/command-r-plus": "command-r-plus",
  // Cloudflare AI
  "cloudflare/llama-3.1-8b": "llama-3.1-8b-instruct",
};

// Provider priority for fallback. Gateway (Tirouter) first = multi-site support via one backend;
// chatgpt-web (DOM) is the free real-model fallback.
export const PROVIDER_FALLBACK_ORDER = [
  "tirouter",    // local CLIProxyAPI gateway (ChatGPT/Claude/Gemini/Grok/...)
  "therouter",   // local OmniRoute aggregator
  "therouterai", // TheRouter cloud
  "omniroute",   // public aggregator
  "kira",        // free tier API
  "freebuff",    // Freebuff2API local proxy (free, open-source models via codebuff.com)
  "openrouter",  // OpenRouter free/paid models
  "groq",        // Groq free tier, very fast
  "together",    // Together AI free credits
  "google",      // Google AI Studio free tier
  "mistral",     // Mistral AI free tier
  "huggingface", // Hugging Face Inference free tier
  "deepseek",    // DeepSeek free tier
  "cerebras",    // Cerebras free tier
  "sambanova",   // SambaNova free tier
  "chutes",      // Chutes AI free tier
  "github",      // GitHub Models free tier
  "cohere",      // Cohere free tier
  "cloudflare",  // Cloudflare AI free tier
  "chatgpt_web", // ChatGPT web browser interface (real model, last resort)
];

export function getProviderConfig(providerName = "tirouter") {
  return PROVIDER_ENDPOINTS[providerName] || PROVIDER_ENDPOINTS.tirouter;
}

export function mapRouterModel(alias) {
  return ROUTER_MODEL_MAP[alias] || alias;
}

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const DEFAULT_ROUTER_URL = process.env.TIIEXTENSION_ROUTER_URL || 'http://127.0.0.1:1870';
const DEFAULT_API_KEY = process.env.TIIEXTENSION_ROUTER_API_KEY || '';

const CIRCUIT_OPEN_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT = 30000;
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const BASE_BACKOFF = 1000;

class CircuitBreaker {
  constructor() {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }

  recordSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= CIRCUIT_OPEN_THRESHOLD) {
      this.state = 'open';
    }
  }

  canExecute() {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > CIRCUIT_RESET_TIMEOUT) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }
}

class TiRouterClient {
  constructor() {
    this.baseUrl = DEFAULT_ROUTER_URL;
    this.apiKey = DEFAULT_API_KEY;
    this.defaultTimeout = DEFAULT_TIMEOUT;
    this.circuitBreaker = new CircuitBreaker();
    this.healthCache = { healthy: null, timestamp: 0 };
    this.healthCacheTTL = 5000;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  async request(method, path, body = null, options = {}) {
    const { 
      timeout = this.defaultTimeout, 
      retries = MAX_RETRIES,
      signal 
    } = options;

    const isMutation = method !== 'GET' && method !== 'HEAD';
    const hasIdempotencyKey = body && body.idempotency_key;

    if (isMutation && !hasIdempotencyKey) {
      throw new Error('Mutation requests require idempotency_key');
    }

    if (!this.circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker open - TiRouter unavailable');
    }

    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      try {
        const response = await this.executeRequest(method, path, body, { timeout, signal });
        this.circuitBreaker.recordSuccess();
        return response;
      } catch (error) {
        lastError = error;
        
        if (!this.shouldRetry(error, attempt, retries)) {
          throw error;
        }

        attempt++;
        if (attempt <= retries) {
          await this.backoff(attempt);
        }
      }
    }

    this.circuitBreaker.recordFailure();
    throw lastError;
  }

  shouldRetry(error, attempt, maxRetries) {
    if (attempt >= maxRetries) return false;
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') return true;
    if (error.status >= 500 && error.status < 600) return true;
    if (error.status === 429) return true;
    return false;
  }

  async backoff(attempt) {
    const jitter = Math.random() * 0.3 + 0.85;
    const delay = BASE_BACKOFF * Math.pow(2, attempt - 1) * jitter;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async executeRequest(method, path, body, options = {}) {
    const { timeout, signal } = options;

    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: this.getHeaders(),
        timeout: timeout
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: parsed
            });
          } catch {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: data
            });
          }
        });
      });

      req.on('error', (error) => {
        reject({ ...error, code: error.code });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Request aborted'));
        });
      }

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  async healthCheck() {
    const now = Date.now();
    if (this.healthCache.healthy !== null && now - this.healthCache.timestamp < this.healthCacheTTL) {
      return this.healthCache.healthy;
    }

    try {
      const response = await this.request('GET', '/health', null, { timeout: 5000 });
      this.healthCache = { healthy: response.status === 200, timestamp: now };
      return this.healthCache.healthy;
    } catch {
      this.healthCache = { healthy: false, timestamp: now };
      return false;
    }
  }

  async getModels() {
    const response = await this.request('GET', '/v1/models');
    return response.data;
  }

  async getCapabilities() {
    const response = await this.request('GET', '/v1/capabilities');
    return response.data;
  }

  async getTools() {
    const response = await this.request('GET', '/v1/tools');
    return response.data;
  }

  async callTool(toolName, args, options = {}) {
    const { workspaceId, revision, timeoutMs } = options;

    const body = {
      tool: toolName,
      args,
      ...(workspaceId && { workspaceId }),
      ...(revision && { revision }),
      ...(timeoutMs && { timeoutMs }),
      idempotency_key: `${workspaceId || 'tiiextension'}:${toolName}:${Date.now()}`
    };

    return await this.request('POST', '/v1/tools/call', body, { timeout: timeoutMs || this.defaultTimeout });
  }

  async chatCompletion(messages, options = {}) {
    const body = {
      model: options.model || 'gpt-4',
      messages,
      ...(options.tools && { tools: options.tools }),
      ...(options.temperature && { temperature: options.temperature }),
      ...(options.max_tokens && { max_tokens: options.max_tokens })
    };

    return await this.request('POST', '/v1/chat/completions', body);
  }

  async createContextQuery(query, options = {}) {
    const body = {
      query,
      ...(options.workspaceId && { workspaceId: options.workspaceId }),
      ...(options.includeKnowledge !== undefined && { includeKnowledge: options.includeKnowledge }),
      ...(options.maxResults && { maxResults: options.maxResults })
    };

    return await this.request('POST', '/v1/context/query', body);
  }

  async createTask(task, options = {}) {
    const body = {
      ...task,
      ...(options.timeoutMs && { timeoutMs: options.timeoutMs }),
      ...(options.priority && { priority: options.priority })
    };

    return await this.request('POST', '/v1/agent/tasks', body);
  }

  async getTaskStatus(taskId) {
    return await this.request('GET', `/v1/agent/tasks/${taskId}`);
  }

  async getRuntimeStatus() {
    return await this.request('GET', '/v1/runtime/status');
  }

  async getEvents(since = 0) {
    return await this.request('GET', `/v1/events?since=${since}`);
  }
}

export const tiRouterClient = new TiRouterClient();
export default TiRouterClient;
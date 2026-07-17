// Main ChatGPT Web Provider interface
import { ChatgptDetector } from './chatgpt-detector.js';
import { ChatgptComposer } from './chatgpt-composer.js';
import { ChatgptResponseObserver } from './chatgpt-response-observer.js';
import { ChatgptToolCallParser } from './chatgpt-tool-call-parser.js';
import { ChatgptResultInjector } from './chatgpt-result-injector.js';
import { ChatgptConversationLock } from './chatgpt-conversation-lock.js';
import { TiWebAgentProtocol } from '../../web-agent/protocol.js';
import { ExecutionController } from '../../web-agent/execution-controller.js';
import { taskStateStore } from '../../web-agent/task-state-store.js';
import { runtime } from '../../browser-polyfill.js';

export class ChatGptWebProvider {
  constructor() {
    this.detector = new ChatgptDetector();
    this.composer = new ChatgptComposer();
    this.observer = new ChatgptResponseObserver();
    this.parser = new ChatgptToolCallParser();
    this.injector = new ChatgptResultInjector();
    this.lock = new ChatgptConversationLock();
    this.protocol = new TiWebAgentProtocol();
    this.executor = new ExecutionController();
    
    this.state = {
      initialized: false,
      connected: false,
      locked: false,
      busy: false
    };
    
    this.responseListener = null;
    this.pendingToolCalls = new Set();
    this.currentTaskId = null;
    
    // Bind methods
    this.handleResponse = this.handleResponse.bind(this);
    this.handleToolResult = this.handleToolResult.bind(this);
  }

  /**
   * Initialize the provider
   * @param {Object} config - Configuration object
   * @returns {Promise<void>}
   */
  async initialize(config = {}) {
    if (this.state.initialized) return;
    
    // Verify we're on a ChatGPT page
    if (!this.detector.isChatGptPage()) {
      throw new Error('Not on a ChatGPT page');
    }
    
    // Wait for page to be ready
    await this.detector.waitForReady();
    
    // Start observing responses
    this.observer.startObserving(this.handleResponse.bind(this));
    
    this.state.initialized = true;
    this.state.connected = true; // We're connected to the page
    
    console.log('[ChatGptWebProvider] Initialized');
  }

  /**
   * Connect to the service (always connected for web provider)
   * @returns {Promise<void>}
   */
  async connect() {
    if (!this.state.initialized) {
      await this.initialize();
    }
    this.state.connected = true;
  }

  /**
   * Disconnect from service
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.observer) {
      this.observer.stopObserving();
    }
    if (this.lock) {
      await this.lock.releaseLock();
    }
    this.state.connected = false;
    this.state.locked = false;
  }

  /**
   * Dispose of resources
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.disconnect();
    this.state.initialized = false;
  }

  /**
   * Send a message to the AI and get a response
   * @param {string} prompt - The prompt to send
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response with text and metadata
   */
  async sendMessage(prompt, options = {}) {
    if (!this.state.initialized) {
      throw new Error('Provider not initialized');
    }
    
    const { timeoutMs = 60000 } = options;
    
    try {
      this.state.busy = true;
      
      // Send the prompt
      await this.composer.submitPrompt(prompt);
      
      // Wait for response
      const response = await this.waitForResponse(timeoutMs);
      
      return {
        text: response.text,
        raw: response,
        timestamp: Date.now()
      };
    } finally {
      this.state.busy = false;
    }
  }

  /**
   * Wait for a response from the AI
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Object>} Response object
   */
  async waitForResponse(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, timeoutMs);
      
      const checkInterval = setInterval(() => {
        // Check if we're still generating
        if (!this.detector.isGenerating()) {
          // Get the latest response
          const lastMessage = document.querySelector('[data-message-author-role="assistant"]:last-of-type');
          if (lastMessage) {
            const text = lastMessage.innerText || lastMessage.textContent;
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve({ 
              text,
              element: lastMessage,
              timestamp: Date.now()
            });
          }
        }
      }, 1000);
    });
  }

  /**
   * Execute a tool call and return the result
   * @param {string} toolId - Tool identifier
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool result
   */
  async executeTool(toolId, params) {
    if (!this.state.initialized) {
      throw new Error('Provider not initialized');
    }
    
    try {
      // Acquire lock to prevent conflicts
      const lockAcquired = await this.lock.acquireLock(this.lock.ownerId, 30000);
      if (!lockAcquired) {
        throw new Error('Could not acquire conversation lock');
      }
      this.state.locked = true;
      
      // Execute via the backend
      const result = await this.executor.executeTool(toolId, params);
      
      // Notify that we have a result (optional: could inject immediately)
      return result;
    } finally {
      // Always release lock
      if (this.state.locked) {
        await this.lock.releaseLock();
        this.state.locked = false;
      }
    }
  }

  /**
   * Inject a tool result back into the conversation
   * @param {Object} result - Tool result from executeTool
   * @returns {Promise<void>}
   */
  async injectToolResult(result) {
    if (!this.state.initialized) {
      throw new Error('Provider not initialized');
    }
    
    // Format as a user message and send it
    const formatted = this.formatResultForChat(result);
    await this.composer.submitPrompt(formatted);
  }

  /**
   * Format a tool result for injection into chat
   * @param {Object} result - Tool result object
   * @returns {string} Formatted string
   */
  formatResultForChat(result) {
    if (typeof result === 'string') {
      return result;
    }
    
    // Format as JSON code block
    try {
      const json = JSON.stringify(result, null, 2);
      return `Here is the result:\n\`\`\`json\n${json}\n\`\`\``;
    } catch (e) {
      return String(result);
    }
  }

  /**
   * Handle incoming responses from the AI (to detect tool calls)
   * @param {Object} responseInfo - From observer
   */
  async handleResponse(responseInfo) {
    const { text } = responseInfo;
    
    // Parse for tool calls
    const toolCalls = this.parser.parseToolCalls(text);
    
    for (const call of toolCalls) {
      // Avoid processing the same call multiple times
      const callId = call.id;
      if (this.pendingToolCalls.has(callId)) continue;
      
      this.pendingToolCalls.add(callId);
      
      try {
        // Execute the tool
        const result = await this.executor.executeTool(call.tool, call.arguments);
        
        // Send result back to AI
        await this.injectToolResult(result);
        
        // Mark as completed
        // (we could also send a final response if needed)
      } catch (error) {
        // Send error back to AI
        const errorMsg = `Tool execution failed: ${error.message}`;
        await this.composer.submitPrompt(errorMsg);
      } finally {
        this.pendingToolCalls.delete(callId);
      }
    }
  }

  /**
   * Get current model from UI
   * @returns {Promise<string>}
   */
  async getCurrentModel() {
    return this.detector.detectCurrentModel();
  }

  /**
   * Set model via UI
   * @param {string} modelName - Model to set
   * @returns {Promise<boolean>}
   */
  async setModel(modelName) {
    return this.detector.selectVisibleModel(modelName);
  }

  /**
   * Get provider status for diagnostics
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      provider: 'chatgpt-web',
      initialized: this.state.initialized,
      connected: this.state.connected,
      locked: this.state.locked,
      busy: this.state.busy,
      model: this.detector.detectCurrentModel ? this.detector.detectCurrentModel() : null,
      pageState: this.detector.getPageState(),
      lockInfo: this.lock.getLockInfo()
    };
  }
}

// Export singleton
export const chatgptWebProvider = new ChatGptWebProvider();
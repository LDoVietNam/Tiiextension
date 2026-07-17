// Observe and capture AI responses
export class ChatGptResponseObserver {
  constructor() {
    this.observer = null;
    this.processedMessages = new WeakSet();
    this.onResponseCallback = null;
  }

  /**
   * Start observing for new AI responses
   * @param {Function} callback - Called when new response is detected
   */
  startObserving(callback) {
    this.onResponseCallback = callback;
    
    // Observe the main container for new messages
    const container = document.querySelector('main') || document.body;
    
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          this.processNode(node);
        }
      }
    });
    
    this.observer.observe(container, {
      childList: true,
      subtree: true
    });
    
    // Also process existing messages
    this.processExistingMessages();
  }

  /**
   * Stop observing
   */
  stopObserving() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.onResponseCallback = null;
  }

  /**
   * Process a DOM node for AI responses
   * @param {Node} node - DOM node to process
   */
  processNode(node) {
    // Skip if already processed
    if (this.processedMessages.has(node)) return;
    
    // Check if this is an assistant message
    if (this.isAssistantMessage(node)) {
      this.processedMessages.add(node);
      
      // Extract the text content
      const text = this.extractMessageText(node);
      
      // Notify callback
      if (this.onResponseCallback && typeof this.onResponseCallback === 'function') {
        this.onResponseCallback({ 
          element: node,
          text,
          timestamp: Date.now()
        });
      }
    }
    
    // Recursively process children
    if (node.hasChildNodes()) {
      for (const child of node.childNodes) {
        this.processNode(child);
      }
    }
  }

  /**
   * Process all existing messages
   */
  processExistingMessages() {
    const messages = this.getAllAssistantMessages();
    for (const msg of messages) {
      this.processNode(msg);
    }
  }

  /**
   * Check if element is an assistant message
   * @param {Element} el - DOM element
   * @returns {boolean}
   */
  isAssistantMessage(el) {
    if (!(el instanceof Element)) return false;
    
    // Check for role attribute
    if (el.getAttribute('data-message-author-role') === 'assistant') {
      return true;
    }
    
    // Check for common classes or attributes
    const selectors = [
      '[data-message-author-role="assistant"]',
      'article[data-author-role="assistant"]',
      '.group.w-full.max-w-4xl' // Common pattern
    ];
    
    return selectors.some(selector => el.matches(selector));
  }

  /**
   * Extract text content from a message element
   * @param {Element} el - Message element
   * @returns {string} Text content
   */
  extractMessageText(el) {
    // Try to get the text content, ignoring code blocks etc.
    // For simplicity, we'll get innerText
    return el.innerText || el.textContent || '';
  }

  /**
   * Get all assistant message elements
   * @returns {Element[]} Array of message elements
   */
  getAllAssistantMessages() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      'article[data-author-role="assistant"]'
    ];
    
    const elements = [];
    for (const selector of selectors) {
      elements.push(...document.querySelectorAll(selector));
    }
    return elements;
  }

  /**
   * Wait for a response containing specific text or after a timeout
   * @param {Object} options - { text: string, timeoutMs: number }
   * @returns {Promise<Object>} Response info
   */
  async waitForResponse(options = {}) {
    const { text, timeoutMs = 15000 } = options;
    const start = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for response${text ? ` containing "${text}"` : ''}`));
          return;
        }
        
        // Check if we have any new messages
        const messages = this.getAllAssistantMessages();
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        const messageText = this.extractMessageText(lastMessage);
        
        if (text) {
          if (messageText.includes(text)) {
            clearInterval(checkInterval);
            resolve({ 
              element: lastMessage,
              text: messageText,
              timestamp: Date.now()
            });
          }
        } else {
          // Just return the latest message if we haven't seen it before
          if (!this.processedMessages.has(lastMessage)) {
            this.processedMessages.add(lastMessage);
            clearInterval(checkInterval);
            resolve({ 
              element: lastMessage,
              text: messageText,
              timestamp: Date.now()
            });
          }
        }
      }, 500);
    });
  }

  /**
   * Check if the assistant is currently generating a response
   * @returns {boolean}
   */
  isGenerating() {
    return !!document.querySelector('[data-testid="stop-button"]') ||
           [...document.querySelectorAll('button')].some(btn => 
             /stop|停止/i.test(btn.getAttribute('aria-label') || btn.innerText || ''));
  }
}
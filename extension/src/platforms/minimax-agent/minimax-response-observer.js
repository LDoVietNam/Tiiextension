// Observe MiniMax Agent responses
// Uses DOM observation pattern to detect when assistant messages appear/change

export class MinimaxResponseObserver {
  constructor() {
    this.subscribers = [];
    this.observer = null;
    this.scanTimer = null;
    this.suppressUntil = 0;
    this.lastText = '';
  }

  /**
   * Start observing for responses
   * @param {Function} callback - Called when new response detected
   */
  startObserving(callback) {
    if (this.observer) {
      this.stopObserving();
    }

    this.subscribers.push(callback);

    // Find the main chat container - MiniMax uses various patterns
    const containerSelectors = [
      '.chat-container',
      '.conversation-container',
      'main',
      '[role="main"]',
      '.messages-container',
      '.message-list',
      'article', // Often wrapping messages
      '.conversation',
      '[class*="chat"][class*="container"]'
    ];

    let container = null;
    for (const selector of containerSelectors) {
      container = document.querySelector(selector);
      if (container) break;
    }

    // Fallback to body if no container found
    if (!container) {
      container = document.body;
    }

    // Observe for DOM changes
    this.observer = new MutationObserver((mutations) => {
      if (Date.now() < this.suppressUntil) return;

      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => {
        this.checkForResponses();
      }, 500);
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /**
   * Stop observing
   */
  stopObserving() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  /**
   * Suppress auto-scan for a duration
   * @param {number} ms
   */
  suppress(ms) {
    this.suppressUntil = Date.now() + ms;
  }

  /**
   * Check for new responses
   */
  checkForResponses() {
    const nodes = MinimaxResponseObserver.findAssistantNodes();
    const lastNode = nodes.at(-1);

    if (lastNode) {
      const text = this.cleanText(lastNode.innerText || lastNode.textContent || '');

      // Check if text has stabilized (generating complete)
      if (text && text !== this.lastText && !MinimaxDetector.isGenerating()) {
        this.lastText = text;
        for (const cb of this.subscribers) {
          try {
            cb({ node: lastNode, text, nodes });
          } catch (e) {
            console.warn('[MinimaxResponseObserver] Subscriber error:', e);
          }
        }
      }
    }
  }

  /**
   * Find assistant message nodes
   * @returns {HTMLElement[]}
   */
  static findAssistantNodes() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      '.assistant-message',
      '.ai-message',
      '.bot-message',
      '.response-message',
      '[data-role="assistant"]',
      '.message.assistant',
      'article .markdown, article .prose',
      '[class*="message"]:has(.markdown), [class*="turn"]:has(.markdown)'
    ];

    for (const selector of selectors) {
      try {
        const nodes = [...document.querySelectorAll(selector)].filter(
          node => node.getClientRects().length > 0
        );
        if (nodes.length) return nodes;
      } catch (e) {}
    }
    return [];
  }

  /**
   * Clean text content
   * @param {string} value
   * @returns {string}
   */
  cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
}

// Import MinimaxDetector for isGenerating check
import { MinimaxDetector } from './minimax-detector.js';
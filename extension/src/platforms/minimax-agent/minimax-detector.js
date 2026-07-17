// Detect MiniMax Agent UI state and model
// Hostnames: agent.minimax.io, www.minimax.io, minimax.io

export class MinimaxDetector {
  /**
   * Check if current page is MiniMax Agent
   * @returns {boolean}
   */
  static isMinimaxPage() {
    return location.hostname.includes('minimax.io') || location.hostname.includes('agent.minimax.io');
  }

  /**
   * Find the model selector button with multiple fallback selectors
   * @returns {HTMLElement|null}
   */
  static findModelSelectorButton() {
    const selectors = [
      '[data-testid*="model"]',
      '[data-testid*="model-select"]',
      'button[aria-label*="model"]',
      'button[aria-label*="Model"]',
      '.model-selector',
      '.model-switcher',
      '[class*="model"][class*="select"]',
      'button:has-text("Model")',
      'button:has(svg):has-text("M")' // Often models are represented with icon+text
    ];

    for (const selector of selectors) {
      try {
        const button = document.querySelector(selector);
        if (button && button.offsetParent !== null) {
          return button;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * Select a visible model from the UI
   * @param {string} modelName - Name of the model to select
   * @returns {Promise<boolean>}
   */
  static async selectVisibleModel(modelName) {
    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Model name must be a non-empty string');
    }

    const selectorBtn = this.findModelSelectorButton();
    if (!selectorBtn) {
      throw new Error('Model selector button not found');
    }

    selectorBtn.click();
    await new Promise(resolve => setTimeout(resolve, 500));

    const menuItemSelectors = [
      '[role="menuitem"]:not([disabled])',
      '[role="option"]:not([disabled])',
      'div[role="menu"] button:not([aria-disabled="true"])',
      'div[role="listbox"] div[role="option"]',
      '.model-option',
      '.dropdown-item',
      '[class*="model"] [class*="option"]'
    ];

    let menuItem = null;
    for (const selector of menuItemSelectors) {
      const items = document.querySelectorAll(selector);
      for (const item of items) {
        const text = item.innerText || item.textContent || '';
        if (text.trim().toLowerCase() === modelName.trim().toLowerCase() ||
            text.toLowerCase().includes(modelName.toLowerCase())) {
          menuItem = item;
          break;
        }
      }
      if (menuItem) break;
    }

    if (!menuItem) {
      document.body.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      throw new Error(`Model '${modelName}' not found in dropdown`);
    }

    menuItem.click();
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {}

    return true;
  }

  /**
   * Get current page state
   * @returns {Object}
   */
  static getPageState() {
    const loginSelectors = [
      '[data-testid*="login"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'a[href*="login"]',
      '[href*="auth"]'
    ];

    for (const selector of loginSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          return { state: 'login_required', ready: false };
        }
      } catch (e) {}
    }

    // Check for conversation input - MiniMax typically uses textarea or contenteditable
    const inputSelectors = [
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.composer-input',
      '.chat-input',
      '[placeholder*="message"]',
      '[placeholder*="Ask"]',
      '[placeholder*="Send"]'
    ];

    for (const selector of inputSelectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null && !el.disabled) {
        const hasMessages = !!document.querySelector('.message, .chat-message, [data-message], .conversation-turn, article');
        return {
          state: hasMessages ? 'ready' : 'new_chat',
          ready: true,
          hasMessages
        };
      }
    }

    // Check for error states
    const errorText = document.body.innerText.toLowerCase();
    if (errorText.includes('rate limit') || errorText.includes('too many')) {
      return { state: 'rate_limited', ready: false, retryable: true };
    }
    if (errorText.includes('verification') || errorText.includes('captcha')) {
      return { state: 'verification_required', ready: false, retryable: false };
    }

    return { state: 'unknown', ready: false };
  }

  /**
   * Check if response is being generated
   * @returns {boolean}
   */
  static isGenerating() {
    const selectors = [
      '[data-testid*="stop"]',
      '[data-testid*="generating"]',
      '.stop-button',
      '.generating-indicator',
      '[class*="stop"]',
      '[class*=" generating"]',
      'button:has-text("Stop")',
      '[aria-busy="true"]',
      '[data-generating="true"]'
    ];

    for (const selector of selectors) {
      if (document.querySelector(selector)) {
        return true;
      }
    }

    // Also check for streaming cursor/blinking animation
    const streamingIndicators = document.querySelectorAll('[class*="cursor"], [class*="blink"]');
    if (streamingIndicators.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Detect current model from UI
   * @returns {Promise<string|null>}
   */
  static async detectCurrentModel() {
    const button = this.findModelSelectorButton();
    if (button) {
      const label = button.getAttribute('aria-label') || button.innerText || button.textContent;
      if (label) {
        // Match MiniMax model patterns
        const minimaxMatch = label.match(/M\d(?:\s*\w+)?|abab\d*\.?\d*|MiniMax/gi);
        if (minimaxMatch) return minimaxMatch[0];

        // Also try general model patterns
        const generalMatch = label.match(/[A-Z][a-z]*-\d+[a-z]*|[A-Z]+-[A-Z]+\-\d+/);
        if (generalMatch) return generalMatch[0];

        return label.replace(/^(model|gpt)\s*:?\s*/i, '').trim();
      }
    }

    return null;
  }

  /**
   * Wait for the page to be ready
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  static async waitForReady(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = this.getPageState();
      if (state.ready) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Timed out waiting for MiniMax Agent to be ready');
  }
}
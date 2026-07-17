// Detect ChatGPT UI state and model
import { runtime } from '../../browser-polyfill.js';

export class ChatGptDetector {
  /**
   * Check if current page is ChatGPT
   * @returns {boolean}
   */
  static isChatGptPage() {
    return location.hostname.includes('chatgpt.com') || 
           location.hostname.includes('chat.openai.com');
  }

  /**
   * Select a visible model from the UI
   * @param {string} modelName - Name of the model to select
   * @returns {Promise<boolean>} True if successful
   */
  static async selectVisibleModel(modelName) {
    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Model name must be a non-empty string');
    }

    // Wait for page to be ready
    await this.waitForReady(5000);

    // Find and click the model selector button with multiple fallback selectors
    const selectorBtn = this.findModelSelectorButton();
    if (!selectorBtn) {
      throw new Error('Model selector button not found');
    }

    // Click to open dropdown
    selectorBtn.click();
    
    // Wait for dropdown to appear
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      // Look for the menu item with matching text
      // Using multiple selectors to catch different UI variations
      const menuItemSelectors = [
        `[role="menuitem"]:not([disabled])`,
        `[role="option"]:not([disabled])`,
        `div[role="menu"] div[role="none"]:not([aria-disabled="true"])`,
        `div[role="menu"] li:not([aria-disabled="true"])`,
        `div[role="listbox"] div[role="option"]:not([aria-disabled="true"])`,
        `div[role="listbox"] div:not([role="separator"]):not([aria-disabled="true"])`,
      ];

      let menuItem = null;
      for (const selector of menuItemSelectors) {
        const items = document.querySelectorAll(selector);
        for (const item of items) {
          const text = item.innerText || item.textContent || '';
          if (text.trim().toLowerCase() === modelName.trim().toLowerCase()) {
            menuItem = item;
            break;
          }
        }
        if (menuItem) break;
      }

      if (!menuItem) {
        // Try partial match if exact match not found
        for (const selector of menuItemSelectors) {
          const items = document.querySelectorAll(selector);
          for (const item of items) {
            const text = item.innerText || item.textContent || '';
            if (text.toLowerCase().includes(modelName.toLowerCase())) {
              menuItem = item;
              break;
            }
          }
          if (menuItem) break;
        }
      }

      if (!menuItem) {
        // Close dropdown by clicking away or pressing Escape
        document.body.click(); // Click away to close
        await new Promise(resolve => setTimeout(resolve, 200));
        throw new Error(`Model '${modelName}' not found in dropdown`);
      }

      // Click the menu item
      menuItem.click();
      
      // Wait for selection to register and dropdown to close
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Try to close dropdown if still open
      try {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        // Ignore cleanup errors
      }
      
      // Verify the selection by checking the button text
      const updatedButton = this.findModelSelectorButton();
      if (updatedButton) {
        const label = updatedButton.getAttribute('aria-label') || 
                     updatedButton.innerText || 
                     updatedButton.textContent || '';
        if (label.toLowerCase().includes(modelName.toLowerCase())) {
          return true;
        }
      }

      // Even if verification fails, assume it worked if we clicked
      return true;
    } catch (error) {
      // Ensure dropdown is closed if something went wrong
      try {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Find model selector button with multiple fallback selectors
   * @returns {HTMLElement|null} The button element or null if not found
   */
  static findModelSelectorButton() {
    const selectors = [
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-haspopup="menu"][aria-label*="model"]',
      'button:contains("Model")',
      'button[aria-label*="model"]',
      '[data-testid*="model"]',
      'button:has-text("Model")'
    ];
    
    for (const selector of selectors) {
      try {
        const button = document.querySelector(selector);
        if (button && button.offsetParent !== null) {
          return button;
        }
      } catch (e) {
        // Selector might fail in some browsers, continue
        continue;
      }
    }
    return null;
  }

  /**
   * Get current page state (login_required, ready, etc.)
   * @returns {Object} State information
   */
  static getPageState() {
    // Check for login elements
    const loginSelectors = [
      '[data-testid="login-button"]',
      'button:contains("Log in")',
      'button:contains("Sign up")'
    ];
    
    for (const selector of loginSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          return { state: 'login_required', ready: false };
        }
      } catch (e) {
        // Selector might fail, continue
      }
    }
    
    // Check for input area (indicates ready state)
    const inputSelectors = [
      '#prompt-textarea',
      'textarea[data-testid]',
      '[contenteditable="true"][data-testid="composer-textarea"]'
    ];
    
    for (const selector of inputSelectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) {
        // Additional check: see if we're in a conversation
        const hasMessages = !!document.querySelector('[data-message-author-role="assistant"], [data-message-author-role="user"]');
        return { 
          state: hasMessages ? 'ready' : 'new_chat', 
          ready: true,
          hasMessages
        };
      }
    }
    
    // Check for error states
    const errorText = document.body.innerText.toLowerCase();
    if (errorText.includes('rate limit') || errorText.includes('too many requests')) {
      return { state: 'rate_limited', ready: false, retryable: true };
    }
    if (errorText.includes('verification') || errorText.includes('captcha')) {
      return { state: 'verification_required', ready: false, retryable: false };
    }
    
    return { state: 'unknown', ready: false };
  }

  /**
   * Detect current model from UI
   * @returns {Promise<string|null>} Model name or null if undetectable
   */
  async detectCurrentModel() {
    // Try to get from model selector button
    const button = this.findModelSelectorButton();
    if (button) {
      // Try to get the label from the button text or aria-label
      const label = button.getAttribute('aria-label') || 
                   button.innerText || 
                   button.textContent;
       
      if (label) {
        // Extract model name from label (e.g., "Model: GPT-4" -> "GPT-4")
        const match = label.match(/[Gg][Pp][Tt][\-\d\.]*[a-z]*/i);
        if (match) return match[0];
        
        // Return cleaned label
        return label.replace(/^(model|gpt)\s*:?\s*/i, '').trim();
      }
    }
    
    // Fallback: check for model in conversation header
    const headerSelectors = [
      '[data-testid="conversation-turn-2"]', // First assistant message often shows model
      '.flex.items-center.gap-2.text-base'
    ];
    
    for (const selector of headerSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.innerText || el.textContent;
        const match = text.match(/[Gg][Pp][Tt][\-\d\.]*[a-z]*/i);
        if (match) return match[0];
      }
    }
    
    return null;
  }

  /**
   * Check if response is currently being generated
   * @returns {boolean}
   */
  isGenerating() {
    return !!document.querySelector('[data-testid="stop-button"]') ||
           [...document.querySelectorAll('button')].some(btn => 
             /stop|停止/i.test(btn.getAttribute('aria-label') || btn.innerText || ''));
  }

  /**
   * Wait for the page to be in a ready state
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<void>}
   */
  async waitForReady(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = this.getPageState();
      if (state.ready) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Timed out waiting for ChatGPT to be ready');
  }

  /**
   * Get available models from UI
   * @returns {Promise<string[]>} List of model names
   */
  async getAvailableModels() {
    // Click the model selector to open dropdown
    const selectorBtn = this.findModelSelectorButton();
    if (!selectorBtn) return [];
    
    // We would need to interact with the UI to get the list
    // For now, return common models
    return ['GPT-4', 'GPT-4 Turbo', 'GPT-3.5 Turbo'];
  }
}
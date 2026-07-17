// Handle prompt submission and composer interaction
export class ChatGptComposer {
  /**
   * Find the prompt input element
   * @returns {HTMLElement|null} Input element
   */
  static findInput() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-testid]',
      '[contenteditable="true"][data-testid="composer-textarea"]'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  /**
   * Find the send button
   * @returns {HTMLElement|null} Button element
   */
  static findSendButton() {
    const selectors = [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'form button[type="submit"]'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null && !el.disabled) return el;
    }
    return null;
  }

  /**
   * Set the value of the input element
   * @param {HTMLElement} input - Input element
   * @param {string} value - Value to set
   */
  static setInputValue(input, value) {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? 
                        HTMLTextAreaElement.prototype : 
                        HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) {
        setter.call(input, value);
      } else {
        input.value = value;
      }
    } else {
      // Contenteditable element
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, value);
    }
    
    // Trigger events
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: value
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Submit a prompt to ChatGPT
   * @param {string} prompt - Prompt to send
   * @returns {Promise<Object>} Result
   */
  async submitPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }
    
    const input = this.findInput();
    if (!input) {
      throw new Error('Could not find ChatGPT input element');
    }
    
    // Focus the input
    input.focus();
    
    // Set the value
    this.setInputValue(input, prompt);
    
    // Find and click send button
    const sendButton = this.findSendButton();
    if (sendButton) {
      sendButton.click();
    } else {
      // Fallback to Enter key
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true
      }));
    }
    
    // Wait a bit for submission to register
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return { submitted: true };
  }

  /**
   * Clear the input field
   * @returns {boolean}
   */
  clearInput() {
    const input = this.findInput();
    if (!input) return false;
    
    this.setInputValue(input, '');
    return true;
  }

  /**
   * Get current input value
   * @returns {string} Current value
   */
  getInputValue() {
    const input = this.findInput();
    if (!input) return '';
    
    if (input.value !== undefined) {
      return input.value;
    }
    return input.innerText || input.textContent || '';
  }
}
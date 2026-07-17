// Handle prompt submission for MiniMax Agent
export class MinimaxComposer {
  /**
   * Find the prompt input element
   * @returns {HTMLElement|null}
   */
  static findInput() {
    const selectors = [
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.composer-input',
      '.chat-input',
      '.message-input',
      '[placeholder*="message"]',
      '[placeholder*="Ask"]',
      '[placeholder*="Send"]',
      '[placeholder*="chat"]',
      '[placeholder*="question"]',
      'form textarea',
      'form [contenteditable]'
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null && !el.disabled) {
          // Avoid selecting login inputs or small text fields
          const rect = el.getBoundingClientRect();
          if (rect.height >= 20 && rect.width >= 200) {
            return el;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Find the send button
   * @returns {HTMLElement|null}
   */
  static findSendButton() {
    const selectors = [
      '[data-testid*="send"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'form button[type="submit"]',
      '.send-button',
      '.submit-button',
      '[class*="send"]:not([disabled])',
      'button:has(svg):not([disabled])', // Icon button
      '[role="button"][aria-label*="send"]'
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null && !el.disabled) {
          return el;
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Set the value of an input element
   * @param {HTMLElement} input
   * @param {string} value
   */
  static setInputValue(input, value) {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) {
        setter.call(input, value);
      } else {
        input.value = value;
      }
    } else if (input.isContentEditable || input.contentEditable === 'true') {
      input.focus();
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
   * Submit a prompt to MiniMax Agent
   * @param {string} prompt
   * @returns {Promise<Object>}
   */
  async submitPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }

    const input = this.findInput();
    if (!input) {
      throw new Error('Could not find MiniMax Agent input element');
    }

    input.focus();
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
        bubbles: true,
        cancelable: true
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true
      }));
    }

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
   * @returns {string}
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
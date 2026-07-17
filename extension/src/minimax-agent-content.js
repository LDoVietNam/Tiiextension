// minimax-agent-content.js
// MiniMax Agent content script for Tiiextension browser extension
// Pattern: minimal content script, delegates to platform classes

(() => {
  // Prevent double-injection
  if (globalThis.__MINIMAX_AGENT_NATIVE_AGENT_V1__) return;
  globalThis.__MINIMAX_AGENT_NATIVE_AGENT_V1__ = true;

  const ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '.assistant-message',
    '.ai-message',
    '.bot-message',
    '.response-message',
    '[data-role="assistant"]',
    '.message.assistant',
    '[class*="turn"]:has(.markdown)',
    'article'
  ];

  const COMPOSER_SELECTORS = [
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '.composer-input',
    '.chat-input',
    '[placeholder*="message"]',
    '[placeholder*="Ask"]',
    '[placeholder*="Send"]'
  ];

  const SEND_SELECTORS = [
    '[data-testid*="send"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'form button[type="submit"]',
    '.send-button',
    '.submit-button',
    '[class*="send"]:not([disabled])',
    'button:has(svg):not([disabled])'
  ];

  // Import the platform modules
  // These will be bundled by the extension build
  const runtime = chrome.runtime;

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  function initialize() {
    // Only activate on MiniMax Agent pages
    if (!isMinimaxPage()) {
      // Still inject overlay for debugging
      injectDiagnosticOverlay();
      return;
    }

    injectAgentOverlay();
    observeResponses();
  }

  function isMinimaxPage() {
    return location.hostname.includes('minimax.io') || location.hostname.includes('agent.minimax.io');
  }

  function injectDiagnosticOverlay() {
    const root = document.createElement('aside');
    root.id = 'minimax-native-agent-overlay';
    root.setAttribute('aria-label', 'MiniMax Agent Controls');
    root.innerHTML = `
      <div class="cna-title">MiniMax Agent <span class="cna-version">v1</span></div>
      <div id="cna-status" aria-live="polite">Not on MiniMax page</div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      #minimax-native-agent-overlay{
        position:fixed;right:14px;bottom:14px;z-index:2147483647;
        display:grid;gap:7px;min-width:190px;padding:11px;
        color:#e5eefb;background:rgba(10,18,34,.94);border:1px solid #334866;border-radius:14px;
        font:12px/1.35 system-ui,sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.38);backdrop-filter:blur(12px)
      }
      #minimax-native-agent-overlay .cna-title{font-weight:750;color:#8ec5ff}
    `;
    document.documentElement.append(style, root);
  }

  function injectAgentOverlay() {
    if (document.querySelector('#minimax-native-agent-overlay')) return;

    const root = document.createElement('aside');
    root.id = 'minimax-native-agent-overlay';
    root.setAttribute('aria-label', 'MiniMax Agent Controls');
    root.innerHTML = `
      <div class="cna-title">MiniMax Agent <span class="cna-version">v1</span></div>
      <div id="cna-status" aria-live="polite">Connecting…</div>
      <label><input id="cna-auto" type="checkbox" checked> auto-run</label>
      <div class="cna-actions">
        <button id="cna-tools" type="button">Tools</button>
        <button id="cna-workspace" type="button">Workspace</button>
        <button id="cna-panel" type="button">Panel</button>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #minimax-native-agent-overlay{
        position:fixed;right:14px;bottom:14px;z-index:2147483647;
        display:grid;gap:7px;min-width:190px;padding:11px;
        color:#e5eefb;background:rgba(10,18,34,.94);border:1px solid #334866;border-radius:14px;
        font:12px/1.35 system-ui,sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.38);backdrop-filter:blur(12px)
      }
      #minimax-native-agent-overlay .cna-title{font-weight:750;color:#8ec5ff}
      .cna-actions,.cna-block-tools{display:flex;gap:6px;flex-wrap:wrap}
      #minimax-native-agent-overlay button{
        color:white;background:#2563eb;border:0;border-radius:8px;padding:6px 8px;cursor:pointer
      }
      .cna-block-tools{margin:6px 0;font:12px system-ui}
      .cna-block-tools button{background:#0f766e}
    `;

    document.documentElement.append(style, root);

    // Setup event handlers
    let autoRunEnabled = true;

    root.querySelector('#cna-auto').addEventListener('change', (event) => {
      autoRunEnabled = event.target.checked;
      updateOverlayStatus(autoRunEnabled ? 'Auto-run enabled' : 'Manual mode');
    });

    root.querySelector('#cna-tools').addEventListener('click', () => {
      updateOverlayStatus('Working…');
      runtime.sendMessage({ type: 'rpc.execute', payload: { tool: 'tool.list', arguments: {} } })
        .then((response) => updateOverlayStatus(response?.ok ? 'Tools loaded' : response?.error?.message || 'Failed'))
        .catch(() => updateOverlayStatus('Native unavailable'));
    });

    root.querySelector('#cna-workspace').addEventListener('click', () => {
      runtime.sendMessage({ type: 'workspace.info', payload: {} })
        .then((response) => updateOverlayStatus(response?.ok ? 'Workspace ready' : 'Workspace error'))
        .catch(() => updateOverlayStatus('Error'));
    });

    root.querySelector('#cna-panel').addEventListener('click', () => {
      runtime.sendMessage({ type: 'sidepanel.open', payload: {} });
    });

    runtime.sendMessage({ type: 'rpc.ping', payload: {} })
      .then((response) => updateOverlayStatus(response?.ok ? 'Native connected' : 'Native unavailable'))
      .catch(() => updateOverlayStatus('Native unavailable'));
  }

  function updateOverlayStatus(message) {
    const status = document.querySelector('#cna-status');
    if (status) status.textContent = message;
  }

  // Observe assistant responses for tool calls
  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-message-author-role="assistant"]')?.lastElementChild && !isGenerating()) {
      scanAssistantMessages();
    }
  });

  // Observe conversation area
  const convArea = document.querySelector('article, main, .conversation, .chat-container') || document.body;
  observer.observe(convArea, { childList: true, subtree: true });

  scanAssistantMessages();

  function isGenerating() {
    return !!document.querySelector('[data-testid*="stop"], .stop-button, [aria-busy="true"], [data-generating="true"]');
  }

  function scanAssistantMessages() {
    const lastAssistant = findLastAssistant();
    if (!lastAssistant || lastAssistant.dataset.cnaProcessed === '1') return;

    const text = cleanText(lastAssistant.innerText || lastAssistant.textContent || '');

    // Check for tool_call JSON blocks
    if (text && /"tool"\s*:\s*"/.test(text)) {
      lastAssistant.dataset.cnaProcessed = '1';
      const match = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) {
        runtime.sendMessage({ type: 'rpc.execute', payload: { type: 'tool_call', arguments: JSON.parse(match[1]) } })
          .then((response) => {
            if (response?.ok) {
              submitRawPrompt(`Result:\n\`\`\`json\n${JSON.stringify(response.result)}\n\`\`\``);
            }
          });
      }
    }
  }

  function findLastAssistant() {
    for (const selector of ASSISTANT_SELECTORS) {
      const nodes = [...document.querySelectorAll(selector)].filter(n => n.getClientRects().length);
      if (nodes.length) return nodes.at(-1);
    }
    return null;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

// Message handler
   runtime.onMessage.addListener((message, sender, sendResponse) => {
     const { type } = message || {};

     if (type === 'minimax.ping') {
       sendResponse({ pong: true, version: '1.0.0' });
       return true;
     }

     if (type === 'minimax.chat') {
       handleProviderChat(message.payload)
         .then((result) => sendResponse({ ok: true, result }))
         .catch((err) => sendResponse({ ok: false, error: err.message }));
       return true;
     }

     if (type === 'minimax.ask') {
       ask(message.payload?.prompt, message.payload?.timeoutMs)
         .then((result) => sendResponse({ ok: true, result }))
         .catch((err) => sendResponse({ ok: false, error: err.message }));
       return true;
     }

if (type === 'minimax.status') {
    sendResponse(getStatus());
    return true;
  }

  if (type === 'minimax.session.capture') {
    captureSessionData()
      .then((session) => sendResponse({ ok: true, session }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (type === 'minimax.session.tokens') {
    sendResponse({ ok: true, tokens: detectSessionTokens() });
    return true;
  }

  return sendResponse({ ok: false, error: `Unknown Minimax message type: ${type}` });
   });

  async function ask(prompt, timeoutMs = 60000) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt required');
    }

    const before = assistantSnapshot();
    updateOverlayStatus('Sending…');

    // Submit prompt
    await submitPrompt(prompt);

    // Wait for response
    const text = await waitForResponse(before, timeoutMs);
    updateOverlayStatus('Response ready');
    return { text };
  }

  function assistantSnapshot() {
    const nodes = findAssistantNodes();
    const last = nodes.at(-1);
    return { count: nodes.length, text: cleanText(last?.innerText || '') };
  }

  function findAssistantNodes() {
    for (const selector of ASSISTANT_SELECTORS) {
      const nodes = [...document.querySelectorAll(selector)].filter(n => n.getClientRects().length);
      if (nodes.length) return nodes;
    }
    return [];
  }

  async function submitPrompt(prompt) {
    const input = findInput();
    if (!input) throw new Error('Input not found');

    input.focus();
    setInputValue(input, prompt);

    const sendBtn = findSend();
    if (sendBtn) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }

    await new Promise(r => setTimeout(r, 300));
  }

  function submitRawPrompt(text) {
    const input = findInput();
    if (!input) return;
    setInputValue(input, text);
    findSend()?.click() || input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  function findInput() {
    for (const selector of COMPOSER_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null && el.getClientRects().length) {
        const rect = el.getBoundingClientRect();
        if (rect.height >= 20 && rect.width >= 100) return el;
      }
    }
    return null;
  }

  function findSend() {
    return SEND_SELECTORS.map(s => document.querySelector(s)).find(el => el?.offsetParent !== null && !el?.disabled) || null;
  }

  function setInputValue(el, value) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
    } else if (el.isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, value);
    }

    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitForResponse(before, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let lastText = '';
      let stable = 0;

      const poll = setInterval(() => {
        if (['challenge_required', 'login_required'].includes(getState().state)) {
          clearInterval(poll);
          reject(new Error('Provider state error'));
          return;
        }

        const current = assistantSnapshot();
        const changed = current.count > before.count || (current.text && current.text !== before.text);

        if (changed) {
          if (current.text === lastText) stable++;
          else { lastText = current.text; stable = 0; }

          if (lastText && stable >= 2 && !isGenerating()) {
            clearInterval(poll);
            resolve(lastText);
          }
        }

        if (Date.now() - started > timeoutMs) {
          clearInterval(poll);
          if (lastText) resolve(lastText);
          else reject(new Error('Timeout'));
        }
      }, 750);
    });
  }

  function getStatus() {
    return {
      provider: 'minimax-agent-web',
      state: getState().state,
      ready: getState().ready,
      loggedIn: getState().state !== 'login_required',
      streaming: isGenerating(),
      url: location.href
    };
  }

  // Handle provider bridge messages from native host
  async function handleProviderChat(payload) {
    const { messages, model, stream = false, timeoutMs = 60000 } = payload || {};
    if (!messages?.length) throw new Error('No messages provided');

    const lastUser = messages.filter(m => m.role === 'user').pop();
    if (!lastUser?.content) throw new Error('No user message found');

    const before = assistantSnapshot();
    const text = await ask(lastUser.content, timeoutMs);
    return { text };
  }

  function observeResponses() {
    const observer = new MutationObserver(() => {
      const lastAssistant = findLastAssistant();
      if (lastAssistant && !isGenerating() && !lastAssistant.dataset.cnaProcessed) {
        lastAssistant.dataset.cnaProcessed = '1';
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getState() {
    const hasInput = !!findInput();
    const text = cleanText(document.body?.innerText || '').toLowerCase();

    if (/log in|sign in/.test(text)) return { state: 'login_required', ready: false };
    if (/rate limit|too many/.test(text)) return { state: 'rate_limited', ready: false, retryable: true };
    if (hasInput) return { state: 'ready', ready: true };
    return { state: 'unknown', ready: false };
  }
})();
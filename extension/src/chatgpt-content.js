// chatgpt-content.js
// ChatGPT Web Content Script - Tiiextension v1.3
// Handles DOM interaction, tool calls, and overlay for ChatGPT Web

import { runtime } from './browser-polyfill.js';
import { ChatGptWebProvider } from './platforms/chatgpt/chatgpt-web-provider.js';

if (!globalThis.__CHATGPT_NATIVE_AGENT_CONTENT_V1__) {
  globalThis.__CHATGPT_NATIVE_AGENT_CONTENT_V1__ = true;

  // Create provider instance
  const chatgptWebProvider = new ChatGptWebProvider();

  // Load selector mappings from robust selector map
  const selectorConfig = (await import('./chatgpt-selectors.json'));

  // Helper to resolve selectors from config
  function getSelectorFromConfig(category) {
    const map = selectorConfig.selectors?.[category] || {};
    const primary = map.primary;
    const fallbacks = map.fallbacks || [];
    if (primary) {
      const el = document.querySelector(primary);
      if (el) return primary;
    }
    for (const fallback of fallbacks) {
      const el = document.querySelector(fallback);
      if (el) return fallback;
    }
    return null;
  }

  // Fallback selector functions
  const getSelector = (category, fallbackDefault = false) => {
    const selector = getSelectorFromConfig(category);
    if (selector) return selector;
    if (category === 'assistant') return '[data-message-author-role="assistant"]';
    if (category === 'composer') return '#prompt-textarea';
    if (category === 'send') return '[data-testid="send-button"]';
    if (category === 'model') return '[data-testid="model-switcher-dropdown-button"]';
    return fallbackDefault ? null : '[data-message-author-role="assistant"]';
  };

  // Constants
  const ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    'article [data-message-author-role="assistant"]',
    'article'
  ];
  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    'textarea[data-testid]',
    'textarea',
    '[contenteditable="true"]'
  ];
  const SEND_SELECTORS = [
    "[data-testid='send-button']",
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
    "form button[type='submit']"
  ];

  // State tracking
  let suppressAutoScanUntil = 0;
  let autoRunEnabled = true;
  let scanTimer = null;
  let lastKnownStructure = null;
  let structureChangeCount = 0;
  let lastScanTime = 0;
  let scanningCooldown = 0;
  const SCAN_THROTTLE = 1500;

  // Provider error helper
  function providerError(code, message, retryable = false) {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    return error;
  }

  // Get ChatGPT provider status
  function providerState() {
    const hasComposer = Boolean(findPromptInput());
    const text = cleanText(document.body?.innerText || "").toLowerCase();
    if (/verify you are human|captcha|cloudflare|security check|challenge/.test(text)) 
      return { state: "challenge_required", ready: false, retryable: false };
    if (!hasComposer && /log in|sign in|đăng nhập/.test(text)) 
      return { state: "login_required", ready: false, retryable: true };
    if (/rate limit|too many requests|try again later|reached.*limit/.test(text)) 
      return { state: "rate_limited", ready: false, retryable: true };
    if (hasComposer) return { state: "ready", ready: true, retryable: false };
    return { state: "dom_incompatible", ready: false, retryable: false };
  }

  // DOM query helpers
  function findPromptInput() {
    for (const selector of COMPOSER_SELECTORS) {
      const input = document.querySelector(selector);
      if (input && input.getClientRects().length) return input;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      "[data-testid='send-button']",
      "button[aria-label*='Send']",
      "button[aria-label*='send']",
      "form button[type='submit']"
    ];
    return selectors.map((selector) => document.querySelector(selector))
      .find((button) => button?.getClientRects().length) || null;
  }

  function getDocumentStructure() {
    return {
      assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
      hasComposer: !!findPromptInput(),
      timestamp: Date.now()
    };
  }

  // Text helpers
  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function uniqueNodes(nodes) {
    return [...new Set(nodes)];
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  // Assistant message helpers
  function assistantNodes() {
    for (const selector of ASSISTANT_SELECTORS) {
      const nodes = [...document.querySelectorAll(selector)].filter((node) => node.getClientRects().length);
      if (nodes.length) return uniqueNodes(nodes);
    }
    return [];
  }

  function assistantSnapshot() {
    const nodes = assistantNodes();
    const node = nodes.at(-1);
    return { count: nodes.length, node, text: cleanText(node?.innerText || node?.textContent || "") };
  }

  function isGenerating() {
    return Boolean(
      document.querySelector("[data-testid='stop-button']")
      || [...document.querySelectorAll("button")].some((button) => /stop|停止|dừng/i.test(button.getAttribute("aria-label") || button.innerText || ""))
    );
  }

  // Model discovery
  function discoverCurrentModel() {
    const selectors = ["[data-testid='model-switcher-dropdown-button']", "button[aria-haspopup='menu']"];
    for (const selector of selectors) {
      const labels = [...document.querySelectorAll(selector)].map((node) => cleanText(node.innerText || node.textContent || ""));
      const model = normalizeModelCandidates(labels)[0];
      if (model) return model;
    }
    return "managed by ChatGPT";
  }

  function discoverModels() {
    const labels = [...document.querySelectorAll("button,[role='menuitem'],[role='option']")]
      .map((node) => cleanText(node.innerText || node.textContent || ""));
    return normalizeModelCandidates(labels);
  }

  function normalizeModelCandidates(values) {
    const accepted = /^(?:GPT(?:-[A-Za-z0-9. -]+)?|ChatGPT(?:\s+[A-Za-z0-9. -]+)?|o\d(?:[A-Za-z0-9. -]+)?|Auto|Thinking|Fast)$/i;
    const output = [];
    for (const value of values) {
      const label = cleanText(value);
      if (!label || !accepted.test(label) || output.some((item) => item.toLowerCase() === label.toLowerCase())) continue;
      output.push(label);
    }
    return output.slice(0, 20);
  }

  // ChatGPT interaction
  async function submitRawPrompt(prompt) {
    const state = providerState();
    if (!state.ready) throw providerError(`PROVIDER_${state.state.toUpperCase()}`, `ChatGPT provider is not ready: ${state.state}`, state.retryable);
    const input = findPromptInput();
    if (!input) throw providerError("PROVIDER_DOM_INCOMPATIBLE", "ChatGPT prompt input not found");
    input.focus();
    setInputValue(input, prompt);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: prompt }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextFrame();
    const sendButton = findSendButton();
    if (sendButton && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") {
      sendButton.click();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cleared = cleanText(input.value || input.innerText || input.textContent || "") !== cleanText(prompt);
    if (!cleared && !isGenerating()) {
      throw providerError("PROVIDER_SUBMISSION_AMBIGUOUS", "The composer did not confirm prompt submission");
    }
    return { submitted: true };
  }

  async function waitForAssistantResponse(before, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let lastText = "";
      let stable = 0;
      const timer = setInterval(() => {
        const state = providerState();
        if (["challenge_required", "login_required", "rate_limited"].includes(state.state)) {
          clearInterval(timer);
          reject(providerError(`PROVIDER_${state.state.toUpperCase()}`, `ChatGPT provider state: ${state.state}`, state.retryable));
          return;
        }
        const current = assistantSnapshot();
        const changed = current.count > before.count || (current.text && current.text !== before.text);
        if (changed) {
          if (current.text === lastText) stable += 1;
          else {
            lastText = current.text;
            stable = 0;
          }
          if (lastText && stable >= 2 && !isGenerating()) {
            clearInterval(timer);
            resolve(lastText);
            return;
          }
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          if (lastText) resolve(lastText);
          else reject(providerError("PROVIDER_RESPONSE_TIMEOUT", "Timed out waiting for ChatGPT response", true));
        }
      }, 750);
    });
  }

  async function ask(prompt, timeoutMs = 180000, requestId = null) {
    if (typeof prompt !== "string" || !prompt.trim()) throw providerError("PROVIDER_PROMPT_REQUIRED", "prompt is required");
    const before = assistantSnapshot();
    suppressAutoScanUntil = Date.now() + timeoutMs + 5000;
    try {
      await submitRawPrompt(prompt);
      const text = await waitForAssistantResponse(before, timeoutMs);
      return { requestId, text, status: getChatGptStatus() };
    } finally {
      suppressAutoScanUntil = 0;
    }
  }

  function getChatGptStatus() {
    const state = providerState();
    return {
      provider: "chatgpt-web",
      state: state.state,
      ready: state.ready,
      loggedIn: state.state !== "login_required",
      models: discoverModels(),
      currentModel: discoverCurrentModel(),
      streaming: isGenerating(),
      url: location.href,
      title: document.title,
      sessionHandling: "browser-managed; credentials are not read or exported"
    };
  }

  // Cookie extraction
  function extractModelFromCookies() {
    try {
      const cookies = {};
      document.cookie.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        if (name && value !== undefined) {
          cookies[name] = decodeURIComponent(value);
        }
      });
      if (cookies['oai-last-model-config']) {
        try {
          const parsed = JSON.parse(cookies['oai-last-model-config']);
          return {
            success: true,
            model: parsed.model,
            effort: parsed.effort,
            raw: cookies['oai-last-model-config']
          };
        } catch (e) {
          return {
            success: false,
            error: "Failed to parse oai-last-model-config cookie",
            raw: cookies['oai-last-model-config']
          };
        }
      }
      return {
        success: false,
        error: "oai-last-model-config cookie not found"
      };
    } catch (error) {
      return {
        success: false,
        error: `Could not extract cookies: ${error.message}`
      };
    }
  }

  // Tool call handling
  const ALLOWED_TOOLS = new Set([
    "runtime.status",
    "workspace.list",
    "fs.list",
    "fs.read",
    "fs.search_text"
  ]);

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (message?.source !== "ti-gpt-web") return;
    if (message?.type !== "tool.call") return;

    const { tool, arguments: args, requestId } = message;

    if (!ALLOWED_TOOLS.has(tool)) {
      window.postMessage({
        source: "tiiextension",
        type: "tool.result",
        requestId,
        response: {
          ok: false,
          error: { code: "TOOL_NOT_ALLOWED", message: `Tool '${tool}' is not allowed in web context` }
        }
      }, "*");
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        channel: "tiiextension.local",
        type: tool,
        payload: args || {}
      });

      window.postMessage({
        source: "tiiextension",
        type: "tool.result",
        requestId,
        response
      }, "*");
    } catch (error) {
      window.postMessage({
        source: "tiiextension",
        type: "tool.result",
        requestId,
        response: {
          ok: false,
          error: { code: "EXTENSION_BRIDGE_FAILED", message: error.message }
        }
      }, "*");
    }
  });

  // Overlay injection
  function injectAgentOverlay() {
    if (document.querySelector("#chatgpt-native-agent-overlay")) return;
    const root = document.createElement("aside");
    root.id = "chatgpt-native-agent-overlay";
    root.setAttribute("aria-label", "Tiiextension controls");
    root.innerHTML = `
      <div class="cna-title">Native Agent <span class="cna-version">v1</span></div>
      <div id="cna-status" aria-live="polite">Connecting…</div>
      <label><input id="cna-auto" type="checkbox" checked> auto-run</label>
      <div class="cna-actions">
        <button id="cna-tools" type="button">Tools</button>
        <button id="cna-workspace" type="button">Workspace</button>
        <button id="cna-panel" type="button">Panel</button>
      </div>
    `;
    const style = document.createElement("style");
    style.textContent = `
      #chatgpt-native-agent-overlay{position:fixed;right:14px;bottom:14px;z-index:2147483647;display:grid;gap:7px;min-width:190px;padding:11px;color:#e5eefb;background:rgba(10,18,34,.94);border:1px solid #334866;border-radius:14px;font:12px/1.35 system-ui,sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.38);backdrop-filter:blur(12px)}
      #chatgpt-native-agent-overlay .cna-title{font-weight:750;color:#8ec5ff}.cna-version{font-size:10px;color:#90a4bf}.cna-actions,.cna-block-tools{display:flex;gap:6px;flex-wrap:wrap}
      #chatgpt-native-agent-overlay button,.cna-block-tools button{color:white;background:#2563eb;border:0;border-radius:8px;padding:6px 8px;cursor:pointer}.cna-block-tools{margin:6px 0;font:12px system-ui}.cna-block-tools button{background:#0f766e}
    `;
    document.documentElement.append(style, root);
    root.querySelector("#cna-auto").addEventListener("change", (event) => {
      autoRunEnabled = event.target.checked;
      updateOverlayStatus(autoRunEnabled ? "Auto-run enabled" : "Manual mode");
    });
    root.querySelector("#cna-tools").addEventListener("click", () => runOverlayCall("native.call", { type: "tool.list", payload: {} }));
    root.querySelector("#cna-workspace").addEventListener("click", () => runOverlayCall("workspace.info", {}));
    root.querySelector("#cna-panel").addEventListener("click", () => runtime.sendMessage({ type: "sidepanel.open", payload: {} }));
    runtime.sendMessage({ type: "native.connect", payload: {} })
      .then((response) => updateOverlayStatus(response?.ok ? `Native ${response.result?.hostVersion || "connected"}` : "Native host unavailable"))
      .catch(() => updateOverlayStatus("Native host unavailable"));
  }

  // DOM observation
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAssistantMessages, 300);
    if (lastKnownStructure !== getDocumentStructure()) {
      structureChangeCount++;
      if (structureChangeCount >= 2) {
        console.debug('[Tiiextension] Document structure changed');
        lastKnownStructure = getDocumentStructure();
        structureChangeCount = 0;
      }
    } else {
      if (scanTimer._restarted) {
        structureChangeCount = 0;
        lastKnownStructure = getDocumentStructure();
      }
    }
  });

  // Initialize
  async function initializeProvider() {
    try {
      await chatgptWebProvider.initialize();
      console.log('[ChatGptWebProvider] Initialized');
    } catch (e) {
      console.error('[ChatGptWebProvider] Failed to initialize:', e);
    }
  }

  // Scan assistant messages
  async function scanAssistantMessages() {
    const now = Date.now();
    if (now - lastScanTime < SCAN_THROTTLE) {
      scanTimer = setTimeout(() => scanAssistantMessages(), SCAN_THROTTLE * 2);
      return;
    }
    lastScanTime = now;
    try {
      // DOM observation for assistant messages
      const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
        .filter((node) => node.getClientRects().length);
      for (const node of nodes) {
        const text = cleanText(node.innerText || node.textContent || "");
        if (text && !node.dataset.scanned) {
          node.dataset.scanned = "true";
          console.debug('[Tiiextension] Found assistant message:', text.slice(0, 100));
        }
      }
      return { scanned: true, count: nodes.length };
    } catch (error) {
      console.debug('[Tiiextension] scanAssistantMessages failed with error:', error);
      return { scanned: false, error: error.message };
    }
  }

  // Setup observers
  const assistantContainer = getSelector('assistant') || document.querySelector('article') || document.documentElement;
  observer.observe(assistantContainer, { childList: true, subtree: true, characterData: true });

  // Initialize the extension
  injectAgentOverlay();
  scanAssistantMessages();
  initializeProvider();

  // Add diagnostic logging
  if (chrome?.runtime?.id === chrome?.runtime?.id) {
    console.debug('[Tiiextension] Extension initialized');
  }

  // Message handler
  async function handleMessage(message) {
    if (message?.type === "chatgpt.ping") return { pong: true, version: "1.3.0" };
    if (message?.type === "chatgpt.status") return getChatGptStatus();
    if (message?.type === "chatgpt.ask") return ask(message.payload?.prompt, message.payload?.timeoutMs, message.payload?.requestId);
    if (message?.type === "chatgpt.send_result") return sendResultToChat(message.payload?.result);
    if (message?.type === "chatgpt.submit_goal") return submitRawPrompt(buildAgentPrompt(message.payload?.goal));
    if (message?.type === "chatgpt.scan") return scanAssistantMessages();
    if (message?.type === "chatgpt.select_model") return selectVisibleModel(message.payload?.label);
    if (message?.type === "chatgpt.extract_session") return {
      provider: "chatgpt-web",
      state: getChatGptStatus()?.state || "unknown",
      credentialsExported: false
    };
    if (message?.type === "chatgpt.extract_model") return extractModelFromCookies();
    if (message?.type === "chatgpt.set_cookie") throw new Error("Raw session mutation is disabled; use the authenticated browser tab");
    if (message?.type === "xiaomimimo.extract_model") return extractXiaomimimoModel();
    if (message?.type === "mgtv.extract_model") return extractMgtvModel();
    if (message?.type === "site.extract_model") return extractSiteModel(message.payload?.site);
    throw providerError("PROVIDER_UNKNOWN_CONTENT_ROUTE", `Unknown ChatGPT content message: ${message?.type}`);
  }

  function buildAgentPrompt(goal) {
    return [
      "Use protocol cnagent/1. Put each executable action in a separate fenced JSON block.",
      "Never request browser cookie/session/token values.",
      `User goal: ${goal}`
    ].join("\n\n");
  }

  async function sendResultToChat(result) {
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    await submitRawPrompt(`Local cnagent/1 result:\n\n\`\`\`json\n${text}\n\`\`\`\n\nContinue only if more actions are required.`);
    updateOverlayStatus("Result sent back to ChatGPT");
    return { sent: true };
  }

  async function selectVisibleModel(label) {
    if (!label) throw providerError("PROVIDER_MODEL_REQUIRED", "model label is required");
    const switcher = document.querySelector("[data-testid='model-switcher-dropdown-button']") || document.querySelector("button[aria-haspopup='menu']");
    if (!switcher) throw providerError("PROVIDER_MODEL_SELECTION_UNAVAILABLE", "Visible model switcher not found");
    switcher.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const matches = [...document.querySelectorAll("[role='menuitem'],[role='option'],button")]
      .filter((node) => cleanText(node.innerText || node.textContent || "").toLowerCase() === cleanText(label).toLowerCase());
    if (matches.length !== 1) throw providerError("PROVIDER_MODEL_SELECTION_UNAVAILABLE", `Expected one visible model option, found ${matches.length}`);
    matches[0].click();
    return { selected: true, model: label };
  }

  async function runOverlayCall(type, payload) {
    updateOverlayStatus("Working…");
    const response = await runtime.sendMessage({ type, payload });
    updateOverlayStatus(response?.ok ? summarize(response.result) : response?.error?.message || "Request failed");
  }

  function updateOverlayStatus(message) {
    const status = document.querySelector("#cna-status");
    if (status) status.textContent = message;
  }

  function summarize(value) {
    const text = JSON.stringify(value);
    return text.length > 110 ? `${text.slice(0, 107)}…` : text;
  }

  function setInputValue(input, value) {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, value);
  }

  async function extractXiaomimimoModel() {
    try {
      const cookies = {};
      document.cookie.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        if (name && value !== undefined) {
          cookies[name] = decodeURIComponent(value);
        }
      });
      if (location.hostname.includes('xiaomimimo.com') || location.hostname.includes('kira.ai') || location.hostname.includes('xiaomimimo')) {
        let model = 'unknown';
        let decodedModel = null;
        if (cookies['xiaomichatbot_ph']) {
          try {
            const rawValue = cookies['xiaomichatbot_ph'].replace(/"/g, '');
            decodedModel = atob(rawValue);
            model = decodedModel || rawValue;
          } catch (e) {
            model = cookies['xiaomichatbot_ph'];
          }
        } else if (cookies['model']) {
          model = cookies['model'];
        }
        const userId = cookies['userId'] || 'anonymous';
        let serviceTokenDecoded = null;
        if (cookies['serviceToken']) {
          try {
            serviceTokenDecoded = JSON.parse(cookies['serviceToken']);
          } catch (e) {}
        }
        return {
          success: true,
          model: model,
          effort: decodedModel || 'decoded',
          userId: userId,
          hasServiceToken: !!cookies['serviceToken'],
          raw: cookies
        };
      }
      return {
        success: false,
        error: 'Not on xiaomimimo.com domain'
      };
    } catch (error) {
      return {
        success: false,
        error: `Could not extract xiaomimimo model: ${error.message}`
      };
    }
  }

  async function extractMgtvModel() {
    try {
      const cookies = {};
      document.cookie.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        if (name && value !== undefined) {
          cookies[name] = decodeURIComponent(value);
        }
      });
      if (location.hostname.includes('mgtv.com')) {
        const vipLevel = cookies['vip_level'] || '0';
        const userId = cookies['user_id'] || '';
        const nickname = cookies['nickname'] || '';
        return {
          success: true,
          domain: 'mgtv.com',
          vipLevel: vipLevel,
          userId: userId,
          nickname: nickname,
          hasAuth: !!cookies['access_token'] || !!cookies['refresh_token'],
          raw: cookies
        };
      }
      return {
        success: false,
        error: 'Not on mgtv.com domain'
      };
    } catch (error) {
      return {
        success: false,
        error: `Could not extract mgtv model: ${error.message}`
      };
    }
  }

  async function extractSiteModel(site) {
    try {
      const cookies = {};
      document.cookie.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        if (name && value !== undefined) {
          cookies[name] = decodeURIComponent(value);
        }
      });
      return {
        success: true,
        site: site,
        cookieCount: Object.keys(cookies).length,
        hasCookies: Object.keys(cookies).length > 0,
        raw: cookies
      };
    } catch (error) {
      return {
        success: false,
        error: `Could not extract model for site ${site}: ${error.message}`
      };
    }
  }

  // Message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message).then(response => sendResponse(response)).catch(error => {
      sendResponse({ ok: false, error: { code: error.code, message: error.message, retryable: error.retryable } });
    });
    return true; // Keep message channel open for async response
  });

  // Import missing functions for backward compatibility
  window.getChatGptStatus = getChatGptStatus;
  window.initializeProvider = initializeProvider;
  window.extractModelFromCookies = extractModelFromCookies;

}
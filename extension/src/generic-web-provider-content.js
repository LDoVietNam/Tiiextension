// Generic browser-backed provider adapter. Authentication remains in the tab:
// this script never reads, serializes, or forwards cookies/session tokens.

(() => {
  if (globalThis.__TII_GENERIC_PROVIDER_V1__) return;
  globalThis.__TII_GENERIC_PROVIDER_V1__ = true;

  const provider = detectProvider(location.hostname);
  if (!provider) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ti-provider.status") {
      sendResponse({ ok: true, result: getStatus(provider) });
      return false;
    }
    if (message?.type !== "ti-provider.request") return false;
    executeRequest(provider, message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { code: error.code || "WEB_PROVIDER_FAILED", message: safeError(error) }
      }));
    return true;
  });

  async function executeRequest(config, request) {
    const operation = normalizeOperation(request.operation);
    if (!config.operations.includes(operation)) {
      throw providerError("PROVIDER_OPERATION_UNSUPPORTED", `${config.id} does not support ${operation}`);
    }
    const prompt = extractPrompt(request.payload || request);
    if (!prompt) throw providerError("PROVIDER_INPUT_INVALID", "A non-empty prompt is required");
    const timeoutMs = clampTimeout(request.timeoutMs || request.payload?.timeoutMs);

    if (operation === "images.generations") {
      return generateImages(config, prompt, timeoutMs, request);
    }
    return generateText(config, prompt, timeoutMs, request);
  }

  async function generateText(config, prompt, timeoutMs, request) {
    const before = snapshotText(config);
    await submitPrompt(config, prompt);
    const text = await waitForText(config, before, timeoutMs);
    return {
      provider: config.id,
      model: request.model || config.defaultModel,
      text,
      session: getStatus(config).session
    };
  }

  async function generateImages(config, prompt, timeoutMs, request) {
    const before = new Set(findImages(config).map(imageKey));
    await submitPrompt(config, prompt);
    const images = await waitForImages(config, before, timeoutMs);
    return {
      provider: config.id,
      model: request.model || config.defaultModel,
      data: images.map((image) => ({
        url: image.currentSrc || image.src,
        revised_prompt: prompt
      }))
    };
  }

  async function submitPrompt(config, prompt) {
    const input = findVisible(config.inputSelectors);
    if (!input) throw providerError("PROVIDER_COMPOSER_NOT_FOUND", "Provider prompt input was not found", true);
    input.focus();
    setInputValue(input, prompt);
    await delay(100);
    const submit = findVisible(config.submitSelectors, (node) => !node.disabled);
    if (submit) submit.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    await delay(300);
  }

  function waitForText(config, before, timeoutMs) {
    return pollUntil(() => {
      const current = snapshotText(config);
      if (!isBusy(config) && current.text && (current.count > before.count || current.text !== before.text)) {
        return current.text;
      }
      return null;
    }, timeoutMs, "Provider text response timed out");
  }

  function waitForImages(config, before, timeoutMs) {
    return pollUntil(() => {
      const fresh = findImages(config).filter((image) => !before.has(imageKey(image)));
      return !isBusy(config) && fresh.length ? fresh.slice(0, 4) : null;
    }, timeoutMs, "Provider image response timed out");
  }

  function pollUntil(check, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        try {
          const result = check();
          if (result) {
            clearInterval(timer);
            resolve(result);
          } else if (Date.now() - started >= timeoutMs) {
            clearInterval(timer);
            reject(providerError("PROVIDER_RESPONSE_TIMEOUT", timeoutMessage, true));
          }
        } catch (error) {
          clearInterval(timer);
          reject(error);
        }
      }, 750);
    });
  }

  function snapshotText(config) {
    const nodes = findAllVisible(config.responseSelectors);
    const last = nodes.at(-1);
    return { count: nodes.length, text: cleanText(last?.innerText || last?.textContent || "") };
  }

  function findImages(config) {
    return findAllVisible(config.imageSelectors || ["img"]).filter((image) => {
      const rect = image.getBoundingClientRect();
      const src = image.currentSrc || image.src || "";
      return rect.width >= 128 && rect.height >= 128 && /^(?:blob:|data:image\/|https?:)/.test(src);
    });
  }

  function getStatus(config) {
    const pageText = cleanText(document.body?.innerText || "").toLowerCase();
    const loginRequired = /\b(?:log in|sign in|đăng nhập|connexion)\b/.test(pageText) && !findVisible(config.inputSelectors);
    const ready = Boolean(findVisible(config.inputSelectors)) && !loginRequired;
    return {
      provider: config.id,
      ready,
      busy: isBusy(config),
      session: {
        state: loginRequired ? "login_required" : ready ? "ready" : "unknown",
        authenticated: ready,
        source: "browser-tab",
        credentialsExported: false
      },
      url: location.origin + location.pathname
    };
  }

  function isBusy(config) {
    return Boolean(findVisible(config.busySelectors || [
      "[aria-busy='true']", "[data-generating='true']", "button[aria-label*='Stop']", "button[title*='Stop']"
    ]));
  }

  function findVisible(selectors, predicate = () => true) {
    return findAllVisible(selectors).find(predicate) || null;
  }

  function findAllVisible(selectors) {
    const result = [];
    const seen = new Set();
    for (const selector of selectors || []) {
      let nodes = [];
      try { nodes = document.querySelectorAll(selector); } catch { continue; }
      for (const node of nodes) {
        if (seen.has(node) || !node.getClientRects().length) continue;
        seen.add(node);
        result.push(node);
      }
    }
    return result;
  }

  function setInputValue(element, value) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    } else if (element.isContentEditable) {
      element.textContent = value;
    } else {
      throw providerError("PROVIDER_COMPOSER_UNSUPPORTED", "Unsupported provider input element");
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function extractPrompt(payload) {
    if (typeof payload.prompt === "string") return payload.prompt.trim();
    if (typeof payload.input === "string") return payload.input.trim();
    if (Array.isArray(payload.messages)) {
      const message = [...payload.messages].reverse().find((item) => item?.role === "user") || payload.messages.at(-1);
      if (typeof message?.content === "string") return message.content.trim();
      if (Array.isArray(message?.content)) {
        return message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n").trim();
      }
    }
    return "";
  }

  function normalizeOperation(value) {
    const aliases = {
      chat: "chat.completions",
      "chat/completions": "chat.completions",
      image: "images.generations",
      "images/generations": "images.generations"
    };
    return aliases[value] || value || "chat.completions";
  }

  function detectProvider(hostname) {
    const commonInputs = [
      "textarea", "[contenteditable='true'][role='textbox']", "[contenteditable='true']",
      "input[type='text']", "[data-testid*='prompt']", "[aria-label*='prompt' i]"
    ];
    const commonSubmit = [
      "button[type='submit']", "button[aria-label*='send' i]", "button[aria-label*='create' i]",
      "button[data-testid*='send']", "button[data-testid*='generate']"
    ];
    const commonResponses = [
      "[data-message-author-role='assistant']", "[data-role='assistant']", ".assistant-message",
      "article", "main .markdown", "[class*='answer']", "[class*='response']"
    ];

    if (hostname === "designer.microsoft.com" || hostname.endsWith(".designer.microsoft.com")) {
      return {
        id: "microsoft-designer-web",
        defaultModel: "microsoft-designer/image-creator",
        operations: ["images.generations"],
        inputSelectors: ["textarea[placeholder*='Describe' i]", "[aria-label*='Describe' i]", ...commonInputs],
        submitSelectors: ["button[aria-label*='Create' i]", ...commonSubmit],
        responseSelectors: commonResponses,
        imageSelectors: ["main img", "[data-testid*='result'] img", "[class*='result'] img", "img"]
      };
    }
    if (hostname === "deepai.org" || hostname.endsWith(".deepai.org")) {
      return {
        id: "deepai-web",
        defaultModel: "deepai/auto",
        operations: ["chat.completions", "images.generations"],
        inputSelectors: commonInputs,
        submitSelectors: commonSubmit,
        responseSelectors: commonResponses,
        imageSelectors: ["[class*='output'] img", "[class*='result'] img", "main img"]
      };
    }
    if (hostname === "felo.ai" || hostname.endsWith(".felo.ai")) {
      return {
        id: "felo-web",
        defaultModel: "felo/search",
        operations: ["chat.completions"],
        inputSelectors: ["textarea", "[role='textbox']", ...commonInputs],
        submitSelectors: commonSubmit,
        responseSelectors: ["[class*='answer']", "[class*='markdown']", "article", ...commonResponses]
      };
    }
    return null;
  }

  function imageKey(image) {
    return image.currentSrc || image.src || image.getAttribute("data-src") || "";
  }

  function clampTimeout(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(5_000, Math.min(parsed, 10 * 60_000)) : 180_000;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeError(error) {
    return String(error?.message || error || "Provider failed")
      .replace(/(?:bearer\s+|api[_-]?key[=:]\s*|token[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
      .slice(0, 1_000);
  }

  function providerError(code, message, retryable = false) {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    return error;
  }
})();

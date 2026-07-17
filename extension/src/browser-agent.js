import { getCdpEngine } from './cdp-engine.js';

const cdpEngine = getCdpEngine();

export function createBrowserAgent(chromeApi) {
  if (!chromeApi?.tabs || !chromeApi?.scripting) throw new TypeError("Chrome tabs and scripting APIs are required");
  const leases = new Map();

  async function run(input = {}) {
    const action = normalizeAction(input.action);
    switch (action) {
      // Legacy scripting-based actions (backward compatible)
      case "browser.tabs.list": return tabsList(input);
      case "browser.tabs.get": return tabsGet(input);
      case "browser.tabs.open": return tabsOpen(input);
      case "browser.tabs.activate": return tabsActivate(input);
      case "browser.tabs.close": return tabsClose(input);
      case "browser.navigate": return navigate(input);
      case "browser.reload": return reload(input);
      case "browser.wait_for_selector": return waitForSelector(input);
      case "browser.locator.click": return locator(input, "click");
      case "browser.locator.fill": return locator(input, "fill");
      case "browser.locator.text": return locator(input, "text");
      case "browser.locator.attributes": return locator(input, "attributes");
      case "browser.extract_text": return locator({ ...input, locator: input.locator || { css: input.selector || "body" } }, "text");
      case "browser.scroll": return scroll(input);
      case "browser.screenshot": return screenshot(input);
      case "browser.dom_snapshot": return domSnapshot(input);
      case "browser.console_logs": return collectCdpEvents(input, ["Log", "Runtime"], ["Log.", "Runtime.consoleAPICalled", "Runtime.exceptionThrown"]);
      case "browser.network_log": return collectCdpEvents(input, ["Network"], ["Network."]);
      case "browser.downloads.list": return downloadsList(input);
      case "browser.downloads.wait": return downloadsWait(input);
      case "browser.cdp.send": return cdpSend(input);
       
       // CDP-powered actions using cdpEngine (pattern from Codex)
       case "browser.cdp.click": {
         const tabId = await resolveTabId(input);
         return cdpEngine.click(tabId, input.x, input.y, { button: input.button || "left" });
       }
       case "browser.cdp.type": {
         const tabId = await resolveTabId(input);
         return cdpEngine.type(tabId, input.text);
       }
       case "browser.cdp.evaluate": {
         const tabId = await resolveTabId(input);
         return { tab_id: tabId, value: await cdpEngine.evaluate(tabId, input.expression, { awaitPromise: input.awaitPromise }) };
       }
       case "browser.cdp.screenshot": {
         const tabId = await resolveTabId(input);
         return cdpEngine.screenshot(tabId, { format: input.format, quality: input.quality, fullPage: input.fullPage });
       }
       case "browser.cdp.navigate": {
         const tabId = await resolveTabId(input);
         return cdpEngine.navigate(tabId, input.url);
       }
       case "browser.cdp.html": {
         const tabId = await resolveTabId(input);
         return { tab_id: tabId, html: await cdpEngine.getOuterHTML(tabId, { depth: input.depth }) };
       }
       case "browser.cdp.enable": {
         const tabId = await resolveTabId(input);
         return cdpEngine.enableDomain(tabId, input.domain);
       }
       case "browser.cdp.collect_events": {
         const tabId = await resolveTabId(input);
         return { tab_id: tabId, events: await cdpEngine.collectEvents(tabId, { domains: input.domains, durationMs: input.durationMs, filterPrefixes: input.filterPrefixes }) };
       }
       case "browser.cdp.wait_load": {
         const tabId = await resolveTabId(input);
         return cdpEngine.waitForLoad(tabId, { timeoutMs: input.timeoutMs });
       }
       case "browser.cdp.attach": {
         const tabId = await resolveTabId(input);
         return cdpEngine.attach(tabId);
       }
       case "browser.cdp.detach": {
         const tabId = await resolveTabId(input);
         return cdpEngine.detach(tabId);
       }
       case "browser.cdp.sessions": {
         return { sessions: Array.from(cdpEngine.getActiveSessions().entries()).map(([tabId, session]) => ({ tabId, attachedAt: session.attachedAt, refCount: session.refCount, enabledDomains: [...session.enabledDomains] })) };
       }
       
       default: throw browserError("BROWSER_ACTION_UNSUPPORTED", `Unsupported browser action: ${input.action}`);
    }
  }

  async function tabsList({ currentWindow = false } = {}) {
    const tabs = await chromeApi.tabs.query(currentWindow ? { currentWindow: true } : {});
    return { tabs: tabs.map(publicTab) };
  }

  async function tabsGet(input) {
    const tab = await chromeApi.tabs.get(await resolveTabId(input));
    return publicTab(tab);
  }

  async function tabsOpen({ url, active = true } = {}) {
    validateNavigableUrl(url);
    const tab = await chromeApi.tabs.create({ url, active });
    return publicTab(tab);
  }

  async function tabsActivate(input) {
    const tabId = await resolveTabId(input);
    const tab = await chromeApi.tabs.update(tabId, { active: true });
    return publicTab(tab);
  }

  async function tabsClose(input) {
    const tabId = await resolveTabId(input);
    await chromeApi.tabs.remove(tabId);
    return { tab_id: tabId, closed: true };
  }

  async function navigate({ url, ...input }) {
    validateNavigableUrl(url);
    const tabId = await resolveTabId(input);
    const tab = await chromeApi.tabs.update(tabId, { url });
    return publicTab(tab);
  }

  async function reload(input) {
    const tabId = await resolveTabId(input);
    await chromeApi.tabs.reload(tabId, { bypassCache: Boolean(input.bypass_cache || input.bypassCache) });
    return { tab_id: tabId, reloaded: true };
  }

  async function waitForSelector({ selector, timeout_ms = 10000, ...input }) {
    if (!selector) throw browserError("BROWSER_SELECTOR_REQUIRED", "selector is required");
    const tabId = await resolveTabId(input);
    const [result] = await chromeApi.scripting.executeScript({
      target: { tabId },
      args: [selector, timeout_ms],
      func: async (css, timeout) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(css);
          if (element) return { found: true, elapsed_ms: Date.now() - started };
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { found: false, elapsed_ms: Date.now() - started };
      }
    });
    if (!result?.result?.found) throw browserError("BROWSER_SELECTOR_TIMEOUT", `Selector did not appear: ${selector}`, true);
    return { tab_id: tabId, selector, ...result.result };
  }

  async function locator(input, operation) {
    const tabId = await resolveTabId(input);
    const locatorSpec = input.locator || (input.selector ? { css: input.selector } : null);
    if (!locatorSpec) throw browserError("BROWSER_LOCATOR_REQUIRED", "locator is required");
    const execute = async () => {
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId },
        args: [locatorSpec, operation, input.text ?? "", Boolean(input.submit)],
        func: performLocatorInPage
      });
      const value = result?.result || { count: 0, items: [] };
      if (["click", "fill"].includes(operation)) {
        if (value.count === 0) throw browserError("BROWSER_LOCATOR_NOT_FOUND", "Locator matched no elements");
        if (value.count !== 1) throw browserError("BROWSER_LOCATOR_AMBIGUOUS", `Locator matched ${value.count} elements`);
      }
      return { tab_id: tabId, operation, ...value };
    };
    return ["click", "fill"].includes(operation) ? withLease(tabId, execute) : execute();
  }

  async function scroll({ x = 0, y = 800, ...input }) {
    const tabId = await resolveTabId(input);
    const [result] = await chromeApi.scripting.executeScript({
      target: { tabId },
      args: [x, y],
      func: (dx, dy) => {
        window.scrollBy(dx, dy);
        return { x: window.scrollX, y: window.scrollY };
      }
    });
    return { tab_id: tabId, ...(result?.result || {}) };
  }

  async function screenshot({ format = "png", quality, ...input }) {
    const tabId = await resolveTabId(input);
    const tab = await chromeApi.tabs.get(tabId);
    const options = { format };
    if (format === "jpeg" && quality !== undefined) options.quality = quality;
    const dataUrl = await chromeApi.tabs.captureVisibleTab(tab.windowId, options);
    return { tab_id: tabId, data_url: dataUrl, format };
  }

  async function domSnapshot(input) {
    const tabId = await resolveTabId(input);
    const [result] = await chromeApi.scripting.executeScript({
      target: { tabId, allFrames: Boolean(input.all_frames) },
      func: () => ({ url: location.href, title: document.title, html: document.documentElement?.outerHTML || "" })
    });
    return { tab_id: tabId, snapshot: result?.result || null };
  }

  async function cdpSend({ method, params = {}, ...input }) {
    const tabId = await resolveTabId(input);
    validateCdpMethod(method);
    return withLease(tabId, async () => {
      const target = { tabId };
      await chromeApi.debugger.attach(target, "0.1");
      try {
        return { tab_id: tabId, method, result: await chromeApi.debugger.sendCommand(target, method, params) };
      } finally {
        await chromeApi.debugger.detach(target).catch(() => {});
      }
    });
  }

  async function collectCdpEvents({ duration_ms = 1000, ...input }, domains, prefixes) {
    const tabId = await resolveTabId(input);
    return withLease(tabId, async () => {
      const target = { tabId };
      const events = [];
      const listener = (source, method, params) => {
        if (source.tabId === tabId && prefixes.some((prefix) => method.startsWith(prefix))) events.push({ method, params, at: Date.now() });
      };
      await chromeApi.debugger.attach(target, "0.1");
      chromeApi.debugger.onEvent.addListener(listener);
      try {
        for (const domain of domains) await chromeApi.debugger.sendCommand(target, `${domain}.enable`).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(duration_ms, 30000))));
        return { tab_id: tabId, events };
      } finally {
        chromeApi.debugger.onEvent.removeListener(listener);
        await chromeApi.debugger.detach(target).catch(() => {});
      }
    });
  }

  async function downloadsList({ query = {} } = {}) {
    if (!chromeApi.downloads) throw browserError("BROWSER_DOWNLOADS_UNAVAILABLE", "downloads permission/API is unavailable");
    const items = await chromeApi.downloads.search(query);
    return { downloads: items.map(publicDownload) };
  }

  async function downloadsWait({ id, timeout_ms = 120000 } = {}) {
    if (!chromeApi.downloads || id === undefined) throw browserError("BROWSER_DOWNLOAD_REQUIRED", "download id is required");
    const existing = (await chromeApi.downloads.search({ id }))[0];
    if (existing?.state === "complete") return publicDownload(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(browserError("BROWSER_DOWNLOAD_TIMEOUT", `Download timed out: ${id}`, true)), timeout_ms);
      const listener = async (delta) => {
        if (delta.id !== id) return;
        if (delta.state?.current === "complete") finish(null, publicDownload((await chromeApi.downloads.search({ id }))[0]));
        if (delta.error?.current) finish(browserError("BROWSER_DOWNLOAD_FAILED", delta.error.current));
      };
      chromeApi.downloads.onChanged.addListener(listener);
      function finish(error, value) {
        clearTimeout(timer);
        chromeApi.downloads.onChanged.removeListener(listener);
        if (error) reject(error);
        else resolve(value);
      }
    });
  }

  async function resolveTabId(input = {}) {
    const explicit = input.tab_id ?? input.tabId;
    if (explicit) return explicit;
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw browserError("BROWSER_TAB_NOT_FOUND", "No active tab");
    return tab.id;
  }

  async function withLease(tabId, operation) {
    if (leases.has(tabId)) throw browserError("BROWSER_TAB_BUSY", `Tab ${tabId} already has a browser-control lease`, true);
    leases.set(tabId, true);
    try {
      return await operation();
    } finally {
      leases.delete(tabId);
    }
  }

  return { run };
}

export function runBrowserAction(action) {
  if (typeof chrome === "undefined") throw browserError("BROWSER_API_UNAVAILABLE", "Chrome extension APIs are unavailable");
  const agent = createBrowserAgent(chrome);
  return agent.run(action);
}

function normalizeAction(action) {
  const legacy = {
    open_tab: "browser.tabs.open",
    extract_text: "browser.extract_text",
    click: "browser.locator.click",
    type: "browser.locator.fill",
    scroll: "browser.scroll"
  };
  return legacy[action] || action;
}

function performLocatorInPage(spec, operation, value, submit) {
  const all = [...document.querySelectorAll("*")];
  const normalized = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const equals = (left, right) => normalized(left).localeCompare(normalized(right), undefined, { sensitivity: "accent" }) === 0;
  const roleOf = (element) => element.getAttribute("role") || ({ BUTTON: "button", A: "link", INPUT: "textbox", TEXTAREA: "textbox" }[element.tagName] || "");
  const nameOf = (element) => element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || element.value || "";
  let matches;
  if (spec.css) matches = [...document.querySelectorAll(spec.css)];
  else if (spec.test_id) matches = [...document.querySelectorAll(`[data-testid="${CSS.escape(spec.test_id)}"]`)];
  else if (spec.label) {
    const labels = [...document.querySelectorAll("label")].filter((label) => equals(label.innerText, spec.label));
    matches = labels.flatMap((label) => {
      const target = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector("input,textarea,select,[contenteditable='true']");
      return target ? [target] : [];
    });
  } else if (spec.role) matches = all.filter((element) => roleOf(element) === spec.role && (!spec.name || equals(nameOf(element), spec.name)));
  else if (spec.text) matches = all.filter((element) => equals(element.innerText || element.textContent, spec.text));
  else matches = [];
  matches = matches.filter((element) => element.getClientRects().length > 0);
  if (operation === "click" && matches.length === 1) matches[0].click();
  if (operation === "fill" && matches.length === 1) {
    const element = matches[0];
    element.focus();
    if ("value" in element) element.value = value;
    else element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    if (submit) element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
  }
  return {
    count: matches.length,
    items: matches.slice(0, 50).map((element) => ({
      text: normalized(element.innerText || element.textContent || element.value),
      tag: element.tagName.toLowerCase(),
      role: roleOf(element),
      attributes: Object.fromEntries([...element.attributes].slice(0, 50).map((attribute) => [attribute.name, attribute.value]))
    }))
  };
}

// ====== Helpers ======

const SAFE_CDP_DOMAINS = new Set([
  "Accessibility", "Console", "CSS", "DOM", "DOMDebugger", "DOMSnapshot",
  "Emulation", "Input", "Log", "Network", "Page", "Performance", "Runtime", "Target"
]);

function validateNavigableUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw browserError("BROWSER_URL_INVALID", `Invalid URL: ${value}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw browserError("BROWSER_URL_DENIED", `URL protocol is not allowed: ${url.protocol}`);
}

function validateCdpMethod(method) {
  if (typeof method !== "string" || !method.includes(".")) throw browserError("BROWSER_CDP_METHOD_INVALID", "CDP method is required");
  const domain = method.split(".", 1)[0];
  if (!SAFE_CDP_DOMAINS.has(domain)) throw browserError("BROWSER_CDP_METHOD_DENIED", `CDP domain is not allowed: ${domain}`);
}

function publicTab(tab) {
  return {
    tab_id: tab.id,
    window_id: tab.windowId,
    active: Boolean(tab.active),
    title: tab.title || "",
    url: tab.url || tab.pendingUrl || "",
    status: tab.status || null
  };
}

function publicDownload(item) {
  return {
    id: item.id,
    filename: item.filename,
    url: item.url,
    state: item.state,
    bytes_received: item.bytesReceived,
    total_bytes: item.totalBytes,
    error: item.error || null
  };
}

function browserError(code, message, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}


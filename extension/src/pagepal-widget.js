// Tiiextension Unified Widget - Chat + Save + Credential Extractor
// Modern glass morphism UI with multiple integrated functions

(function() {
  if (document.getElementById("__tiiextension-widget")) return;

  const STYLES = `
    :root {
      --ti-primary: #3B82F6;
      --ti-secondary: #8B5CF6;
      --ti-accent: #EC4899;
      --ti-bg: rgba(30, 41, 59, 0.95);
      --ti-surface: rgba(255, 255, 255, 0.05);
      --ti-text: #E2E8F0;
      --ti-text-secondary: #9FB4B0;
    }
    
    #__tiiextension-chat-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483646;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--ti-primary), var(--ti-secondary));
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(59, 130, 246, 0.25);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    #__tiiextension-chat-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(59, 130, 246, 0.35);
    }
    
    #__tiiextension-chat-btn:active { transform: scale(0.95); }
    
    #__tiiextension-chat-window {
      position: fixed;
      bottom: 84px;
      right: 24px;
      z-index: 2147483647;
      width: 360px;
      background: var(--ti-bg);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
      display: none;
      flex-direction: column;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      overflow: hidden;
    }
    
    #__tiiextension-chat-header {
      padding: 16px 20px;
      background: linear-gradient(135deg, var(--ti-primary), var(--ti-secondary));
      color: white;
      font-weight: 600;
      font-size: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    #__tiiextension-chat-header button {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      cursor: pointer;
      font-size: 20px;
      opacity: 0.9;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    #__tiiextension-chat-header button:hover { opacity: 1; background: rgba(255, 255, 255, 0.2); }
    
    #__tiiextension-chat-tabs {
      display: flex;
      padding: 0 16px;
      gap: 4px;
      margin-top: -12px;
    }
    
    .ti-tab {
      padding: 8px 16px;
      font-size: 12px;
      color: var(--ti-text-secondary);
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    
    .ti-tab.active {
      color: var(--ti-primary);
      border-bottom-color: var(--ti-primary);
    }
    
    #__tiiextension-chat-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      color: var(--ti-text);
      font-size: 14px;
      line-height: 1.5;
      min-height: 120px;
      max-height: 240px;
    }
    
    #__tiiextension-chat-input {
      padding: 12px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      gap: 8px;
    }
    
    #__tiiextension-chat-input input {
      flex: 1;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: var(--ti-surface);
      color: var(--ti-text);
      font-size: 14px;
      outline: none;
    }
    
    #__tiiextension-chat-input input:focus { border-color: var(--ti-primary); }
    
    #__tiiextension-chat-input button {
      padding: 0 16px;
      border-radius: 8px;
      border: none;
      background: linear-gradient(135deg, var(--ti-primary), var(--ti-accent));
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    
    #__tiiextension-chat-input button:hover { opacity: 0.9; }
    
    #__tiiextension-save-btn {
      position: fixed;
      z-index: 2147483647;
      padding: 10px 16px;
      background: linear-gradient(135deg, var(--ti-primary), var(--ti-secondary));
      color: white;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 500;
      border-radius: 10px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3);
      opacity: 0;
      transform: translateY(4px);
      transition: all 0.15s ease;
      display: none;
    }
    
    #__tiiextension-toast {
      position: fixed;
      bottom: 84px;
      right: 24px;
      z-index: 2147483648;
      padding: 12px 20px;
      background: var(--ti-bg);
      color: var(--ti-text);
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0,0, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      opacity: 0;
      transition: opacity 0.3s;
    }
    
    .ti-msg {
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      max-width: 85%;
    }
    
    .ti-msg-user {
      background: linear-gradient(135deg, var(--ti-primary), var(--ti-secondary));
      color: white;
      margin-left: auto;
    }
    
    .ti-msg-ai {
      background: var(--ti-surface);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
  `;

  const styleSheet = document.createElement("style");
  styleSheet.textContent = STYLES;
  document.head.appendChild(styleSheet);

  const container = document.createElement("div");
  container.id = "__tiiextension-widget";
  container.innerHTML = `
    <div id="__tiiextension-chat-btn" title="Tiiextension AI">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>
    <div id="__tiiextension-chat-window">
      <div id="__tiiextension-chat-header">
        <span>Tiiextension AI</span>
        <button id="__tiiextension-minimize" title="Close">×</button>
      </div>
      <div id="__tiiextension-chat-tabs">
        <div class="ti-tab active" data-tab="chat">Chat</div>
        <div class="ti-tab" data-tab="save">Save</div>
        <div class="ti-tab" data-tab="autofill">Autofill</div>
        <div class="ti-tab" data-tab="security">Security</div>
        <div class="ti-tab" data-tab="credentials">Credentials</div>
        <div class="ti-tab" data-tab="api-debugger">API</div>
        <div class="ti-tab" data-tab="captcha">Captcha</div>
        <div class="ti-tab" data-tab="grok">Grok</div>
      </div>
      <div id="__tiiextension-chat-messages"></div>
      <div id="__tiiextension-chat-input">
        <input type="text" id="__tiiextension-input" placeholder="Ask about this page..." />
        <button id="__tiiextension-send">Send</button>
        <button id="__tiiextension-extract-creds" style="display:none;padding:0 12px;">Extract</button>
      </div>
    </div>
    <div id="__tiiextension-save-btn">&#128218; Save Text</div>
    <div id="__tiiextension-toast"></div>
  `;
  document.body.appendChild(container);

  const chatBtn = document.getElementById("__tiiextension-chat-btn");
  const chatWindow = document.getElementById("__tiiextension-chat-window");
  const chatMessages = document.getElementById("__tiiextension-chat-messages");
  const chatInput = document.getElementById("__tiiextension-input");
  const sendBtn = document.getElementById("__tiiextension-send");
  const extractBtn = document.getElementById("__tiiextension-extract-creds");
  const saveBtn = document.getElementById("__tiiextension-save-btn");
  const toast = document.getElementById("__tiiextension-toast");
  const minimizeBtn = document.getElementById("__tiiextension-minimize");
  const tabs = document.querySelectorAll(".ti-tab");

  let selectedText = "";
  let hideTimeout = null;
  let currentTab = "chat";

  // Toggle chat window
  chatBtn.addEventListener("click", () => {
    chatWindow.style.display = chatWindow.style.display === "flex" ? "none" : "flex";
    if (chatWindow.style.display === "flex") chatInput.focus();
  });

  minimizeBtn.addEventListener("click", () => { chatWindow.style.display = "none"; });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelector(".ti-tab.active").classList.remove("active");
      tab.classList.add("active");
      currentTab = tab.dataset.tab;
      sendBtn.style.display = currentTab === "chat" || currentTab === "security" ? "" : "none";
      extractBtn.style.display = currentTab === "credentials" ? "" : "none";
      chatInput.placeholder = currentTab === "chat" 
        ? "Ask about this page..." 
        : currentTab === "autofill" 
          ? "Enter temp email or press autofill..."
          : currentTab === "security"
            ? "Click 'Scan' to check for exposed secrets..."
            : currentTab === "captcha"
              ? "Auto-detect and solve CAPTCHA..."
              : currentTab === "grok"
                ? "GrokHub: register or query token pool..."
                : "Extract ChatGPT credentials...";
      if (currentTab === "autofill") detectAndMarkForms();
      if (currentTab === "security") runSecurityScan();
      if (currentTab === "api-debugger") initAPIDebugger();
      if (currentTab === "captcha") detectAndSolveCaptcha();
      if (currentTab === "grok") initGrokTab();
    });
  });

  // Show toast
  function showToast(message) {
    toast.textContent = message;
    toast.style.opacity = "1";
    setTimeout(() => { toast.style.opacity = "0"; }, 2000);
  }

  // Add message to chat
  function addMessage(text, isUser = false) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `ti-msg ${isUser ? "ti-msg-user" : "ti-msg-ai"}`;
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Show save button on text selection
  function showSaveButton(x, y) {
    saveBtn.style.display = "block";
    saveBtn.style.left = Math.min(x, window.innerWidth - 150) + "px";
    saveBtn.style.top = Math.max(y - 45, 10) + "px";
    requestAnimationFrame(() => {
      saveBtn.style.opacity = "1";
      saveBtn.style.transform = "translateY(0)";
    });
  }

  function hideSaveButton() {
    saveBtn.style.opacity = "0";
    saveBtn.style.transform = "translateY(4px)";
    setTimeout(() => { saveBtn.style.display = "none"; }, 150);
  }

  // Handle text selection
  document.addEventListener("mouseup", function(e) {
    if (e.target === saveBtn || saveBtn.contains(e.target)) return;
    clearTimeout(hideTimeout);
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length > 5) {
        selectedText = text;
        showSaveButton(e.clientX, e.clientY);
      } else {
        hideTimeout = setTimeout(hideSaveButton, 200);
      }
    }, 10);
  });

  // Click save button
  saveBtn.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedText) return;
    window.postMessage({
      type: "TIIEXTENSION_SAVE",
      text: selectedText,
      url: window.location.href,
      title: document.title
    }, "*");
    hideSaveButton();
    showToast("Text saved to memory!");
  });

  // Handle chat send
  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    addMessage(text, true);
    chatInput.value = "";

    if (currentTab === "chat" || currentTab === "security") {
      const cached = getCachedResponse(text);
      if (cached) {
        addMessage(`[Cached] ${cached.response}`);
        return;
      }
      
      const ctx = buildPageContext();
      const queryWithContext = ctx.selectedText ? `"${ctx.selectedText}" - ${text}` : text;
      
      window.postMessage({
        type: "TIIEXTENSION_QUERY",
        text: queryWithContext,
        url: window.location.href,
        title: document.title,
        context: ctx
      }, "*");
      setTimeout(() => addMessage("Processing your request..."), 500);
    } else if (currentTab === "autofill") {
      fillFormWithTemp(text);
    } else if (currentTab === "credentials") {
      extractCredentials();
    } else if (currentTab === "api-debugger") {
      const calls = getAPICalls();
      addMessage(`Captured ${calls.length} API calls\n${calls.map(c => `${c.method} ${c.url} (${c.status || "pending"})`).join("\n")}`);
    }
  }

  // Security scanner - detects exposed secrets
  function runSecurityScan() {
    addMessage("Scanning for exposed credentials...");
    const findings = scanForSecrets();
    if (findings.length === 0) {
      addMessage("No exposed secrets detected. Page looks clean!");
      showToast("Security scan complete - no issues found");
    } else {
      addMessage(`Found ${findings.length} potential secret(s):\n${findings.map(f => `[${f.severity}] ${f.type}: ${f.value.substring(0, 30)}...`).join("\n")}`);
      showToast(`Found ${findings.length} potential secrets!`);
    }
  }

  function scanForSecrets() {
    const patterns = [
      { type: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/, severity: "CRITICAL" },
      { type: "OpenAI Key", regex: /sk-[a-zA-Z0-9]{48}/, severity: "CRITICAL" },
      { type: "JWT Token", regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, severity: "HIGH" },
      { type: "Google API Key", regex: /AIza[0-9A-Za-z-_]{35}/, severity: "HIGH" },
      { type: "GitHub Token", regex: /ghp_[a-zA-Z0-9]{36}/, severity: "CRITICAL" },
      { type: "Stripe Key", regex: /(sk_live|sk_test)_[a-zA-Z0-9]{24,}/, severity: "CRITICAL" }
    ];

    const findings = [];
    const pageSource = document.documentElement.innerHTML;
    
    patterns.forEach(({ type, regex, severity }) => {
      const matches = pageSource.match(new RegExp(regex.source, "g"));
      if (matches) {
        matches.forEach(match => {
          findings.push({ type, value: match, severity });
        });
      }
    });

    return findings;
  }

  // API Debugger - intercept and display API calls
  let apiRequests = [];
  let originalFetch = window.fetch;
  let originalXHR = window.XMLHttpRequest;

  function initAPIDebugger() {
    addMessage("API Debugger initialized. Monitoring network requests...");
    showToast("API capture active");
    
    // Intercept fetch
    window.fetch = function(...args) {
      const [url, options] = args;
      const requestId = Date.now() + Math.random().toString(36).substring(2, 6);
      
      apiRequests.push({
        id: requestId,
        url: url.toString(),
        method: options?.method || "GET",
        timestamp: new Date().toLocaleTimeString(),
        type: "fetch"
      });
      
      return originalFetch.apply(this, args).then(response => {
        const req = apiRequests.find(r => r.id === requestId);
        if (req) req.status = response.status;
        return response;
      });
    };

    // Intercept XMLHttpRequest
    const xhrOpen = originalXHR.prototype.open;
    originalXHR.prototype.open = function(...args) {
      const [method, url] = args;
      this._requestId = Date.now() + Math.random().toString(36).substring(2, 6);
      this._requestUrl = url;
      this._requestMethod = method;
      
      apiRequests.push({
        id: this._requestId,
        url: url.toString(),
        method: method,
        timestamp: new Date().toLocaleTimeString(),
        type: "xhr"
      });
      
      return xhrOpen.apply(this, args);
    };

    const xhrSend = originalXHR.prototype.send;
    originalXHR.prototype.send = function(...args) {
      this.addEventListener("load", () => {
        const req = apiRequests.find(r => r.id === this._requestId);
        if (req) req.status = this.status;
      });
      return xhrSend.apply(this, args);
    };
  }

  function getAPICalls() {
    return apiRequests.slice(-50);
  }

  // Prompt Library - lưu template prompts
  let promptTemplates = JSON.parse(localStorage.getItem("ti_prompt_templates") || "[]");
  
  function initPromptLibrary() {
    const templates = getPromptTemplates();
    if (templates.length === 0) {
      const defaultTemplates = [
        { name: "Summarize Page", text: "Tóm tắt trang web này bằng tiếng Việt" },
        { name: "Extract Keywords", text: "Trích xuất từ khóa quan trọng từ trang này" },
        { name: "Explain Code", text: "Giải thích code này bằng tiếng Việt" },
        { name: "Translate to EN", text: "Dịch sang tiếng Anh" }
      ];
      setPromptTemplates(defaultTemplates);
    }
  }
  
  function getPromptTemplates() {
    return JSON.parse(localStorage.getItem("ti_prompt_templates") || "[]");
  }
  
  function setPromptTemplates(templates) {
    localStorage.setItem("ti_prompt_templates", JSON.stringify(templates));
    promptTemplates = templates;
  }
  
  function addPromptTemplate(name, text) {
    const templates = getPromptTemplates();
    templates.push({ name, text });
    setPromptTemplates(templates);
    showToast(`Template "${name}" saved`);
  }
  
  // Context Builder - thu thập thông tin trang
  function buildPageContext() {
    return {
      url: window.location.href,
      title: document.title,
      meta: Array.from(document.querySelectorAll('meta[name][content]')).map(m => ({
        name: m.getAttribute('name'),
        content: m.getAttribute('content')
      })),
      bodyText: document.body.innerText.substring(0, 5000),
      selectedText: window.getSelection().toString()
    };
  }
  
  function getContextSummary() {
    const ctx = buildPageContext();
    return `URL: ${ctx.url}\nTitle: ${ctx.title}\nMeta: ${ctx.meta.length} tags\nBody: ${ctx.bodyText.length} chars`;
  }

  // Response Cache
  let responseCache = new Map();
  
  function cacheResponse(query, response) {
    const key = btoa(query.substring(0, 50)).substring(0, 16);
    responseCache.set(key, { query, response, timestamp: Date.now() });
    
    const cache = JSON.parse(localStorage.getItem("ti_response_cache") || "[]");
    cache.push({ key, query, response, timestamp: Date.now() });
    if (cache.length > 20) cache.shift();
    localStorage.setItem("ti_response_cache", JSON.stringify(cache));
  }
  
  function getCachedResponse(query) {
    const key = btoa(query.substring(0, 50)).substring(0, 16);
    return responseCache.get(key);
  }

  // CAPTCHA Solver - detect and solve using Gemini Vision API
  function detectAndSolveCaptcha() {
    addMessage("Scanning for CAPTCHA images...");
    const captchaImages = findCaptchaImages();
    
    if (captchaImages.length === 0) {
      addMessage("No CAPTCHA images detected on this page.");
      return;
    }
    
    addMessage(`Found ${captchaImages.length} potential CAPTCHA image(s)`);
    
    captchaImages.forEach((img, index) => {
      solveCaptchaWithGemini(img.src, index + 1);
    });
  }
  
  function findCaptchaImages() {
    const images = Array.from(document.querySelectorAll('img'));
    return images.filter(img => {
      const src = img.src || '';
      const alt = img.alt || '';
      const className = img.className || '';
      return /captcha|recaptcha|verify|challenge/i.test(src) || 
             /captcha|recaptcha|verify|challenge/i.test(alt) ||
             /captcha|recaptcha|verify/i.test(className) ||
             (img.width > 50 && img.width < 300 && img.height > 20 && img.height < 150);
    });
  }
  
  async function solveCaptchaWithGemini(imageSrc, captchaNum) {
    addMessage(`Solving CAPTCHA #${captchaNum}...`);
    
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer YOUR_API_KEY'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Extract the text from this CAPTCHA image. Return only the text." },
              { inline_data: { mime_type: "image/png", data: await imageUrlToBase64(imageSrc) } }
            ]
          }]
        })
      });
      
      const result = await response.json();
      const captchaText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "Could not extract";
      addMessage(`CAPTCHA #${captchaNum} result: ${captchaText}`);
      showToast(`CAPTCHA solved: ${captchaText}`);
    } catch (error) {
      addMessage(`CAPTCHA #${captchaNum} error: ${error.message || "Failed to solve"}`);
    }
  }
  
  async function imageUrlToBase64(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  // Autofill form detection and filling
  function detectAndMarkForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      const emailInputs = form.querySelectorAll('input[type="email"], input[name*="email"], input[id*="email"]');
      emailInputs.forEach(input => {
        input.style.border = "2px solid var(--ti-primary)";
        input.setAttribute("data-autofill-hint", "Click to auto-fill with temp email");
      });
    });
    addMessage(`Detected ${forms.length} forms on page. Click email fields to autofill.`);
  }

  function generateTempEmail() {
    const domains = ["tempmail.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org"];
    const random = Math.random().toString(36).substring(2, 10);
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `${random}@${domain}`;
  }

  function fillFormWithTemp(email) {
    const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email"], input[id*="email"]');
    if (emailInputs.length === 0) {
      addMessage("No email fields detected on this page.");
      return;
    }
    const targetEmail = email || generateTempEmail();
    emailInputs.forEach(input => {
      if (input.value === "" || input === document.activeElement) {
        input.value = targetEmail;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    addMessage(`Filled ${emailInputs.length} email field(s) with: ${targetEmail}`);
    showToast("Form autofilled!");
  }

  sendBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keypress", e => { if (e.key === "Enter") sendMessage(); });

  // Extract credentials
  extractBtn.addEventListener("click", extractCredentials);

  async function extractCredentials() {
    addMessage("Fetching ChatGPT session...", true);
    extractBtn.disabled = true;
    try {
      const result = await fetch('https://chatgpt.com/api/auth/session', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const data = await result.json();
      if (!data?.accessToken) throw new Error("No access token found - please log in to chatgpt.com");
      const auth = buildAuthJson(data);
      const jsonStr = JSON.stringify(auth, null, 2);
      addMessage(`Generated auth.json:\n${jsonStr}`);
      try {
        await navigator.clipboard.writeText(jsonStr);
        showToast("Credentials copied to clipboard!");
      } catch {
        showToast("Copy failed - check console");
      }
    } catch (err) {
      addMessage(`Error: ${err.message || err}`);
    } finally {
      extractBtn.disabled = false;
    }
  }

  function buildAuthJson(sessionData) {
    const payload = JSON.parse(atob(sessionData.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    const claim = payload['https://api.openai.com/auth'];
    return {
      auth: {
        OPENAI_API_KEY: null,
        tokens: {
          id_token: sessionData.accessToken,
          access_token: sessionData.accessToken,
          refresh_token: '',
          account_id: claim?.chatgpt_account_id || sessionData.account?.id || 'unknown'
        },
        last_refresh: new Date().toISOString()
      }
    };
  }

  // Listen for background messages
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.action === "saveToMemory" && msg.text) {
      window.postMessage({
        type: "TIIEXTENSION_SAVE",
        text: msg.text,
        url: msg.pageUrl,
        title: msg.pageTitle
      }, "*");
      showToast("Text saved!");
    }
    if (msg.action === "queryResponse" && msg.response) {
      addMessage(msg.response, false);
    }
  });

  // SPA Navigation Handler
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      window.postMessage({ type: "SPA_NAVIGATION" }, "*");
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Init Prompt Library
  initPromptLibrary();

  // GrokHub integration - talks to local FastAPI backend (:8000)
  const GROKHUB_BASE = "http://127.0.0.1:8000";
  let grokRegistered = false;

  async function initGrokTab() {
    if (grokRegistered) return;
    grokRegistered = true;
    try {
      const cfg = await fetch(`${GROKHUB_BASE}/config`).then(r => r.json());
      addMessage(`GrokHub connected. Email providers: ${(cfg.email_providers || []).join(", ")}`);
    } catch {
      addMessage("GrokHub backend not reachable at " + GROKHUB_BASE + ". Start it first.");
      return;
    }

    // Render Register + Token Pool controls
    const controls = document.createElement("div");
    controls.style.cssText = "padding:12px;display:flex;gap:8px;flex-wrap:wrap;";
    controls.innerHTML = `
      <input id="grok-email-provider" value="mailtm" style="flex:1;min-width:100px;padding:6px;border-radius:6px;border:1px solid var(--ti-surface);background:var(--ti-surface);color:var(--ti-text);" placeholder="email provider" />
      <input id="grok-count" type="number" value="1" min="1" max="8" style="width:60px;padding:6px;border-radius:6px;border:1px solid var(--ti-surface);background:var(--ti-surface);color:var(--ti-text);" />
      <button id="grok-register-btn" style="padding:6px 14px;border:none;border-radius:6px;background:var(--ti-primary);color:#fff;cursor:pointer;">Register</button>
      <button id="grok-pool-btn" style="padding:6px 14px;border:none;border-radius:6px;background:var(--ti-secondary);color:#fff;cursor:pointer;">Token Pool</button>
    `;
    chatMessages.parentElement.insertBefore(controls, chatMessages.nextSibling);

    controls.querySelector("#grok-register-btn").addEventListener("click", async () => {
      const provider = controls.querySelector("#grok-email-provider").value.trim() || "mailtm";
      const count = parseInt(controls.querySelector("#grok-count").value, 10) || 1;
      addMessage(`Starting ${count} registration(s) via ${provider}...`);
      const res = await fetch(`${GROKHUB_BASE}/register/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, email_provider: provider }),
      }).then(r => r.json());
      addMessage(`Task IDs: ${res.task_ids ? res.task_ids.join(", ") : "(none)"}`);
      pollTasks(res.task_ids || []);
    });

    controls.querySelector("#grok-pool-btn").addEventListener("click", async () => {
      const res = await fetch(`${GROKHUB_BASE}/tokens`).then(r => r.json());
      addMessage(`Token pool: ${res.pool.total} total, ${res.pool.valid} valid, ${res.pool.expiring} expiring`);
    });
  }

  async function pollTasks(taskIds) {
    for (const id of taskIds) {
      for (let i = 0; i < 30; i++) {
        const t = await fetch(`${GROKHUB_BASE}/tasks/${id}`).then(r => r.json());
        if (t && (t.status === "done" || t.status === "failed")) {
          addMessage(`Task ${id}: ${t.status}${t.result ? " (" + t.result + ")" : ""}`);
          break;
        }
        await new Promise(res => setTimeout(res, 4000));
      }
    }
  }

  // Welcome message
  setTimeout(() => {
    addMessage("Hi! I'm your AI assistant. Select text to save, or ask me anything about this page.");
  }, 1000);
})();
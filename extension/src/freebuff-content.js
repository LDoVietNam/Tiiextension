// freebuff-content.js
// Auto-extract Freebuff session token from freebuff.com and save to chrome.storage.local
// Pattern: minimal content script, one purpose only

(() => {
  if (globalThis.__FREEBUFF_TOKEN_EXTRACTED_V1__) return;
  globalThis.__FREEBUFF_TOKEN_EXTRACTED_V1__ = true;

  const STORAGE_KEY = 'freebuffToken';

  // Extract token from next-auth session cookie
  function extractFromCookie() {
    const cookies = document.cookie.split(';').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('__Secure-next-auth.session-token='));
    if (!sessionCookie) return null;
    const value = sessionCookie.split('=')[1];
    if (!value || value === 'undefined') return null;
    try {
      // Freebuff may store JSON in cookie value, try parse first
      const parsed = JSON.parse(decodeURIComponent(value));
      return parsed.token || parsed.session_token || decodeURIComponent(value);
    } catch {
      return decodeURIComponent(value);
    }
  }

  // Extract token from localStorage (in case it's stored there)
  function extractFromLocalStorage() {
    try {
      const token = localStorage.getItem('freebuff_token') || localStorage.getItem('freebuff.ai_token');
      return token;
    } catch {
      return null;
    }
  }

  async function saveToken(token) {
    if (!token) return false;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: token });
      console.debug('[Freebuff] Token saved to storage');
      return true;
    } catch {
      return false;
    }
  }

  async function extractAndSave() {
    const fromCookie = extractFromCookie();
    const fromStorage = extractFromLocalStorage();
    const token = fromCookie || fromStorage;
    if (!token) return;

    const saved = await saveToken(token);
    if (saved) {
      console.debug('[Freebuff] Token extracted successfully');
    }
  }

  // Run on script load
  extractAndSave();

  // Watch for cookie changes - re-extract if cookie appears/appears
  if (typeof MutationObserver !== 'undefined') {
    let lastCookie = document.cookie;
    const observer = new MutationObserver(() => {
      if (document.cookie !== lastCookie) {
        lastCookie = document.cookie;
        extractAndSave();
      }
    });
    observer.observe(document.documentElement, { subtree: true, characterData: true });
  }
})();
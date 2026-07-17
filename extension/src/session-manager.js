// session-manager.js
// Tab leasing and session management
// Pattern from ChatGPT Codex: claim/release/handoff tabs with ref-counting
// Enables Tiiextension to manage multiple AI tabs across sessions

const SESSION_STORAGE_KEY = "tiiextension_tab_leases";

// Active sessions: sessionId -> { tabIds, turnId, createdAt }
const sessions = new Map();

// Tab ownership: tabId -> { sessionId, turnId, origin, claimedAt }
const tabLeases = new Map();

// Event listeners for session changes
const sessionListeners = new Set();

export function getSessionManager() {
  return {
    // Session lifecycle
    createSession,
    endSession,
    getSession,
    getActiveSessions: () => new Map(sessions),

    // Tab leasing
    claimTab,
    releaseTab,
    releaseTabs,
    handoffTab,
    resumeHandoff,
    getTabLease,
    getSessionTabs,
    isTabClaimed,

    // Events
    onSessionChange,
    offSessionChange,

    // Persistence
    saveToStorage,
    loadFromStorage
  };
}

/**
 * Create a new browser session.
 * Pattern from Codex: session groups tabs together under one AI turn
 */
async function createSession(sessionId, { turnId = null, origin = "agent" } = {}) {
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (turnId) existing.turnId = turnId;
    return existing;
  }

  const session = {
    id: sessionId,
    turnId,
    origin,
    tabIds: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  sessions.set(sessionId, session);
  notifyListeners({ type: "session_created", sessionId, session });
  await saveToStorage();
  return session;
}

/**
 * End a session and release all its tabs.
 * Pattern from Codex: releaseTabs, detach debuggers
 */
async function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Release all tabs
  const tabIds = [...session.tabIds];
  for (const tabId of tabIds) {
    await releaseTab(sessionId, tabId);
  }

  sessions.delete(sessionId);
  notifyListeners({ type: "session_ended", sessionId });
  await saveToStorage();
}

/**
 * Get session info.
 */
function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * Claim a tab for a session.
 * Pattern from Codex: claimTab with sessionId, turnId, origin
 */
async function claimTab(sessionId, tabId, { turnId = null, origin = "agent" } = {}) {
  // Ensure session exists
  let session = sessions.get(sessionId);
  if (!session) {
    session = await createSession(sessionId, { turnId, origin });
  }

  // Check if tab is already claimed by another session
  const existingLease = tabLeases.get(tabId);
  if (existingLease && existingLease.sessionId !== sessionId) {
    throw sessionError("TAB_ALREADY_CLAIMED",
      `Tab ${tabId} is already claimed by session ${existingLease.sessionId}`);
  }

  // Update turn if provided
  if (turnId) {
    session.turnId = turnId;
  }

  // Create or update lease
  const lease = {
    sessionId,
    tabId,
    turnId: turnId || session.turnId,
    origin,
    claimedAt: Date.now(),
    lastActivity: Date.now(),
    mark: null // "handoff" | "deliverable" | null
  };

  tabLeases.set(tabId, lease);
  session.tabIds.add(tabId);
  session.lastActivity = Date.now();

  notifyListeners({ type: "tab_claimed", sessionId, tabId, lease });
  await saveToStorage();
  return lease;
}

/**
 * Release a tab from a session.
 * Pattern from Codex: releaseTab with cleanup
 */
async function releaseTab(sessionId, tabId) {
  const lease = tabLeases.get(tabId);
  if (!lease || lease.sessionId !== sessionId) return;

  tabLeases.delete(tabId);

  const session = sessions.get(sessionId);
  if (session) {
    session.tabIds.delete(tabId);
    session.lastActivity = Date.now();
    if (session.tabIds.size === 0) {
      sessions.delete(sessionId);
    }
  }

  notifyListeners({ type: "tab_released", sessionId, tabId });
  await saveToStorage();
}

/**
 * Release multiple tabs at once.
 */
async function releaseTabs(sessionId, tabIds) {
  for (const tabId of tabIds) {
    await releaseTab(sessionId, tabId);
  }
}

/**
 * Mark a tab for handoff (keep tab open for next turn).
 * Pattern from Codex: handoffTabs with mark
 */
async function handoffTab(sessionId, tabId, { turnId = null } = {}) {
  const lease = tabLeases.get(tabId);
  if (!lease || lease.sessionId !== sessionId) {
    throw sessionError("TAB_NOT_CLAIMED", `Tab ${tabId} is not claimed by session ${sessionId}`);
  }

  lease.mark = "handoff";
  if (turnId) lease.turnId = turnId;
  lease.lastActivity = Date.now();

  notifyListeners({ type: "tab_handoff", sessionId, tabId, lease });
  await saveToStorage();
  return lease;
}

/**
 * Resume a handoff tab (re-activate for current turn).
 * Pattern from Codex: resumeHandoffTabs
 */
async function resumeHandoff(sessionId, tabId, { turnId = null } = {}) {
  const lease = tabLeases.get(tabId);
  if (!lease || lease.sessionId !== sessionId) {
    throw sessionError("TAB_NOT_FOUND", `No handoff tab ${tabId} for session ${sessionId}`);
  }

  lease.mark = null;
  if (turnId) lease.turnId = turnId;
  lease.lastActivity = Date.now();

  const session = sessions.get(sessionId);
  if (session) {
    session.tabIds.add(tabId);
    session.lastActivity = Date.now();
  }

  notifyListeners({ type: "tab_resumed", sessionId, tabId, lease });
  await saveToStorage();
  return lease;
}

/**
 * Get lease info for a tab.
 */
function getTabLease(tabId) {
  return tabLeases.get(tabId) || null;
}

/**
 * Get all tabs for a session.
 */
function getSessionTabs(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return [...session.tabIds]
    .map(tabId => {
      const lease = tabLeases.get(tabId);
      return lease ? { tabId, ...lease } : null;
    })
    .filter(Boolean);
}

/**
 * Check if a tab is claimed by any session.
 */
function isTabClaimed(tabId) {
  return tabLeases.has(tabId);
}

/**
 * Register session change listener.
 */
function onSessionChange(callback) {
  sessionListeners.add(callback);
  return () => sessionListeners.delete(callback);
}

function offSessionChange(callback) {
  sessionListeners.delete(callback);
}

function notifyListeners(event) {
  for (const cb of sessionListeners) {
    try { cb(event); } catch { /* isolated */ }
  }
}

/**
 * Save session state to storage.
 */
async function saveToStorage() {
  const data = {
    sessions: Array.from(sessions.entries()).map(([id, s]) => ({
      id,
      turnId: s.turnId,
      origin: s.origin,
      tabIds: [...s.tabIds],
      createdAt: s.createdAt,
      lastActivity: s.lastActivity
    })),
    leases: Array.from(tabLeases.entries()).map(([tabId, l]) => ({
      tabId,
      sessionId: l.sessionId,
      turnId: l.turnId,
      origin: l.origin,
      claimedAt: l.claimedAt,
      lastActivity: l.lastActivity,
      mark: l.mark
    }))
  };

  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: data });
}

/**
 * Load session state from storage.
 */
async function loadFromStorage() {
  const stored = (await chrome.storage.session.get(SESSION_STORAGE_KEY))[SESSION_STORAGE_KEY];
  if (!stored) return;

  // Restore sessions
  for (const s of stored.sessions || []) {
    const session = {
      id: s.id,
      turnId: s.turnId,
      origin: s.origin,
      tabIds: new Set(s.tabIds || []),
      createdAt: s.createdAt,
      lastActivity: s.lastActivity
    };
    sessions.set(s.id, session);
  }

  // Restore leases
  for (const l of stored.leases || []) {
    tabLeases.set(l.tabId, {
      sessionId: l.sessionId,
      tabId: l.tabId,
      turnId: l.turnId,
      origin: l.origin,
      claimedAt: l.claimedAt,
      lastActivity: l.lastActivity,
      mark: l.mark
    });
  }
}

function sessionError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.retryable = false;
  return err;
}
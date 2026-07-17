// Prevent multi-tab conflicts for ChatGPT sessions
export class ChatgptConversationLock {
  constructor() {
    this.lockKey = 'ti-chatgpt-lock';
    this.ownerId = null;
    this.renewInterval = null;
  }

  /**
   * Attempt to acquire a lock for the current tab
   * @param {string} ownerId - Unique identifier for this tab (e.g., timestamp + random)
   * @param {number} ttlMs - Time to live for the lock (default 30 seconds)
   * @returns {Promise<boolean>} True if lock acquired
   */
  async acquireLock(ownerId, ttlMs = 30000) {
    this.ownerId = ownerId;
    
    // Try to set the lock in localStorage (will fail if already set by another tab)
    const lockData = {
      owner: ownerId,
      timestamp: Date.now(),
      ttl: ttlMs
    };
    
    try {
      // Use localStorage.setItem which will overwrite if exists, but we want to check first
      const existing = localStorage.getItem(this.lockKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        // Check if lock is expired
        if (Date.now() - parsed.timestamp > parsed.ttl) {
          // Expired, we can take it
          localStorage.setItem(this.lockKey, JSON.stringify(lockData));
          this.startRenewal(ttlMs);
          return true;
        }
        // Lock is still valid and owned by someone else
        return false;
      }
      
      // No lock exists, create one
      localStorage.setItem(this.lockKey, JSON.stringify(lockData));
      this.startRenewal(ttlMs);
      return true;
    } catch (e) {
      console.error('Failed to acquire lock:', e);
      return false;
    }
  }

  /**
   * Release the lock
   * @returns {boolean}
   */
  releaseLock() {
    try {
      const current = localStorage.getItem(this.lockKey);
      if (current) {
        const parsed = JSON.parse(current);
        if (parsed.owner === this.ownerId) {
          localStorage.removeItem(this.lockKey);
          this.stopRenewal();
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('Failed to release lock:', e);
      return false;
    }
  }

  /**
   * Renew the lock periodically
   * @param {number} ttlMs - TTL for renewal
   */
  startRenewal(ttlMs) {
    this.stopRenewal(); // Clear any existing interval
    this.renewInterval = setInterval(() => {
      try {
        const current = localStorage.getItem(this.lockKey);
        if (current) {
          const parsed = JSON.parse(current);
          if (parsed.owner === this.ownerId) {
            // Update timestamp
            const updated = {
              ...parsed,
              timestamp: Date.now()
            };
            localStorage.setItem(this.lockKey, JSON.stringify(updated));
          }
        }
      } catch (e) {
        console.error('Failed to renew lock:', e);
      }
    }, Math.floor(ttlMs / 3)); // Renew at 1/3 of TTL
  }

  /**
   * Stop renewal interval
   */
  stopRenewal() {
    if (this.renewInterval) {
      clearInterval(this.renewInterval);
      this.renewInterval = null;
    }
  }

  /**
   * Get current lock information
   * @returns {Object|null} Lock info or null if no lock
   */
  getLockInfo() {
    try {
      const data = localStorage.getItem(this.lockKey);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Wait until we can acquire the lock
   * @param {string} ownerId - Owner ID
   * @param {number} timeoutMs - How long to wait (default 10000)
   * @returns {Promise<boolean>} True if lock acquired
   */
  async waitForLock(ownerId, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.acquireLock(ownerId, 5000)) {
        return true;
      }
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  /**
   * Check if we currently hold the lock
   * @returns {boolean}
   */
  isLockOwner() {
    const info = this.getLockInfo();
    return info && info.owner === this.ownerId;
  }

  /**
   * Set up event listener for storage changes to detect when lock is released
   * @param {Function} onLockFree - Callback when lock becomes available
   */
  onLockReleased(onLockFree) {
    const handler = (e) => {
      if (e.key === this.lockKey) {
        // Either lock was removed or updated
        const newValue = e.newValue;
        if (!newValue) {
          // Lock released
          onLockFree();
        }
      }
    };
    
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}

// Export a singleton instance with a generated owner ID
const ownerId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
export const conversationLock = new ChatgptConversationLock();
Object.defineProperty(conversationLock, 'ownerId', { value: ownerId });
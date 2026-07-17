// task-state-store.js
// Manages state for concurrent tool calls and results in the web agent

export class TaskStateStore {
  constructor() {
    this.states = new Map();
    this.results = new Map();
  }

  // Store pending tool call state
  setPending(callId, toolCall) {
    this.states.set(callId, {
      status: 'pending',
      toolCall,
      startedAt: Date.now()
    });
  }

  // Mark tool call as in progress
  setInProgress(callId) {
    const state = this.states.get(callId);
    if (state) {
      state.status = 'in_progress';
      state.startedAt = Date.now();
    }
  }

  // Store result and mark complete
  setResult(callId, result) {
    this.states.set(callId, {
      status: 'completed',
      result,
      completedAt: Date.now()
    });
    this.results.set(callId, result);
  }

  // Store error and mark failed
  setError(callId, error) {
    this.states.set(callId, {
      status: 'failed',
      error,
      failedAt: Date.now()
    });
  }

  // Get state by call ID
  getState(callId) {
    return this.states.get(callId);
  }

  // Get result by call ID
  getResult(callId) {
    return this.results.get(callId);
  }

  // Get all pending calls
  getPending() {
    return Array.from(this.states.entries())
      .filter(([_, state]) => state.status === 'pending')
      .map(([id, state]) => ({ id, ...state }));
  }

  // Clear state after completion
  clear(callId) {
    this.states.delete(callId);
    this.results.delete(callId);
  }
}

export const taskStateStore = new TaskStateStore();
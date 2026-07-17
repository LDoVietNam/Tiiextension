# CURRENT STATE ANALYSIS: ChatGPT Web Adapter

## Files that will remain unchanged:
- `extension/src/browser-polyfill.js` - Browser abstraction layer
- `extension/src/provider-registry.js` - Provider registration mechanism (already has chatgpt-web registered)
- `extension/src/model-selector.js` - Model selection logic
- `extension/src/model-auto-select.js` - Auto-selection wrapper
- `extension/src/provider-presets.js` - Provider configuration
- `extension/src/model-fallbacks.js` - Model fallback definitions
- `extension/src/popup.js` - Popup UI (will need updates but core structure remains)
- `extension/src/chatgpt-selectors.json` - Selector mappings
- `extension/src/native-client.js` - Native host communication
- `extension/src/sidepanel.js` - Side panel UI
- `extension/src/ws-agent-bridge.js` - WebSocket agent bridge
- `extension/src/session-manager.js` - Session management
- `extension/src/event-bus.js` - Event bus
- `extension/src/block-parser.js` - Block parsing
- `extension/src/cdp-engine.js` - Chrome DevTools Protocol engine
- `extension/src/provider-coordinator.js` - Provider coordination
- `extension/src/credential-store.js` - Credential storage
- `extension/src/approval-policy.js` - Approval policies
- `extension/src/diagnostics.js` - Diagnostics
- `extension/src/artifact-store.js` - Artifact storage
- `extension/src/tab-session-broker.js` - Tab session broker
- `extension/src/batch-queue.js` - Batch queue
- `extension/src/orchestrator.js` - Orchestrator

## Files that need modification:
- `extension/src/chatgpt-content.js` - Main ChatGPT content script (major rewrite needed)
- `extension/src/popup.js` - Popup UI (need to add model control UI elements)

## Files that need to be created:
- `extension/src/platforms/chatgpt/chatgpt-detector.js`
- `extension/src/platforms/chatgpt/chatgpt-composer.js`
- `extension/src/platforms/chatgpt/chatgpt-response-observer.js`
- `extension/src/platforms/chatgpt/chatgpt-tool-call-parser.js`
- `extension/src/platforms/chatgpt/chatgpt-result-injector.js`
- `extension/src/platforms/chatgpt/chatgpt-conversation-lock.js`
- `extension/src/platforms/chatgpt/chatgpt-web-provider.js`
- `extension/src/web-agent/protocol.js`
- `extension/src/web-agent/execution-controller.js`
- `extension/src/web-agent/task-state-store.js`
- `extension/src/web-agent/redaction.js`
- `extension/src/runtime/providers/chatgpt-web-provider.mjs`
- `extension/src/runtime/agent/web-provider-loop.mjs`
- `extension/src/runtime/rpc/chatgpt-web-routes.mjs`
- `extension/tests/chatgpt-web-provider/` (unit tests)
- `extension/tests/runtime/chatgpt-web-provider.test.mjs`

## Current Contract Issues:
1. **chatgpt-web provider status**: Currently set to `() => "in-development"` - needs to become functional
2. **Missing capabilities**: While capabilities are declared, no implementation exists
3. **UI elements missing**: Popup lacks active model control controls
4. **No tool call implementation**: Content script doesn't parse or execute ti-web-agent/1 protocol
5. **No conversation locking**: No mechanism to prevent multi-tab conflicts
6. **Passive model detection**: Only reads cookies, doesn't actively set models in UI

## DOM Selector Risks:
- ChatGPT frequently changes DOM selectors
- Current implementation uses fallback selectors but needs more robust observation
- Model selector button: `[data-testid='model-switcher-dropdown-button']`
- Composer: `#prompt-textarea`
- Send button: `[data-testid='send-button']`
- Stop button: `[data-testid='stop-button']`
- Response elements: `[data-message-author-role='assistant']`

## Service Worker Restart Risk:
- Background service worker may terminate; need to ensure message listeners are properly re-established
- Content scripts need to handle re-injection after navigation
- Native host connection may need re-establishment

## Missing Contracts:
1. **ti-web-agent/1 protocol parser** - No implementation for parsing tool calls from ChatGPT responses
2. **Tool result injector** - No mechanism to inject tool results back into ChatGPT conversation
3. **Conversation lock** - No tab coordination mechanism
4. **Active model setter** - No way to change model via UI interaction
5. **Agent loop executor** - No backend implementation for processing agent tasks
6. **RPC endpoints** - No backend routes for chatgpt-web provider
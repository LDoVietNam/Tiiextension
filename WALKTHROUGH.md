# WALKTHROUGH
## ChatGPT Web Agent Provider Implementation

### ARCHITECTURE OVERVIEW

The ChatGPT Web Agent Provider transforms the existing passive ChatGPT adapter into a full agent provider that enables true agent-loop functionality with tool usage, iterative reasoning, and proper integration with the Ti Local Agent Suite.

#### Core Components

```
ChatGPT Web Page
        ↑ (DOM Interaction)
chatgpt-detector.js ←→ chatgpt-composer.js ←→ chatgpt-response-observer.js
        ↓                     ↑                       ↓
chatgpt-tool-call-parser.js ← chatgpt-web-provider.js → chatgpt-result-injector.js
        ↓                     ↑                       ↓
chatgpt-conversation-lock.js ←→ chatgpt-model-controller.js
        ↓
extension/web-agent/
├── protocol.js (ti-web-agent/1)
├── execution-controller.js
├── task-state-store.js
└── redaction.js
        ↓
Background Message Router (background.js)
        ↓
Existing Ti Local Agent Suite Infrastructure
(Event Bus, Session Manager, Native Host, Provider Registry)
```

### DATA FLOW DETAILS

#### 1. Initialization and Detection
1. `chatgpt-detector.js` monitors the page for ChatGPT-specific indicators
2. Uses multiple detection strategies (URL, DOM elements, page title) for robustness
3. Reports readiness state to `chatgpt-web-provider.js`
4. Provides UI element references through robust selector system

#### 2. User Interaction and Prompt Submission
1. `chatgpt-composer.js` handles all interactions with the input box and send button
2. Uses proper event dispatching (input, change, keypress) to mimic human interaction
3. Includes fallback mechanisms (Enter key if button not clickable)
4. Verifies successful submission through value clearing checks

#### 3. Response Observation and Capture
1. `chatgpt-response-observer.js` uses MutationObserver to detect new assistant messages
2. Distinguishes between streaming and complete responses
3. Implements deduplication to prevent processing the same message multiple times
4. Buffers response chunks until completion is detected

#### 4. Tool Call Processing (ti-web-agent/1 Protocol)
1. `chatgpt-response-observer.js` passes complete responses to `chatgpt-tool-call-parser.js`
2. Parser extracts JSON blocks using multiple strategies:
   - Fenced code blocks (```json)
   - Plain pre/code elements
   - Raw text scanning for JSON patterns
   - Handles streaming incomplete responses
3. Validates protocol compliance (ti-web-agent/1, type, id, etc.)
4. Prevents duplicate execution through ID tracking
5. Sends valid tool calls to `chatgpt-web-provider.js`

#### 5. Conversation Safety and Model Control
1. `chatgpt-conversation-lock.js` manages cross-tab coordination:
   - Uses localStorage events for cross-communication
   - Implements lock states: FREE, READ_LOCK, WRITE_LOCK
   - Automatic expiration and renewal mechanisms
   - Provides UI feedback through extension popup
2. `chatgpt-model-controller.js` handles active model management:
   - Programmatic interaction with ChatGPT's model selector dropdown
   - Verifies changes through UI observation
   - Falls back to enhanced cookie detection when needed
   - Caches model state to reduce UI interaction frequency

#### 6. Tool Execution and Result Injection
1. `chatgpt-web-provider.js` routes validated tool calls to:
   - `extension/web-agent/execution-controller.js`
2. Execution controller maps AI tool names to available capabilities:
   - Filesystem operations (read, write, search, etc.)
   - Terminal commands
   - Git operations
   - Browser automation
   - Other registered tools
3. Uses existing native host messaging system (`sendNative`) for execution
4. Formats results according to ti-web-agent/1 specification:
   - Success: `{ "protocol": "ti-web-agent/1", "type": "tool_result", "id": "...", "ok": true, "result": { ... } }`
   - Error: `{ "protocol": "ti-web-agent/1", "type": "tool_result", "id": "...", "ok": false, "error": { "type": "...", "message": "..." } }`
5. `chatgpt-result-injector.js` formats and inserts results back into ChatGPT conversation
6. Triggers continued AI processing through standard submission mechanism

#### 7. State Management and Recovery
1. `extension/web-agent/task-state-store.js` maintains:
   - Conversation history and context
   - Tool call execution status and results
   - Timeout and cancellation handling
   - Persistence through session-manager.js
2. Automatic recovery on extension/service worker restart
3. Graceful degradation when components fail

### INTEGRATION POINTS

#### With Existing Ti Local Agent Suite
1. **Provider Registry**: Registers as `"chatgpt-web"` with appropriate capabilities
2. **Event Bus**: Uses existing messaging system for internal communication
3. **Session Manager**: Leverages for state persistence across browser sessions
4. **Native Client**: Uses established `sendNative` mechanism for tool execution
5. **Gateway System**: Can fall back to existing provider mechanisms if needed
6. **Model Selector**: Integrates with intelligent model choice system

#### UI Integration
1. **Popup**: Displays provider status, connection state, model info, lock status
2. **Badge**: Shows visual indicator when ChatGPT Web Provider is active
3. **Tooltip**: Provides detailed status on hover
4. **Context Menu**: Offers quick actions for common operations

### EXTENSION POINT DESIGN

All components follow these principles for maintainability and extensibility:

1. **Loose Coupling**: Components communicate through well-defined interfaces
2. **Single Responsibility**: Each module has one clear purpose
3. **Dependency Injection**: Where appropriate, dependencies are injected rather than hardcoded
4. **Error Boundaries**: Failures in one component don't cascade to others
5. **Configuration Driven**: Behavior can be adjusted through settings without code changes
6. **Testability**: Each unit can be tested in isolation with mocks

### EXECUTION FLOW EXAMPLE

1. User asks: "What files are in the src directory?"
2. AI processes and decides to use filesystem tool
3. AI responds with JSON tool call:
   ```json
   {
     "protocol": "ti-web-agent/1",
     "type": "tool_call",
     "id": "call-123",
     "tool": "fs.list",
     "arguments": { "path": "src" }
   }
   ```
4. Extension detects, validates, and extracts the tool call
5. Extension routes to native host for execution
6. Native host executes `fs.list` on path "src"
7. Result returned: `{ "files": ["chatgpt-content.js", "popup.js", ...] }`
8. Extension formats as tool result:
   ```json
   {
     "protocol": "ti-web-agent/1",
     "type": "tool_result",
     "id": "call-123",
     "ok": true,
     "result": {
       "path": "src",
       "content": ["chatgpt-content.js", "popup.js", "model-selector.js", ...]
     }
   }
   ```
9. Result inserted into ChatGPT conversation
10. AI processes result and provides final answer
11. Extension detects final response and presents to user

### SECURITY AND PRIVACY CONSIDERATIONS

1. **Data Minimization**: Only essential data is collected and transmitted
2. **Input Sanitization**: All inputs are validated and sanitized
3. **Output Encoding**: Outputs are properly encoded to prevent injection
4. **No Secret Logging**: Sensitive data never appears in logs or diagnostics
5. **Least Privilege**: Extension requests only necessary permissions
6. **Origin Validation**: All cross-tab/window communications validate origins
7. **Content Security Policy**: Strict CSP policies prevent XSS attacks

### PERFORMANCE CONSIDERATIONS

1. **Efficient Observation**: MutationObservers limited to necessary subtrees
2. **Debouncing**: Rapid-fire events are debounced to reduce processing load
3. **Minimal DOM Access**: DOM reads are batched and cached when possible
4. **Efficient Algorithms**: O(n) or better complexity for all operations
5. **Memory Management**: Proper cleanup of event listeners and observers
6. **Lazy Initialization**: Components initialized only when needed

### ERROR HANDLING AND RESILIENCE

1. **Graceful Degradation**: Falls back to basic adapter mode if advanced features fail
2. **Retry Logic**: Transient failures are retried with exponential backoff
3. **Circuit Breaker**: Prevents cascading failures during service outages
4. **Clear Error Reporting**: Users informed of issues through UI with actionable guidance
5. **State Recovery**: Automatic recovery from common failure scenarios
6. **Fallback Mechanisms**: Multiple approaches for critical operations (model detection, etc.)

This architecture provides a robust foundation for the ChatGPT Web Agent Provider while maintaining compatibility with the existing Ti Local Agent Suite infrastructure and providing clear paths for future enhancements.
# Execution Integration Plan – Standard Format

## 1. Summary
Enable ChatGPT Web Provider to execute file system operations via Context Bridge and return results to the conversation using the `ti-web-agent/1` protocol.

## 2. Prerequisites
- Extension loaded unpacked with extension ID `ojjbdgfmnedbnpadfnmgkolfmhipkefi`
- Native host installed and communicating with port 18401 (API server)
- Context Bridge running on port 3333
- ChatGPT Web page loaded in browser

## 3. Completed Work
| File | Purpose | Status |
|------|---------|--------|
| `extension/src/web-agent/execution-controller.js` | Routes tool calls to Context Bridge, manages queue | ✅ Done |
| `extension/src/runtime/rpc/chatgpt-web-routes.mjs` | Maps tool names to handler functions | ✅ Done |
| `extension/src/runtime/agent/web-provider-loop.mjs` | Executes planner-defined steps | ✅ Done |
| `extension/src/web-agent/result-injector.js` | DOM injection utilities | ✅ Done |
| `extension/src/platforms/chatgpt/chatgpt-result-injector.js` | Result injection logic | ✅ Done |
| `extension/src/web-agent/protocol.js` | Protocol definitions | ✅ Done |
| `extension/src/web-agent/task-state-store.js` | State management for concurrent calls | ✅ Done |
| `extension/src/context-bridge/api.js` | Context Bridge client API | ✅ Done |
| `docs/EXECUTION_FLOWCHART.md` | Flowchart visualization | ✅ Done |

## 4. Integration Tasks
### T4.1 Module Registration
Update `_loadModule` in `ChatgptWebProvider` to resolve new module names:
- `'chatgpt-result-injector'`
- `'web-agent/execution-controller'`
- `'runtime/rpc/chatgpt-web-routes'`

**Status:** In progress - Provider already imports modules correctly

### T4.2 Provider Wiring
In `ChatgptWebProvider.initialize()`:
- Import and instantiate `executionController`
- Wire `onToolCall` → `executionController.handleToolCall()`
- Wire `onFinalResponse` → `resultInjector.injectFinalResponse()`

**Status:** Already implemented in `chatgpt-web-provider.js`

### T4.3 Context Bridge Enhancement
Extend `extension/src/context-bridge/server.js`:
- Add `/v1/execute` endpoint
- Support `method` + `args` payload
- Return `{ ok, result }` structure

**Status:** ✅ Done - Added `/v1/execute` endpoint

### T4.4 Testing & Verification
- Load ChatGPT, trigger tool call response
- Verify file read returns content
- Confirm result injected into DOM

**Status:** Pending - Requires manual testing

## 5. Technical Notes
- Protocol: `ti-web-agent/1` with `{ protocol, type, tool, arguments, id }`
- Context Bridge guard: workspace `tiiextension` allows `read`, `search`, `patch`, `test`
- Result injection uses hidden DOM marker + visible formatted block

## 6. Success Criteria
1. Tool call JSON appears in ChatGPT response → executed locally
2. File content returned via Context Bridge → injected into conversation
3. UI shows formatted result block below assistant message
4. Concurrent calls queued and processed sequentially

## 7. Dependencies
- `fs.read` tool must be callable via Context Bridge API
- Content script must have DOM access to ChatGPT elements
- Native host must be running for Context Bridge communication

## 8. Rollback Plan
If integration breaks:
1. Revert changes to `chatgpt-web-provider.js`
2. Restore `context-bridge/server.js` to original state
3. Disable provider via `providers.json` setting

## 9. Estimated Effort
- T4.1: 15 minutes
- T4.2: 20 minutes
- T4.3: 10 minutes
- T4.4: 15 minutes

**Total: ~60 minutes**

## 10. Next Steps
1. Verify all module imports resolve correctly
2. Test tool call execution end-to-end
3. Document findings in `docs/EXECUTION_FLOWCHART.md`
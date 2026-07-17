# Flowchart: ChatGPT Web Provider Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Action                                    │
│   User sends message via ChatGPT UI                                         │
│   Or: AI generates response with tool_call in thinking block                  │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ChatGptResponseObserver                              │
│   - Listens for new assistant messages                                       │
│   - Detects tool_call JSON blocks in response                                │
│   - Calls handleResponse() when message is complete                          │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ChatGptToolCallParser                                 │
│   Input: Raw response text from ChatGPT                                       │
│   Output: Array of tool_call objects                                          │
│                                                                              │
│   parseToolCalls(text) → [{ protocol, type, tool, arguments, id }]         │
│                                                                              │
│   Example parsed tool_call:                                                 │
│   { protocol: 'ti-web-agent/1', type: 'tool_call', tool: 'fs.read',         │
│     arguments: { path: 'README.md' }, id: 'call_123' }                       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ExecutionController.handleToolCall()                 │
│                                                                              │
│   1. Check queue: if busy, enqueue call                                     │
│   2. If idle:                                                               │
│      a. Dispatch to Context Bridge via POST /v1/tools/fs.read              │
│      b. Wait for response from Context Bridge                               │
│      c. Return result to caller                                             │
│                                                                              │
│   Context Bridge Request:                                                   │
│   POST http://127.0.0.1:3333/v1/tools/fs.read                               │
│   {                                                                              │
│     "args": { "workspaceId": "tiiextension", "path": "README.md" }           │
│   }                                                                           │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Context Bridge (server.js)                          │
│                                                                              │
│   1. Validate workspaceId (tiiextension)                                    │
│   2. Validate path is within workspace root                                 │
│   3. Read file from filesystem                                                │
│   4. Compute SHA256 revision hash                                           │
│   5. Return: { ok: true, result: { content, path, revision } }              │
│                                                                              │
│   Output:                                                                   │
│   { ok: true, result: { path: 'README.md', content: '...', revision: 'abc' } }│
└─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ChatGptWebProvider.handleResponse()                  │
│                                                                              │
│   1. Receive result from ExecutionController                                │
│   2. Format result as user message (JSON code block)                        │
│   3. Submit prompt via ChatGptComposer.submitPrompt()                       │
│                                                                              │
│   Formatted output: "Here is the result:\n```json\n{...}\n```"              │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ChatGPT UI Update                                 │
│                                                                              │
│   - User message: "What's in README.md?"                                    │
│   - AI response: "Let me check that file..." + tool_call JSON               │
│   - Extension executes tool_call and injects result                         │
│   - AI sees result and continues conversation                               │
│   - Final response appears in conversation                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
Tool Call ──► ExecutionController ──► Context Bridge
     │                                          │
     │                                          ▼
     │                                   { ok: false, error: {...} }
     │                                          │
     ▼                                          │
handleResponse() ◄─────────────────────────────┘
     │
     ▼
Format error message: "Tool execution failed: <error>"
     │
     ▼
Submit error to ChatGPT as user message
```

## Queue Management

```
Idle State:
  Tool Call 1 → Execute immediately → Return result

Busy State (executing Tool Call 1):
  Tool Call 2 → Queue
  Tool Call 3 → Queue
  Tool Call 4 → Queue

After Tool Call 1 completes:
  Process Tool Call 2 from queue
  Process Tool Call 3 from queue
  Process Tool Call 4 from queue
```

## Data Flow Summary

1. **Input**: ChatGPT response containing `ti-web-agent/1` tool_call JSON
2. **Parse**: Extract tool name, arguments, call ID from JSON
3. **Execute**: HTTP POST to Context Bridge at `localhost:3333`
4. **Read**: Context Bridge reads file from workspace directory
5. **Return**: JSON response with file content
6. **Format**: Convert result to formatted string
7. **Inject**: Submit formatted result as new prompt to ChatGPT
8. **Output**: AI continues with processed result
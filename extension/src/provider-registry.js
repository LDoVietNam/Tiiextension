registerProvider({
  id: "chatgpt-web",
  name: "ChatGPT Web",
  role: "model",
  status: () => "ready", // Implemented with active model control and tool call support
  capabilities: [
    "provider.chatgpt-web.agent-loop",
    "provider.chatgpt-web.tool-calls",
    "provider.chatgpt-web.result-injection",
    "provider.chatgpt-web.model-detection",
    "provider.chatgpt-web.conversation-lock"
  ]
});
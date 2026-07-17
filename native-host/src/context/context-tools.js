import { dispatchToolCall, getToolCategory } from "../orchestration/request-dispatcher.js";

export function createContextTools({ guard, config, events }) {
  const toolCategories = {
    context: [
      "workspace.info",
      "workspace.status",
      "repo.tree",
      "repo.search",
      "repo.symbols",
      "repo.dependencies",
      "revision.compute",
      "revision.check"
    ],
    filesystem: [
      "fs.list",
      "fs.read",
      "fs.search_text",
      "fs.stat"
    ],
    git: [
      "git_status",
      "git_diff"
    ]
  };

  async function handle(type, payload) {
    const category = getToolCategory(type);
    const toolMap = {
      "workspace.info": "workspace.info",
      "workspace.status": "workspace.status",
      "repo.tree": "repo.tree",
      "repo.search": "repo.search",
      "repo.symbols": "repo.symbols",
      "repo.dependencies": "repo.dependencies",
      "revision.compute": "revision.compute",
      "revision.check": "revision.check",
      "fs.list": "fs.list",
      "fs.read": "fs.read",
      "fs.search_text": "fs.search_text",
      "fs.stat": "fs.stat"
    };
    const nativeTool = toolMap[type] || type;
    if (type.startsWith("workspace.") || type.startsWith("repo.") || type.startsWith("revision.")) {
      return await dispatchToolCall(nativeTool, payload, {
        workspaceId: payload.workspaceId,
        revision: payload.revision,
        timeoutMs: payload.timeoutMs
      });
    }
    if (type.startsWith("fs.") || type.startsWith("git.")) {
      return await dispatchToolCall(nativeTool, payload, {
        workspaceId: payload.workspaceId,
        revision: payload.revision,
        timeoutMs: payload.timeoutMs
      });
    }
    throw new Error("Context tool not supported: " + type);
  }

  function getToolManifest() {
    const manifest = [
      { name: "workspace.info", description: "Get workspace information", inputSchema: { type: "object", properties: { workspaceId: { type: "string" } } }, category: "context" },
      { name: "workspace.status", description: "Alias for workspace.info", inputSchema: { type: "object", properties: { workspaceId: { type: "string" } } }, category: "context" },
      { name: "repo.tree", description: "List directory tree", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, path: { type: "string" } } }, category: "context" },
      { name: "repo.search", description: "Search text in workspace", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, query: { type: "string" } } }, category: "context" },
      { name: "repo.symbols", description: "Extract symbols", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, path: { type: "string" } } }, category: "context" },
      { name: "repo.dependencies", description: "Build dependency graph", inputSchema: { type: "object", properties: { workspaceId: { type: "string" } } }, category: "context" },
      { name: "revision.compute", description: "Compute revision", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, path: { type: "string" } } }, category: "context" },
      { name: "revision.check", description: "Check revision matches", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, expectedRevision: { type: "string" } } }, category: "context" },
      { name: "fs.list", description: "List directory", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, path: { type: "string" } } }, category: "filesystem" },
      { name: "fs.read", description: "Read file", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, path: { type: "string" } } }, category: "filesystem" },
      { name: "fs.search_text", description: "Search text", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, query: { type: "string" } } }, category: "filesystem" },
      { name: "fs.stat", description: "Get file info", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, path: { type: "string" } } }, category: "filesystem" },
      { name: "git.status", description: "Git status", inputSchema: { type: "object", properties: { workspaceId: { type: "string" } } }, category: "git" },
      { name: "git.diff", description: "Git diff", inputSchema: { type: "object", properties: { workspaceId: { type: "string" } } }, category: "git" }
    ];
    return manifest;
  }

  return {
    handle,
    getToolManifest,
    getToolCategory
  };
}
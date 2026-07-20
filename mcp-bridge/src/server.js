#!/usr/bin/env node
import { callCnagentTool } from "./cnagent-client.js";
import { listMcpTools, mapMcpToolCall, GITHUB_TOOL_NAMES } from "./tool-mapper.js";

const baseUrl = process.env.TIIEXTENSION_API_URL || "http://127.0.0.1:18401";
const token = process.env.TIIEXTENSION_API_TOKEN || "";
const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handleLine(line).catch((error) => writeError(null, error));
  }
});

async function handleLine(line) {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (method === "initialize") {
    return writeResult(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "tiiextension-mcp-bridge", version: "1.3.0" },
      capabilities: { tools: {} }
    });
  }
  if (method === "tools/list") return writeResult(id, { tools: listMcpTools() });
  if (method === "tools/call") {
    const mapped = mapMcpToolCall(params.name, params.arguments || {});
    let result;
    if (mapped.source === "github-mcp") {
      result = await callGithubMcp(params.name, params.arguments || {});
    } else {
      result = await callCnagentTool({ baseUrl, token, tool: mapped.tool, args: mapped.args });
    }
    return writeResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  }
  return writeError(id, { code: "MCP_METHOD_NOT_FOUND", message: `Unsupported method: ${method}` });
}

async function callGithubMcp(tool, args) {
  // GitHub MCP fallback - call via npx @modelcontextprotocol/server-github
  const { execSync } = require("child_process");
  const result = execSync(`npx -y @modelcontextprotocol/server-github --stdio`, {
    input: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: tool, arguments: args } }) + "\n",
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: githubToken }
  });
  return JSON.parse(result);
}

function writeResult(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function writeError(id, error) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: error.code || -32000, message: error.message || String(error) }
  })}\n`);
}

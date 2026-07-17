import crypto from "node:crypto";
import http from "node:http";

import { createExtensionRpcBridge } from "./extension-rpc-bridge.js";
import { createProviderConnectors } from "./provider-connectors.js";
import { createUpstreamRouter } from "./upstream-router.js";
import { attachWebSocket, webSocketAccept } from "./websocket.js";

export function createLocalApi({
  runtime,
  host = "127.0.0.1",
  port = 1840,
  token,
  allowedOrigins = [],
  maxBodyBytes = 1024 * 1024,
  extensionBridge = null,
  providerConnectors = null,
  upstreamRouter = null,
  fetchImpl = globalThis.fetch,
  env = process.env,
  providerConfig = {},
  providerTimeoutMs,
} = {}) {
  if (!runtime || !token) throw new TypeError("runtime and token are required");
  if (!isLoopbackHost(host) && runtime.config?.mode === "release") {
    throw apiError("API_BIND_DENIED", "Release API may bind only to loopback");
  }

  const bridge = extensionBridge || createExtensionRpcBridge();
  const connectors = providerConnectors || createProviderConnectors({
    fetchImpl,
    extensionBridge: bridge,
    env,
    config: providerConfig,
    timeoutMs: providerTimeoutMs,
  });
  const router = upstreamRouter || createUpstreamRouter({ connectors });
  const sockets = new Set();
  let extensionConnection = null;

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, `http://${host}`).pathname;
    const rawErrorShape = isRawRoute(pathname);
    handleRequest(request, response).catch((error) => (
      rawErrorShape ? sendOpenAiError(response, error) : sendError(response, error)
    ));
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("upgrade", (request, socket) => {
    const pathname = new URL(request.url, `http://${host}`).pathname;
    handleUpgrade(request, socket).catch((error) => {
      socket.end(`HTTP/1.1 ${statusFor(error)} ${http.STATUS_CODES[statusFor(error)]}\r\nConnection: close\r\n\r\n`);
      if (isRawRoute(pathname)) bridge.detach("Extension upgrade failed");
    });
  });

  async function handleUpgrade(request, socket) {
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname === "/v1/extension") return handleExtensionUpgrade(request, socket);
    if (url.pathname !== "/v1/events") throw apiError("API_ROUTE_NOT_FOUND", "WebSocket route not found");

    assertOrigin(request);
    const queryToken = url.searchParams.get("token");
    if (!constantTimeEqual(queryToken || "", token)) {
      throw apiError("API_UNAUTHORIZED", "Invalid WebSocket token");
    }
    assertWebSocketUpgrade(request);
    const key = request.headers["sec-websocket-key"];
    socket.write(handshakeHeaders(key));

    let unsubscribe = () => {};
    const connection = attachWebSocket(socket, {
      onClose: () => unsubscribe(),
    });
    const taskId = url.searchParams.get("task_id") || undefined;
    const afterCursor = Number(url.searchParams.get("after_cursor") || 0);
    const replay = await runtime.events.list({ afterCursor, taskId, limit: 5000 });
    for (const event of replay.events) connection.send(event);
    unsubscribe = runtime.events.subscribe((event) => connection.send(event), { taskId });
  }

  async function handleExtensionUpgrade(request, socket) {
    assertExactOrigin(request);
    assertWebSocketUpgrade(request);
    if (extensionConnection) throw apiError("EXTENSION_ALREADY_CONNECTED", "An extension bridge is already connected");

    const key = request.headers["sec-websocket-key"];
    socket.write(handshakeHeaders(key));

    let connection = null;
    connection = attachWebSocket(socket, {
      onMessage: (raw) => {
        try {
          bridge.handleMessage(raw);
        } catch {
          connection?.close(1002);
        }
      },
      onClose: () => {
        if (extensionConnection === connection) extensionConnection = null;
        bridge.detach("Extension disconnected");
      },
    });
    extensionConnection = connection;
    bridge.attach(connection);
  }

  async function handleRequest(request, response) {
    assertOrigin(request);
    const url = new URL(request.url, `http://${host}`);
    const method = request.method || "GET";

    if (method === "GET" && url.pathname === "/v1/health") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({
        type: "runtime.handshake",
        payload: { protocols: ["cnagent/1"] },
      }));
    }

    if (method === "GET" && url.pathname === "/v1/workspace/registry") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, { ok: true, result: await runtime.handle({ type: "profiles.active", payload: {} }) });
    }

    if (method === "GET" && url.pathname === "/v1/capabilities") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({ type: "tool.capabilities", payload: {} }));
    }
    if (method === "GET" && url.pathname === "/v1/tools") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({
        type: "tool.manifest",
        payload: Object.fromEntries(url.searchParams),
      }));
    }
if (method === "GET" && url.pathname === "/v1/workspaces") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({ type: "profiles.active", payload: {} }));
    }

    if (method === "GET" && url.pathname === "/v1/workspace/registry") {
      assertAuthorization(request.headers.authorization);
      const { readFileSync } = require('node:fs');
      const { resolve } = require('node:path');
      
      try {
        const configPath = process.env.CHATGPT_NATIVE_AGENT_CONFIG || 
          resolve('Z:\\01_PROJECTS\\apps\\_workspace\\workspace-registry.json');
        const content = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        return sendJson(response, 200, { ok: true, result: parsed });
      } catch (error) {
        return sendJson(response, 500, { ok: false, error: { message: error.message } });
      }
    }

    if (method === "GET" && url.pathname === "/v1/tasks") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({
        type: "task.list",
        payload: Object.fromEntries(url.searchParams),
      }));
    }
    if (method === "POST" && url.pathname === "/v1/tasks") {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 201, await runtime.handle({
        type: "task.enqueue",
        payload: await readJson(request),
      }));
    }
    if (method === "POST" && url.pathname === "/v1/agent/goal") {
      assertAuthorization(request.headers.authorization);
      const body = await readJson(request);
      if (typeof body.goal !== "string" || !body.goal.trim()) {
        throw apiError("PROTOCOL_VALIDATION_ERROR", "goal is required");
      }
      return sendJson(response, 202, await runtime.handle({
        type: "task.enqueue",
        payload: {
          goal: body.goal,
          profile: body.profile,
          provider: body.provider,
          maxIterations: body.max_iterations ?? body.maxIterations,
          workspace_id: body.workspace_id,
          mode: body.mode || "plan_then_execute",
          source: "api.goal",
          input: body.input || {},
          constraints: body.constraints || {},
        },
      }));
    }

    const taskMatch = /^\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && taskMatch) {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({
        type: "task.get",
        payload: { task_id: decodeURIComponent(taskMatch[1]) },
      }));
    }
    const cancelMatch = /^\/v1\/tasks\/([^/]+)\/cancel$/.exec(url.pathname);
    if (method === "POST" && cancelMatch) {
      assertAuthorization(request.headers.authorization);
      return sendJson(response, 200, await runtime.handle({
        type: "task.cancel",
        payload: { task_id: decodeURIComponent(cancelMatch[1]) },
      }));
    }
    if (method === "POST" && url.pathname === "/v1/tools/call") {
      assertAuthorization(request.headers.authorization);
      const body = await readJson(request);
      if (!body.tool) throw apiError("PROTOCOL_VALIDATION_ERROR", "tool is required");
      return sendJson(response, 200, await runtime.handle({
        type: body.tool,
        payload: body.args || {},
        task_id: body.task_id,
        call_id: body.call_id,
        idempotency_key: body.idempotency_key,
      }));
    }

    if (method === "GET" && url.pathname === "/v1/models") {
      assertAuthorization(request.headers.authorization);
      return sendRawJson(response, 200, await router.listModels());
    }
    if (method === "GET" && url.pathname === "/v1/providers") {
      assertAuthorization(request.headers.authorization);
      return sendRawJson(response, 200, await router.listProviders());
    }
    if (method === "GET" && url.pathname === "/v1/providers/status") {
      assertAuthorization(request.headers.authorization);
      return sendRawJson(response, 200, await router.getProviderStatuses());
    }

    if (method === "POST" && isRawRoute(url.pathname)) {
      assertAuthorization(request.headers.authorization);
      return sendRawJson(response, 200, await router.dispatchRoute(url.pathname, await readJson(request)));
    }

    const artifactMatch = /^\/v1\/artifacts\/(artifact_[A-Za-z0-9]+)$/.exec(url.pathname);
    if (method === "GET" && artifactMatch) {
      assertAuthorization(request.headers.authorization);
      const artifact = await runtime.artifacts.read(artifactMatch[1]);
      response.writeHead(200, {
        "Content-Type": artifact.metadata.mime_type || "application/octet-stream",
        "Content-Length": artifact.data.length,
        "X-Content-SHA256": artifact.metadata.sha256,
        "Cache-Control": "no-store",
      });
      response.end(artifact.data);
      return;
    }

    throw apiError("API_ROUTE_NOT_FOUND", `Route not found: ${method} ${url.pathname}`);
  }

  function assertAuthorization(header) {
    const match = /^Bearer\s+(.+)$/i.exec(header || "");
    if (!match || !constantTimeEqual(match[1], token)) {
      throw apiError("API_UNAUTHORIZED", "Bearer token is required");
    }
  }

  function assertOrigin(request) {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      throw apiError("API_ORIGIN_DENIED", `Origin is not allowed: ${origin}`);
    }
  }

  function assertExactOrigin(request) {
    const origin = String(request.headers.origin || "");
    if (!origin || !allowedOrigins.includes(origin)) {
      throw apiError("API_ORIGIN_DENIED", `Origin is not allowed: ${origin || "[missing]"}`);
    }
  }

  function readJson(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      let oversized = false;
      request.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) oversized = true;
        else chunks.push(chunk);
      });
      request.on("end", () => {
        if (oversized) {
          reject(apiError("API_BODY_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes`));
          return;
        }
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(text ? JSON.parse(text) : {});
        } catch (error) {
          reject(apiError("PROTOCOL_INVALID_JSON", `Invalid JSON body: ${error.message}`));
        }
      });
      request.on("error", reject);
    });
  }

  async function listen() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    return { host: address.address, port: address.port, url: `http://${address.address}:${address.port}` };
  }

  async function close() {
    bridge.detach("Server shutting down");
    for (const socket of sockets) socket.destroy();
    if (!server.listening) return;
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    server,
    listen,
    close,
    bridge,
    connectors,
    router,
  };
}

function assertWebSocketUpgrade(request) {
  if (String(request.headers.upgrade).toLowerCase() !== "websocket" || !/upgrade/i.test(String(request.headers.connection))) {
    throw apiError("WEBSOCKET_BAD_UPGRADE", "Invalid WebSocket upgrade headers");
  }
  const key = request.headers["sec-websocket-key"];
  if (!key) throw apiError("WEBSOCKET_BAD_UPGRADE", "Sec-WebSocket-Key is required");
}

function handshakeHeaders(key) {
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${webSocketAccept(key)}`,
    "",
    "",
  ].join("\r\n");
}

function isRawRoute(pathname) {
  return [
    "/v1/models",
    "/v1/providers",
    "/v1/providers/status",
    "/v1/chat",
    "/v1/chat/completions",
    "/v1/images/generations",
    "/v1/embeddings",
    "/v1/audio/speech",
    "/v1/audio/transcriptions",
  ].includes(pathname);
}

function sendJson(response, status, result) {
  const body = Buffer.from(JSON.stringify({ ok: true, result }));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendRawJson(response, status, result) {
  const body = Buffer.from(JSON.stringify(result));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendError(response, caught) {
  const error = caught?.code ? caught : apiError("API_INTERNAL_ERROR", caught?.message || String(caught));
  const body = Buffer.from(JSON.stringify({
    ok: false,
    error: { code: error.code, message: error.message, retryable: Boolean(error.retryable) },
  }));
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(statusFor(error), {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendOpenAiError(response, caught) {
  const error = caught?.code ? caught : apiError("API_INTERNAL_ERROR", caught?.message || String(caught));
  const body = Buffer.from(JSON.stringify({
    error: {
      message: error.message,
      type: statusFor(error) >= 500 ? "server_error" : "invalid_request_error",
      code: error.code,
    },
  }));
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(statusFor(error), {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function statusFor(error) {
  if (error.code === "API_UNAUTHORIZED") return 401;
  if (["API_ORIGIN_DENIED", "POLICY_DENIED", "WORKSPACE_OUTSIDE_ROOT"].includes(error.code)) return 403;
  if (error.code === "API_ROUTE_NOT_FOUND" || /_NOT_FOUND$/.test(error.code)) return 404;
  if (error.code === "EXTENSION_ALREADY_CONNECTED") return 409;
  if (error.code === "API_BODY_TOO_LARGE") return 413;
  if (["PROVIDER_UNAVAILABLE", "EXTENSION_PROVIDER_UNAVAILABLE"].includes(error.code)) return 503;
  if (/^(?:PROTOCOL_|FILESYSTEM_PATCH_CONFLICT|TASK_INVALID|API_BIND|WEBSOCKET_)/.test(error.code)) return 400;
  return Number(error.status) || 500;
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isLoopbackHost(value) {
  return ["127.0.0.1", "::1", "localhost"].includes(value);
}

function apiError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = code === "PROVIDER_UNAVAILABLE" || code === "EXTENSION_PROVIDER_UNAVAILABLE";
  return error;
}

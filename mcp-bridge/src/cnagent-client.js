export function buildToolCallRequest(baseUrl, token, mapped) {
  const normalized = String(baseUrl || "http://127.0.0.1:18401").replace(/\/+$/, "");
  return {
    url: `${normalized}/v1/tools/call`,
    options: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token || ""}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(mapped)
    }
  };
}

export async function callCnagentTool({ baseUrl, token, tool, args }) {
  const request = buildToolCallRequest(baseUrl, token, { tool, args: args || {} });
  const response = await fetch(request.url, request.options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error?.message || `Tiiextension API failed with ${response.status}`);
    error.code = body.error?.code || "TIIEXTENSION_API_ERROR";
    throw error;
  }
  return body.result;
}

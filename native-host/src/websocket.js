import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function webSocketAccept(key) {
  return crypto.createHash("sha1").update(`${key}${GUID}`).digest("base64");
}

export function encodeWebSocketFrame(data, { opcode = 0x1 } = {}) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

export function decodeWebSocketFrames(input, { expectMasked = true, maxPayloadBytes = 1024 * 1024 } = {}) {
  const frames = [];
  let buffer = Buffer.from(input);
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = Boolean(first & 0x80);
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    if (expectMasked && !masked) throw webSocketError("WEBSOCKET_UNMASKED_CLIENT_FRAME", "Client WebSocket frames must be masked");
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      const longLength = buffer.readBigUInt64BE(cursor);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw webSocketError("WEBSOCKET_FRAME_TOO_LARGE", "WebSocket frame length is unsafe");
      length = Number(longLength);
      cursor += 8;
    }
    if (length > maxPayloadBytes) throw webSocketError("WEBSOCKET_FRAME_TOO_LARGE", `WebSocket frame exceeds limit: ${length}`);
    const maskBytes = masked ? 4 : 0;
    if (buffer.length - cursor < maskBytes + length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskBytes;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    frames.push({ fin, opcode, data: payload, text: opcode === 0x1 ? payload.toString("utf8") : null });
    offset = cursor + length;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

export function attachWebSocket(socket, { onMessage = () => {}, onClose = () => {}, maxPayloadBytes = 1024 * 1024 } = {}) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  socket.on("data", (chunk) => {
    if (closed) return;
    try {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeWebSocketFrames(buffer, { expectMasked: true, maxPayloadBytes });
      buffer = decoded.remaining;
      for (const frame of decoded.frames) {
        if (!frame.fin) throw webSocketError("WEBSOCKET_FRAGMENT_UNSUPPORTED", "Fragmented frames are not supported");
        if (frame.opcode === 0x8) {
          close();
        } else if (frame.opcode === 0x9) {
          socket.write(encodeWebSocketFrame(frame.data, { opcode: 0xA }));
        } else if (frame.opcode === 0x1) {
          onMessage(frame.text);
        }
      }
    } catch {
      close(1002);
    }
  });
  socket.on("close", notifyClose);
  socket.on("error", notifyClose);

  function send(value) {
    if (!closed && socket.writable) socket.write(encodeWebSocketFrame(typeof value === "string" ? value : JSON.stringify(value)));
  }

  function close(code = 1000) {
    if (closed) return;
    closed = true;
    if (socket.writable) {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code);
      socket.end(encodeWebSocketFrame(payload, { opcode: 0x8 }));
    } else socket.destroy();
    notifyClose();
  }

  function notifyClose() {
    if (!closed) closed = true;
    onClose();
  }

  return { send, close, socket };
}

function webSocketError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}


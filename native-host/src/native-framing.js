export class NativeMessageDecoder {
  constructor({ maxBytes = 64 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxBytes) throw framingError("PROTOCOL_MESSAGE_TOO_LARGE", `Native message exceeds limit: ${length} > ${this.maxBytes}`);
      if (this.buffer.length < length + 4) break;
      const body = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      try {
        messages.push(JSON.parse(body.toString("utf8")));
      } catch (error) {
        throw framingError("PROTOCOL_INVALID_JSON", `Invalid native message JSON: ${error.message}`);
      }
    }
    return messages;
  }
}

export function encodeNativeMessage(message, { maxBytes = 1024 * 1024 } = {}) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > maxBytes) throw framingError("PROTOCOL_MESSAGE_TOO_LARGE", `Native response exceeds limit: ${body.length} > ${maxBytes}`);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function framingError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}


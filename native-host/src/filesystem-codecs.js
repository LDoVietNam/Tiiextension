const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

export function detectBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  let encoding = "utf-8";
  let bom = null;
  let body = buffer;
  if (buffer.subarray(0, 3).equals(UTF8_BOM)) {
    bom = "utf-8";
    body = buffer.subarray(3);
  } else if (buffer.subarray(0, 2).equals(UTF16LE_BOM)) {
    encoding = "utf-16le";
    bom = "utf-16le";
    body = buffer.subarray(2);
  } else if (buffer.subarray(0, 2).equals(UTF16BE_BOM)) {
    return { binary: true, encoding: "utf-16be", bom: "utf-16be", eol: "unknown", bytes: buffer.length };
  } else if (looksBinary(body)) {
    return { binary: true, encoding: null, bom: null, eol: "unknown", bytes: buffer.length };
  }

  let text;
  try {
    text = encoding === "utf-16le" ? body.toString("utf16le") : new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return { binary: true, encoding: null, bom, eol: "unknown", bytes: buffer.length };
  }
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const eol = crlf && !lf ? "crlf" : lf && !crlf ? "lf" : crlf || lf ? "mixed" : "none";
  return { binary: false, encoding, bom, eol, bytes: buffer.length };
}

export function decodeText(buffer) {
  const metadata = detectBuffer(buffer);
  if (metadata.binary) {
    const error = new Error("Text operation is not allowed for binary or unsupported-encoding files");
    error.code = "FILESYSTEM_BINARY_TEXT_OPERATION";
    error.retryable = false;
    throw error;
  }
  const offset = metadata.bom === "utf-8" ? 3 : metadata.bom === "utf-16le" ? 2 : 0;
  const body = buffer.subarray(offset);
  const text = metadata.encoding === "utf-16le" ? body.toString("utf16le") : body.toString("utf8");
  return { text, metadata };
}

export function encodeText(text, metadata = {}) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const encoding = metadata.encoding === "utf-16le" ? "utf-16le" : "utf-8";
  const normalized = normalizeEol(text, metadata.eol);
  const body = encoding === "utf-16le" ? Buffer.from(normalized, "utf16le") : Buffer.from(normalized, "utf8");
  if (metadata.bom === "utf-16le") return Buffer.concat([UTF16LE_BOM, body]);
  if (metadata.bom === "utf-8") return Buffer.concat([UTF8_BOM, body]);
  return body;
}

export function normalizeEol(text, eol) {
  if (eol !== "crlf" && eol !== "lf") return text;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function looksBinary(buffer) {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.15;
}


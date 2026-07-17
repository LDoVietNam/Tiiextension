import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function createArtifactStore({ dataDir, store = null, maxInlineBytes = 768 * 1024 }) {
  if (!dataDir) throw new TypeError("dataDir is required");
  const artifactsDir = path.join(dataDir, "artifacts");

  async function put({ data, mimeType = "application/octet-stream", taskId = null, callId = null, sensitivity = "normal" }) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    const id = `artifact_${crypto.randomUUID().replaceAll("-", "")}`;
    const filePath = path.join(artifactsDir, `${id}.bin`);
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
    const metadata = {
      artifact_id: id,
      mime_type: mimeType,
      bytes: buffer.length,
      sha256: digest,
      sensitivity,
      ...(taskId ? { task_id: taskId } : {}),
      ...(callId ? { call_id: callId } : {}),
      created_at: new Date().toISOString(),
      file_path: filePath
    };
    if (store) await store.update((draft) => { draft.artifacts[id] = metadata; });
    else await writeMetadata(id, metadata);
    return publicMetadata(metadata);
  }

  async function get(id) {
    validateId(id);
    let metadata = store ? await store.read((state) => state.artifacts[id]) : null;
    if (!metadata) {
      try {
        metadata = JSON.parse(await fs.readFile(path.join(artifactsDir, `${id}.json`), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") throw artifactError("ARTIFACT_NOT_FOUND", `Artifact not found: ${id}`);
        throw error;
      }
    }
    return clone(metadata);
  }

  async function read(id) {
    const metadata = await get(id);
    const data = await fs.readFile(metadata.file_path);
    const digest = crypto.createHash("sha256").update(data).digest("hex");
    if (digest !== metadata.sha256) throw artifactError("ARTIFACT_INTEGRITY_ERROR", `Artifact hash mismatch: ${id}`);
    return { metadata: publicMetadata(metadata), data };
  }

  async function maybeExternalize(value, { taskId = null, callId = null } = {}) {
    const data = Buffer.from(JSON.stringify(value));
    if (data.length <= maxInlineBytes) return value;
    const artifact = await put({ data, mimeType: "application/json", taskId, callId });
    return {
      artifact_ref: artifact.artifact_id,
      externalized: true,
      mime_type: artifact.mime_type,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      summary: "Result exceeded the native message budget and was stored as a local artifact"
    };
  }

  async function writeMetadata(id, metadata) {
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(path.join(artifactsDir, `${id}.json`), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  }

  return { put, get, read, maybeExternalize };
}

function publicMetadata(metadata) {
  const { file_path, ...safe } = metadata;
  return safe;
}

function validateId(id) {
  if (!/^artifact_[A-Za-z0-9]+$/.test(String(id))) throw artifactError("ARTIFACT_INVALID_ID", "Invalid artifact id");
}

function artifactError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}


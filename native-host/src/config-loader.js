import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CAPABILITIES = [
  "filesystem.read",
  "filesystem.write",
  "process.run",
  "payload.load",
  "browser.control"
];

export async function loadRuntimeConfig(configPath) {
  if (!configPath) throw new TypeError("configPath is required");
  const baseDir = path.dirname(path.resolve(configPath));
  const raw = JSON.parse(await fs.readFile(configPath, "utf8"));
  const config = normalizeConfig(raw, baseDir);
  const activeProfile = config.profiles.find((profile) => profile.id === config.active_profile);
  if (!activeProfile) throw new Error(`Active profile not found: ${config.active_profile}`);
  return { config, activeProfile, baseDir, configPath: path.resolve(configPath) };
}

export function normalizeConfig(raw, baseDir = process.cwd()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Runtime config must be an object");
  const mode = raw.mode === "release" ? "release" : "dev";
  const legacyProfiles = Array.isArray(raw.profiles) && raw.profiles.length
    ? raw.profiles
    : [{ name: "default", roots: raw.workspaces || [] }];
  const profiles = legacyProfiles.map((profile, index) => normalizeProfile(profile, baseDir, index));
  if (!profiles.length || profiles.some((profile) => !profile.roots.length)) {
    throw new Error("At least one workspace root is required");
  }
  const active = raw.active_profile || raw.activeProfile || profiles[0].id;
  const auditPath = resolveFrom(baseDir, raw.audit?.path || raw.logsPath || "./runtime/audit.jsonl");
  const dataDir = resolveFrom(baseDir, raw.data_dir || raw.dataDir || "./runtime");
  const tokenFile = resolveFrom(baseDir, raw.api?.token_file || raw.api?.tokenFile || "./secrets/local-api.token");
  return {
    ...raw,
    schema: "cnagent-config/2",
    mode,
    active_profile: active,
    profiles,
    data_dir: dataDir,
    provider: {
      preferred: "chatgpt-web",
      max_iterations: 20,
      response_timeout_ms: 180000,
      ...(raw.provider || {})
    },
    native_hosts: {
      preferred: "com.chatgpt_native_agent.host",
      compatible: [],
      ...(raw.native_hosts || raw.nativeHosts || {})
    },
    api: {
      enabled: raw.api?.enabled ?? true,
      host: raw.api?.host || "127.0.0.1",
      port: raw.api?.port || 1840,
      ...raw.api,
      token_file: tokenFile
    },
    audit: {
      retention_days: 30,
      hash_chain: true,
      ...(raw.audit || {}),
      path: auditPath
    }
  };
}

function normalizeProfile(profile, baseDir, index) {
  const id = profile.id || profile.name || `profile-${index + 1}`;
  const rawRoots = profile.roots || profile.workspaces || [];
  const roots = rawRoots.map((root, rootIndex) => {
    const item = typeof root === "string" ? { path: root } : root;
    if (!item?.path) throw new Error(`Profile ${id} has a root without path`);
    const resolved = resolveFrom(baseDir, item.path);
    return {
      id: item.id || item.name || `${id}-root-${rootIndex + 1}`,
      path: resolved,
      read_only: Boolean(item.read_only ?? item.readOnly)
    };
  });
  const payloadRoots = profile.payload_roots || profile.payloads || [];
  return {
    ...profile,
    id,
    roots,
    payload_roots: payloadRoots.map((entry) => resolveFrom(baseDir, typeof entry === "string" ? entry : entry.path)),
    capabilities: Array.isArray(profile.capabilities) && profile.capabilities.length ? [...profile.capabilities] : [...DEFAULT_CAPABILITIES],
    process: {
      allow: ["node", "npm", "npx", "git"],
      shell: false,
      max_concurrency: 2,
      default_timeout_ms: 120000,
      ...(profile.process || {})
    },
    filesystem: {
      max_read_bytes: 4 * 1024 * 1024,
      max_write_bytes: 16 * 1024 * 1024,
      max_results: 1000,
      deny_globs: ["**/*.pem", "**/id_rsa*"],
      redact_globs: ["**/.env*"],
      snapshot_retention_days: 14,
      transaction_max_bytes: 1024 * 1024 * 1024,
      ...(profile.filesystem || {})
    }
  };
}

function resolveFrom(baseDir, value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Config path must be a non-empty string");
  return path.resolve(baseDir, value);
}

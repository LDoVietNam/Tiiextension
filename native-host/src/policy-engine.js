import path from "node:path";

const WRITE_TOOLS = new Set([
  "fs.mkdir", "fs.write", "fs.write_many", "fs.append", "fs.patch", "fs.patch_unified",
  "fs.delete", "fs.move", "fs.copy", "fs.transaction.begin", "fs.transaction.commit",
  "fs.transaction.rollback", "fs.rollback", "fs.snapshots.prune"
]);

export function createPolicyEngine({ config, profile }) {
  if (!config || !profile) throw new TypeError("config and profile are required");
  const capabilities = new Set(profile.capabilities || []);
  const filesystem = profile.filesystem || {};
  const processPolicy = profile.process || {};

  function authorizeTool(tool, args = {}, context = {}) {
    const capability = capabilityFor(tool);
    if (capability === "administrative") {
      return { allowed: false, reason: "Administrative tools cannot be called by the model", capability, limits: limitsFor(tool) };
    }
    if (capability && !capabilities.has(capability)) {
      return { allowed: false, reason: `Capability not enabled: ${capability}`, capability, limits: limitsFor(tool) };
    }
    if (WRITE_TOOLS.has(tool) && context.root?.read_only) {
      return { allowed: false, reason: `Workspace root is read-only: ${context.root.id}`, capability, limits: limitsFor(tool) };
    }
    if (tool === "process.run" && args.command && !isCommandAllowed(args.command)) {
      return { allowed: false, reason: `Command is not allowlisted: ${args.command}`, capability, limits: limitsFor(tool) };
    }
    return { allowed: true, reason: "allowed_by_profile", capability, limits: limitsFor(tool) };
  }

  function limitsFor(tool) {
    if (tool.startsWith("fs.")) return { ...filesystem };
    if (tool === "process.run" || tool.startsWith("project.")) return { ...processPolicy };
    return {};
  }

  function isCommandAllowed(command) {
    const allowed = processPolicy.allow || [];
    const name = normalizeCommandName(command);
    return allowed.map(normalizeCommandName).includes(name);
  }

  function classifyPath(inputPath) {
    const normalized = String(inputPath).replaceAll("\\", "/").replace(/^\.\//, "");
    if ((filesystem.deny_globs || []).some((pattern) => globMatch(normalized, pattern))) return "deny";
    if ((filesystem.redact_globs || []).some((pattern) => globMatch(normalized, pattern))) return "redact";
    return "allow";
  }

  function scrub(value) {
    return scrubValue(value);
  }

  return { authorizeTool, limitsFor, isCommandAllowed, classifyPath, scrub, mode: config.mode, profile };
}

function normalizeCommandName(value) {
  return path.basename(String(value)).toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, "");
}

export function capabilityFor(tool) {
  if (!tool || typeof tool !== "string") return null;
  if (tool.startsWith("profiles.") || tool.startsWith("config.") || tool.startsWith("trust.")) return "administrative";
  if (tool.startsWith("fs.")) return WRITE_TOOLS.has(tool) ? "filesystem.write" : "filesystem.read";
  if (tool.startsWith("process.") || tool.startsWith("project.")) return "process.run";
  if (tool.startsWith("payload.")) return "payload.load";
  if (tool.startsWith("browser.")) return "browser.control";
  return null;
}

function scrubValue(value, key = "") {
  if (/cookie|session|token|secret|password|authorization|api[-_]?key/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => scrubValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, scrubValue(child, childKey)]));
  }
  if (typeof value === "string") {
    return value.replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]");
  }
  return value;
}

function globMatch(value, pattern) {
  const normalizedPattern = String(pattern).replaceAll("\\", "/");
  let source = "";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i").test(value);
}

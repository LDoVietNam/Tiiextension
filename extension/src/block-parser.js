export const BLOCK_KEYS = [
  "agent_goal",
  "agent_action",
  "tool_call",
  "payload_load",
  "filesystem_read",
  "filesystem_write",
  "filesystem_patch",
  "filesystem_search",
  "task_result",
  "task_event"
];

export function parseStructuredBlocks(text) {
  if (!text || typeof text !== "string") return [];
  const candidates = extractJsonCandidates(text);
  const blocks = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      collectBlocks(parsed, blocks);
    } catch {
      continue;
    }
  }

  return dedupeBlocks(blocks);
}

function extractJsonCandidates(text) {
  const candidates = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenced.exec(text))) {
    candidates.push(match[1].trim());
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed);
  }

  for (const slice of balancedObjectSlices(text)) {
    candidates.push(slice);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function balancedObjectSlices(text) {
  const slices = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        slices.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return slices;
}

function collectBlocks(value, blocks) {
  if (Array.isArray(value)) {
    for (const item of value) collectBlocks(item, blocks);
    return;
  }
  if (!value || typeof value !== "object") return;
  const present = BLOCK_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (present.length !== 1) return;
  const key = present[0];
  if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) return;
  if (value.protocol && value.protocol !== "cnagent/1") return;
  blocks.push({
    protocol: "cnagent/1",
    taskId: typeof value.task_id === "string" ? value.task_id : null,
    blockId: typeof value.block_id === "string" ? value.block_id : stableBlockId(key, value[key]),
    type: key,
    payload: value[key]
  });
}

function dedupeBlocks(blocks) {
  const seen = new Set();
  return blocks.filter((block) => {
    const key = block.blockId || `${block.type}:${JSON.stringify(block.payload)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableBlockId(type, payload) {
  const source = `${type}:${JSON.stringify(payload)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

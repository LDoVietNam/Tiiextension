export function parseUnifiedDiff(diffText) {
  if (typeof diffText !== "string" || !diffText.trim()) throw new Error("diff is required");
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }
    const oldPath = cleanHeaderPath(lines[index].slice(4));
    index += 1;
    if (!lines[index]?.startsWith("+++ ")) throw new Error("Unified diff is missing a +++ file header");
    const newPath = cleanHeaderPath(lines[index].slice(4));
    index += 1;
    const patch = {
      old_path: oldPath,
      new_path: newPath,
      path: newPath === "/dev/null" ? oldPath : newPath,
      create: oldPath === "/dev/null",
      delete: newPath === "/dev/null",
      hunks: []
    };
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      const header = lines[index];
      if (!header) {
        index += 1;
        continue;
      }
      if (!header.startsWith("@@")) throw new Error(`Unexpected unified diff line: ${header}`);
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(header);
      if (!match) throw new Error(`Malformed unified diff hunk: ${header}`);
      const hunk = {
        old_start: Number(match[1]),
        old_count: match[2] === undefined ? 1 : Number(match[2]),
        new_start: Number(match[3]),
        new_count: match[4] === undefined ? 1 : Number(match[4]),
        lines: []
      };
      index += 1;
      while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("--- ")) {
        const line = lines[index];
        if (line.startsWith("\\ No newline at end of file")) {
          index += 1;
          continue;
        }
        if (line === "" && index === lines.length - 1) {
          index += 1;
          break;
        }
        if (!/^[ +\-]/.test(line)) throw new Error(`Malformed unified diff content: ${line}`);
        hunk.lines.push({ kind: line[0], text: line.slice(1) });
        index += 1;
      }
      const oldCount = hunk.lines.filter((line) => line.kind !== "+").length;
      const newCount = hunk.lines.filter((line) => line.kind !== "-").length;
      if (oldCount !== hunk.old_count || newCount !== hunk.new_count) {
        throw new Error(`Unified diff hunk count mismatch at old line ${hunk.old_start}`);
      }
      patch.hunks.push(hunk);
    }
    if (!patch.hunks.length) throw new Error(`Unified diff contains no hunks for ${patch.path}`);
    files.push(patch);
  }
  if (!files.length) throw new Error("Unified diff contains no file patches");
  return files;
}

export function applyPatchToText(before, patch) {
  if (typeof before !== "string") throw new TypeError("before must be a string");
  const normalized = before.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hadFinalNewline = normalized.endsWith("\n");
  const source = normalized.split("\n");
  if (hadFinalNewline) source.pop();
  const output = [];
  let cursor = 0;
  let offset = 0;
  for (let hunkIndex = 0; hunkIndex < patch.hunks.length; hunkIndex += 1) {
    const hunk = patch.hunks[hunkIndex];
    const start = Math.max(0, hunk.old_start - 1);
    if (start < cursor) throw conflict(patch, hunkIndex, "Overlapping or out-of-order hunk");
    output.push(...source.slice(cursor, start));
    const expected = hunk.lines.filter((line) => line.kind !== "+").map((line) => line.text);
    const actual = source.slice(start, start + expected.length);
    if (!sameLines(expected, actual)) {
      throw conflict(patch, hunkIndex, "Patch context does not match", { expected, actual, old_start: hunk.old_start + offset });
    }
    for (const line of hunk.lines) {
      if (line.kind === " " || line.kind === "+") output.push(line.text);
    }
    cursor = start + expected.length;
    offset += hunk.new_count - hunk.old_count;
  }
  output.push(...source.slice(cursor));
  const result = output.join("\n");
  return hadFinalNewline ? `${result}\n` : result;
}

export function applyUnifiedDiff(files, patches) {
  const result = { ...files };
  for (const patch of patches) {
    const before = patch.create ? "" : result[patch.path];
    if (before === undefined && !patch.create) throw conflict(patch, 0, "Patch target does not exist");
    const after = applyPatchToText(before || "", patch);
    if (patch.delete) delete result[patch.path];
    else result[patch.path] = after;
  }
  return result;
}

function cleanHeaderPath(value) {
  const withoutTimestamp = value.split("\t", 1)[0].trim();
  if (withoutTimestamp === "/dev/null") return withoutTimestamp;
  return withoutTimestamp.replace(/^[ab]\//, "");
}

function sameLines(expected, actual) {
  return expected.length === actual.length && expected.every((line, index) => line === actual[index]);
}

function conflict(patch, hunkIndex, message, details = {}) {
  const error = new Error(`${message} for ${patch.path}`);
  error.code = "FILESYSTEM_PATCH_CONFLICT";
  error.retryable = false;
  error.details = { path: patch.path, hunk: hunkIndex + 1, ...details };
  return error;
}


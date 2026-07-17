const DEFINITIONS = [
  ["fs.workspace_info", "Describe configured workspace roots and project metadata.", {}, "inspect"],
  ["fs.roots.list", "List allowed workspace roots.", {}, "inspect"],
  ["fs.exists", "Check whether a workspace path exists.", { path: "string" }, "read"],
  ["fs.list", "List one directory with pagination.", { path: "string?", offset: "number?", limit: "number?" }, "read"],
  ["fs.tree", "Return a bounded directory tree.", { path: "string?", depth: "number?" }, "read"],
  ["fs.stat", "Return file or directory metadata.", { path: "string" }, "read"],
  ["fs.read", "Read a text file with encoding and size guards.", { path: "string", maxBytes: "number?" }, "read"],
  ["fs.read_many", "Read multiple text files.", { paths: "string[]" }, "read"],
  ["fs.read_bytes", "Read bytes as base64.", { path: "string", maxBytes: "number?" }, "read"],
  ["fs.hash", "Hash a workspace file.", { path: "string", algorithm: "string?" }, "read"],
  ["fs.detect_encoding", "Detect binary/text encoding, BOM and EOL.", { path: "string" }, "read"],
  ["fs.search_text", "Search literal text in workspace files.", { path: "string?", query: "string", maxResults: "number?" }, "read"],
  ["fs.search_regex", "Search a regular expression in workspace files.", { path: "string?", pattern: "string", flags: "string?" }, "read"],
  ["fs.search_glob", "Find files by glob pattern.", { path: "string?", pattern: "string" }, "read"],
  ["fs.find_files", "Find files by glob pattern.", { path: "string?", pattern: "string" }, "read"],
  ["fs.find_duplicates", "Find duplicate files by size and SHA-256.", { path: "string?" }, "read"],
  ["fs.diff", "Compare a file with content or another file.", { path: "string", content: "string?", comparePath: "string?" }, "read"],
  ["fs.preview_write", "Preview a proposed write.", { path: "string", content: "string" }, "read"],
  ["fs.preview_patch", "Preview exact search/replace.", { path: "string", search: "string", replace: "string" }, "read"],
  ["fs.patch_check", "Validate and preview a unified diff.", { diff: "string" }, "read"],
  ["fs.mkdir", "Create a directory transactionally.", { path: "string" }, "write"],
  ["fs.write", "Write one text file transactionally.", { path: "string", content: "string" }, "write"],
  ["fs.write_many", "Write multiple files atomically.", { files: "{path,content}[]" }, "write"],
  ["fs.append", "Append text transactionally.", { path: "string", content: "string" }, "write"],
  ["fs.patch", "Apply exact search/replace transactionally.", { path: "string", search: "string", replace: "string" }, "write"],
  ["fs.patch_unified", "Apply a strict multi-file unified diff transactionally.", { diff: "string" }, "write"],
  ["fs.delete", "Delete a path transactionally.", { path: "string", recursive: "boolean?" }, "write"],
  ["fs.move", "Move a path transactionally.", { from: "string", to: "string" }, "write"],
  ["fs.copy", "Copy a path transactionally.", { from: "string", to: "string" }, "write"],
  ["fs.transaction.begin", "Begin an explicit filesystem transaction.", { taskId: "string?", label: "string?" }, "write"],
  ["fs.transaction.status", "Read transaction state.", { id: "string" }, "read"],
  ["fs.transaction.preview", "Preview transaction operations.", { id: "string" }, "read"],
  ["fs.transaction.commit", "Commit a staged transaction.", { id: "string" }, "write"],
  ["fs.transaction.rollback", "Rollback a transaction.", { id: "string" }, "write"],
  ["fs.snapshot", "Create a restorable snapshot.", { paths: "string[]", label: "string?" }, "write"],
  ["fs.snapshots.list", "List restorable snapshots.", {}, "read"],
  ["fs.snapshots.prune", "Prune old snapshots.", { olderThanDays: "number?" }, "write"],
  ["fs.rollback", "Restore a snapshot.", { id: "string" }, "write"],
  ["fs.change_log", "Read recent filesystem change records.", { limit: "number?" }, "read"],
  ["fs.watch.start", "Start a coalesced workspace filesystem event stream.", { path: "string?", recursive: "boolean?", debounce_ms: "number?", ignore: "string[]?" }, "read"],
  ["fs.watch.stop", "Stop a filesystem watcher.", { id: "string" }, "read"],
  ["fs.watch.status", "Inspect one or all filesystem watchers.", { id: "string?" }, "inspect"],
  ["fs.index.build", "Build an in-memory searchable workspace file index.", { path: "string?", include_hash: "boolean?", max_files: "number?" }, "read"],
  ["fs.index.status", "Inspect filesystem indexes.", { id: "string?" }, "inspect"],
  ["fs.index.search", "Search indexed paths and text snippets.", { query: "string", id: "string?", limit: "number?" }, "read"],
  ["fs.index.refresh", "Rebuild an existing or path-based filesystem index.", { id: "string?", path: "string?", include_hash: "boolean?" }, "read"],
  ["project.detect", "Detect project type.", { path: "string?" }, "read"],
  ["project.summary", "Summarize project metadata.", { path: "string?" }, "read"],
  ["project.package_info", "Read package.json.", { path: "string?" }, "read"],
  ["project.scripts", "List package scripts.", { path: "string?" }, "read"],
  ["project.dependencies", "List package dependencies.", { path: "string?" }, "read"],
  ["project.run_script", "Run an allowlisted package script.", { path: "string?", script: "string", args: "string[]?" }, "execute"],
  ["project.test", "Run the test script.", { path: "string?" }, "execute"],
  ["project.build", "Run the build script.", { path: "string?" }, "execute"],
  ["project.lint", "Run the lint script.", { path: "string?" }, "execute"],
  ["project.typecheck", "Run the typecheck script.", { path: "string?" }, "execute"],
  ["payload.list", "List loaded hot payloads.", {}, "inspect"],
  ["payload.load", "Load a verified module or command payload.", { path: "string" }, "execute"],
  ["payload.unload", "Unload a payload.", { name: "string" }, "execute"],
  ["payload.reload", "Reload a payload.", { path: "string", name: "string?" }, "execute"],
  ["payload.validate", "Validate payload checksum/signature.", { path: "string" }, "read"],
  ["payload.call", "Call a loaded payload method.", { name: "string", method: "string?", args: "object?" }, "execute"],
  ["process.run", "Run an allowlisted process without a shell.", { command: "string", args: "string[]?", cwd: "string?" }, "execute"],
  ["process.cancel", "Cancel a supervised process.", { id: "string" }, "execute"],
  ["process.list", "List running supervised processes.", {}, "inspect"],
  ["git_status", "Đọc Git status và trạng thái clean.", { path: "string?" }, "read"],
  ["git_diff", "Đọc Git diff, hỗ trợ staged và pathspec.", { path: "string?", staged: "boolean?", pathspec: "string?" }, "read"],
  ["git_log", "Đọc commit log có cấu trúc.", { path: "string?", limit: "number?" }, "read"],
  ["git_branches", "Liệt kê branch local/remote.", { path: "string?" }, "read"],
  ["git_create_branch", "Tạo branch.", { path: "string?", name: "string", checkout: "boolean?" }, "write"],
  ["git_add", "Stage file.", { path: "string?", paths: "string[]" }, "write"],
  ["git_commit", "Commit thay đổi.", { path: "string?", message: "string" }, "write"],
  ["git_restore", "Restore file hoặc staged state.", { path: "string?", paths: "string[]", staged: "boolean?" }, "write"],
  ["verify_detect_plan", "Tạo kế hoạch lint/typecheck/test/build phù hợp với loại project, không chạy lệnh.", { path: "string?" }, "read"],
  ["verify_workspace", "Chạy pipeline xác minh workspace: secret scan và các kiểm tra lint/typecheck/test/build được phát hiện từ project.", { path: "string?" }, "read"],
  ["verify_scan_secrets", "Quét workspace phát hiện secret/private key phản biện; kết quả luôn được redaction.", { path: "string?" }, "read"],
  ["route_provider", "Chọn Web LLM session tốt nhất theo model, provider, capability, health và lịch sự lỗi.", { provider: "string?", model: "string?", capability: "string?", requiredCapabilities: "string[]" }, "read"],
  ["route_list_providers", "Liệt kê provider Web LLM kèm health, score, độ trễ và circuit breaker.", { status: "string?" }, "read"],
  ["route_provider_metrics", "Đọc success rate, latency, failure streak và circuit state của provider.", { key: "string?" }, "read"],
  ["route_reset_circuit", "Đặt lại circuit breaker của provider sau khi người dùng khắc phục session.", { key: "string" }, "write"],
  ["runtime_capabilities", "Đọc capability, policy và tool inventory của local runtime.", {}, "inspect"],
  ["runtime_diagnostics", "Chạy self-check cấu hình, roots, state persistence, provider, task queue và transaction store.", {}, "read"],
  ["runtime_list_approvals", "Liệt kê operation nguy hiểm đang chờ người dùng duyệt.", { status: "string?" }, "read"],
  ["runtime_read_audit", "Đọc audit log gần nhất đã được redaction.", { limit: "number?" }, "read"],
  ["runtime_list_tasks", "Liệt kê durable task theo trạng thái.", { status: "string?", limit: "number?" }, "read"],
  ["runtime_cancel_task", "Hủy durable task đang queued/leased/retry_wait.", { id: "string", reason: "string?" }, "write"],
  ["runtime_retry_task", "Đưa task failed/cancelled trở lại hàng đợi.", { id: "string" }, "write"],
  ["workspace.info", "Thông tin workspace (revision, git, permissions).", { workspaceId: "string?" }, "read"],
  ["workspace.status", "Trạng thái workspace.", { workspaceId: "string?" }, "read"],
  ["revision.compute", "Tính revision của workspace hoặc file.", { workspaceId: "string?", path: "string?" }, "read"],
  ["revision.check", "Kiểm tra revision mismatch.", { workspaceId: "string?", path: "string?", expectedRevision: "string" }, "read"],
  ["repo.tree", "Cây thư mục repository.", { workspaceId: "string?", path: "string?" }, "read"],
  ["repo.search", "Tìm kiếm text trong repository.", { workspaceId: "string?", query: "string", path: "string?", filePattern: "string?", maxResults: "number?", caseSensitive: "boolean?" }, "read"],
  ["repo.symbols", "Trích xuất symbols từ file hoặc workspace.", { workspaceId: "string?", path: "string?" }, "read"],
  ["repo.dependencies", "Dependency graph của workspace.", { workspaceId: "string?" }, "read"]
];

export const TOOL_MANIFEST = DEFINITIONS.map(([name, description, args, risk]) => tool(name, description, args, risk));

export function compactToolManifest() {
  return TOOL_MANIFEST.map(({ name, description, args, risk, mutates, transactional }) => ({ name, description, args, risk, mutates, transactional }));
}

export function describeTool(name) {
  return TOOL_MANIFEST.find((item) => item.name === name) || null;
}

function tool(name, description, args, risk) {
  const mutates = risk === "write";
  return {
    name,
    version: "1.3.0",
    description,
    args,
    input_schema: { type: "object", additionalProperties: true },
    output_schema: { type: "object", additionalProperties: true },
    capability: capabilityFor(name, risk),
    risk,
    mutates,
    transactional: mutates && name.startsWith("fs."),
    default_timeout_ms: risk === "execute" ? 120000 : 30000,
    max_output_bytes: 768 * 1024,
    supports_cancellation: risk === "execute" || risk === "read",
    supports_progress: risk === "execute"
  };
}

function capabilityFor(name, risk) {
  if (name.startsWith("fs.")) return risk === "write" ? "filesystem.write" : "filesystem.read";
  if (name.startsWith("project.") || name.startsWith("process.")) return "process.run";
  if (name.startsWith("payload.")) return "payload.load";
  if (name.startsWith("git.")) return "git";
  if (name.startsWith("verify.")) return "verification";
  if (name.startsWith("route.")) return "provider.routing";
  if (name.startsWith("runtime.")) return "runtime.management";
  return "runtime.inspect";
}

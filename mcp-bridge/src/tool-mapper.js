const NATIVE_TOOL_NAMES = [
  "fs.workspace_info",
  "fs.roots.list",
  "fs.exists",
  "fs.list",
  "fs.tree",
  "fs.stat",
  "fs.read",
  "fs.read_many",
  "fs.read_bytes",
  "fs.hash",
  "fs.detect_encoding",
  "fs.search_text",
  "fs.search_regex",
  "fs.search_glob",
  "fs.find_files",
  "fs.find_duplicates",
  "fs.diff",
  "fs.diff_tree",
  "fs.preview_write",
  "fs.preview_patch",
  "fs.patch_check",
  "fs.mkdir",
  "fs.write",
  "fs.write_many",
  "fs.append",
  "fs.patch",
  "fs.patch_unified",
  "fs.delete",
  "fs.move",
  "fs.copy",
  "fs.transaction.begin",
  "fs.transaction.status",
  "fs.transaction.preview",
  "fs.transaction.commit",
  "fs.transaction.rollback",
  "fs.snapshot",
  "fs.snapshots.list",
  "fs.snapshots.prune",
  "fs.rollback",
  "fs.change_log",
  "fs.watch.start",
  "fs.watch.stop",
  "fs.watch.status",
  "fs.index.build",
  "fs.index.status",
  "fs.index.search",
  "fs.index.refresh",
  "project.detect",
  "project.summary",
  "project.package_info",
  "project.scripts",
  "project.dependencies",
  "project.run_script",
  "project.test",
  "project.build",
  "project.lint",
  "project.typecheck",
  "git_status",
  "git_diff",
  "git_log",
  "git_branches",
  "git_create_branch",
  "git_add",
  "git_commit",
  "git_restore",
  "verify_detect_plan",
  "verify_workspace",
  "verify_scan_secrets",
  "route_provider",
  "route_list_providers",
  "route_provider_metrics",
  "route_reset_circuit",
  "runtime_capabilities",
  "runtime_diagnostics",
  "runtime_list_approvals",
  "runtime_read_audit",
  "runtime_list_tasks",
  "runtime_cancel_task",
  "runtime_retry_task",
  "process.run",
  "process.cancel",
  "process.list"
];

const GITHUB_TOOL_NAMES = [
  "github.search_repos",
  "github.list_issues",
  "github.get_issue",
  "github.create_issue",
  "github.update_issue",
  "github.list_pull_requests",
  "github.get_pull_request",
  "github.create_pull_request",
  "github.merge_pull_request",
  "github.get_file_contents",
  "github.get_branch",
  "github.list_branches",
  "github.list_commits"
];

const ALL_TOOL_NAMES = [...NATIVE_TOOL_NAMES, ...GITHUB_TOOL_NAMES];

export function listMcpTools() {
  return ALL_TOOL_NAMES.map((name) => ({
    name,
    description: name.startsWith("github.") ? `GitHub MCP ${name}` : `Tiiextension ${name}`,
    inputSchema: { type: "object", additionalProperties: true }
  }));
}

export function mapMcpToolCall(name, args = {}) {
  const source = GITHUB_TOOL_NAMES.includes(name) ? "github-mcp" : "native-host";
  if (!ALL_TOOL_NAMES.includes(name)) {
    const error = new Error(`Unsupported MCP tool: ${name}`);
    error.code = "MCP_TOOL_NOT_FOUND";
    throw error;
  }
  return { tool: name, args, source };
}

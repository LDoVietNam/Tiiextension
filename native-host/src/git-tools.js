import { spawn } from "node:child_process";
import path from "node:path";

export function createGitTools(guard, context = {}) {
  const events = context.events || null;
  const audit = context.audit || null;

  async function execGit(args, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => stdout += chunk.toString());
      child.stderr.on("data", (chunk) => stderr += chunk.toString());

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `git ${args[0]} failed`));
        } else {
          resolve(stdout);
        }
      });

      child.on("error", (err) => reject(err));
    });
  }

  async function gitStatus({ path: inputPath = "." }) {
    const resolved = guard.resolveInside(inputPath);
    const stat = await execGit(["status", "--porcelain=v1", "--branch"], resolved.path);
    const lines = stat.trim().split(/\r?\n/).filter(Boolean);
    const branchLine = lines.find(l => l.startsWith("## "));
    const changes = lines.filter(l => !l.startsWith("## "));

    return {
      repo: resolved.path,
      output: stat,
      clean: changes.length === 0,
      branch: branchLine ? branchLine.slice(3).split("...")[0] : null,
      changes: changes.slice(0, 100)
    };
  }

  async function gitDiff({ path: inputPath = ".", staged = false, pathspec }) {
    const resolved = guard.resolveInside(inputPath);
    const args = ["diff"];
    if (staged) args.push("--staged");
    if (pathspec) args.push("--", pathspec);

    const diff = await execGit(args, resolved.path);
    return {
      repo: resolved.path,
      diff,
      truncated: diff.length > 1024 * 1024
    };
  }

  async function gitLog({ path: inputPath = ".", limit = 20 }) {
    const resolved = guard.resolveInside(inputPath);
    const log = await execGit(["log", `-${Math.min(limit, 200)}`, "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%an%x09%s"], resolved.path);

    const commits = log.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [hash, date, author, ...msg] = line.split("\t");
      return { hash, date, author, message: msg.join("\t") };
    });

    return { repo: resolved.path, commits };
  }

  async function gitBranches({ path: inputPath = "." }) {
    const resolved = guard.resolveInside(inputPath);
    const log = await execGit(["branch", "--all", "--format=%(refname:short)%09%(HEAD)%09%(objectname:short)"], resolved.path);

    const branches = log.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [name, head, commit] = line.split("\t");
      return { name, current: head === "*", commit };
    });

    return { repo: resolved.path, branches };
  }

  async function gitCreateBranch({ path: inputPath = ".", name, checkout = false }) {
    const resolved = guard.resolveInside(inputPath);
    if (!name || !/^[A-Za-z0-9._/-]+$/.test(name)) {
      throw new Error("Tên branch không hợp lệ");
    }

    const args = checkout ? ["switch", "-c", name] : ["branch", name];
    await execGit(args, resolved.path);

    await audit?.append({ type: "git.branch_created", repo: resolved.path, name, checkout });

    return { ok: true, repo: resolved.path, name, checkout };
  }

  async function gitAdd({ path: inputPath = ".", paths }) {
    const resolved = guard.resolveInside(inputPath);
    const targetPaths = Array.isArray(paths) && paths.length ? paths : ["."];
    await execGit(["add", "--", ...targetPaths], resolved.path);

    await audit?.append({ type: "git.add", repo: resolved.path, paths: targetPaths });

    return { ok: true, repo: resolved.path, output: " staged" };
  }

  async function gitCommit({ path: inputPath = ".", message }) {
    const resolved = guard.resolveInside(inputPath);
    if (!message) {
      throw new Error("message là bắt buộc");
    }

    await execGit(["commit", "-m", message], resolved.path);

    await audit?.append({ type: "git.commit", repo: resolved.path, message });

    return { ok: true, repo: resolved.path, output: " committed" };
  }

  async function gitRestore({ path: inputPath = ".", paths, staged = false }) {
    const resolved = guard.resolveInside(inputPath);
    if (!Array.isArray(paths) || !paths.length) {
      throw new Error("paths là bắt buộc");
    }

    const args = ["restore"];
    if (staged) args.push("--staged");
    args.push("--", ...paths);

    await execGit(args, resolved.path);

    await audit?.append({ type: "git.restore", repo: resolved.path, paths, staged });

    return { ok: true, repo: resolved.path, output: " restored" };
  }

  function toolError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.retryable = false;
    return error;
  }

  const definitions = [
    ["git_status", "Đọc Git status và trạng thái clean.", { type: "object", properties: { path: { type: "string" } } }],
    ["git_diff", "Đọc Git diff, hỗ trợ staged và pathspec.", { type: "object", properties: { path: { type: "string" }, staged: { type: "boolean" }, pathspec: { type: "string" } } }],
    ["git_log", "Đọc commit log có cấu trúc.", { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } } }],
    ["git_branches", "Liệt kê branch local/remote.", { type: "object", properties: { path: { type: "string" } } }],
    ["git_create_branch", "Tạo branch, yêu cầu confirm: true.", { type: "object", properties: { path: { type: "string" }, name: { type: "string" }, checkout: { type: "boolean" }, confirm: { type: "boolean" } }, required: ["name", "confirm"] }],
    ["git_add", "Stage file, yêu cầu confirm: true.", { type: "object", properties: { path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, confirm: { type: "boolean" } }, required: ["confirm"] }],
    ["git_commit", "Commit thay đổi, yêu cầu confirm: true.", { type: "object", properties: { path: { type: "string" }, message: { type: "string" }, confirm: { type: "boolean" } }, required: ["message", "confirm"] }],
    ["git_restore", "Restore file hoặc staged state, yêu cầu confirm: true.", { type: "object", properties: { path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, staged: { type: "boolean" }, confirm: { type: "boolean" } }, required: ["paths", "confirm"] }]
  ].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

  return { definitions, async call(name, args = {}) {
    const handlers = { 
      git_status: gitStatus, 
      git_diff: gitDiff, 
      git_log: gitLog, 
      git_branches: gitBranches, 
      git_create_branch: gitCreateBranch, 
      git_add: gitAdd, 
      git_commit: gitCommit, 
      git_restore: gitRestore 
    };
    const handler = handlers[name];
    if (!handler) throw toolError("TOOL_NOT_FOUND", `Unknown git tool: ${name}`);
    return handler(args);
  }};
}
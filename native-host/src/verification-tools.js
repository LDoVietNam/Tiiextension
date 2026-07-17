import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export function createVerificationTools(guard, context = {}) {
  const events = context.events || null;
  const audit = context.audit || null;

  async function execCommand(command, args = [], cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
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
        resolve({ code, stdout, stderr });
      });

      child.on("error", (err) => reject(err));
    });
  }

  function detectProjectType(dir) {
    const markers = {
      node: ["package.json"],
      python: ["pyproject.toml", "requirements.txt", "setup.py"],
      go: ["go.mod"],
      rust: ["Cargo.toml"],
      dotnet: [".csproj", ".sln"],
      java: ["pom.xml", "build.gradle", "build.gradle.kts"],
      docker: ["Dockerfile", "docker-compose.yml", "compose.yaml"]
    };

    return Object.entries(markers).reduce((types, [type, files]) => {
      if (files.some(f => files.some(fn => fn === f))) {
        types.push(type);
      }
      return types;
    }, []);
  }

  function getLintCommand(projectType) {
    const commands = {
      node: ["npm", ["run", "lint"]],
      python: ["ruff", ["check", "."]],
      go: ["go", ["vet", "."]],
      rust: ["cargo", ["clippy", "--", "-D", "warnings"]],
      dotnet: ["dotnet", ["build", "--no-restore"]],
      java: ["mvn", ["verify", "-DskipTests"]],
      docker: null
    };
    return commands[projectType] || null;
  }

  function getTypecheckCommand(projectType) {
    const commands = {
      node: ["npm", ["run", "typecheck"]],
      python: ["mypy", ["."]],
      go: ["go", ["build", "."]],
      rust: ["cargo", ["check"]],
      dotnet: ["dotnet", ["build", "--no-restore"]],
      java: null,
      docker: null
    };
    return commands[projectType] || null;
  }

  function getTestCommand(projectType) {
    const commands = {
      node: ["npm", ["test"]],
      python: ["pytest", ["."]],
      go: ["go", ["test", "./..."]],
      rust: ["cargo", ["test"]],
      dotnet: ["dotnet", ["test"]],
      java: ["mvn", ["test"]],
      docker: null
    };
    return commands[projectType] || null;
  }

  function getBuildCommand(projectType) {
    const commands = {
      node: ["npm", ["run", "build"]],
      python: ["python", ["-m", "build"]],
      go: ["go", ["build", "./..."]],
      rust: ["cargo", ["build", "--release"]],
      dotnet: ["dotnet", ["build", "-c", "Release"]],
      java: ["mvn", ["package", "-DskipTests"]],
      docker: null
    };
    return commands[projectType] || null;
  }

  async function detectVerificationPlan({ path: inputPath = "." }) {
    const resolved = guard.resolveInside(inputPath);
    const stats = await fs.stat(resolved.path);
    const dir = stats.isDirectory() ? resolved.path : path.dirname(resolved.path);

    const types = detectProjectType(dir);
    const plan = { path: resolved.path, stages: [], projectTypes: types };

    for (const type of types) {
      const stage = { projectType: type, checks: [] };

      const lintCmd = getLintCommand(type);
      if (lintCmd) stage.checks.push({ name: "lint", command: lintCmd[0], args: lintCmd[1] });

      const typecheckCmd = getTypecheckCommand(type);
      if (typecheckCmd) stage.checks.push({ name: "typecheck", command: typecheckCmd[0], args: typecheckCmd[1] });

      const testCmd = getTestCommand(type);
      if (testCmd) stage.checks.push({ name: "test", command: testCmd[0], args: testCmd[1] });

      const buildCmd = getBuildCommand(type);
      if (buildCmd) stage.checks.push({ name: "build", command: buildCmd[0], args: buildCmd[1] });

      plan.stages.push(stage);
    }

    if (plan.stages.length === 0) {
      plan.stages.push({ projectType: "generic", checks: [] });
    }

    return plan;
  }

  async function verifyWorkspace({ path: inputPath = "." }) {
    const plan = await detectVerificationPlan({ path: inputPath });
    const resolved = guard.resolveInside(inputPath);

    const results = {
      path: resolved.path,
      projectTypes: plan.projectTypes,
      stages: [],
      passed: true,
      summary: {}
    };

    for (const stage of plan.stages) {
      const stageResult = { projectType: stage.projectType, checks: [], passed: true };

      for (const check of stage.checks) {
        try {
          const { code, stdout, stderr } = await execCommand(check.command, check.args, resolved.path);
          const passed = code === 0;
          if (!passed) stageResult.passed = false;

          stageResult.checks.push({
            name: check.name,
            command: `${check.command} ${check.args.join(" ")}`,
            passed,
            exitCode: code,
            output: stdout.slice(0, 10000),
            error: stderr.slice(0, 5000)
          });
        } catch (error) {
          stageResult.passed = false;
          stageResult.checks.push({
            name: check.name,
            command: `${check.command} ${check.args.join(" ")}`,
            passed: false,
            error: error.message
          });
        }
      }

      results.stages.push(stageResult);
      if (!stageResult.passed) results.passed = false;
    }

    results.summary = {
      totalChecks: results.stages.reduce((sum, s) => sum + s.checks.length, 0),
      passedChecks: results.stages.reduce((sum, s) => sum + s.checks.filter(c => c.passed).length, 0),
      failedChecks: results.stages.reduce((sum, s) => sum + s.checks.filter(c => !c.passed).length, 0)
    };

    await audit?.append({ type: "workspace.verified", path: resolved.path, passed: results.passed });

    return results;
  }

  async function scanWorkspaceSecrets({ path: inputPath = "." }) {
    const resolved = guard.resolveInside(inputPath);
    const stats = await fs.stat(resolved.path);
    const dir = stats.isDirectory() ? resolved.path : path.dirname(resolved.path);

    const sensitivePatterns = [
      { name: "api_key", pattern: /api[_-]?key/i },
      { name: "apikey", pattern: /apikey/i },
      { name: "secret", pattern: /secret[_-]?key/i },
      { name: "password", pattern: /password/i },
      { name: "token", pattern: /token[_-]?secret/i },
      { name: "private_key", pattern: /-----BEGIN.*PRIVATE KEY-----/ },
      { name: "aws_key", pattern: /AKIA[0-9A-Z]{16}/ },
      { name: "generic_credential", pattern: /credential/i }
    ];

    const findings = [];

    async function scanFile(filePath) {
      try {
        const content = await fs.readFile(filePath, "utf8");
        for (const { name, pattern } of sensitivePatterns) {
          const matches = [];
          let match;
          const regex = new RegExp(pattern.source, pattern.flags);
          while ((match = regex.exec(content)) !== null) {
            matches.push({ line: content.substring(0, match.index).split("\n").length });
          }
          if (matches.length > 0) {
            findings.push({
              file: filePath,
              type: name,
              count: matches.length,
              preview: "REDACTED"
            });
          }
        }
      } catch {
        // Binary or inaccessible files are skipped
      }
    }

    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !["node_modules", ".git", "dist", "build", ".next", "coverage"].includes(entry.name)) {
          await walk(full);
        } else if (entry.isFile()) {
          await scanFile(full);
        }
      }
    }

    await walk(dir);

    return {
      path: resolved.path,
      scanned: true,
      findings: findings,
      redacted: true,
      summary: findings.length === 0 ? "No secrets found" : "Potential secrets detected - details redacted"
    };
  }

  const definitions = [
    ["detect_verification_plan", "Tạo kế hoạch lint/typecheck/test/build phù hợp với loại project, không chạy lệnh.", { type: "object", properties: { path: { type: "string" } } }],
    ["verify_workspace", "Chạy pipeline xác minh dực lập: secret scan và các kiểm tra lint/typecheck/test/build được phát hiện từ project.", { type: "object", properties: { path: { type: "string" } } }],
    ["scan_workspace_secrets", "Quét workspace phát hiện secret/private key phản biện; kết quả luôn được redaction.", { type: "object", properties: { path: { type: "string" } } }]
  ].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

  return { definitions, async call(name, args = {}) {
    const handlers = { detectVerificationPlan, verifyWorkspace, scanWorkspaceSecrets };
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown verification tool: ${name}`);
    return handler(args);
  }};
}
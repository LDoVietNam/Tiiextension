import fs from "node:fs/promises";
import path from "node:path";

export function createProjectTools(guard, processTools) {
  async function handle(type, payload = {}) {
    switch (type) {
      case "project.detect":
        return detect(payload);
      case "project.summary":
        return summary(payload);
      case "project.package_info":
        return packageInfo(payload);
      case "project.scripts":
        return scripts(payload);
      case "project.dependencies":
        return dependencies(payload);
      case "project.run_script":
        return runScript(payload);
      case "project.test":
        return runScript({ ...payload, script: payload.script || "test" });
      case "project.build":
        return runScript({ ...payload, script: payload.script || "build" });
      case "project.lint":
        return runScript({ ...payload, script: payload.script || "lint" });
      case "project.typecheck":
        return runScript({ ...payload, script: payload.script || "typecheck" });
      default:
        throw new Error(`Unknown project tool: ${type}`);
    }
  }

  async function detect({ path: inputPath = "." } = {}) {
    const root = guard.resolveInside(inputPath).path;
    const markers = await markerFiles(root);
    return {
      path: root,
      type: detectType(markers),
      markers
    };
  }

  async function summary({ path: inputPath = "." } = {}) {
    const root = guard.resolveInside(inputPath).path;
    const markers = await markerFiles(root);
    let pkg = null;
    try {
      pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    } catch {
      // Ignore.
    }
    return {
      path: root,
      type: detectType(markers),
      package: pkg ? { name: pkg.name, version: pkg.version, scripts: Object.keys(pkg.scripts || {}), dependencies: Object.keys(pkg.dependencies || {}), devDependencies: Object.keys(pkg.devDependencies || {}) } : null,
      markers
    };
  }

  async function packageInfo({ path: inputPath = "." } = {}) {
    const root = guard.resolveInside(inputPath).path;
    const pkgPath = path.join(root, "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    return { path: pkgPath, package: pkg };
  }

  async function scripts({ path: inputPath = "." } = {}) {
    const info = await packageInfo({ path: inputPath });
    return { path: info.path, scripts: info.package.scripts || {} };
  }

  async function dependencies({ path: inputPath = "." } = {}) {
    const info = await packageInfo({ path: inputPath });
    return {
      path: info.path,
      dependencies: info.package.dependencies || {},
      devDependencies: info.package.devDependencies || {},
      peerDependencies: info.package.peerDependencies || {},
      optionalDependencies: info.package.optionalDependencies || {}
    };
  }

  async function runScript({ path: inputPath = ".", script, args = [], timeoutMs = 120000 }) {
    if (!script) throw new Error("script is required");
    const root = guard.resolveInside(inputPath).path;
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    if (!pkg.scripts?.[script]) throw new Error(`package.json script not found: ${script}`);
    const isWindows = process.platform === "win32";
    return processTools.run({
      command: isWindows ? "npm.cmd" : "npm",
      args: ["run", script, "--", ...args],
      cwd: root,
      timeoutMs
    });
  }

  return { handle };
}

async function markerFiles(root) {
  const candidates = ["package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "vite.config.js", "next.config.js", "tsconfig.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml"];
  const found = [];
  for (const name of candidates) {
    try {
      await fs.stat(path.join(root, name));
      found.push(name);
    } catch {
      // Missing marker.
    }
  }
  return found;
}

function detectType(markers) {
  if (markers.includes("package.json")) return "node";
  if (markers.includes("pyproject.toml") || markers.includes("requirements.txt")) return "python";
  if (markers.includes("go.mod")) return "go";
  if (markers.includes("Cargo.toml")) return "rust";
  return "unknown";
}

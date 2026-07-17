import fs from "node:fs/promises";
import path from "node:path";

const STORE_SCHEMA = "cnagent-store/1";

export function createDurableStore({ filePath }) {
  if (!filePath) throw new TypeError("filePath is required");
  let state = null;
  let writeQueue = Promise.resolve();

  async function init() {
    if (state) return clone(state);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      state = normalizeState(parsed);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = defaultState();
      await persist(state);
    }
    return clone(state);
  }

  async function snapshot() {
    await init();
    await writeQueue;
    return clone(state);
  }

  async function read(selector) {
    const value = await snapshot();
    return typeof selector === "function" ? selector(value) : value;
  }

  async function write(nextState) {
    return update((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, normalizeState(nextState));
      return draft;
    });
  }

  async function update(mutator) {
    if (typeof mutator !== "function") throw new TypeError("mutator must be a function");
    await init();
    const operation = writeQueue.then(async () => {
      const draft = clone(state);
      const result = await mutator(draft);
      const normalized = normalizeState(draft);
      await persist(normalized);
      state = normalized;
      return clone(result === undefined ? normalized : result);
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function persist(value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(temporary, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, filePath);
  }

  return { filePath, init, read, write, update, snapshot };
}

function defaultState() {
  return {
    schema: STORE_SCHEMA,
    tasks: {},
    calls: {},
    transactions: {},
    artifacts: {},
    events: [],
    nextCursor: 1
  };
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid durable store state");
  if (value.schema && value.schema !== STORE_SCHEMA) throw new Error(`Unsupported store schema: ${value.schema}`);
  return {
    ...defaultState(),
    ...value,
    schema: STORE_SCHEMA,
    tasks: objectOrEmpty(value.tasks),
    calls: objectOrEmpty(value.calls),
    transactions: objectOrEmpty(value.transactions),
    artifacts: objectOrEmpty(value.artifacts),
    events: Array.isArray(value.events) ? value.events : [],
    nextCursor: Number.isSafeInteger(value.nextCursor) && value.nextCursor > 0 ? value.nextCursor : 1
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}


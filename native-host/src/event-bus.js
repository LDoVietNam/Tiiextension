export function createEventBus({ store, maxEvents = 5000, clock = () => new Date().toISOString() }) {
  if (!store) throw new TypeError("store is required");
  const listeners = new Set();

  async function emit(type, data = {}, { taskId = null } = {}) {
    if (!type) throw new TypeError("event type is required");
    const event = await store.update((draft) => {
      const next = {
        cursor: draft.nextCursor++,
        at: clock(),
        type,
        ...(taskId ? { task_id: taskId } : {}),
        data: clone(data)
      };
      draft.events.push(next);
      if (draft.events.length > maxEvents) draft.events.splice(0, draft.events.length - maxEvents);
      return next;
    });
    for (const item of listeners) {
      if (matches(event, item.filters)) {
        try {
          item.listener(clone(event));
        } catch {
          // A subscriber cannot break event persistence or other subscribers.
        }
      }
    }
    return event;
  }

  async function list({ afterCursor = 0, taskId, types, limit = 1000 } = {}) {
    const state = await store.snapshot();
    const firstCursor = state.events[0]?.cursor ?? state.nextCursor;
    const selected = state.events
      .filter((event) => event.cursor > afterCursor)
      .filter((event) => !taskId || event.task_id === taskId)
      .filter((event) => !types?.length || types.includes(event.type))
      .slice(0, Math.max(1, Math.min(limit, 5000)));
    return {
      events: clone(selected),
      next_cursor: selected.at(-1)?.cursor ?? afterCursor,
      pruned: afterCursor < firstCursor - 1
    };
  }

  function subscribe(listener, filters = {}) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    const item = { listener, filters };
    listeners.add(item);
    return () => listeners.delete(item);
  }

  return { emit, list, subscribe };
}

function matches(event, filters) {
  if (filters.taskId && event.task_id !== filters.taskId) return false;
  if (filters.types?.length && !filters.types.includes(event.type)) return false;
  return true;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}


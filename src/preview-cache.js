const PREFIX = "daynote:week-preview:v1:";
export const SESSION_HINT = "daynote:session:v1";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
export const previewStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export function makeWeekPreview(
  uid,
  calendarId,
  start,
  calendars,
  tasks,
  now = Date.now(),
) {
  return {
    version: 1,
    uid,
    calendarId,
    start,
    savedAt: now,
    calendars: calendars.map(({ id, name, order, color, lists = [] }) => ({
      id,
      name,
      order: order ?? 0,
      color: color || "#71977e",
      lists: lists.map(({ id, name }) => ({ id, name })),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      text: task.text,
      date: task.date,
      done: !!task.done,
      color: task.color || "blank",
      freq: task.freq || 0,
      hasNote: !!(task.note || task.hasNote),
      isoDate: task.isoDate || null,
      checklist: (task.checklist || []).map(({ done }) => ({ done: !!done })),
    })),
  };
}

export function readWeekPreview(storage, uid, now = Date.now()) {
  try {
    if (!validId(uid)) return null;
    const raw = storage.getItem(PREFIX + uid);
    if (!raw || raw.length > 180000) return null;
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      value.uid !== uid ||
      !validId(value.calendarId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.start) ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > now + 60000 ||
      now - value.savedAt > MAX_AGE ||
      !Array.isArray(value.calendars) ||
      value.calendars.length > 100 ||
      !Array.isArray(value.tasks) ||
      value.tasks.length > 300 ||
      value.tasks.some(
        (t) =>
          !t ||
          !validId(t.id) ||
          typeof t.text !== "string" ||
          t.text.length > 10000 ||
          typeof t.done !== "boolean" ||
          !Array.isArray(t.checklist) ||
          t.checklist.some((i) => !i || typeof i.done !== "boolean"),
      ) ||
      value.calendars.some(
        (c) =>
          !c ||
          !validId(c.id) ||
          typeof c.name !== "string" ||
          !Array.isArray(c.lists) ||
          c.lists.some(
            (l) => !l || !validId(l.id) || typeof l.name !== "string",
          ),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function saveWeekPreview(storage, value) {
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= 180000 && value.tasks.length <= 300)
      storage.setItem(PREFIX + value.uid, raw);
  } catch {
    /* A full or unavailable cache must not prevent using the planner. */
  }
}

export function rememberSession(storage, uid) {
  try {
    const previous = storage.getItem(SESSION_HINT);
    if (uid) storage.setItem(SESSION_HINT, uid);
    else {
      storage.removeItem(SESSION_HINT);
      if (validId(previous)) storage.removeItem(PREFIX + previous);
    }
  } catch {
    /* Authentication remains authoritative when storage is unavailable. */
  }
}

export function hasRememberedSession(storage) {
  try {
    return validId(storage.getItem(SESSION_HINT));
  } catch {
    return false;
  }
}

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  serverTimestamp,
  waitForPendingWrites,
  terminate,
  clearIndexedDbPersistence,
} from "firebase/firestore";
import { app } from "./auth.js";
import {
  parseBackup,
  backupStats,
  materialize,
  validateTask,
} from "./domain.js";

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: 64 * 1024 * 1024,
  }),
});
const ref = (uid, kind, id) => doc(db, "users", uid, kind, id);
export async function ensureProfile(user) {
  const target = doc(db, "users", user.uid),
    existing = await getDoc(target);
  if (!existing.exists())
    await setDoc(target, {
      username: user.email.split("@")[0],
      displayName: user.displayName || user.email.split("@")[0],
      active: true,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      settings: { hideCompleted: false },
    });
  else if (existing.data().active)
    await updateDoc(target, { lastSeenAt: Date.now() });
}
export const watchProfile = (uid, next, error) =>
  onSnapshot(
    doc(db, "users", uid),
    (s) => next(s.exists() ? { id: s.id, ...s.data() } : null),
    error,
  );
export const watchAdmin = (uid, next) =>
  onSnapshot(
    doc(db, "admins", uid),
    (s) => next(s.exists()),
    () => next(false),
  );
export const watchUsers = (next, error) =>
  onSnapshot(
    collection(db, "users"),
    (s) => next(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    error,
  );
export const updateUser = (uid, patch) =>
  updateDoc(doc(db, "users", uid), patch);
export const watchCalendars = (uid, next, error) =>
  onSnapshot(
    collection(db, "users", uid, "calendars"),
    { includeMetadataChanges: true },
    (s) =>
      next(
        s.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .sort((a, b) => (a.order || 0) - (b.order || 0)),
        { cached: s.metadata.fromCache },
      ),
    error,
  );
export const watchTasks = (uid, next, error) =>
  onSnapshot(
    collection(db, "users", uid, "tasks"),
    { includeMetadataChanges: true },
    (s) =>
      next(
        s.docs.map((d) => ({ ...d.data(), id: d.id })),
        { cached: s.metadata.fromCache, pending: s.metadata.hasPendingWrites },
      ),
    error,
  );
export const saveCalendar = (uid, calendar) =>
  setDoc(ref(uid, "calendars", calendar.id), calendar);
export async function saveTask(uid, task, patch = {}) {
  const value = materialize(task, patch);
  validateTask(value);
  await setDoc(ref(uid, "tasks", value.id), value);
  return value;
}
export async function addTask(uid, task) {
  const value = {
    id: crypto.randomUUID(),
    text: "",
    done: false,
    note: "",
    color: "blank",
    date: null,
    listId: null,
    checklist: [],
    freq: 0,
    createdAt: Date.now(),
    order: Date.now(),
    ...task,
  };
  validateTask(value);
  await setDoc(ref(uid, "tasks", value.id), value);
  return value;
}
export async function patchTask(uid, task, patch) {
  if (task.virtual) return saveTask(uid, task, patch);
  return updateDoc(ref(uid, "tasks", task.id), {
    ...patch,
    updatedAt: Date.now(),
  });
}
export async function toggleTask(uid, task) {
  return patchTask(uid, task, { done: !task.done });
}
export const deleteTask = (uid, task) =>
  task.freq && !task.recurringTodoId && task.date
    ? saveTask(
        uid,
        {
          ...task,
          id: task.id + "_" + task.date.replaceAll("-", ""),
          recurringTodoId: task.id,
          isBase: false,
        },
        { deleted: true },
      )
    : patchTask(uid, task, { deleted: true });
export const restoreTask = (uid, task) =>
  patchTask(uid, task, { deleted: false, isBaseDeleted: false });
export async function editTask(uid, task, patch, scope = "single") {
  const baseId = task.recurringTodoId || task.id;
  if (task.freq && scope === "series") {
    const all = await getDocsFromServer(collection(db, "users", uid, "tasks"));
    const linked = all.docs.filter(
      (d) => d.id === baseId || d.data().recurringTodoId === baseId,
    );
    const seriesPatch = {
      text: patch.text,
      note: patch.note,
      color: patch.color,
      checklist: patch.checklist,
      freq: patch.freq,
      recurrence: patch.recurrence,
      ...("isMD" in patch ? { isMD: patch.isMD } : {}),
      updatedAt: Date.now(),
    };
    for (let i = 0; i < linked.length; i += 100) {
      const batch = writeBatch(db);
      for (const d of linked.slice(i, i + 100))
        batch.update(d.ref, seriesPatch);
      await batch.commit();
    }
    return;
  }
  if (
    task.freq &&
    !task.recurringTodoId &&
    task.date &&
    patch.freq === task.freq
  ) {
    return saveTask(
      uid,
      {
        ...task,
        id: task.id + "_" + task.date.replaceAll("-", ""),
        recurringTodoId: task.id,
        isBase: false,
      },
      patch,
    );
  }
  return task.virtual
    ? saveTask(uid, task, patch)
    : updateDoc(ref(uid, "tasks", task.id), patch);
}
export async function defaultCalendar(uid) {
  const calendar = {
    id: "personal",
    name: "나의 캘린더",
    order: 0,
    color: "#356650",
    lists: [
      { id: "someday", name: "언젠가" },
      { id: "ideas", name: "아이디어" },
      { id: "personal", name: "개인 메모" },
    ],
  };
  await saveCalendar(uid, calendar);
  return calendar;
}
export async function exportBackup(uid) {
  const [calendars, tasks] = await Promise.all([
    getDocsFromServer(collection(db, "users", uid, "calendars")),
    getDocsFromServer(collection(db, "users", uid, "tasks")),
  ]);
  return {
    version: 1,
    source: "daynote",
    exportedAt: new Date().toISOString(),
    calendars: calendars.docs.map((x) => ({ ...x.data(), id: x.id })),
    tasks: tasks.docs.map((x) => ({ ...x.data(), id: x.id })),
  };
}
export async function importBackup(uid, input, onProgress = () => {}) {
  const data = parseBackup(input);
  const raw = JSON.stringify(input),
    hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
      ),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  const [existingTasks, existingCalendars] = await Promise.all([
    getDocsFromServer(collection(db, "users", uid, "tasks")),
    getDocsFromServer(collection(db, "users", uid, "calendars")),
  ]);
  const taskMap = new Map(existingTasks.docs.map((d) => [d.id, d.data()])),
    calMap = new Map(existingCalendars.docs.map((d) => [d.id, d.data()]));
  const entries = [];
  let skipped = 0;
  for (const c of data.calendars) {
    if (calMap.has(c.id)) {
      if (calMap.get(c.id).importHash === hash) {
        skipped++;
        continue;
      }
      throw Error(
        "같은 ID의 캘린더가 이미 있습니다. 기존 자료를 보호하기 위해 가져오기를 중단했습니다.",
      );
    }
    entries.push(["calendars", c.id, { ...c, importHash: hash }]);
  }
  for (const t of data.tasks) {
    if (taskMap.has(t.id)) {
      if (taskMap.get(t.id).importHash === hash) {
        skipped++;
        continue;
      }
      throw Error(
        "같은 ID의 항목이 이미 있습니다. 기존 자료를 보호하기 위해 가져오기를 중단했습니다.",
      );
    }
    entries.push(["tasks", t.id, { ...t, importHash: hash }]);
  }
  const receipt = ref(uid, "imports", hash);
  await setDoc(receipt, {
    hash,
    status: "importing",
    startedAt: Date.now(),
    counts: backupStats(data),
    written: 0,
  });
  for (let i = 0; i < entries.length; i += 100) {
    const batch = writeBatch(db);
    for (const [kind, id, value] of entries.slice(i, i + 100))
      batch.set(ref(uid, kind, id), value);
    await batch.commit();
    const written = Math.min(i + 100, entries.length);
    onProgress({ written, total: entries.length, skipped });
    await updateDoc(receipt, { written });
  }
  await waitForPendingWrites(db);
  // Compare every source field against a fresh server read, including notes and deletion markers.
  const [savedTasks, savedCalendars] = await Promise.all([
    getDocsFromServer(collection(db, "users", uid, "tasks")),
    getDocsFromServer(collection(db, "users", uid, "calendars")),
  ]);
  const saved = new Map(savedTasks.docs.map((d) => [d.id, d.data()])),
    savedC = new Map(savedCalendars.docs.map((d) => [d.id, d.data()]));
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => equal(a[k], b[k]))
    );
  };
  for (const t of data.tasks) {
    const actual = saved.get(t.id);
    if (!actual || !Object.entries(t).every(([k, v]) => equal(v, actual[k])))
      throw Error("서버에서 항목 대조에 실패했습니다: " + t.id);
  }
  for (const c of data.calendars) {
    const actual = savedC.get(c.id);
    if (!actual || !Object.entries(c).every(([k, v]) => equal(v, actual[k])))
      throw Error("서버에서 캘린더 대조에 실패했습니다.");
  }
  const result = {
    hash,
    status: "verified",
    verifiedAt: Date.now(),
    counts: backupStats(data),
    written: entries.length,
    skipped,
  };
  await setDoc(receipt, result);
  return result;
}

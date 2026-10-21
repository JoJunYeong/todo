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
  connectFirestoreEmulator,
} from "firebase/firestore";
import { validateNoteImage, noteImageIds, imageId } from "./image-data.js";
import { app } from "./auth.js";
import {
  parseBackup,
  backupStats,
  materialize,
  validateTask,
  matchesBackupEntry,
  planBackupImport,
} from "./domain.js";

export const db =
  import.meta.hot?.data.db ||
  initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
      cacheSizeBytes: 64 * 1024 * 1024,
    }),
  });
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data.db = db;
  });
if (
  import.meta.env.VITE_FIREBASE_EMULATORS === "true" &&
  !import.meta.hot?.data.db
)
  connectFirestoreEmulator(db, "127.0.0.1", 18871);
const ref = (uid, kind, id) => doc(db, "users", uid, kind, id);
export async function ensureProfile(user) {
  const target = doc(db, "users", user.uid);
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if ((await getDoc(target)).exists()) return;
    throw Error("처음 접속할 때는 인터넷 연결이 필요해요.");
  }
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(target);
    if (!existing.exists())
      transaction.set(target, {
        username: user.email.split("@")[0],
        displayName: user.displayName || user.email.split("@")[0],
        active: true,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        settings: { hideCompleted: false },
      });
    else if (existing.data().active)
      transaction.update(target, { lastSeenAt: Date.now() });
  });
}
export const watchProfile = (uid, next, error) =>
  onSnapshot(
    doc(db, "users", uid),
    { includeMetadataChanges: true },
    (s) =>
      next(s.exists() ? { id: s.id, ...s.data() } : null, {
        cached: s.metadata.fromCache,
      }),
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
export async function saveNoteImage(uid, image) {
  validateNoteImage(image);
  await setDoc(ref(uid, "noteImages", image.id), image);
}
export async function getNoteImage(uid, id) {
  if (!imageId(id)) throw Error("이미지 ID가 올바르지 않습니다.");
  const value = await getDoc(ref(uid, "noteImages", id));
  if (!value.exists())
    throw Error(
      "이미지를 찾을 수 없어요. 백업에 이미지가 포함되어 있는지 확인해 주세요.",
    );
  return validateNoteImage({ ...value.data(), id: value.id });
}
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
  const values = tasks.docs.map((x) => ({ ...x.data(), id: x.id }));
  const imageIds = [...new Set(values.flatMap((t) => noteImageIds(t.note)))];
  const noteImages = await Promise.all(
    imageIds.map((id) => getNoteImage(uid, id)),
  );
  return {
    version: 1,
    source: "daynote",
    exportedAt: new Date().toISOString(),
    calendars: calendars.docs.map((x) => ({ ...x.data(), id: x.id })),
    tasks: values,
    ...(noteImages.length ? { noteImages } : {}),
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
  const existingImages = data.noteImages?.length
    ? await getDocsFromServer(collection(db, "users", uid, "noteImages"))
    : null;
  const { entries, skipped } = planBackupImport(
    data,
    existingTasks.docs.map((d) => ({ ...d.data(), id: d.id })),
    existingCalendars.docs.map((d) => ({ ...d.data(), id: d.id })),
    existingImages?.docs.map((d) => ({ ...d.data(), id: d.id })) || [],
  );
  const receipt = ref(uid, "imports", hash);
  await setDoc(receipt, {
    hash,
    status: "importing",
    startedAt: Date.now(),
    counts: backupStats(data),
    written: 0,
  });
  const batchSize = data.noteImages?.length ? 5 : 100;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = writeBatch(db);
    for (const [kind, id, value] of entries.slice(i, i + batchSize))
      batch.set(ref(uid, kind, id), { ...value, importHash: hash });
    await batch.commit();
    const written = Math.min(i + batchSize, entries.length);
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
  for (const t of data.tasks) {
    const actual = saved.get(t.id);
    if (!matchesBackupEntry(t, actual))
      throw Error("서버에서 항목 대조에 실패했습니다: " + t.id);
  }
  for (const c of data.calendars) {
    const actual = savedC.get(c.id);
    if (!matchesBackupEntry(c, actual))
      throw Error("서버에서 캘린더 대조에 실패했습니다.");
  }
  if (data.noteImages?.length) {
    const images = await getDocsFromServer(
      collection(db, "users", uid, "noteImages"),
    );
    const byId = new Map(images.docs.map((d) => [d.id, d.data()]));
    for (const image of data.noteImages)
      if (!matchesBackupEntry(image, byId.get(image.id)))
        throw Error("서버에서 이미지 대조에 실패했습니다.");
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

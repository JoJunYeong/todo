import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  writeBatch,
  setLogLevel,
  onSnapshot,
  getDocFromServer,
  disableNetwork,
  enableNetwork,
} from "firebase/firestore";
import { watchWithSync } from "../src/cloud-sync.js";
setLogLevel("silent");

// This suite must never connect to a real project or an unowned emulator.
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18871")
  throw Error(
    "Start the dedicated Daynote Firestore emulator on 127.0.0.1:18871.",
  );
let env;
const profile = (name) => ({
  username: name,
  displayName: name,
  active: true,
  createdAt: 1,
  lastSeenAt: 1,
  settings: { hideCompleted: false },
});
const task = (id) => ({
  id,
  calendarId: "personal",
  text: "Private task",
  done: false,
  date: "2026-10-21",
  note: "Sensitive note",
});
const user = (id, name = id) =>
  env
    .authenticatedContext(id, { email: name + "@users.daynote.invalid" })
    .firestore();
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-daynote-ein6xs",
    firestore: {
      host: "127.0.0.1",
      port: 18871,
      rules: fs.readFileSync(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", "alice"), profile("alice")),
      setDoc(doc(db, "users", "bob"), profile("bob")),
      setDoc(doc(db, "users", "admin"), profile("admin")),
      setDoc(doc(db, "admins", "admin"), { active: true }),
      setDoc(doc(db, "users", "alice", "tasks", "one"), task("one")),
    ]);
  });
});
test("unauthenticated callers cannot read or write any private data", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "users", "alice", "tasks", "one")));
  await assertFails(getDocs(collection(db, "users")));
  await assertFails(
    setDoc(doc(db, "users", "alice", "tasks", "two"), task("two")),
  );
});
test("an account can use only its own task paths", async () => {
  const db = user("alice");
  await assertSucceeds(getDoc(doc(db, "users", "alice", "tasks", "one")));
  await assertSucceeds(
    setDoc(doc(db, "users", "alice", "tasks", "two"), task("two")),
  );
  await assertFails(getDocs(collection(db, "users", "bob", "tasks")));
  await assertFails(
    setDoc(doc(db, "users", "bob", "tasks", "two"), task("two")),
  );
});
test("normal accounts cannot list users or grant themselves administrator access", async () => {
  const db = user("alice");
  await assertFails(getDocs(collection(db, "users")));
  await assertFails(setDoc(doc(db, "admins", "alice"), { active: true }));
  await assertFails(updateDoc(doc(db, "users", "alice"), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "users", "bob"), { active: false }));
});
test("registration binds username to the authenticated email and forbids extra privileges", async () => {
  const db = user("carol");
  await assertSucceeds(setDoc(doc(db, "users", "carol"), profile("carol")));
  const wrong = user("eve");
  await assertFails(setDoc(doc(wrong, "users", "eve"), profile("alice")));
  await assertFails(
    setDoc(doc(user("dave"), "users", "dave"), {
      ...profile("dave"),
      role: "admin",
    }),
  );
});
test("profile edits cannot change username, activation or creation date", async () => {
  const db = user("alice");
  await assertSucceeds(
    updateDoc(doc(db, "users", "alice"), {
      displayName: "새 이름",
      settings: { hideCompleted: true },
    }),
  );
  for (const patch of [
    { username: "bob" },
    { active: false },
    { createdAt: 999 },
  ])
    await assertFails(updateDoc(doc(db, "users", "alice"), patch));
});
test("administrators may manage account status but cannot read other accounts notes", async () => {
  const db = user("admin");
  await assertSucceeds(getDocs(collection(db, "users")));
  await assertSucceeds(updateDoc(doc(db, "users", "bob"), { active: false }));
  await assertFails(getDoc(doc(db, "users", "alice", "tasks", "one")));
  await assertFails(updateDoc(doc(db, "users", "admin"), { active: false }));
});
test("disabled accounts cannot read or write and cannot reenable themselves", async () => {
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "users", "alice"), { active: false }),
  );
  const db = user("alice");
  await assertSucceeds(getDoc(doc(db, "users", "alice")));
  await assertFails(getDoc(doc(db, "users", "alice", "tasks", "one")));
  await assertFails(
    setDoc(doc(db, "users", "alice", "tasks", "two"), task("two")),
  );
  await assertFails(updateDoc(doc(db, "users", "alice"), { active: true }));
  await assertFails(getDocs(collection(db, "users", "alice", "calendars")));
});
test("task IDs and basic types are validated on the server", async () => {
  const db = user("alice");
  await assertFails(
    setDoc(doc(db, "users", "alice", "tasks", "two"), task("wrong-id")),
  );
  await assertFails(
    setDoc(doc(db, "users", "alice", "tasks", "two"), {
      ...task("two"),
      done: "true",
    }),
  );
  await assertFails(
    setDoc(doc(db, "users", "alice", "tasks", "two"), {
      ...task("two"),
      note: { secret: "value" },
    }),
  );
});
test("batch imports stay within authorization checks and preserve note contents", async () => {
  const db = user("alice"),
    batch = writeBatch(db);
  for (let i = 0; i < 100; i++)
    batch.set(
      doc(db, "users", "alice", "tasks", "batch-" + i),
      task("batch-" + i),
    );
  await assertSucceeds(batch.commit());
  const result = await assertSucceeds(
    getDoc(doc(db, "users", "alice", "tasks", "batch-99")),
  );
  assert.equal(result.data().note, "Sensitive note");
});
test("unknown collection names and cross-user import receipts remain private", async () => {
  const db = user("alice");
  await assertFails(
    setDoc(doc(db, "users", "alice", "permissions", "one"), { admin: true }),
  );
  await assertFails(getDocs(collection(db, "users", "bob", "imports")));
  await assertSucceeds(
    setDoc(doc(db, "users", "alice", "imports", "one"), { status: "verified" }),
  );
});
test("two clients of the same account remain connected and see each other's edits", async () => {
  const first = user("alice"), second = user("alice");
  const target = doc(first, "users", "alice", "tasks", "one");
  let stop;
  try {
    const changed = new Promise((resolve, reject) => {
      stop = onSnapshot(doc(second, "users", "alice", "tasks", "one"), (snapshot) => {
        if (snapshot.data()?.text === "Changed on first device") resolve();
      }, reject);
    });
    await updateDoc(target, { text: "Changed on first device" });
    await changed;
    await updateDoc(doc(second, "users", "alice", "tasks", "one"), { done: true });
    const latest = await getDocFromServer(target);
    assert.equal(latest.data().done, true);
    assert.equal(latest.data().text, "Changed on first device");
    await updateDoc(doc(second, "users", "alice"), { "settings.hideCompleted": true });
    assert.equal((await getDocFromServer(doc(first, "users", "alice"))).data().settings.hideCompleted, true);
  } finally { stop?.(); }
});
test("an offline client's queued field edit preserves another device's unrelated change", async () => {
  const first = user("alice"), second = user("alice");
  const target = doc(second, "users", "alice", "tasks", "one");
  await getDocFromServer(target);
  await disableNetwork(second);
  const pending = updateDoc(target, { note: "Offline draft" });
  try {
    await updateDoc(doc(first, "users", "alice", "tasks", "one"), { text: "Remote title" });
  } finally { await enableNetwork(second); }
  await pending;
  const value = (await getDocFromServer(target)).data();
  assert.equal(value.note, "Offline draft");
  assert.equal(value.text, "Remote title");
});
test("a denied listener recovers after access is restored without weakening the rules", { timeout: 10000 }, async () => {
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), "users", "alice"), { active: false }));
  const db = user("alice");
  let denied, recovered;
  const deniedPromise = new Promise((resolve) => { denied = resolve; });
  const recoveredPromise = new Promise((resolve) => { recovered = resolve; });
  const stop = watchWithSync((next, error) => onSnapshot(doc(db, "users", "alice", "tasks", "one"), next, error),
    (snapshot) => { if (!snapshot.metadata.fromCache && snapshot.exists()) recovered(); },
    (error) => { if (error.code === "permission-denied") denied(); }, { interval: 100 });
  try {
    await deniedPromise;
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), "users", "alice"), { active: true }));
    await recoveredPromise;
  } finally { stop(); }
});
const capture = () => ({
  id: "capture",
  contentType: "image/png",
  data: "data:image/png;base64,iVBORw0KGgo=",
  width: 100,
  height: 100,
  createdAt: 1,
});
test("note images are private to active owners, including from administrators", async () => {
  const db = user("alice"),
    target = doc(db, "users", "alice", "noteImages", "capture");
  await assertSucceeds(setDoc(target, capture()));
  await assertSucceeds(getDoc(target));
  for (const other of [
    user("bob"),
    user("admin"),
    env.unauthenticatedContext().firestore(),
  ])
    await assertFails(
      getDoc(doc(other, "users", "alice", "noteImages", "capture")),
    );
  await assertFails(
    setDoc(doc(db, "users", "bob", "noteImages", "capture"), capture()),
  );
});
test("image rules reject mismatched IDs, non-images, oversized data and extra fields", async () => {
  const target = doc(user("alice"), "users", "alice", "noteImages", "capture");
  for (const patch of [
    { id: "other" },
    { contentType: "image/svg+xml", data: "data:image/svg+xml;base64,AAAA" },
    { data: "data:image/jpeg;base64,AAAA" },
    { data: "data:image/png;base64," + "a".repeat(660000) },
    { width: 2561 },
    { height: 0 },
    { privateAccess: true },
  ])
    await assertFails(setDoc(target, { ...capture(), ...patch }));
});
test("image retries preserve original bytes and suspended owners lose access", async () => {
  const db = user("alice"),
    target = doc(db, "users", "alice", "noteImages", "capture");
  await assertSucceeds(setDoc(target, capture()));
  await assertSucceeds(setDoc(target, capture()));
  await assertSucceeds(updateDoc(target, { importHash: "backup" }));
  await assertFails(updateDoc(target, { data: "data:image/png;base64,BBBB" }));
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "users", "alice"), { active: false }),
  );
  await assertFails(getDoc(target));
  await assertFails(setDoc(target, capture()));
});

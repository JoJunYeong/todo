import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDocFromServer, onSnapshot } from "firebase/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18871" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:19099")
  throw Error("Start the dedicated local Daynote Auth and Firestore emulators.");

test("independent sign-ins with the same credentials keep both sessions and synchronize both ways", { timeout: 15000 }, async () => {
  const nonce = randomBytes(6).toString("hex"), username = `sync_${nonce}`;
  const email = `${username}@users.daynote.invalid`, password = randomBytes(16).toString("hex");
  const apps = ["first", "second"].map((name) => initializeApp({ apiKey: "demo-daynote", projectId: "demo-daynote-ein6xs" }, `${name}-${nonce}`));
  const clients = apps.map((app) => {
    const auth = getAuth(app), db = getFirestore(app);
    connectAuthEmulator(auth, "http://127.0.0.1:19099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 18871);
    return { auth, db };
  });
  let stop;
  try {
    const [first, second] = clients;
    const { user } = await createUserWithEmailAndPassword(first.auth, email, password);
    await setDoc(doc(first.db, "users", user.uid), { username, displayName: "Sync test", active: true, settings: {} });
    await signInWithEmailAndPassword(second.auth, email, password);
    assert.equal(first.auth.currentUser.uid, second.auth.currentUser.uid);
    await first.auth.currentUser.getIdToken(true);
    const path = ["users", user.uid, "tasks", "one"];
    const received = new Promise((resolve, reject) => {
      stop = onSnapshot(doc(second.db, ...path), (snapshot) => {
        if (snapshot.data()?.text === "First device") resolve();
      }, reject);
    });
    await setDoc(doc(first.db, ...path), { id: "one", text: "First device", done: false, calendarId: "personal" });
    await received;
    await updateDoc(doc(second.db, ...path), { note: "Second device" });
    const latest = (await getDocFromServer(doc(first.db, ...path))).data();
    assert.equal(latest.text, "First device");
    assert.equal(latest.note, "Second device");
    assert.equal(first.auth.currentUser.uid, user.uid);
    assert.equal(second.auth.currentUser.uid, user.uid);
  } finally {
    stop?.();
    if (clients[0].auth.currentUser) await deleteUser(clients[0].auth.currentUser);
    await Promise.all(apps.map(deleteApp));
  }
});

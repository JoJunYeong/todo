import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  inMemoryPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  connectAuthEmulator,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocsFromServer,
  getDocFromServer,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { app, auth } from "./auth.js";
import { db } from "./store.js";

function owner(uid) {
  if (!uid || auth.currentUser?.uid !== uid)
    throw Error("로그인한 계정을 다시 확인해 주세요.");
}
export async function listAiConnections(uid) {
  owner(uid);
  const rows = await getDocsFromServer(
    collection(db, "users", uid, "aiConnections"),
  );
  return rows.docs
    .map((row) => ({ id: row.id, ...row.data() }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function issueAiConnection(
  uid,
  { name, write = false, days = 90 },
) {
  owner(uid);
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80 ||
    typeof write !== "boolean" ||
    ![7, 30, 90, 365].includes(days)
  )
    throw Error("연결 이름과 유효 기간을 확인해 주세요.");
  const secondary = initializeApp(
    app.options,
    "daynote-ai-" + crypto.randomUUID(),
  );
  let agent,
    granted = false;
  try {
    const secondaryAuth = getAuth(secondary);
    if (import.meta.env.VITE_FIREBASE_EMULATORS === "true")
      connectAuthEmulator(secondaryAuth, "http://127.0.0.1:19099", {
        disableWarnings: true,
      });
    await setPersistence(secondaryAuth, inMemoryPersistence);
    const random = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    ({ user: agent } = await createUserWithEmailAndPassword(
      secondaryAuth,
      "agent-" + crypto.randomUUID() + "@agents.daynote.invalid",
      random,
    ));
    owner(uid);
    const connection = {
      name: name.trim(),
      scopes: write ? ["read", "write"] : ["read"],
      createdAt: Date.now(),
      expiresAt: Date.now() + days * 86400000,
      revoked: false,
    };
    const ref = doc(db, "users", uid, "aiConnections", agent.uid);
    await setDoc(ref, connection);
    granted = true;
    const saved = await getDocFromServer(ref);
    if (!saved.exists() || saved.data().createdAt !== connection.createdAt)
      throw Error("AI 연결 저장 결과를 확인하지 못했어요.");
    return {
      connection: { id: agent.uid, ...connection },
      credentials: {
        version: 1,
        projectId: app.options.projectId,
        apiKey: app.options.apiKey,
        ownerUid: uid,
        agentUid: agent.uid,
        refreshToken: agent.refreshToken,
        ...(import.meta.env.VITE_FIREBASE_EMULATORS === "true"
          ? { emulator: true }
          : {}),
      },
    };
  } catch (error) {
    if (agent && !granted) await deleteUser(agent).catch(() => {});
    throw error;
  } finally {
    await deleteApp(secondary);
  }
}
export async function revokeAiConnection(uid, agentUid) {
  owner(uid);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentUid || ""))
    throw Error("AI 연결을 확인해 주세요.");
  const ref = doc(db, "users", uid, "aiConnections", agentUid);
  await updateDoc(ref, { revoked: true });
  if (!(await getDocFromServer(ref)).data()?.revoked)
    throw Error("폐기 결과를 확인하지 못했어요.");
}

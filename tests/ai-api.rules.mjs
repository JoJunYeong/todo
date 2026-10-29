import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  updateDoc,
  getDocFromServer,
  setLogLevel,
} from "firebase/firestore";
import { DaynoteClient, encodeFields } from "../public/daynote-ai.mjs";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18871" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:19099"
)
  throw Error("Use the dedicated Daynote Auth and Firestore emulators.");
setLogLevel("silent");
const projectId = "demo-daynote-ein6xs",
  apiKey = "demo-daynote",
  nonce = randomBytes(6).toString("hex");
const denied = (promise) =>
  assert.rejects(promise, (e) => e.code === "PERMISSION_DENIED");

test(
  "delegated HTTPS API with real Auth tokens and deployed security rules",
  { timeout: 60000 },
  async (t) => {
    const env = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: "127.0.0.1",
        port: 18871,
        rules: fs.readFileSync(
          new URL("../firestore.rules", import.meta.url),
          "utf8",
        ),
      },
    });
    const apps = [];
    async function actor(label) {
      const app = initializeApp({ apiKey, projectId }, label + nonce);
      apps.push(app);
      const auth = getAuth(app),
        db = getFirestore(app);
      connectAuthEmulator(auth, "http://127.0.0.1:19099", {
        disableWarnings: true,
      });
      connectFirestoreEmulator(db, "127.0.0.1", 18871);
      const { user } = await createUserWithEmailAndPassword(
        auth,
        `${label}-${nonce}@users.daynote.invalid`,
        randomBytes(24).toString("hex"),
      );
      return { user, db };
    }
    try {
      const owner = await actor("owner"),
        agent = await actor("agent"),
        stranger = await actor("stranger");
      const uid = owner.user.uid,
        aid = agent.user.uid;
      const profile = (who) => ({
        username: who.user.email.split("@")[0],
        displayName: "API test",
        active: true,
        settings: {},
      });
      await setDoc(doc(owner.db, "users", uid), profile(owner));
      await setDoc(
        doc(stranger.db, "users", stranger.user.uid),
        profile(stranger),
      );
      await setDoc(doc(owner.db, "users", uid, "calendars", "personal"), {
        id: "personal",
        name: "Personal",
        color: "blank",
        lists: [],
        order: 0,
      });
      const grant = doc(owner.db, "users", uid, "aiConnections", aid);
      const connection = {
        name: "test agent",
        scopes: ["read", "write"],
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        revoked: false,
      };
      await setDoc(grant, connection);
      const client = new DaynoteClient({
        version: 1,
        apiKey,
        projectId,
        ownerUid: uid,
        agentUid: aid,
        refreshToken: agent.user.refreshToken,
        emulator: true,
      });
      let saved;
      const original = {
        requestId: "create-sample-001",
        text: "보드 시험 설계 초안",
        calendarId: "personal",
        date: "2026-10-29",
        note: "계획만 저장. 실제 시험은 미수행.\n<script>data only</script>",
      };
      await t.test(
        "refresh token authenticates only the delegated principal",
        async () => {
          const status = await client.status();
          assert.deepEqual(status.scopes, ["read", "write"]);
          assert.equal(status.serverVerified, true);
          const mismatched = new DaynoteClient({
            ...client.config,
            agentUid: "wrong-agent",
          });
          await assert.rejects(
            mismatched.status(),
            (e) => e.code === "UNAUTHENTICATED",
          );
          assert.equal(
            (await client.listCalendars()).calendars[0].id,
            "personal",
          );
        },
      );
      await t.test(
        "create and repeated request commit once, with server readback",
        async () => {
          const first = await client.createTask(original);
          saved = first.task;
          assert.equal(first.serverVerified, true);
          assert.equal(first.replayed, false);
          assert.equal(saved.done, false);
          assert.equal(saved.note, original.note);
          assert.ok(saved.noteHtml.includes("&lt;script&gt;"));
          const repeated = await client.createTask(original);
          assert.equal(repeated.replayed, true);
          assert.equal(repeated.task.id, saved.id);
          assert.equal(
            (await client.listTasks({ includeDeleted: true })).tasks.length,
            1,
          );
          await assert.rejects(
            client.createTask({ ...original, text: "different" }),
            (e) => e.code === "IDEMPOTENCY_CONFLICT",
          );
        },
      );
      await t.test(
        "simultaneous retries produce one task and one receipt",
        async () => {
          const args = {
            ...original,
            requestId: "concurrent-create-001",
            text: "Concurrent",
          };
          const results = await Promise.all([
            client.createTask(args),
            client.createTask(args),
          ]);
          assert.equal(results[0].task.id, results[1].task.id);
          assert.equal(
            (await client.listTasks({ query: "Concurrent" })).tasks.length,
            1,
          );
        },
      );
      await t.test(
        "partial updates preserve legacy fields and reject stale revisions",
        async () => {
          await updateDoc(doc(owner.db, "users", uid, "tasks", saved.id), {
            opaqueLegacyField: { preserved: true },
            note: '<p><strong>기존 서식</strong><img src="daynote-image:retained"></p>',
          });
          const stale = saved.revision;
          saved = await client.getTask({ taskId: saved.id });
          await assert.rejects(
            client.updateTask({
              requestId: "stale-update-001",
              taskId: saved.id,
              revision: stale,
              patch: { done: true },
            }),
            (e) => ["FAILED_PRECONDITION", "ABORTED"].includes(e.code),
          );
          const appended = await client.appendNote({
            requestId: "append-sample-001",
            taskId: saved.id,
            revision: saved.revision,
            note: "시험은 아직 안 함",
          });
          assert.ok(appended.task.noteHtml.startsWith(saved.noteHtml + "<hr>"));
          const latest = await getDocFromServer(
            doc(owner.db, "users", uid, "tasks", saved.id),
          );
          assert.deepEqual(latest.data().opaqueLegacyField, {
            preserved: true,
          });
          const result = await client.updateTask({
            requestId: "complete-sample-001",
            taskId: saved.id,
            revision: appended.task.revision,
            patch: { done: true, date: "2026-10-30" },
          });
          saved = result.task;
          assert.equal(saved.done, true);
          assert.equal(saved.date, "2026-10-30");
        },
      );
      await t.test(
        "pagination searches all pages without treating empty matches as completion",
        async () => {
          let pageToken,
            count = 0,
            pages = 0;
          do {
            const page = await client.listTasks({
              pageSize: 1,
              pageToken,
              query: "보드",
            });
            count += page.tasks.length;
            pages++;
            pageToken = page.nextPageToken;
          } while (pageToken);
          assert.equal(count, 1);
          assert.ok(pages >= 2);
        },
      );
      await t.test(
        "raw HTTP cannot access profiles, other owners, images, imports, grants, or permanent deletion",
        async () => {
          for (const path of [
            client.userPath,
            `${client.root}/users/${stranger.user.uid}/tasks`,
            client.userPath + "/noteImages",
            client.userPath + "/imports",
            client.userPath + "/aiConnections",
            `${client.root}/admins/${uid}`,
          ])
            await denied(client._request(path));
          await denied(
            client._request(client.connectionPath, {
              method: "PATCH",
              body: {
                fields: encodeFields({
                  ...connection,
                  scopes: ["read", "write", "admin"],
                }),
              },
            }),
          );
          await denied(
            client._request(client.userPath + "/tasks/" + saved.id, {
              method: "DELETE",
            }),
          );
          const receiptPath =
            client.connectionPath +
            "/requests/" +
            createHash("sha256").update(original.requestId).digest("hex");
          assert.ok((await client._request(receiptPath)).fields);
          await denied(client._request(receiptPath, { method: "DELETE" }));
          await denied(
            client._request(receiptPath + "?updateMask.fieldPaths=taskId", {
              method: "PATCH",
              body: { fields: encodeFields({ taskId: "replacement" }) },
            }),
          );
          await denied(
            client._request(
              client.userPath +
                "/tasks/" +
                saved.id +
                "?updateMask.fieldPaths=freq",
              { method: "PATCH", body: { fields: encodeFields({ freq: 7 }) } },
            ),
          );
          await assert.rejects(
            client.createTask({
              ...original,
              requestId: "unknown-calendar-001",
              calendarId: "missing",
            }),
            (e) => e.code === "PERMISSION_DENIED",
          );
        },
      );
      await t.test(
        "read-only, revocation, expiry, and disabled-owner checks apply to every request",
        async () => {
          await updateDoc(grant, { scopes: ["read"] });
          assert.equal(
            (await client.getTask({ taskId: saved.id })).id,
            saved.id,
          );
          await denied(
            client.createTask({
              ...original,
              requestId: "readonly-create-001",
            }),
          );
          await updateDoc(grant, { revoked: true });
          await denied(client.status());
          await denied(client.listTasks());
          await updateDoc(grant, { ...connection, revoked: false });
          await env.withSecurityRulesDisabled((c) =>
            updateDoc(doc(c.firestore(), "users", uid, "aiConnections", aid), {
              expiresAt: Date.now() - 1,
            }),
          );
          await denied(client.listTasks());
          // Even expired connections remain revocable by their owner.
          await updateDoc(grant, { revoked: true });
          await updateDoc(grant, { ...connection, revoked: false });
          await env.withSecurityRulesDisabled((c) =>
            updateDoc(doc(c.firestore(), "users", uid), { active: false }),
          );
          await denied(client.listCalendars());
          await env.withSecurityRulesDisabled((c) =>
            updateDoc(doc(c.firestore(), "users", uid), { active: true }),
          );
          await updateDoc(grant, { revoked: true });
        },
      );
    } finally {
      await Promise.all(apps.map(deleteApp));
      await env.cleanup();
    }
  },
);

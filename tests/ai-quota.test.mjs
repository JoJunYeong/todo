import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DaynoteClient, DaynoteError, createFileOutbox, dispatch, encodeFields, quotaRetryAt } from "../public/daynote-ai.mjs";

const config = { version: 1, projectId: "demo-daynote-ein6xs", ownerUid: "owner", agentUid: "agent", apiKey: "demo", refreshToken: "test-only", emulator: true };
const root = "projects/demo-daynote-ein6xs/databases/(default)/documents/users/owner/tasks/";
const document = (id, date) => ({ name: root + id, fields: encodeFields({ id, date, text: id, note: "", done: false, calendarId: "work" }), updateTime: "2026-11-04T00:00:00Z" });
const transport = (respond) => async (url, options) => String(url).includes("/token?")
  ? Response.json({ id_token: "test", user_id: "agent", expires_in: 3600 }) : respond(String(url), options);

test("quota retry follows Pacific midnight in winter, summer and the DST transition", () => {
  assert.equal(quotaRetryAt(Date.parse("2026-11-04T05:00:00Z")), "2026-11-04T08:05:00.000Z");
  assert.equal(quotaRetryAt(Date.parse("2026-06-04T05:00:00Z")), "2026-06-04T07:05:00.000Z");
  assert.equal(quotaRetryAt(Date.parse("2026-11-01T07:30:00Z")), "2026-11-02T08:05:00.000Z");
});

test("date queries send indexed bounds and paginate without scanning unrelated tasks", async () => {
  const calls = [];
  const client = new DaynoteClient(config, { fetch: transport((url, options) => {
    assert.ok(url.endsWith("/users/owner:runQuery"));
    const q = JSON.parse(options.body).structuredQuery;
    calls.push(q);
    return Response.json(q.startAt ? [] : [{ document: document("one", "2026-11-04") }]);
  }) });
  const args = { from: "2026-11-04", to: "2026-11-04", calendarId: "work", pageSize: 1 };
  const first = await client.listTasks(args);
  assert.equal(first.scanned, 1);
  assert.equal(first.tasks[0].id, "one");
  assert.ok(first.nextPageToken.startsWith("dnq1:"));
  assert.deepEqual(calls[0].where.compositeFilter.filters.map((f) => f.fieldFilter.op), ["GREATER_THAN_OR_EQUAL", "LESS_THAN_OR_EQUAL"]);
  assert.equal(calls[0].where.compositeFilter.filters[0].fieldFilter.field.fieldPath, "date");
  const last = await client.listTasks({ ...args, pageToken: first.nextPageToken });
  assert.equal(last.complete, true);
  assert.deepEqual(calls[1].startAt.values, [{ stringValue: "2026-11-04" }, { referenceValue: root + "one" }]);
  assert.equal(calls[1].startAt.before, false);
  await assert.rejects(client.listTasks({ ...args, from: "2026-11-03", pageToken: first.nextPageToken }), /검색 조건/);
  assert.equal(calls.length, 2);
});

test("calendar and done filters use one field, and native in-flight cursors remain valid", async () => {
  const calls = [];
  const client = new DaynoteClient(config, { fetch: transport((url, options) => {
    calls.push({ url, body: options.body && JSON.parse(options.body) });
    return Response.json(options.body ? [] : { documents: [], nextPageToken: "legacy-next" });
  }) });
  await client.listTasks({ calendarId: "work", done: true });
  assert.equal(calls[0].body.structuredQuery.where.fieldFilter.field.fieldPath, "calendarId");
  await client.listTasks({ done: false });
  assert.deepEqual(calls[1].body.structuredQuery.where.fieldFilter.value, { booleanValue: false });
  const legacy = await client.listTasks({ from: "2026-11-04", pageToken: "native/page+=" });
  assert.equal(new URL(calls[2].url).searchParams.get("pageToken"), "native/page+=");
  assert.equal(legacy.nextPageToken, "legacy-next");
});

test("quota errors expose retry time without silently repeating the request", async () => {
  let calls = 0;
  const client = new DaynoteClient(config, { now: () => Date.parse("2026-11-04T05:00:00Z"), fetch: transport(() => {
    calls++;
    return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
  }) });
  await assert.rejects(client.status(), (e) => e.code === "RESOURCE_EXHAUSTED" && e.retryAt === "2026-11-04T08:05:00.000Z");
  assert.equal(calls, 1);
});

const withOutbox = async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "daynote-outbox-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let now = Date.parse("2026-11-04T05:00:00Z");
  const outbox = await createFileOutbox(config, directory, { now: () => now });
  return { directory, outbox, advance: (value) => { now = Date.parse(value); } };
};
const args = { requestId: "recovery-20261104-test", calendarId: "work", text: "draft", note: "preserve this draft" };

test("failed mutations survive restart privately and only replay once due, preserving exact arguments", async (t) => {
  const { directory, outbox, advance } = await withOutbox(t);
  const failure = Object.assign(new DaynoteError("quota", 429, "RESOURCE_EXHAUSTED"), { retryAt: "2026-11-04T08:05:00.000Z" });
  const client = { createTask: async () => { throw failure; }, onMutationError: (...args) => outbox.capture(...args) };
  await assert.rejects(dispatch(client, "createTask", args), (e) => e.queued === true);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  const file = path.join(directory, files[0]);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.ok(!(await fs.readFile(file, "utf8")).includes(config.refreshToken));
  let calls = 0;
  const restored = await createFileOutbox(config, directory, { now: () => Date.parse("2026-11-04T08:06:00Z") });
  const replay = { createTask: async (input) => { calls++; assert.deepEqual(input, args); return { serverVerified: true, task: { id: "saved", revision: "revision" } }; } };
  assert.equal((await outbox.retry(replay)).pending, 1);
  assert.equal(calls, 0);
  assert.equal((await restored.retry(replay)).saved, 1);
  assert.equal((await restored.retry(replay)).saved, 0);
  assert.equal(calls, 1);
  const receipt = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(receipt.state, "saved");
  assert.equal(receipt.result.serverVerified, true);
  assert.ok(!("args" in receipt));
});

test("concurrent captures preserve one original draft across independent processes", async (t) => {
  const { directory, outbox } = await withOutbox(t);
  const second = await createFileOutbox(config, directory);
  const error = new DaynoteError("quota", 429, "RESOURCE_EXHAUSTED");
  const results = await Promise.allSettled([
    outbox.capture("createTask", args, error),
    second.capture("createTask", { ...args, text: "other content" }, error),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await fs.readdir(directory)).length, 1);
});

test("request identity conflicts preserve the first draft and stale revisions never overwrite", async (t) => {
  const { outbox, advance } = await withOutbox(t);
  const e = Object.assign(new DaynoteError("offline", 503, "UNAVAILABLE"), { retryAt: "2026-11-04T05:01:00.000Z" });
  const change = { taskId: "one", requestId: "stale-recovery-request", revision: "2026-11-03T00:00:00Z", patch: { note: "preserved" } };
  await outbox.capture("updateTask", change, e);
  await assert.rejects(outbox.capture("updateTask", { ...change, patch: { note: "different" } }, e), (e) => e.code === "IDEMPOTENCY_CONFLICT");
  advance("2026-11-04T05:02:00Z");
  let calls = 0;
  const client = { updateTask: async (input) => { calls++; assert.deepEqual(input, change); throw new DaynoteError("stale", 409, "FAILED_PRECONDITION"); } };
  assert.equal((await outbox.retry(client)).blocked, 1);
  assert.equal((await outbox.retry(client)).blocked, 1);
  assert.equal(calls, 1);
});

test("read errors and deterministic invalid or denied mutations are never queued", async (t) => {
  const { directory, outbox } = await withOutbox(t);
  for (const code of ["INVALID_ARGUMENT", "PERMISSION_DENIED", "IDEMPOTENCY_CONFLICT"]) {
    assert.deepEqual(await outbox.capture("createTask", args, new DaynoteError("denied", 403, code)), {});
  }
  assert.deepEqual(await outbox.capture("getTask", args, new DaynoteError("quota", 429, "RESOURCE_EXHAUSTED")), {});
  assert.deepEqual(await fs.readdir(directory), []);
});

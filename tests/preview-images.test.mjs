import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeWeekPreview,
  readWeekPreview,
  saveWeekPreview,
  rememberSession,
  hasRememberedSession,
} from "../src/preview-cache.js";
import {
  validateNoteImage,
  noteImageIds,
  IMAGE_DATA_LIMIT,
} from "../src/image-data.js";
import {
  parseBackup,
  planBackupImport,
  backupStats,
  searchTasks,
  buildSearchIndex,
} from "../src/domain.js";

const storage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const calendar = {
  id: "personal",
  name: "Calendar",
  lists: [{ id: "someday", name: "Later" }],
};
const task = {
  id: "one",
  text: "회의 준비",
  done: false,
  color: "blank",
  calendarId: "personal",
  date: "2026-10-21",
  note: "<p>private note</p>",
  checklist: [{ id: "c1", text: "private checklist", done: true }],
  freq: 0,
};
const image = {
  id: "capture_1",
  contentType: "image/png",
  data: "data:image/png;base64,iVBORw0KGgo=",
  width: 100,
  height: 100,
  createdAt: 1,
};
const preview = () =>
  makeWeekPreview("alice", "personal", "2026-10-19", [calendar], [task], 1000);
const backup = () => ({
  version: 1,
  source: "daynote",
  calendars: [calendar],
  tasks: [
    { ...task, note: '<p>Capture</p><img data-daynote-image="capture_1">' },
  ],
  noteImages: [image],
});

test("week preview keeps display metadata but excludes notes, checklist text and image bytes", () => {
  const value = preview(),
    encoded = JSON.stringify(value);
  assert.equal(value.tasks[0].hasNote, true);
  assert.deepEqual(value.tasks[0].checklist, [{ done: true }]);
  assert.ok(
    !encoded.includes("private note") &&
      !encoded.includes("private checklist") &&
      !encoded.includes("data:image/"),
  );
});
test("preview is scoped by authenticated UID and expires", () => {
  const s = storage();
  saveWeekPreview(s, preview());
  assert.equal(readWeekPreview(s, "alice", 2000).tasks.length, 1);
  assert.equal(readWeekPreview(s, "bob", 2000), null);
  assert.equal(readWeekPreview(s, "alice", 8 * 86400000), null);
});
test("corrupt and malformed cache records are ignored rather than rendered", () => {
  const s = storage();
  for (const value of [
    "not json",
    JSON.stringify({ ...preview(), uid: "bob" }),
    JSON.stringify({
      ...preview(),
      tasks: [{ ...preview().tasks[0], checklist: [null] }],
    }),
    JSON.stringify({
      ...preview(),
      calendars: [{ ...calendar, lists: [null] }],
    }),
  ]) {
    s.setItem("daynote:week-preview:v1:alice", value);
    assert.equal(readWeekPreview(s, "alice", 2000), null);
  }
});
test("cache quota or storage denial cannot break the planner", () => {
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("full");
    },
    removeItem() {
      throw Error("denied");
    },
  };
  assert.doesNotThrow(() => saveWeekPreview(denied, preview()));
  assert.equal(readWeekPreview(denied, "alice"), null);
  assert.doesNotThrow(() => rememberSession(denied, "alice"));
  assert.equal(hasRememberedSession(denied), false);
});
test("logout clears the previous user's preview and preload hint", () => {
  const s = storage();
  saveWeekPreview(s, preview());
  rememberSession(s, "alice");
  assert.equal(hasRememberedSession(s), true);
  rememberSession(s, null);
  assert.equal(hasRememberedSession(s), false);
  assert.equal(readWeekPreview(s, "alice", 2000), null);
});
test("unsupported, oversized, malformed and cross-path image records are rejected", () => {
  assert.equal(validateNoteImage(image), image);
  for (const patch of [
    { id: "../bob/picture" },
    { contentType: "image/svg+xml" },
    { data: "data:image/png;base64," },
    { data: "data:image/jpeg;base64,AAAA" },
    { data: "data:image/png;base64," + "a".repeat(IMAGE_DATA_LIMIT) },
    { width: 2561 },
    { height: 0 },
    { createdAt: 1.5 },
    { unexpectedField: "reject before import writes" },
  ])
    assert.throws(() => validateNoteImage({ ...image, ...patch }));
});
test("image references are deduplicated and cannot select another user's document path", () => {
  assert.deepEqual(
    noteImageIds(
      '<img data-daynote-image="capture_1"><img data-daynote-image=\'capture_1\'><img data-daynote-image="../bob/pic">',
    ),
    ["capture_1"],
  );
});
test("image backup round trip preserves bytes and excludes old migration hashes", () => {
  const input = backup();
  input.noteImages[0] = { ...image, importHash: "old" };
  const parsed = parseBackup(input);
  assert.deepEqual(parsed.noteImages, [image]);
  assert.equal(backupStats(parsed).images, 1);
  assert.ok(JSON.stringify(parsed).includes(image.data));
});
test("backup refuses missing, duplicate or invalid image records", () => {
  assert.throws(() => parseBackup({ ...backup(), noteImages: [] }), /이미지/);
  assert.throws(
    () => parseBackup({ ...backup(), noteImages: [image, image] }),
    /중복/,
  );
  assert.throws(() =>
    parseBackup({
      ...backup(),
      noteImages: [{ ...image, contentType: "image/svg+xml" }],
    }),
  );
});
test("restore stages images before task references and skips matching images on retry", () => {
  const parsed = parseBackup(backup());
  const first = planBackupImport(parsed, [], []);
  assert.deepEqual(
    first.entries.map((entry) => entry[0]),
    ["calendars", "noteImages", "tasks"],
  );
  const retry = planBackupImport(
    parsed,
    parsed.tasks,
    parsed.calendars,
    parsed.noteImages,
  );
  assert.equal(retry.entries.length, 0);
  assert.equal(retry.skipped, 3);
  assert.throws(() =>
    planBackupImport(parsed, parsed.tasks, parsed.calendars, [
      { ...image, data: "data:image/png;base64,BBBB" },
    ]),
  );
});
test("a note with private image references remains searchable by its text", () => {
  const parsed = parseBackup(backup());
  assert.equal(
    searchTasks(buildSearchIndex(parsed.tasks), "capture")[0].id,
    "one",
  );
});

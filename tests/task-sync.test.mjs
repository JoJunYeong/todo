import { test } from "node:test";
import assert from "node:assert/strict";
import { editableTask, changedTaskFields, conflictingTaskFields, currentTask } from "../src/task-sync.js";

const task = { id: "one", text: "Meeting", date: "2026-10-28", calendarId: "personal", done: false, note: "Original" };
test("saving a title edit excludes untouched notes, completion and other remote fields", () => {
  const base = editableTask(task);
  const patch = changedTaskFields(base, { ...base, text: "New title" });
  const current = editableTask({ ...task, note: "Edited on another device", done: true });
  assert.deepEqual(patch, { text: "New title" });
  assert.deepEqual(conflictingTaskFields(base, current, patch), []);
  assert.equal({ ...current, ...patch }.note, "Edited on another device");
  assert.equal({ ...current, ...patch }.done, true);
});
test("concurrent changes to the same field are detected without rejecting identical edits", () => {
  const base = editableTask(task), current = { ...base, note: "Remote note" };
  assert.deepEqual(conflictingTaskFields(base, current, { note: "Local note" }), ["note"]);
  assert.deepEqual(conflictingTaskFields(base, current, { note: "Remote note" }), []);
});
test("optional defaults do not create writes when a remote snapshot is unchanged", () => {
  const base = editableTask(task);
  assert.deepEqual(changedTaskFields(base, editableTask({ ...task, updatedAt: 123 })), {});
});
test("open details track stored changes, including tombstones", () => {
  const remote = { ...task, deleted: true, note: "New note" };
  assert.equal(currentTask([remote], task), remote);
});
test("virtual recurring details use fresh series data and recognize removed occurrences", () => {
  const base = { ...task, id: "series", date: "2026-10-27", dtStart: "2026-10-27", freq: 1 };
  const opened = { ...base, id: "series_20261028", date: "2026-10-28", virtual: true, recurringTodoId: "series" };
  assert.equal(currentTask([{ ...base, text: "Updated series" }], opened).text, "Updated series");
  assert.equal(currentTask([{ ...base, isBaseDeleted: true, deleted: true }], opened).deleted, true);
});

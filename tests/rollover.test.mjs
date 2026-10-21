import { test } from "node:test";
import assert from "node:assert/strict";
import { rolloverPatch, rolloverCandidates } from "../src/rollover.js";
const task = {
  id: "one",
  date: "2026-10-21",
  done: false,
  freq: 0,
  note: "keep",
  checklist: [{ text: "keep" }],
};
test("unfinished ordinary tasks catch up directly to today with their original date retained", () => {
  assert.deepEqual(rolloverPatch(task, "2026-10-25"), {
    date: "2026-10-25",
    rolloverOriginalDate: "2026-10-21",
    rolloverFrom: "2026-10-21",
    rolloverAt: "2026-10-25",
  });
  assert.equal(task.date, "2026-10-21");
  assert.equal(task.note, "keep");
});
test("completed, deleted, undated, future, recurring and virtual tasks are left in place", () => {
  for (const patch of [
    { done: true },
    { deleted: true },
    { date: null },
    { date: "2026-10-23" },
    { freq: 1 },
    { recurrence: "FREQ=DAILY" },
    { recurringTodoId: "master" },
    { virtual: true },
  ])
    assert.equal(rolloverPatch({ ...task, ...patch }, "2026-10-22"), null);
});
test("historical imported work and invalid dates are not silently rescheduled", () => {
  assert.equal(
    rolloverPatch({ ...task, date: "2026-10-20" }, "2026-10-22"),
    null,
  );
  assert.equal(
    rolloverPatch({ ...task, date: "2026-02-30" }, "2026-10-22"),
    null,
  );
  assert.equal(rolloverPatch(task, "invalid"), null);
});
test("repeated checks do not duplicate moves or lose the first scheduled date", () => {
  const moved = { ...task, ...rolloverPatch(task, "2026-10-22") };
  assert.equal(rolloverPatch(moved, "2026-10-22"), null);
  assert.equal(
    rolloverPatch(moved, "2026-10-23").rolloverOriginalDate,
    "2026-10-21",
  );
  assert.equal(rolloverPatch(moved, "2026-10-23").rolloverFrom, "2026-10-22");
  assert.equal(
    rolloverCandidates([task, moved, { ...task, done: true }], "2026-10-22")
      .length,
    1,
  );
});

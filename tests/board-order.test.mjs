import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findTaskZone,
  projectTask,
  moveOrder,
  isRestingHoliday,
  canMoveCard,
  completedLast,
} from "../src/board-order.js";
const a = { id: "a", order: 1024 },
  b = { id: "b", order: 2048 },
  c = { id: "c", order: 3072 };
test("daily completion grouping preserves each status group's manual order and source data", () => {
  const items = [
    { ...a, done: true },
    b,
    { ...c, done: true },
    { id: "d", order: 4096, done: false },
  ];
  const before = structuredClone(items);
  assert.deepEqual(
    completedLast(items).map((task) => task.id),
    ["b", "d", "a", "c"],
  );
  assert.deepEqual(items, before);
  assert.deepEqual(
    completedLast(items.map((task) => ({ ...task, done: false }))).map(
      (task) => task.id,
    ),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(completedLast([]), []);
});
test("dated drag previews keep completed cards below unfinished cards without changing backlog order", () => {
  const done = { id: "done", done: true, order: 0 };
  const groups = {
    "day:2026-10-21": [a, done],
    "list:later": [b, { ...c, done: true }],
  };
  const unfinished = projectTask(groups, "b", "day:2026-10-21");
  assert.deepEqual(
    unfinished["day:2026-10-21"].map((task) => task.id),
    ["a", "b", "done"],
  );
  const completed = projectTask(groups, "c", "day:2026-10-21", "a");
  assert.deepEqual(
    completed["day:2026-10-21"].map((task) => task.id),
    ["a", "c", "done"],
  );
  assert.deepEqual(
    projectTask(groups, "done", "list:later", "b")["list:later"].map(
      (task) => task.id,
    ),
    ["done", "b", "c"],
  );
  assert.deepEqual(groups["day:2026-10-21"], [a, done]);
});
test("cross-list drag previews move one item without mutating the saved lists", () => {
  const groups = { monday: [a, b], tuesday: [c], empty: [] };
  const moved = projectTask(groups, "b", "tuesday", "c");
  assert.deepEqual(moved.monday, [a]);
  assert.deepEqual(moved.tuesday, [b, c]);
  assert.deepEqual(groups.monday, [a, b]);
  assert.equal(findTaskZone(moved, "b"), "tuesday");
  assert.deepEqual(projectTask(moved, "b", "empty").empty, [b]);
});
test("invalid drag targets or a self target preserve the current preview", () => {
  const groups = { monday: [a, b] };
  assert.equal(projectTask(groups, "a", "missing"), groups);
  assert.equal(projectTask(groups, "missing", "monday"), groups);
  assert.equal(projectTask(groups, "a", "monday", "a"), groups);
});
test("move order excludes the moving card before calculating first, middle and last slots", () => {
  assert.equal(moveOrder([a, b, c], "c", "a", 10000), 0);
  assert.equal(moveOrder([a, b, c], "a", "c", 10000), 2560);
  assert.equal(moveOrder([a, b, c], "a", null, 10000), 4096);
  assert.equal(moveOrder([], "a", null, 10000), -1024);
});
test("an empty holiday rests until a task exists, including hidden completed tasks or a drag preview", () => {
  assert.equal(isRestingHoliday(["대체공휴일"], 0, 0), true);
  assert.equal(isRestingHoliday(["대체공휴일"], 1, 0), false);
  assert.equal(isRestingHoliday(["대체공휴일"], 0, 1), false);
  assert.equal(isRestingHoliday(null, 0, 0), false);
});
test("a move refuses a concurrently deleted or relocated card while preserving unrelated edits", () => {
  const original = {
    id: "a",
    date: "2026-10-21",
    calendarId: "one",
    listId: null,
  };
  assert.equal(
    canMoveCard(
      { ...original, note: "changed in another tab", done: true },
      original,
    ),
    true,
  );
  for (const patch of [
    { date: "2026-10-22" },
    { calendarId: "two" },
    { listId: "later" },
    { deleted: true },
  ])
    assert.equal(canMoveCard({ ...original, ...patch }, original), false);
  assert.equal(canMoveCard(null, original), false);
});

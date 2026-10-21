import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findTaskZone,
  projectTask,
  moveOrder,
  isRestingHoliday,
} from "../src/board-order.js";
const a = { id: "a", order: 1024 },
  b = { id: "b", order: 2048 },
  c = { id: "c", order: 3072 };
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { watchDayChange } from "../src/day-clock.js";
import { rolloverPatch } from "../src/rollover.js";

function clock(onDay) {
  let day = "2026-11-04", tick, cleared = false;
  const windowTarget = new EventTarget(), documentTarget = new EventTarget();
  const stop = watchDayChange(() => day, onDay, {
    windowTarget,
    documentTarget,
    timers: {
      setInterval(callback, interval) {
        assert.equal(interval, 30_000);
        tick = callback;
        return 1;
      },
      clearInterval(id) {
        assert.equal(id, 1);
        cleared = true;
      },
    },
  });
  return {
    windowTarget, documentTarget, stop,
    setDay(value) { day = value; },
    tick() { if (!cleared) tick(); },
  };
}

for (const [target, event] of [
  ["windowTarget", "focus"],
  ["windowTarget", "pageshow"],
  ["windowTarget", "online"],
  ["documentTarget", "resume"],
  ["documentTarget", "visibilitychange"],
]) {
  test(`${event} catches up the day after overnight suspension without waiting for a timer`, () => {
    let today;
    const c = clock((day) => { today = day; });
    assert.equal(today, "2026-11-04");
    c.setDay("2026-11-05");
    c[target].dispatchEvent(new Event(event));
    assert.equal(today, "2026-11-05");
    c.stop();
  });
}

test("regular checks still advance the day while the page stays open", () => {
  let today;
  const c = clock((day) => { today = day; });
  c.setDay("2026-11-05");
  c.tick();
  assert.equal(today, "2026-11-05");
  c.stop();
});

test("multiple wake events catch up missed days without moving a task twice", () => {
  let task = { date: "2026-11-04", done: false }, moves = 0;
  const c = clock((day) => {
    const patch = rolloverPatch(task, day);
    if (patch) { task = { ...task, ...patch }; moves++; }
  });
  c.setDay("2026-11-06");
  c.documentTarget.dispatchEvent(new Event("resume"));
  c.windowTarget.dispatchEvent(new Event("focus"));
  c.windowTarget.dispatchEvent(new Event("online"));
  assert.equal(task.date, "2026-11-06");
  assert.equal(task.rolloverOriginalDate, "2026-11-04");
  assert.equal(moves, 1);
  c.stop();
});

test("cleanup removes wake listeners and the fallback timer", () => {
  let calls = 0;
  const c = clock(() => { calls++; });
  c.stop();
  for (const event of ["focus", "pageshow", "online"])
    c.windowTarget.dispatchEvent(new Event(event));
  for (const event of ["visibilitychange", "resume"])
    c.documentTarget.dispatchEvent(new Event(event));
  c.tick();
  assert.equal(calls, 1);
});

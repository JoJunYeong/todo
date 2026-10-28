import { test } from "node:test";
import assert from "node:assert/strict";
import { watchWithSync, SYNC_INTERVAL_MS } from "../src/cloud-sync.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(extra = {}) {
  let now = 0;
  const window = new EventTarget(), document = new EventTarget();
  window.navigator = { onLine: true };
  document.visibilityState = "visible";
  const intervals = new Set(), listeners = [], values = [], errors = [];
  const timers = {
    setInterval(fn, delay) { const timer = { fn, delay }; intervals.add(timer); return timer; },
    clearInterval(timer) { intervals.delete(timer); },
  };
  const stop = watchWithSync((next, error) => {
    const listener = { next, error, stopped: false };
    listeners.push(listener);
    return () => { listener.stopped = true; };
  }, (value) => values.push(value), (error) => errors.push(error), {
    window, document, timers, now: () => now, ...extra,
  });
  return {
    window, document, intervals, listeners, values, errors, stop,
    tick(ms = SYNC_INTERVAL_MS) { now += ms; for (const timer of intervals) timer.fn(); },
    event(target, name) { now += 1001; target.dispatchEvent(new Event(name)); },
  };
}
test("periodic synchronization resumes listeners every 30 seconds and cancels old callbacks", () => {
  const f = fixture();
  assert.equal([...f.intervals][0].delay, 30000);
  f.listeners[0].next({ metadata: { fromCache: false }, value: "first" });
  f.tick();
  assert.equal(f.listeners.length, 2);
  assert.equal(f.listeners[0].stopped, true);
  f.listeners[0].next({ value: "stale" });
  f.listeners[1].next({ value: "fresh" });
  assert.deepEqual(f.values.map((x) => x.value), ["first", "fresh"]);
  f.stop();
  f.tick();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.listeners[1].stopped, true);
});
test("background and offline pages avoid polling and resync when visible or reconnected", () => {
  const f = fixture();
  f.document.visibilityState = "hidden";
  f.tick();
  assert.equal(f.listeners.length, 1);
  f.document.visibilityState = "visible";
  f.event(f.document, "visibilitychange");
  assert.equal(f.listeners.length, 2);
  f.window.navigator.onLine = false;
  f.tick();
  assert.equal(f.listeners.length, 2);
  f.window.navigator.onLine = true;
  f.event(f.window, "online");
  f.event(f.window, "focus");
  assert.equal(f.listeners.length, 4);
  f.stop();
  f.event(f.window, "pageshow");
  assert.equal(f.listeners.length, 4);
});
test("terminal permission failures retry with refreshed authentication and recover", async () => {
  let refreshed = 0;
  const f = fixture({ beforeRetry: async () => { refreshed++; } });
  const denied = { code: "permission-denied" };
  f.listeners[0].error(denied);
  f.tick();
  await flush();
  assert.equal(refreshed, 1);
  f.listeners[1].next({ metadata: { fromCache: true } });
  f.listeners[1].error(denied);
  assert.equal(f.errors.length, 1);
  f.tick();
  await flush();
  f.listeners[2].next({ metadata: { fromCache: false } });
  f.listeners[2].error(denied);
  assert.equal(f.errors.length, 2);
  f.stop();
});
test("logout during an authentication retry cannot reopen a previous account listener", async () => {
  let finish;
  const f = fixture({ beforeRetry: () => new Promise((resolve) => { finish = resolve; }) });
  f.listeners[0].error({ code: "unauthenticated" });
  f.tick();
  f.stop();
  finish();
  await flush();
  assert.equal(f.listeners.length, 1);
  assert.equal(f.intervals.size, 0);
});
test("focus and online events in the same burst open only one new listener", () => {
  const f = fixture();
  f.tick();
  for (const name of ["online", "focus", "pageshow"]) f.window.dispatchEvent(new Event(name));
  assert.equal(f.listeners.length, 2);
  f.stop();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDelay, watchWithSync } from "../src/cloud-sync.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
test("automatic retries slow down after repeated failures and quota exhaustion", () => {
  assert.deepEqual([1, 2, 3].map(n => retryDelay("unavailable", n)), [30000, 60000, 120000]);
  assert.deepEqual([1, 2, 20].map(n => retryDelay("resource-exhausted", n)), [300000, 600000, 3600000]);
});
function fixture(extra = {}) {
  const pending = new Set(), listeners = [], values = [], errors = [];
  const timers = {
    setTimeout(fn, delay) { const timer = { fn, delay }; pending.add(timer); return timer; },
    clearTimeout(timer) { pending.delete(timer); },
  };
  const stop = watchWithSync((next, error) => {
    const listener = { next, error, stopped: false };
    listeners.push(listener);
    return () => { listener.stopped = true; };
  }, value => values.push(value), error => errors.push(error), { timers, ...extra });
  return { pending, listeners, values, errors, stop,
    tick() { const timer = [...pending][0]; pending.delete(timer); timer.fn(); } };
}
test("healthy listener stays attached and receives changes without periodic reads", () => {
  const f = fixture();
  f.listeners[0].next({ metadata: { fromCache: false }, value: "one" });
  f.listeners[0].next({ metadata: { fromCache: false }, value: "two" });
  assert.equal(f.listeners.length, 1);
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.values.map(x => x.value), ["one", "two"]);
  f.stop();
  assert.equal(f.listeners[0].stopped, true);
});
test("quota failures back off and do not force token refresh", async () => {
  let refreshed = 0;
  const f = fixture({ beforeRetry: () => { refreshed++; } });
  f.listeners[0].error({ code: "resource-exhausted" });
  assert.equal([...f.pending][0].delay, 300000);
  f.tick(); await flush();
  f.listeners[1].error({ code: "resource-exhausted" });
  assert.equal([...f.pending][0].delay, 600000);
  assert.equal(refreshed, 0);
  assert.equal(f.errors.length, 1);
  f.stop(); assert.equal(f.pending.size, 0);
});
test("permission failure refreshes authentication, recovers and cancels stale callbacks", async () => {
  let refreshed = 0;
  const f = fixture({ beforeRetry: async () => { refreshed++; } });
  f.listeners[0].error({ code: "permission-denied" });
  assert.equal([...f.pending][0].delay, 30000);
  f.tick(); await flush();
  assert.equal(refreshed, 1);
  f.listeners[0].next({ value: "stale" });
  f.listeners[1].next({ metadata: { fromCache: false }, value: "fresh" });
  assert.deepEqual(f.values.map(x => x.value), ["fresh"]);
  f.stop();
});
test("logout during authentication refresh cannot reopen the listener", async () => {
  let finish;
  const f = fixture({ beforeRetry: () => new Promise(resolve => { finish = resolve; }) });
  f.listeners[0].error({ code: "unauthenticated" });
  f.tick(); f.stop(); finish(); await flush();
  assert.equal(f.listeners.length, 1);
});

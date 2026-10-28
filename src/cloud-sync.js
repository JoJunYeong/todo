export const SYNC_INTERVAL_MS = 30_000;

// Reopening a persisted Firestore listener resumes its server query and keeps
// local pending writes. It does not replace the collection with a stale copy.
export function watchWithSync(listen, next, error, options = {}) {
  const win = options.window ?? globalThis.window;
  const page = options.document ?? globalThis.document;
  const timers = options.timers ?? globalThis;
  const now = options.now ?? Date.now;
  let unsubscribe, closed = false, generation = 0, refreshing = false;
  let failed = false, reported = "", lastRefresh = -Infinity;
  const report = (cause) => {
    failed = true;
    const key = cause?.code || cause?.message || String(cause);
    if (reported !== key) {
      reported = key;
      error?.(cause);
    }
  };
  const attach = async (initial = false) => {
    if (closed || refreshing) return;
    if (!initial && (win?.navigator?.onLine === false || page?.visibilityState === "hidden")) return;
    if (!initial && now() - lastRefresh < 1000) return;
    refreshing = true;
    lastRefresh = now();
    const current = ++generation;
    unsubscribe?.();
    unsubscribe = undefined;
    try {
      if (failed) await options.beforeRetry?.();
      if (closed || current !== generation) return;
      const stop = listen(
        (snapshot) => {
          if (closed || current !== generation) return;
          if (!snapshot.metadata?.fromCache) {
            failed = false;
            reported = "";
          }
          next(snapshot);
        },
        (cause) => {
          if (!closed && current === generation) report(cause);
        },
      );
      if (closed || current !== generation) stop?.();
      else unsubscribe = stop;
    } catch (cause) {
      if (!closed && current === generation) report(cause);
    } finally {
      refreshing = false;
    }
  };
  const refresh = () => { void attach(); };
  void attach(true);
  const timer = timers.setInterval(refresh, options.interval ?? SYNC_INTERVAL_MS);
  for (const name of ["online", "focus", "pageshow"]) win?.addEventListener(name, refresh);
  page?.addEventListener("visibilitychange", refresh);
  return () => {
    closed = true;
    generation++;
    unsubscribe?.();
    timers.clearInterval(timer);
    for (const name of ["online", "focus", "pageshow"]) win?.removeEventListener(name, refresh);
    page?.removeEventListener("visibilitychange", refresh);
  };
}

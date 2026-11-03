export function retryDelay(code, failures, base = 30_000, maxDelay = 60 * 60_000) {
  const minimum = code === "resource-exhausted" ? Math.max(base, 5 * 60_000) : base;
  return Math.min(maxDelay, minimum * 2 ** Math.min(Math.max(failures - 1, 0), 16));
}

// Firestore's persistent listener already reconnects after network interruptions.
// Reopening a healthy collection listener repeatedly re-reads its entire result.
export function watchWithSync(listen, next, error, options = {}) {
  const timers = options.timers ?? globalThis;
  const base = options.interval ?? 30_000;
  const maxDelay = options.maxDelay ?? 60 * 60_000;
  let unsubscribe, timer, closed = false, generation = 0;
  let failures = 0, reported = "";

  const attach = async () => {
    if (closed) return;
    const current = ++generation;
    unsubscribe?.();
    unsubscribe = undefined;
    try {
      if (failures && (lastCode === "permission-denied" || lastCode === "unauthenticated"))
        await options.beforeRetry?.();
      if (closed || current !== generation) return;
      const stop = listen(
        (snapshot) => {
          if (closed || current !== generation) return;
          if (!snapshot.metadata?.fromCache) { failures = 0; reported = ""; }
          next(snapshot);
        },
        (cause) => { if (!closed && current === generation) retry(cause); },
      );
      if (closed || current !== generation) stop?.();
      else unsubscribe = stop;
    } catch (cause) {
      if (!closed && current === generation) retry(cause);
    }
  };
  let lastCode = "";
  const retry = (cause) => {
    lastCode = cause?.code || "";
    const key = lastCode || cause?.message || String(cause);
    if (key !== reported) { reported = key; error?.(cause); }
    failures++;
    const delay = retryDelay(lastCode, failures, base, maxDelay);
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = undefined; void attach(); }, delay);
  };
  void attach();
  return () => {
    closed = true;
    generation++;
    timers.clearTimeout(timer);
    unsubscribe?.();
  };
}

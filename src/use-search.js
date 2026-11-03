import { useEffect, useRef, useState } from "react";

// Indexing and matching notes can be expensive; keep it off the UI thread.
export function useSearch(tasks, query, filter, limit) {
  const worker = useRef(null), sequence = useRef(0), request = useRef(null);
  const [answer, setAnswer] = useState(null), [failure, setFailure] = useState(false);
  useEffect(() => {
    if (!query) return;
    let instance;
    try { instance = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" }); }
    catch { setFailure(true); return; }
    worker.current = instance;
    setFailure(false);
    instance.onmessage = ({ data }) => {
      if (data.id === sequence.current) setAnswer({ ...data, ...request.current });
    };
    instance.onerror = () => setFailure(true);
    return () => { instance.terminate(); worker.current = null; };
  }, [!!query]);
  useEffect(() => {
    if (worker.current) worker.current.postMessage({ type: "index", tasks });
  }, [tasks, !!query]);
  useEffect(() => {
    if (!worker.current || !query) return;
    const id = ++sequence.current;
    request.current = { tasks, query, filter, limit };
    const timer = setTimeout(() => worker.current?.postMessage({ type: "search", id, query, filter, limit }), 120);
    return () => clearTimeout(timer);
  }, [tasks, query, filter, limit]);
  const pending = !!query && (!answer || answer.id !== sequence.current ||
    answer.tasks !== tasks || answer.query !== query || answer.filter !== filter || answer.limit !== limit);
  return { results: query && !pending ? answer.results : [],
    previews: new Map(query && !pending ? answer.previews : []), pending, failure };
}

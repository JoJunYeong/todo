import { useEffect, useState } from "react";
import { rolloverCandidates } from "./rollover.js";

export function useRollover({ uid, store, tasks, today, ready, enabled }) {
  const candidates = rolloverCandidates(tasks, today).slice(0, 20);
  const signature = candidates
    .map((task) => task.id + ":" + task.date)
    .join("|");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ready || !enabled || !signature) {
      setError("");
      return;
    }
    let active = true,
      timer;
    const run = async () => {
      try {
        await store.rolloverTasks(uid, candidates, today);
        if (active) setError("");
      } catch {
        if (!active) return;
        setError(
          "미완료 할 일을 오늘로 옮기지 못했어요. 잠시 후 자동으로 다시 시도해요.",
        );
        timer = setTimeout(run, 30000);
      }
    };
    run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [uid, store, today, ready, enabled, signature]);
  return error;
}

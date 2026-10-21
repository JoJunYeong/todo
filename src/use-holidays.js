import { useEffect, useState, useCallback, useRef } from "react";
import { addDays } from "./domain.js";
import { loadHolidayYear, readHolidayCache } from "./holidays.js";
import { previewStorage } from "./preview-cache.js";

export function useHolidays(start, online) {
  const first = Number(start.slice(0, 4));
  const last = Number(addDays(start, 6).slice(0, 4));
  const [byYear, setByYear] = useState({});
  const [retry, setRetry] = useState(0);
  const [wake, setWake] = useState(0);
  const previousRetry = useRef(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") setWake((n) => n + 1);
    };
    const timer = setInterval(check, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const years = [...new Set([first, last])];
    const force = retry !== previousRetry.current;
    previousRetry.current = retry;
    const storage = previewStorage();
    setByYear(
      Object.fromEntries(
        years.map((year) => [year, readHolidayCache(storage, year)]),
      ),
    );
    setLoading(true);
    setFailed(false);
    Promise.allSettled(
      years.map(async (year) => {
        const result = await loadHolidayYear(year, { storage, force });
        return [year, result];
      }),
    ).then((results) => {
      if (!active) return;
      const good = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
      setByYear(Object.fromEntries(good));
      setFailed(good.length !== years.length || good.some(([, r]) => r.stale));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [first, last, online, retry, wake]);
  const values = [...new Set([first, last])]
    .map((year) => byYear[year])
    .filter(Boolean);
  return {
    days: Object.assign({}, ...values.map((value) => value.days)),
    loading,
    failed,
    available: values.length > 0,
    updatedAt: values.length
      ? Math.min(...values.map((value) => value.fetchedAt))
      : null,
    refresh,
  };
}

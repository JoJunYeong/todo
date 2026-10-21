import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHolidays,
  loadHolidayYear,
  readHolidayCache,
  HOLIDAY_TTL,
} from "../src/holidays.js";

const records = () =>
  [
    ["2026-01-01", "새해"],
    ["2026-03-01", "삼일절"],
    ["2026-03-02", "삼일절 (대체공휴일)"],
    ["2026-10-03", "개천절"],
    ["2026-10-05", "개천절 (대체공휴일)"],
    ["2026-10-09", "한글날"],
  ].map(([date, name]) => ({ date, name, kind: 1, holiday: true }));
const storage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
};
const response = (data) => async () => ({ ok: true, json: async () => data });

test("holiday source retains original and substitute dates, filtering observances", () => {
  const days = normalizeHolidays(
    [
      ...records(),
      { date: "2026-05-15", name: "스승의 날", holiday: false, kind: 2 },
      ...records().slice(0, 1),
    ],
    2026,
  );
  assert.deepEqual(days["2026-03-01"], ["삼일절"]);
  assert.deepEqual(days["2026-03-02"], ["삼일절 (대체공휴일)"]);
  assert.deepEqual(days["2026-01-01"], ["새해"]);
  assert.equal(days["2026-05-15"], undefined);
});
test("invalid dates, wrong years and incomplete responses do not replace holiday data", () => {
  for (const extra of [
    { ...records()[0], date: "2026-02-30" },
    { ...records()[0], date: "2027-01-01" },
    { ...records()[0], name: "" },
  ])
    assert.throws(() => normalizeHolidays([...records(), extra], 2026));
  assert.throws(() => normalizeHolidays([], 2026));
});
test("fresh yearly cache avoids the network; manual refresh fetches changed holidays", async () => {
  const s = storage();
  let calls = 0;
  const fetcher = async (...args) => {
    calls++;
    assert.equal(args[1].credentials, "omit");
    return response(records())();
  };
  await loadHolidayYear(2026, { storage: s, fetcher, now: 1000 });
  await loadHolidayYear(2026, { storage: s, fetcher, now: 2000 });
  assert.equal(calls, 1);
  await loadHolidayYear(2026, { storage: s, fetcher, now: 3000, force: true });
  assert.equal(calls, 2);
  assert.equal(readHolidayCache(s, 2027), null);
});
test("refresh failure preserves last good cache and marks it stale", async () => {
  const s = storage();
  await loadHolidayYear(2026, {
    storage: s,
    fetcher: response(records()),
    now: 1000,
  });
  const old = await loadHolidayYear(2026, {
    storage: s,
    fetcher: async () => {
      throw Error("offline");
    },
    now: HOLIDAY_TTL + 2000,
  });
  assert.equal(old.stale, true);
  assert.equal(old.fetchedAt, 1000);
  assert.deepEqual(old.days["2026-10-05"], ["개천절 (대체공휴일)"]);
  await assert.rejects(
    loadHolidayYear(2027, { storage: s, fetcher: async () => ({ ok: false }) }),
  );
});
test("corrupt or unavailable storage cannot break successful holiday loading", async () => {
  const broken = {
    getItem: () => "bad json",
    setItem: () => {
      throw Error("full");
    },
  };
  assert.equal(readHolidayCache(broken, 2026), null);
  const data = await loadHolidayYear(2026, {
    storage: broken,
    fetcher: response(records()),
  });
  assert.deepEqual(data.days["2026-10-09"], ["한글날"]);
});

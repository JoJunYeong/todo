import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  monday,
  addDays,
  isDate,
  htmlText,
  authEmail,
  buildSearchIndex,
  searchTasks,
  expandWeek,
  parseBackup,
  materialize,
} from "../src/domain.js";

test("ending a recurring series preserves history and stops future dates", () => {
  const input = [
    task({ freq: 2, dtStart: "2026-10-19", done: true }),
    task({
      id: "end",
      date: "2026-10-26",
      recurringTodoId: "task",
      freq: 2,
      isBaseDeleted: true,
      deleted: true,
    }),
  ];
  assert.equal(expandWeek(input, "2026-10-19")[0].done, true);
  assert.equal(expandWeek(input, "2026-11-02").length, 0);
});

test("a series edit changes future notes while keeping prior occurrences", () => {
  const input = [
    task({ freq: 2, dtStart: "2026-10-19", note: "before" }),
    task({
      id: "edited",
      date: "2026-10-26",
      recurringTodoId: "task",
      freq: 2,
      isBase: true,
      recurrence: "RRULE:FREQ=WEEKLY",
      note: "after",
    }),
  ];
  assert.equal(expandWeek(input, "2026-10-19")[0].note, "before");
  assert.equal(expandWeek(input, "2026-11-02")[0].note, "after");
});

const task = (patch = {}) => ({
  id: "task",
  calendarId: "cal",
  text: "보고서 작성",
  date: "2026-10-19",
  done: false,
  note: "",
  ...patch,
});
test("local dates survive DST and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(monday("2026-10-25"), "2026-10-19");
  assert.equal(monday("2026-10-19"), "2026-10-19");
});
test("calendar dates reject normalized invalid days", () => {
  assert.ok(isDate("2024-02-29"));
  assert.ok(!isDate("2025-02-29"));
  assert.ok(!isDate("2026-13-01"));
  assert.ok(!isDate("2026-1-01"));
});
test("username aliases normalize case and reject path or email injection", () => {
  assert.equal(authEmail(" JJY "), "jjy@users.daynote.invalid");
  assert.throws(() => authEmail("x@y.z"));
  assert.throws(() => authEmail("../admin"));
  assert.throws(() => authEmail("ab"));
});
test("search includes Korean notes, checklist items, initials and Latin case", () => {
  const index = buildSearchIndex([
    task({
      note: "<p>Dolby Atmos 인증 결과</p>",
      checklist: [{ id: "a", text: "코드리뷰", done: false }],
    }),
    task({ id: "other", text: "다른 할 일", deleted: true }),
  ]);
  for (const q of ["돌비", "없는말"])
    assert.equal(searchTasks(index, q).length, 0);
  for (const q of ["DOLBY atmos", "인증 결과", "코드리뷰", "ㅂㄱㅅ"])
    assert.equal(searchTasks(index, q).length, 1);
  assert.equal(searchTasks(index, "인증", { status: "done" }).length, 0);
});
test("search supports full-width text and caps results without dropping precise matches", () => {
  const index = buildSearchIndex([
    task({ id: "1", text: "ＡＢＣ 문서" }),
    task({ id: "2", text: "ABC" }),
  ]);
  assert.equal(searchTasks(index, "abc", { limit: 1 })[0].id, "2");
});
test("HTML search text separates paragraphs and decodes entities", () => {
  assert.equal(
    htmlText("<p>A&amp;B</p><p>한글&nbsp;내용</p>"),
    "A&B 한글 내용",
  );
});
test("daily recurrence yields every day in bounded week", () => {
  const week = expandWeek(
    [task({ freq: 1, dtStart: "2026-10-19" })],
    "2026-10-19",
  );
  assert.equal(week.length, 7);
  assert.equal(week[0].id, "task");
  assert.equal(week[1].id, "task_20261020");
  assert.equal(week[1].done, false);
});
test("stored overrides and deletion markers replace recurrence occurrences", () => {
  const week = expandWeek(
    [
      task({ freq: 1 }),
      task({
        id: "override",
        date: "2026-10-20",
        recurringTodoId: "task",
        done: true,
        text: "수정된 일정",
      }),
      task({
        id: "removed",
        date: "2026-10-21",
        recurringTodoId: "task",
        deleted: true,
      }),
    ],
    "2026-10-19",
  );
  assert.equal(week.length, 6);
  assert.equal(week.find((t) => t.date === "2026-10-20").text, "수정된 일정");
  assert.ok(!week.some((t) => t.date === "2026-10-21"));
});
test("weekday recurrence excludes weekends and uses anchor without date", () => {
  const week = expandWeek(
    [task({ date: null, dtStart: "2024-01-01", freq: 5 })],
    "2026-10-19",
  );
  assert.equal(week.length, 5);
  assert.equal(week.at(-1).date, "2026-10-23");
});
test("custom recurrence honors UNTIL and BYDAY", () => {
  const input = task({
    date: null,
    dtStart: "2026-10-01",
    freq: 7,
    recurrence: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261021T000000Z",
  });
  assert.deepEqual(
    expandWeek([input], "2026-10-19").map((x) => x.date),
    ["2026-10-19", "2026-10-21"],
  );
  assert.equal(expandWeek([input], "2026-10-26").length, 0);
});
test("monthly recurrence does not invent invalid February dates", () => {
  const input = task({ date: "2026-01-31", dtStart: "2026-01-31", freq: 3 });
  assert.equal(expandWeek([input], "2026-02-23").length, 0);
});
test("deleted base occurrence does not erase future recurrence", () => {
  const input = task({ freq: 2, isBaseDeleted: true });
  assert.equal(expandWeek([input], "2026-10-19").length, 0);
  assert.equal(expandWeek([input], "2026-10-26").length, 1);
});
test("backup preserves every source field, checklists and unplaced recurrence bases", () => {
  const raw = {
    source: "https://tweek.so/api/v1",
    calendars: [
      { id: "cal", name: "내 캘린더", lists: [{ id: "one", name: "언젠가" }] },
    ],
    tasks: [
      task({
        date: null,
        freq: 2,
        dtStart: "2024-01-01",
        isBaseDeleted: true,
        note: "<table><tr><td>원본</td></tr></table>",
        checklist: [
          {
            id: "c",
            text: "중요",
            done: true,
            indent: 2,
            highlighted: true,
            variant: "header",
          },
        ],
      }),
    ],
  };
  const parsed = parseBackup(raw);
  for (const [k, v] of Object.entries(raw.tasks[0]))
    assert.deepEqual(parsed.tasks[0][k], v);
  assert.equal(parsed.tasks[0].importSource, "tweek");
  assert.equal(parsed.calendars[0].lists[0].name, "언젠가");
});
test("backup preflight rejects duplicates, orphan calendars and invalid data", () => {
  const base = { calendars: [{ id: "cal", name: "Test" }], tasks: [task()] };
  assert.throws(() => parseBackup({ ...base, tasks: [task(), task()] }));
  assert.throws(() =>
    parseBackup({ ...base, tasks: [task({ calendarId: "missing" })] }),
  );
  assert.throws(() =>
    parseBackup({ ...base, tasks: [task({ date: "2026-99-01" })] }),
  );
  assert.throws(() => parseBackup({ ...base, tasks: [task({ id: "a/b" })] }));
});
test("materialized occurrence retains provenance but strips UI-only state", () => {
  const x = materialize(
    task({
      id: "task_20261020",
      recurringTodoId: "task",
      virtual: true,
      score: 3,
    }),
    { done: true },
  );
  assert.equal(x.done, true);
  assert.equal(x.recurringTodoId, "task");
  assert.ok(!("virtual" in x));
  assert.ok(!("score" in x));
});

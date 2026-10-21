import rrule from "rrule/dist/es5/rrule.js";
import { validateNoteImage, noteImageIds } from "./image-data.js";
const { RRule, rrulestr } = rrule;

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
export const COLORS = {
  blank: "#ffffff",
  yellowish: "#fff0a5",
  greenish: "#d6eddf",
  cornflower: "#dae5ff",
  pink: "#f8dce4",
  mango: "#ffe2bd",
  lilac: "#eaddf8",
  grey: "#e7e9e7",
  black: "#454b48",
};
export const COLOR_NAMES = {
  blank: "기본",
  yellowish: "노랑",
  greenish: "초록",
  cornflower: "파랑",
  pink: "분홍",
  mango: "주황",
  lilac: "보라",
  grey: "회색",
  black: "검정",
};
export const FREQUENCIES = {
  0: "반복 없음",
  1: "매일",
  2: "매주",
  3: "매월",
  4: "매년",
  5: "평일마다",
  6: "2주마다",
  7: "사용자 지정",
};
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(value + "T12:00:00");
  return Number.isFinite(+d) && dateKey(d) === value;
}
export function addDays(key, n) {
  const d = new Date(key + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export function monday(key = dateKey()) {
  const d = new Date(key + "T12:00:00");
  return addDays(key, -((d.getDay() + 6) % 7));
}
export function htmlText(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(Number(n), 0x10ffff)),
    )
    .replace(/\s+/g, " ")
    .trim();
}
export const normalize = (s = "") =>
  String(s)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ")
    .trim();
const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
export const initials = (s = "") =>
  [...s]
    .map((c) => {
      const n = c.charCodeAt(0) - 0xac00;
      return n >= 0 && n < 11172 ? CHOSEONG[Math.floor(n / 588)] : c;
    })
    .join("");
export function buildSearchIndex(tasks) {
  return tasks.map((t) => ({
    task: t,
    title: normalize(t.text),
    text: normalize(
      [
        t.text,
        htmlText(t.note),
        ...(t.checklist || []).map((x) => x.text),
      ].join(" "),
    ),
    initials: normalize(initials(normalize(t.text))),
  }));
}
export function searchTasks(
  index,
  query,
  { calendarId, status = "all", limit = 100 } = {},
) {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  return index
    .filter(
      (x) =>
        !x.task.deleted &&
        (!calendarId || x.task.calendarId === calendarId) &&
        (status === "all" || x.task.done === (status === "done")) &&
        words.every(
          (w) =>
            x.text.includes(w) ||
            (/^[ㄱ-ㅎ\u1100-\u1112]+$/.test(w) && x.initials.includes(w)),
        ),
    )
    .map((x) => ({
      ...x.task,
      score: words.reduce(
        (n, w) =>
          n +
          (x.title === w
            ? 100
            : x.title.startsWith(w)
              ? 30
              : x.title.includes(w)
                ? 10
                : 1),
        0,
      ),
    }))
    .sort(
      (a, b) => b.score - a.score || (b.date || "").localeCompare(a.date || ""),
    )
    .slice(0, limit);
}
export function authEmail(username) {
  const name = normalize(username);
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name))
    throw Error("아이디는 영문·숫자·밑줄·하이픈 3~32자로 입력해 주세요.");
  return name + "@users.daynote.invalid";
}

function schedule(task) {
  const start = task.dtStart || task.date;
  if (!isDate(start)) return null;
  const dtstart = new Date(start + "T00:00:00Z");
  if (task.recurrence) {
    try {
      const text = /^DTSTART/m.test(task.recurrence)
        ? task.recurrence
        : `DTSTART:${start.replaceAll("-", "")}T000000Z\n${task.recurrence}`;
      return rrulestr(text, { forceset: true });
    } catch {
      return null;
    }
  }
  const freq = {
    1: RRule.DAILY,
    2: RRule.WEEKLY,
    3: RRule.MONTHLY,
    4: RRule.YEARLY,
    5: RRule.WEEKLY,
    6: RRule.WEEKLY,
  }[task.freq];
  if (freq === undefined) return null;
  return new RRule({
    freq,
    dtstart,
    ...(task.freq === 5
      ? { byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR] }
      : {}),
    ...(task.freq === 6 ? { interval: 2 } : {}),
  });
}
export function expandWeek(tasks, start, end = addDays(start, 6)) {
  const result = new Map();
  const stored = new Map(
    tasks
      .filter((t) => t.recurringTodoId && t.date)
      .map((t) => {
        const original = t.id.startsWith(t.recurringTodoId + "_")
          ? t.id.slice(t.recurringTodoId.length + 1)
          : "";
        const scheduled = /^\d{8}$/.test(original)
          ? `${original.slice(0, 4)}-${original.slice(4, 6)}-${original.slice(6, 8)}`
          : t.date;
        return [`${t.recurringTodoId}:${scheduled}`, t];
      }),
  );
  const from = new Date(start + "T00:00:00Z"),
    to = new Date(end + "T23:59:59Z");
  // Tweek records series edits as successive acting bases. A deleted base ends
  // the series from that date; an ordinary deleted occurrence skips one day.
  for (const task of tasks)
    if (
      task.date >= start &&
      task.date <= end &&
      !task.deleted &&
      !task.isBaseDeleted &&
      (!task.freq || task.recurringTodoId)
    )
      result.set(task.id, task);
  for (const master of tasks.filter((t) => t.freq && !t.recurringTodoId)) {
    const rootStart = master.dtStart || master.date;
    if (!isDate(rootStart)) continue;
    const events = [
      { ...master, segmentStart: rootStart },
      ...tasks
        .filter(
          (t) =>
            t.recurringTodoId === master.id &&
            t.date &&
            (t.isBase || t.isBaseDeleted),
        )
        .map((t) => ({ ...t, segmentStart: t.date })),
    ].sort((a, b) => a.segmentStart.localeCompare(b.segmentStart));
    for (let i = 0; i < events.length; i++) {
      const base = events[i],
        until = events[i + 1]?.segmentStart;
      if (!base.freq || (base.deleted && base.isBaseDeleted)) continue;
      // Legacy acting bases with neither DTSTART nor RRULE do not generate
      // occurrences in Tweek. Keep their stored entries without inventing dates.
      if (base.recurringTodoId && !base.dtStart && !base.recurrence) continue;
      const rule = schedule({
        ...base,
        dtStart: base.dtStart || base.segmentStart,
      });
      if (!rule) continue;
      for (const day of rule.between(from, to, true)) {
        const key = day.toISOString().slice(0, 10);
        if (key < base.segmentStart || (until && key >= until)) continue;
        const override = stored.get(`${master.id}:${key}`);
        if (override) {
          if (
            !override.deleted &&
            !override.isBaseDeleted &&
            override.date >= start &&
            override.date <= end
          )
            result.set(override.id, override);
          continue;
        }
        if (key === rootStart && master.isBaseDeleted) continue;
        const isOriginal = rootStart === key && !master.deleted;
        const { segmentStart, ...fields } = base;
        const occurrence = isOriginal
          ? { ...master, date: key }
          : {
              ...master,
              ...fields,
              id: master.id + "_" + key.replaceAll("-", ""),
              date: key,
              virtual: true,
              recurringTodoId: master.id,
              done: false,
              isBase: false,
              isBaseDeleted: false,
              deleted: false,
            };
        result.set(occurrence.id, occurrence);
      }
    }
  }
  return [...result.values()].sort(
    (a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id),
  );
}
export function materialize(task, patch = {}) {
  const { virtual, score, ...rest } = task;
  return { ...rest, ...patch, updatedAt: Date.now() };
}
export function validateTask(task) {
  if (
    !task ||
    typeof task.id !== "string" ||
    !task.id ||
    task.id.includes("/") ||
    task.id.length > 200
  )
    throw Error("항목 ID가 올바르지 않습니다.");
  if (typeof task.text !== "string" || task.text.length > 10000)
    throw Error("제목이 너무 깁니다.");
  if (typeof task.done !== "boolean")
    throw Error("완료 상태 형식이 올바르지 않습니다.");
  if (
    typeof task.calendarId !== "string" ||
    !task.calendarId ||
    task.calendarId.includes("/")
  )
    throw Error("캘린더 정보가 올바르지 않습니다.");
  if (task.date != null && !isDate(task.date))
    throw Error("날짜가 올바르지 않습니다.");
  if (
    task.listId != null &&
    (typeof task.listId !== "string" || task.listId.includes("/"))
  )
    throw Error("목록 정보가 올바르지 않습니다.");
  if (task.note != null && typeof task.note !== "string")
    throw Error("메모 형식이 올바르지 않습니다.");
  if (
    task.checklist != null &&
    (!Array.isArray(task.checklist) ||
      task.checklist.some(
        (c) =>
          typeof c.id !== "string" ||
          typeof c.text !== "string" ||
          typeof c.done !== "boolean",
      ))
  )
    throw Error("체크리스트 형식이 올바르지 않습니다.");
  if (new TextEncoder().encode(JSON.stringify(task)).length > 900000)
    throw Error("한 항목의 크기가 너무 큽니다.");
  return task;
}
export function parseBackup(input) {
  if (!input || !Array.isArray(input.tasks) || !Array.isArray(input.calendars))
    throw Error("Daynote 또는 Tweek 백업 JSON 파일을 선택해 주세요.");
  if (input.tasks.length > 50000)
    throw Error("한 번에 50,000개까지 가져올 수 있습니다.");
  if (!input.calendars.length || input.calendars.length > 1000)
    throw Error("백업에는 1~1,000개의 캘린더가 필요합니다.");
  const seen = new Set(),
    calendars = input.calendars.map((c, i) => {
      if (
        !c.id ||
        typeof c.id !== "string" ||
        c.id.includes("/") ||
        c.id.length > 200 ||
        typeof c.name !== "string" ||
        c.name.length > 200 ||
        (c.lists != null && (!Array.isArray(c.lists) || c.lists.length > 100))
      )
        throw Error("캘린더 형식이 올바르지 않습니다.");
      const { importHash, ...fields } = c;
      return {
        ...fields,
        order: c.order ?? i,
        lists: (c.lists || []).map((l) => {
          if (
            !l.id ||
            typeof l.id !== "string" ||
            l.id.includes("/") ||
            typeof l.name !== "string"
          )
            throw Error("목록 형식이 올바르지 않습니다.");
          return { ...l };
        }),
      };
    });
  const calIds = new Set(calendars.map((c) => c.id));
  if (calIds.size !== calendars.length)
    throw Error("중복된 캘린더 ID가 있습니다.");
  const tasks = input.tasks.map((t, i) => {
    validateTask(t);
    if (seen.has(t.id)) throw Error("중복된 항목 ID가 있습니다.");
    seen.add(t.id);
    if (!calIds.has(t.calendarId))
      throw Error("항목의 캘린더를 찾을 수 없습니다.");
    const { importHash, ...fields } = t;
    return {
      ...fields,
      order: t.order ?? t.sortIndex ?? i,
      ...(input.source?.includes("tweek.so") ? { importSource: "tweek" } : {}),
    };
  });
  if (
    input.noteImages != null &&
    (!Array.isArray(input.noteImages) || input.noteImages.length > 10000)
  )
    throw Error("백업 이미지 형식이 올바르지 않습니다.");
  const imageIds = new Set();
  const noteImages = (input.noteImages || []).map((value) => {
    const { importHash, ...image } = validateNoteImage(value);
    if (imageIds.has(image.id)) throw Error("중복된 이미지 ID가 있습니다.");
    imageIds.add(image.id);
    return image;
  });
  for (const task of tasks)
    for (const id of noteImageIds(task.note))
      if (!imageIds.has(id))
        throw Error(
          "백업에 메모 이미지가 빠져 있습니다. 이미지가 포함된 전체 백업을 선택해 주세요.",
        );
  return {
    calendars,
    tasks,
    ...(noteImages.length ? { noteImages } : {}),
    colors: input.colors || [],
    source: input.source || "daynote",
    version: 1,
  };
}
export function matchesBackupEntry(expected, actual) {
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => equal(a[k], b[k]))
    );
  };
  return (
    !!actual && Object.entries(expected).every(([k, v]) => equal(v, actual[k]))
  );
}
export function planBackupImport(
  data,
  existingTasks,
  existingCalendars,
  existingNoteImages = [],
) {
  const entries = [];
  let skipped = 0;
  for (const [kind, values, existing] of [
    ["calendars", data.calendars, existingCalendars],
    ["noteImages", data.noteImages || [], existingNoteImages],
    ["tasks", data.tasks, existingTasks],
  ]) {
    const saved = new Map(existing.map((item) => [item.id, item]));
    for (const value of values) {
      if (!saved.has(value.id)) entries.push([kind, value.id, value]);
      else if (matchesBackupEntry(value, saved.get(value.id))) skipped++;
      else
        throw Error(
          "같은 ID의 자료가 이미 있고 내용이 달라요. 기존 자료를 보호하기 위해 가져오기를 시작하지 않았어요.",
        );
    }
  }
  return { entries, skipped };
}
export function backupStats(data) {
  return {
    tasks: data.tasks.length,
    notes: data.tasks.filter((t) => t.note).length,
    checklists: data.tasks.filter((t) => t.checklist?.length).length,
    calendars: data.calendars.length,
    ...(data.noteImages?.length ? { images: data.noteImages.length } : {}),
    deleted: data.tasks.filter((t) => t.deleted).length,
  };
}

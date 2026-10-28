import { expandWeek } from "./domain.js";

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function editableTask(task) {
  return {
    text: task.text || "",
    date: task.date || null,
    listId: task.date ? null : task.listId || "",
    calendarId: task.calendarId,
    color: task.color || "blank",
    done: !!task.done,
    freq: Number(task.freq || 0),
    recurrence: Number(task.freq) === 7 ? task.recurrence || "" : null,
    checklist: task.checklist || [],
    note: task.note || "",
    isMD: !!task.isMD,
  };
}

export function changedTaskFields(base, draft) {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => !sameValue(base[key], value)),
  );
}

export function conflictingTaskFields(base, current, patch) {
  return Object.keys(patch).filter(
    (key) => !sameValue(base[key], current[key]) && !sameValue(patch[key], current[key]),
  );
}

export function currentTask(tasks, opened) {
  if (!opened) return null;
  const stored = tasks.find((task) => task.id === opened.id);
  if (stored) return stored;
  if (opened.virtual && opened.date)
    return expandWeek(tasks, opened.date, opened.date).find((task) => task.id === opened.id) || { ...opened, deleted: true };
  return opened;
}

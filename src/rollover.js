// Start with this release's schedules; do not reschedule imported historical work.
export const ROLLOVER_START = "2026-10-21";
const validDate = (date) =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date + "T12:00:00Z")) &&
  new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;

export function rolloverPatch(task, today, start = ROLLOVER_START) {
  if (
    !validDate(today) ||
    !validDate(start) ||
    !validDate(task.date) ||
    task.done !== false ||
    task.deleted ||
    task.freq ||
    task.recurrence ||
    task.recurringTodoId ||
    task.virtual ||
    task.date < start ||
    task.date >= today
  )
    return null;
  return {
    date: today,
    rolloverOriginalDate: task.rolloverOriginalDate || task.date,
    rolloverFrom: task.date,
    rolloverAt: today,
  };
}

export function rolloverCandidates(tasks, today, start = ROLLOVER_START) {
  return tasks.filter((task) => rolloverPatch(task, today, start));
}

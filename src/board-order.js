export const dayZone = (date) => "day:" + date;
export const listZone = (id) => "list:" + id;
export function findTaskZone(groups, taskId) {
  return Object.keys(groups).find((id) =>
    groups[id].some((task) => task.id === taskId),
  );
}
export function projectTask(groups, taskId, target, beforeId = null) {
  const source = findTaskZone(groups, taskId);
  if (!source || !groups[target] || beforeId === taskId) return groups;
  const task = groups[source].find((item) => item.id === taskId);
  const next = {
    ...groups,
    [source]: groups[source].filter((item) => item.id !== taskId),
  };
  const items = source === target ? next[source] : [...groups[target]];
  const at = beforeId ? items.findIndex((item) => item.id === beforeId) : -1;
  next[target] = [
    ...items.slice(0, at < 0 ? items.length : at),
    task,
    ...items.slice(at < 0 ? items.length : at),
  ];
  return next;
}
export function moveOrder(peers, activeId, beforeId, now = Date.now()) {
  const items = peers
    .filter((item) => item.id !== activeId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const found = beforeId ? items.findIndex((item) => item.id === beforeId) : -1;
  const at = found < 0 ? items.length : found;
  if (at === 0) return (items[0]?.order || 0) - 1024;
  if (at === items.length) return (items.at(-1)?.order || now) + 1024;
  return ((items[at - 1].order || 0) + (items[at].order || 0)) / 2;
}
export const isRestingHoliday = (holidayNames, scheduledCount, visibleCount) =>
  !!holidayNames?.length && scheduledCount === 0 && visibleCount === 0;
export const canMoveCard = (current, original) =>
  !!current &&
  !current.deleted &&
  current.calendarId === original.calendarId &&
  (current.date || null) === (original.date || null) &&
  (current.listId || null) === (original.listId || null);

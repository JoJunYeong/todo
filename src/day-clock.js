// Timers can pause overnight without a visibility change when the page returns.
export function watchDayChange(
  readDay,
  onDay,
  {
    windowTarget = window,
    documentTarget = document,
    timers = globalThis,
    interval = 30_000,
  } = {},
) {
  const check = () => onDay(readDay());
  const windowEvents = ["focus", "pageshow", "online"];
  const documentEvents = ["visibilitychange", "resume"];
  const timer = timers.setInterval(check, interval);
  for (const event of windowEvents) windowTarget.addEventListener(event, check);
  for (const event of documentEvents) documentTarget.addEventListener(event, check);
  check();
  return () => {
    timers.clearInterval(timer);
    for (const event of windowEvents) windowTarget.removeEventListener(event, check);
    for (const event of documentEvents)
      documentTarget.removeEventListener(event, check);
  };
}

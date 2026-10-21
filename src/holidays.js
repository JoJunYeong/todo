export const HOLIDAY_SOURCE = "https://holidays.dist.be";
export const HOLIDAY_TTL = 24 * 60 * 60 * 1000;
const key = (year) => `daynote:kr-holidays:v1:${year}`;
const validYear = (year) =>
  Number.isInteger(year) && year >= 1900 && year <= 2200;

export function normalizeHolidays(records, year) {
  if (!validYear(year) || !Array.isArray(records) || records.length > 1000)
    throw Error("공휴일 정보 형식이 올바르지 않아요.");
  const result = {};
  for (const row of records) {
    if (row?.holiday !== true || row.kind !== 1) continue;
    if (
      typeof row.date !== "string" ||
      !new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(row.date) ||
      !Number.isFinite(Date.parse(row.date + "T12:00:00Z")) ||
      new Date(row.date + "T12:00:00Z").toISOString().slice(0, 10) !==
        row.date ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 150
    )
      throw Error("공휴일 정보 형식이 올바르지 않아요.");
    const names = (result[row.date] ||= []);
    if (!names.includes(row.name.trim())) names.push(row.name.trim());
  }
  if (Object.keys(result).length < 5)
    throw Error("해당 연도의 공휴일 정보가 아직 충분하지 않아요.");
  return result;
}

export function readHolidayCache(storage, year, now = Date.now()) {
  try {
    const raw = storage?.getItem(key(year));
    if (!raw || raw.length > 100000) return null;
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      value.year !== year ||
      !Number.isFinite(value.fetchedAt) ||
      value.fetchedAt > now + 60000 ||
      !Array.isArray(value.records)
    )
      return null;
    return {
      days: normalizeHolidays(value.records, year),
      fetchedAt: value.fetchedAt,
    };
  } catch {
    return null;
  }
}

export async function loadHolidayYear(
  year,
  { storage, fetcher = fetch, force = false, now = Date.now() } = {},
) {
  if (!validYear(year)) throw Error("지원하지 않는 연도예요.");
  const cached = readHolidayCache(storage, year, now);
  if (!force && cached && now - cached.fetchedAt < HOLIDAY_TTL)
    return { ...cached, stale: false };
  try {
    const response = await fetcher(`${HOLIDAY_SOURCE}/${year}.json`, {
      credentials: "omit",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("공휴일 정보를 가져오지 못했어요.");
    const records = await response.json();
    const days = normalizeHolidays(records, year);
    try {
      storage?.setItem(
        key(year),
        JSON.stringify({
          version: 1,
          year,
          fetchedAt: now,
          records: records.filter(
            (row) => row.holiday === true && row.kind === 1,
          ),
        }),
      );
    } catch {
      /* Storage availability must not block the calendar. */
    }
    return { days, fetchedAt: now, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}

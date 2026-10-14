/** Date helpers for wall-clock times in the configured timezone (e.g. "10:00 in Asia/Dhaka"). */

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

/** Offset of the timezone from UTC at a given instant, in milliseconds. */
function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-10-15" + "10:00" in timeZone -> UTC Date. */
export function zonedToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Second pass handles DST edges where the offset differs at the target instant.
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** YYYY-MM-DD of an instant in timeZone. */
export function zonedDate(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Adds days to a YYYY-MM-DD string. */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** [start, end) of the calendar day containing `date` in timeZone, as UTC Dates. */
export function dayRangeUtc(date, timeZone) {
  const day = zonedDate(date, timeZone);
  return [zonedToUtc(day, '00:00', timeZone), zonedToUtc(addDays(day, 1), '00:00', timeZone)];
}

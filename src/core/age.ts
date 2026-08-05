const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How old a snapshot reads to a person. Rounded down: "3 min ago" is never optimistic. */
export function describeAge(capturedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - capturedAt));
  if (seconds < MINUTE) {
    return "just now";
  }
  if (seconds < HOUR) {
    return `${Math.floor(seconds / MINUTE)} min ago`;
  }
  if (seconds < DAY) {
    return `${Math.floor(seconds / HOUR)} h ago`;
  }
  return `${Math.floor(seconds / DAY)} d ago`;
}

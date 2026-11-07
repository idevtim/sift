const DAY = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "5 days ago", "3 months ago", "2 years ago". */
export function ago(ms: number, now = Date.now()): string {
  const days = Math.floor((now - ms) / DAY);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/** At least a month ago — shown in sand ("take a look") on Apps. */
export const isStale = (ms: number) => Date.now() - ms >= 30 * DAY;

export const daysSince = (ms: number) => (Date.now() - ms) / DAY;

/** "Sep 2, 2023" */
export const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

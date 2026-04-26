/**
 * IM-style relative time formatter — closer to WeChat / WhatsApp than to
 * "X minutes ago" verbose forms. Used by sidebar rows to show when a
 * project was last active in a single short token.
 *
 * Rules (en):
 *   < 1 min    → "just now"
 *   < 1 hour   → "5m"
 *   < 1 day    → "14:32"        (HH:MM)
 *   < 7 days   → "Tue"          (weekday short)
 *   else       → "12/15"        (month/day, no year for simplicity)
 *
 * For zh, we replace "just now" → "刚刚", weekday → "周二", and use
 * 24-hour clock all the way.
 */

export function formatRelativeIM(iso: string | null, lang: "en" | "zh" = "en"): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 0) return formatTime(then);

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return lang === "zh" ? "刚刚" : "just now";
  if (diffMin < 60) return lang === "zh" ? `${diffMin}分钟` : `${diffMin}m`;

  const diffHr = Math.floor(diffMs / 3_600_000);
  // Same calendar day → show clock time.
  if (isSameDay(then, now)) return formatTime(then);

  // Yesterday: explicit label
  if (isYesterday(then, now)) return lang === "zh" ? "昨天" : "Yesterday";

  // Within a week: weekday
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) {
    const d = new Date(then).getDay();
    return lang === "zh" ? `周${ZH_WEEKDAYS[d]}` : EN_WEEKDAYS[d];
  }

  // Older: month/day
  const date = new Date(then);
  return lang === "zh"
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getMonth() + 1}/${date.getDate()}`;
}

const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function isYesterday(then: number, now: number): boolean {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return isSameDay(then, d.getTime());
}

/**
 * Format a date as an IM-style chat divider label.
 *
 * Used between message groups when the gap exceeds a threshold (e.g.
 * iMessage / Telegram / WhatsApp date-time markers). Uses 24h time for
 * locale-neutral readability.
 *
 * Examples (assuming today is Apr 27 2026):
 *   - same day:        "14:32"
 *   - yesterday:       "Yesterday · 14:32"
 *   - within 7 days:   "Mon · 14:32"
 *   - older same year: "Apr 22 · 14:32"
 *   - older year:      "Apr 22, 2024 · 14:32"
 */
export function formatTimeMarker(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const startOfNow = new Date(now);
  startOfNow.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfNow.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDiff <= 0) {
    return time;
  }
  if (dayDiff === 1) {
    return `Yesterday · ${time}`;
  }
  if (dayDiff < 7) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
    return `${weekday} · ${time}`;
  }

  const sameYear = now.getFullYear() === date.getFullYear();
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${dateLabel} · ${time}`;
}

/**
 * Format a date as a human-friendly relative time string
 * Examples: "just now", "5m ago", "2h ago", "3d ago", "Jan 15"
 */
export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) {
    return "just now";
  }

  if (diffMin < 1) {
    return `${diffSec}s ago`;
  }

  if (diffHour < 1) {
    return `${diffMin}m ago`;
  }

  if (diffDay < 1) {
    return `${diffHour}h ago`;
  }

  if (diffDay < 7) {
    return `${diffDay}d ago`;
  }

  // For older dates, show abbreviated month and day
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  return `${month} ${day}`;
}

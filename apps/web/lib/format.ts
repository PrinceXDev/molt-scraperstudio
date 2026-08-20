/** Presentation-only formatting. No logic that affects a verdict lives here. */

export function percent(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export function magnitude(value: number): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return rounded.toLocaleString('en-US');
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function timeOnly(iso: string): string {
  return iso.slice(11, 19);
}

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** `field` / `fields`. */
export function fieldWord(n: number): string {
  return n === 1 ? 'field' : 'fields';
}

/**
 * Formatting helpers for heal prompts.
 *
 * The prompt is read by an AI code-refactor tool, so it is written as plain
 * prose with backticked identifiers rather than as a data dump. Precision
 * matters more than brevity right up to the 1,000-character limit.
 */

/**
 * A fill rate as a percentage, without trailing noise.
 *
 * `1` renders as `100%`, not `100.0%`; `0.982` as `98.2%`. Exact integers read
 * as deliberate measurements, which is what they are.
 */
export function percent(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

/** A count with thousands separators, so 24300 reads as 24,300. */
export function count(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * A magnitude, rendered for a human.
 *
 * Magnitudes are medians of prices, character lengths or list sizes, so a
 * fractional value is an artefact of averaging two samples rather than
 * meaningful precision.
 */
export function magnitude(value: number): string {
  return Number.isInteger(value) ? count(value) : count(Math.round(value * 10) / 10);
}

/** Backtick an identifier so the healer treats it as a field name. */
export function code(name: string): string {
  return `\`${name}\``;
}

/**
 * Join names as English prose: "`a`", "`a` and `b`", "`a`, `b` and `c`".
 *
 * When there are more names than `limit`, the remainder is summarised rather
 * than listed, which keeps a wide schema from consuming the character budget.
 */
export function nameList(names: readonly string[], limit = 6): string {
  const quoted = names.map(code);

  if (quoted.length === 0) return '';
  if (quoted.length === 1) return quoted[0] ?? '';

  if (quoted.length > limit) {
    const shown = quoted.slice(0, limit).join(', ');
    return `${shown} and ${quoted.length - limit} more`;
  }

  const last = quoted.at(-1) ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${last}`;
}

/** `field` for one, `fields` for several. */
export function fieldWord(n: number): string {
  return n === 1 ? 'field' : 'fields';
}

/** Just the date portion of an ISO timestamp, for compact prose. */
export function isoDate(timestamp: string): string {
  const [date] = timestamp.split('T');
  return date ?? timestamp;
}

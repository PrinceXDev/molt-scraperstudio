/**
 * Row projection.
 *
 * Scraper Studio's AI frequently produces a nested output schema: one row per
 * page, each containing an array of the records actually on that page. The
 * primary collector is exactly this shape —
 *
 * ```json
 * { "security_advisories": [ { "cve_id": "…", "cvss_score": "4.2", … } ],
 *   "product_page_url": "https://…", "input": { "url": "…" } }
 * ```
 *
 * — where 70 returned rows carry 327 real records between them.
 *
 * Fill-rate analysis has to run over the records, not the wrappers: a wrapper
 * row's `security_advisories` key is present even when every advisory inside it
 * has lost its `cvss_score`. Projection flattens the payload into the rows that
 * actually matter, and it happens here at the I/O boundary so `@molt/health`
 * stays a pure function over flat rows.
 */

export type UnknownRecord = Record<string, unknown>;

export interface RowProjection {
  /**
   * Dot path to an array of records nested inside each returned row, e.g.
   * `"security_advisories"`. Omit for collectors that are already flat.
   */
  readonly recordPath?: string;
  /**
   * Keys on the wrapper row to merge into each extracted record — typically the
   * page URL, so a record can still be traced to its source after flattening.
   */
  readonly inherit?: readonly string[];
}

/** Read a dot-delimited path out of a record without throwing. */
export function readPath(source: UnknownRecord, path: string): unknown {
  const segments = path.split('.').filter((s) => s !== '');

  let cursor: unknown = source;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as UnknownRecord)[segment];
  }

  return cursor;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Flatten returned rows into the records to analyse.
 *
 * A wrapper whose `recordPath` is missing, empty or not an array contributes no
 * records. That is deliberate and it is the correct signal: if the nested array
 * disappears, the projected row count collapses, and an empty harvest is
 * precisely what Molt should report.
 */
export function projectRows(
  rows: readonly unknown[],
  projection: RowProjection = {},
): UnknownRecord[] {
  const { recordPath, inherit = [] } = projection;

  if (recordPath === undefined || recordPath === '') {
    return rows.filter(isRecord);
  }

  const projected: UnknownRecord[] = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;

    const nested = readPath(row, recordPath);
    if (!Array.isArray(nested)) continue;

    const inherited: UnknownRecord = {};
    for (const key of inherit) {
      const value = readPath(row, key);
      if (value !== undefined) inherited[key] = value;
    }

    for (const record of nested) {
      if (!isRecord(record)) continue;
      // Inherited keys first, so a child field of the same name wins.
      projected.push({ ...inherited, ...record });
    }
  }

  return projected;
}

/**
 * `@molt/diagnose` — evidence becomes a prompt.
 *
 * The step almost every self-healing demo skips: a human reads the failure and
 * types a description of it. Molt derives the description from measured drift,
 * which is why its heals tend to land on the first attempt — the prompt names
 * the dead fields, their before-and-after fill rates, and, crucially, the fields
 * that are *still working* so the healer knows not to touch them.
 *
 * Pure and deterministic. No network, no clock, no model required.
 */

export { diagnose, HEAL_PROMPT_MAX_CHARS, type Diagnosis, type DiagnoseOptions } from './prompt.js';

export { code, count, fieldWord, isoDate, magnitude, nameList, percent } from './format.js';

export {
  buildReviewRows,
  isSampleTooSmallToCompare,
  COMPARABLE_SAMPLE_RATIO,
  type ReviewRow,
} from './review.js';

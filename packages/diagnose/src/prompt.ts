import type { FaultFinding, HealthReport } from '@molt/health';

import { code, count, fieldWord, isoDate, magnitude, nameList, percent } from './format.js';
import type { PromptPreferences } from './learning.js';

/**
 * `bdata scraper heal` rejects a prompt longer than this.
 * Verified from `bdata scraper heal --help`: "prompt  What is broken / what to
 * fix (max 1000 chars)".
 */
export const HEAL_PROMPT_MAX_CHARS = 1000;

export interface DiagnoseOptions {
  /** Hard ceiling on the generated prompt. Defaults to the CLI's own limit. */
  readonly maxChars?: number;
  /**
   * What past heal outcomes say the prompt should look like — see
   * `learning.ts`. Absent or all-null preferences leave the template exactly
   * as it was, so the learner can never make the deterministic path worse.
   */
  readonly preferences?: PromptPreferences;
}

export interface Diagnosis {
  /** Ready to pass to `bdata scraper heal`. Never exceeds `maxChars`. */
  readonly prompt: string;
  readonly charCount: number;
  /** True when a lower-priority section had to be dropped to fit. */
  readonly truncated: boolean;
  /** Fields the prompt asks the healer to fix. */
  readonly targetFields: readonly string[];
  /** Fields reported as still working, to help the healer localise. */
  readonly unaffectedFields: readonly string[];
}

/**
 * A prompt section.
 *
 * `order` is where it reads in the finished prompt; `weight` is how hard it
 * fights for the character budget (lower wins). `required` sections are never
 * dropped — losing the instruction would leave the healer with a description of
 * the problem and no request to fix it.
 */
interface Section {
  readonly order: number;
  readonly weight: number;
  readonly required: boolean;
  readonly text: string;
}

/** Fields worth asking the healer to re-capture. `appeared` is not a fault. */
function targetsOf(faults: readonly FaultFinding[]): string[] {
  return [...new Set(faults.map((f) => f.field))];
}

/** Describe the dead fields — the headline, and the reason for the heal. */
function describeCollapsed(faults: readonly FaultFinding[], report: HealthReport): string | null {
  const collapsed = faults.filter(
    (f): f is Extract<FaultFinding, { kind: 'collapsed' }> => f.kind === 'collapsed',
  );
  if (collapsed.length === 0) return null;

  const names = nameList(collapsed.map((f) => f.field));
  const word = fieldWord(collapsed.length);
  const verb = collapsed.length === 1 ? 'returns' : 'return';

  // Baseline rates are near-identical in practice, so report the range rather
  // than repeating a number per field and spending the budget on it.
  const rates = collapsed.map((f) => f.baselineRate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const wasText = lo === hi ? percent(lo) : `${percent(lo)}–${percent(hi)}`;

  return (
    `${word[0]?.toUpperCase()}${word.slice(1)} ${names} ${verb} empty on every row ` +
    `as of ${isoDate(report.candidateCapturedAt)}. ` +
    `On ${isoDate(report.baselineCapturedAt)} ${collapsed.length === 1 ? 'it filled' : 'they filled'} ` +
    `${wasText} of ${count(report.baselineRowCount)} rows; ` +
    `now 0% of ${count(report.candidateRowCount)} rows.`
  );
}

/** A field gone from the output entirely, rather than merely empty. */
function describeVanished(faults: readonly FaultFinding[]): string | null {
  const vanished = faults.filter((f) => f.kind === 'vanished');
  if (vanished.length === 0) return null;

  const names = nameList(vanished.map((f) => f.field));
  return (
    `${fieldWord(vanished.length) === 'field' ? 'Field' : 'Fields'} ${names} ` +
    `${vanished.length === 1 ? 'is' : 'are'} absent from the output entirely.`
  );
}

/** Values still present but wrong — the failure a null check cannot see. */
function describeDistorted(faults: readonly FaultFinding[]): string | null {
  const distorted = faults.filter(
    (f): f is Extract<FaultFinding, { kind: 'distorted' }> => f.kind === 'distorted',
  );
  if (distorted.length === 0) return null;

  const parts = distorted.map(
    (f) =>
      `${code(f.field)} still fills but its values changed scale ` +
      `(typical value was ${magnitude(f.baselineMagnitude)}, now ${magnitude(f.currentMagnitude)})`,
  );

  return `${parts.join('; ')}.`;
}

/** Variety gone: one repeated value where the baseline had many. */
function describeFlatlined(faults: readonly FaultFinding[]): string | null {
  const flat = faults.filter(
    (f): f is Extract<FaultFinding, { kind: 'flatlined' }> => f.kind === 'flatlined',
  );
  if (flat.length === 0) return null;

  const parts = flat.map(
    (f) =>
      `${code(f.field)} now returns the same single value on every row ` +
      `(baseline had ${count(f.baselineDistinct)} distinct values)`,
  );

  return `${parts.join('; ')}.`;
}

/** Partial loss — often a pagination or region failure rather than a rename. */
function describeDegraded(faults: readonly FaultFinding[]): string | null {
  const degraded = faults.filter(
    (f): f is Extract<FaultFinding, { kind: 'degraded' }> => f.kind === 'degraded',
  );
  if (degraded.length === 0) return null;

  const parts = degraded.map(
    (f) => `${code(f.field)} fell from ${percent(f.baselineRate)} to ${percent(f.currentRate)}`,
  );

  return `Partial loss: ${parts.join('; ')}.`;
}

/**
 * Name what still works.
 *
 * This is the highest-leverage sentence in the prompt. Telling the healer which
 * fields are unaffected localises the change: if `title` still extracts and
 * `cvss_score` does not, the markup around one value moved rather than the whole
 * page being rebuilt. Without it the healer is far likelier to rewrite the
 * entire scraper and regress a working field.
 */
function describeUnaffected(report: HealthReport): string | null {
  const healthy = report.findings.filter((f) => f.kind === 'healthy').map((f) => f.field);
  if (healthy.length === 0) return null;

  return (
    `${fieldWord(healthy.length) === 'field' ? 'Field' : 'Fields'} ${nameList(healthy)} ` +
    `${healthy.length === 1 ? 'is' : 'are'} unaffected and still extracting normally — ` +
    `leave ${healthy.length === 1 ? 'it' : 'them'} as ${healthy.length === 1 ? 'it is' : 'they are'}.`
  );
}

function describeEmptyHarvest(report: HealthReport): string {
  return (
    `The scraper now returns no rows at all ` +
    `(${count(report.candidateRowCount)}, against ${count(report.baselineRowCount)} on ` +
    `${isoDate(report.baselineCapturedAt)}). The page structure the scraper walks to find records ` +
    `appears to have changed.`
  );
}

function instruction(report: HealthReport, targets: readonly string[]): string {
  if (report.emptyHarvest) {
    return 'Re-establish how records are located on the page, then re-capture all fields.';
  }

  if (targets.length === 0) return 'Verify the extraction still matches the page.';

  // Bounded by `nameList`: a 40-field schema losing half its fields would
  // otherwise produce an instruction longer than the entire budget, and the
  // instruction is the one section that must always survive.
  return `Re-capture ${nameList(targets)} from the current markup, keeping the existing field names.`;
}

/**
 * Turn a health report into a heal prompt.
 *
 * Deterministic and pure — the same report always yields the same prompt, so
 * the wording can be pinned by tests and no second vendor is required to
 * produce a usable one. An LLM pass can refine the phrasing later, but this is
 * the path that must always work.
 *
 * Sections are assembled by priority and dropped from the least important end
 * if the budget runs out, so the result is always a valid, coherent prompt
 * rather than a sentence cut in half.
 */
export function diagnose(report: HealthReport, options: DiagnoseOptions = {}): Diagnosis {
  const maxChars = options.maxChars ?? HEAL_PROMPT_MAX_CHARS;
  const { faults } = report;
  const targets = targetsOf(faults);

  // Fault descriptions in reading order. The first one present is the headline
  // and is never dropped; the rest are supporting context.
  const faultTexts: Array<string | null> = report.emptyHarvest
    ? [describeEmptyHarvest(report), null, null, null, null]
    : [
        describeCollapsed(faults, report),
        describeVanished(faults),
        describeDistorted(faults),
        describeFlatlined(faults),
        describeDegraded(faults),
      ];

  const sections: Section[] = [];
  let leadClaimed = false;

  faultTexts.forEach((text, index) => {
    if (text === null) return;

    const isLead = !leadClaimed;
    leadClaimed = true;

    sections.push({
      order: index,
      // The headline outranks everything; later fault detail yields to the
      // instruction, which a healer cannot act without.
      weight: isLead ? 0 : 2 + index,
      required: isLead,
      text,
    });
  });

  sections.push({ order: 5, weight: 1, required: true, text: instruction(report, targets) });

  const unaffected = report.findings.filter((f) => f.kind === 'healthy').map((f) => f.field);
  const unaffectedText = describeUnaffected(report);
  const preferUnaffected = options.preferences?.preferUnaffected ?? null;

  // The one learnable knob. History saying "prompts that name the working
  // fields land first-try more often" promotes the section ahead of
  // lower-priority fault detail in the fight for the budget; history saying
  // the opposite drops it and spends the characters on evidence instead. No
  // opinion leaves the long-standing default: nice to have, first to go.
  if (unaffectedText !== null && preferUnaffected !== false) {
    sections.push({
      order: 6,
      weight: preferUnaffected === true ? 2 : 10,
      required: false,
      text: unaffectedText,
    });
  }

  const kept: Section[] = [];
  let length = 0;
  let truncated = false;

  // Required sections are reserved first, so a large headline can never cause
  // the instruction to be sacrificed for a merely nice-to-have section.
  for (const section of sections.filter((s) => s.required)) {
    kept.push(section);
    length += (length === 0 ? 0 : 1) + section.text.length;
  }

  for (const section of sections.filter((s) => !s.required).sort((a, b) => a.weight - b.weight)) {
    const cost = (length === 0 ? 0 : 1) + section.text.length;
    if (length + cost > maxChars) {
      truncated = true;
      continue;
    }
    kept.push(section);
    length += cost;
  }

  const prompt = kept
    .sort((a, b) => a.order - b.order)
    .map((s) => s.text)
    .join(' ');

  // Last resort. Only reachable if the required sections alone overflow, which
  // needs an extreme schema; better a clipped prompt than a rejected call.
  const bounded = prompt.length > maxChars ? clip(prompt, maxChars) : prompt;

  return {
    prompt: bounded,
    charCount: bounded.length,
    truncated: truncated || bounded !== prompt,
    targetFields: targets,
    unaffectedFields: unaffected,
  };
}

/** Clip to a sentence boundary where possible, so the result still reads. */
function clip(text: string, maxChars: number): string {
  const head = text.slice(0, maxChars);
  const lastStop = head.lastIndexOf('. ');

  return lastStop > maxChars / 2 ? head.slice(0, lastStop + 1) : head.trimEnd();
}

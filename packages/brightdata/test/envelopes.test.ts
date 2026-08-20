import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseJsonFromStdout } from '../src/command.js';
import {
  createEnvelopeSchema,
  extractRows,
  healEnvelopeSchema,
  isAwaitingApproval,
  isCollectorId,
  isFailureStatus,
  isHealBlocked,
  isSuccessStatus,
} from '../src/envelopes.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));
}

describe('collector ids', () => {
  it('accepts a real id', () => {
    expect(isCollectorId('c_mt0z2fn11aj6lk4bdz')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isCollectorId('j_abc123')).toBe(false);
    expect(isCollectorId('mt0z2fn11aj6lk4bdz')).toBe(false);
    expect(isCollectorId('c_')).toBe(false);
    expect(isCollectorId(42)).toBe(false);
  });
});

describe('create envelope — real captured output', () => {
  it('parses the success envelope from collector c_mt0z2fn11aj6lk4bdz', () => {
    const parsed = createEnvelopeSchema.parse(fixture('create-success.json'));

    expect(parsed.collector_id).toBe('c_mt0z2fn11aj6lk4bdz');
    expect(parsed.status).toBe('done');
    expect(isSuccessStatus(parsed.status)).toBe(true);
    expect(parsed.error).toBeUndefined();

    // All nine AI pipeline stages ran. Note that Bright Data's own step name
    // contains a typo (`collector_mainatiner`), which is exactly why these are
    // carried through as opaque strings rather than a closed enum.
    expect(parsed.completed_steps).toHaveLength(9);
    expect(parsed.completed_steps?.at(-1)).toBe('preview_picker');
  });

  it('parses a failure envelope and still surfaces the orphaned collector', () => {
    // A template is created before generation runs, so a failed create leaves a
    // half-built collector behind. Molt has to record the id to report it.
    const parsed = createEnvelopeSchema.parse(fixture('create-failed.json'));

    expect(parsed.status).toBe('failed');
    expect(isFailureStatus(parsed.status)).toBe(true);
    expect(parsed.collector_id).toMatch(/^c_/);
    expect(parsed.completed_steps).toEqual(['prepare_intent_analyzer']);
    expect(parsed.error).toContain('failed');
  });

  it('tolerates unknown fields a future CLI release might add', () => {
    const parsed = createEnvelopeSchema.parse({
      collector_id: 'c_abc123',
      status: 'done',
      something_new: { nested: true },
    });

    expect(parsed.collector_id).toBe('c_abc123');
    expect(parsed['something_new']).toEqual({ nested: true });
  });

  it('rejects an envelope missing the collector id', () => {
    expect(() => createEnvelopeSchema.parse({ status: 'done' })).toThrow();
  });
});

describe('heal envelope', () => {
  it('recognises the approval gate', () => {
    const parsed = healEnvelopeSchema.parse({
      collector_id: 'c_abc123',
      status: 'awaiting_approval',
      prompt: 'cvss_score returns null',
      next_step: 'Run `bdata scraper approve c_abc123`',
      preview_result: [{ cve_id: 'CVE-2026-1', cvss_score: '4.2' }],
    });

    expect(isAwaitingApproval(parsed)).toBe(true);
    expect(isSuccessStatus(parsed.status)).toBe(false);
    expect(extractRows(parsed.preview_result)).toHaveLength(1);
  });

  it('recognises a completed heal', () => {
    const parsed = healEnvelopeSchema.parse({ collector_id: 'c_abc123', status: 'done' });

    expect(isAwaitingApproval(parsed)).toBe(false);
    expect(isSuccessStatus(parsed.status)).toBe(true);
  });

  it('is case- and separator-insensitive about the gate status', () => {
    expect(isAwaitingApproval({ status: 'Awaiting_Approval' })).toBe(true);
    expect(isAwaitingApproval({ status: ' awaiting-approval ' })).toBe(true);
  });
});

describe('isHealBlocked', () => {
  // Scraper Studio allows one refactor job per collector. The real stderr:
  const STDERR_409 =
    'Triggering self-healing...\n' +
    'Failed to start self-healing for collector c_mt101cvbc0o34ghzh: Error: Another refactor job is still in progress\n' +
    '  Status: 409\n';

  it('recognises the envelope status', () => {
    expect(isHealBlocked({ status: 'heal_trigger_failed' })).toBe(true);
  });

  it('recognises the message even without the status', () => {
    expect(isHealBlocked({ status: 'failed' }, STDERR_409)).toBe(true);
  });

  it('does not confuse it with an ordinary failure', () => {
    // The distinction is load-bearing: an ordinary failure consumes a retry
    // attempt, a blocked heal must not, because retrying cannot help.
    expect(isHealBlocked({ status: 'failed' }, 'AI generation failed')).toBe(false);
    expect(isHealBlocked({ status: 'awaiting_approval' })).toBe(false);
    expect(isHealBlocked({ status: 'done' })).toBe(false);
  });
});

describe('the real awaiting_approval envelope', () => {
  // Captured from a genuine heal of c_mt101cvbc0o34ghzh on 2026-08-20.
  const envelope = healEnvelopeSchema.parse(fixture('heal-awaiting-approval.json'));

  it('stops at the approval gate', () => {
    expect(isAwaitingApproval(envelope)).toBe(true);
    expect(isHealBlocked(envelope)).toBe(false);
  });

  it('carries a preview of what the fixed scraper would return', () => {
    const rows = extractRows(envelope.preview_result);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('names the command that commits it', () => {
    expect(envelope.next_step).toContain('bdata scraper approve');
  });

  it('carries the two fields the docs omit', () => {
    expect(envelope.diff_summary).toContain('proposed template');
    expect(envelope.completed_steps).toContain('request_fulfillment_validator');
  });
});

describe('extractRows', () => {
  it('handles a bare array, which is what `scraper run` returned', () => {
    expect(extractRows(fixture('run-pg-advisories.json'))).toHaveLength(8);
  });

  it('handles the documented wrapper shapes', () => {
    expect(extractRows({ data: [{ a: 1 }, { a: 2 }] })).toHaveLength(2);
    expect(extractRows({ results: [{ a: 1 }] })).toHaveLength(1);
    expect(extractRows({ rows: [{ a: 1 }] })).toHaveLength(1);
  });

  it('wraps a single record response', () => {
    expect(extractRows({ cve_id: 'CVE-2026-1' })).toEqual([{ cve_id: 'CVE-2026-1' }]);
  });

  it('returns nothing for a payload with no rows', () => {
    expect(extractRows(null)).toEqual([]);
    expect(extractRows('text')).toEqual([]);
    expect(extractRows(undefined)).toEqual([]);
  });

  it('drops non-record entries inside an array', () => {
    expect(extractRows([{ a: 1 }, null, 'x'])).toEqual([{ a: 1 }]);
  });
});

describe('parseJsonFromStdout', () => {
  it('finds the envelope among interleaved progress lines', () => {
    // The real failure mode: the CLI prints human progress to the same stream as
    // the JSON, so a bare JSON.parse of stdout throws.
    const stdout = [
      'Creating scraper template...',
      'Template created: c_mt0z2fn11aj6lk4bdz',
      'Step: code_generator — polling (attempt 112/600)',
      'Done in 122 poll attempts.',
      '{"collector_id":"c_mt0z2fn11aj6lk4bdz","status":"done"}',
    ].join('\n');

    expect(parseJsonFromStdout(stdout)).toEqual({
      collector_id: 'c_mt0z2fn11aj6lk4bdz',
      status: 'done',
    });
  });

  it('parses stdout that is pure JSON', () => {
    expect(parseJsonFromStdout('{"a":1}')).toEqual({ a: 1 });
  });

  it('finds a JSON array among progress lines', () => {
    expect(parseJsonFromStdout('Running...\n[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('returns undefined when there is no JSON at all', () => {
    expect(parseJsonFromStdout('Error: No API key found.')).toBeUndefined();
    expect(parseJsonFromStdout('   ')).toBeUndefined();
  });
});

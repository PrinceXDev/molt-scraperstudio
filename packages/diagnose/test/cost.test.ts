import { describe, expect, it } from 'vitest';

import { costOfSilence, describeCostOfSilence, formatDuration } from '../src/cost.js';

describe('formatDuration', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('renders sub-hour durations in minutes and seconds', () => {
    expect(formatDuration(9 * 60_000 + 12_000)).toBe('9m 12s');
    // Exactly on a minute boundary: no trailing "0s" noise.
    expect(formatDuration(14 * 60_000)).toBe('14m');
  });

  it('renders sub-day durations in hours and minutes', () => {
    expect(formatDuration(14 * 3_600_000 + 32 * 60_000)).toBe('14h 32m');
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
  });

  it('renders multi-day durations in days and hours', () => {
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h');
    expect(formatDuration(2 * 86_400_000)).toBe('2d');
  });

  it('never goes negative', () => {
    expect(formatDuration(-500)).toBe('0s');
  });
});

describe('costOfSilence', () => {
  it('measures a resolved incident against its close time, not now', () => {
    const cost = costOfSilence({
      openedAt: '2026-08-20T00:00:00.000Z',
      closedAt: '2026-08-20T14:32:00.000Z',
      now: '2026-08-25T00:00:00.000Z', // long after — must be ignored once closed
      badRuns: 4,
    });

    expect(cost.durationMs).toBe(14 * 3_600_000 + 32 * 60_000);
    expect(cost.duration).toBe('14h 32m');
    expect(cost.ongoing).toBe(false);
    expect(cost.badRuns).toBe(4);
  });

  it('measures an open incident against "now"', () => {
    const cost = costOfSilence({
      openedAt: '2026-08-20T00:00:00.000Z',
      closedAt: null,
      now: '2026-08-20T03:00:00.000Z',
      badRuns: 2,
    });

    expect(cost.durationMs).toBe(3 * 3_600_000);
    expect(cost.ongoing).toBe(true);
  });

  it('floors bad run counts at zero and duration at zero', () => {
    const cost = costOfSilence({
      openedAt: '2026-08-20T00:00:00.000Z',
      closedAt: '2026-08-20T00:00:00.000Z',
      now: '2026-08-20T00:00:00.000Z',
      badRuns: -3,
    });

    expect(cost.durationMs).toBe(0);
    expect(cost.badRuns).toBe(0);
  });
});

describe('describeCostOfSilence', () => {
  it('phrases a resolved incident in the past tense', () => {
    const cost = costOfSilence({
      openedAt: '2026-08-20T00:00:00.000Z',
      closedAt: '2026-08-20T03:00:00.000Z',
      now: '2026-08-20T03:00:00.000Z',
      badRuns: 1,
    });

    expect(describeCostOfSilence(cost)).toBe('data was wrong for 3h, across 1 run');
  });

  it('phrases an open incident as ongoing', () => {
    const cost = costOfSilence({
      openedAt: '2026-08-20T00:00:00.000Z',
      closedAt: null,
      now: '2026-08-20T03:00:00.000Z',
      badRuns: 3,
    });

    expect(describeCostOfSilence(cost)).toBe('data has been wrong for 3h so far, across 3 runs');
  });
});

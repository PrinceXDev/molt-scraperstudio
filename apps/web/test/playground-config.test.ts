import { afterEach, describe, expect, it } from 'vitest';

import { isCreateEnabled, isLiveCheckEnabled } from '../lib/playground-config.js';

const ORIGINAL_LIVE = process.env['MOLT_PLAYGROUND_LIVE'];
const ORIGINAL_CREATE = process.env['MOLT_PLAYGROUND_CREATE'];

afterEach(() => {
  if (ORIGINAL_LIVE === undefined) delete process.env['MOLT_PLAYGROUND_LIVE'];
  else process.env['MOLT_PLAYGROUND_LIVE'] = ORIGINAL_LIVE;

  if (ORIGINAL_CREATE === undefined) delete process.env['MOLT_PLAYGROUND_CREATE'];
  else process.env['MOLT_PLAYGROUND_CREATE'] = ORIGINAL_CREATE;
});

describe('isLiveCheckEnabled', () => {
  it('is off when the variable is unset', () => {
    delete process.env['MOLT_PLAYGROUND_LIVE'];
    expect(isLiveCheckEnabled()).toBe(false);
  });

  it('is on only for exactly "1"', () => {
    process.env['MOLT_PLAYGROUND_LIVE'] = '1';
    expect(isLiveCheckEnabled()).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', '', 'true', 'yes', '2'])('stays off for %o', (value) => {
    // The failure mode this guards: a truthiness check would read
    // MOLT_PLAYGROUND_LIVE=0 and MOLT_PLAYGROUND_LIVE=false as *enabled*,
    // turning a variable someone set to switch credit spending off into the
    // thing that switched it on.
    process.env['MOLT_PLAYGROUND_LIVE'] = value;
    expect(isLiveCheckEnabled()).toBe(false);
  });
});

/**
 * The create flag gets the same enumeration as the live-check flag, and one
 * more case that matters only for this one: it must default off, and it must
 * be a genuinely separate switch from `MOLT_PLAYGROUND_LIVE` — a deployment
 * that turned on live checks must not have silently turned on collector
 * generation too, since the two do not carry the same risk (an orphaned,
 * non-deletable collector on a failed attempt).
 */
describe('isCreateEnabled', () => {
  it('is off when the variable is unset', () => {
    delete process.env['MOLT_PLAYGROUND_CREATE'];
    expect(isCreateEnabled()).toBe(false);
  });

  it('is on only for exactly "1"', () => {
    process.env['MOLT_PLAYGROUND_CREATE'] = '1';
    expect(isCreateEnabled()).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', '', 'true', 'yes', '2'])('stays off for %o', (value) => {
    process.env['MOLT_PLAYGROUND_CREATE'] = value;
    expect(isCreateEnabled()).toBe(false);
  });

  it('is independent of MOLT_PLAYGROUND_LIVE in both directions', () => {
    process.env['MOLT_PLAYGROUND_LIVE'] = '1';
    delete process.env['MOLT_PLAYGROUND_CREATE'];
    expect(isCreateEnabled()).toBe(false);

    delete process.env['MOLT_PLAYGROUND_LIVE'];
    process.env['MOLT_PLAYGROUND_CREATE'] = '1';
    expect(isLiveCheckEnabled()).toBe(false);
    expect(isCreateEnabled()).toBe(true);
  });
});

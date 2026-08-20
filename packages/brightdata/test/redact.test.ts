import { describe, expect, it } from 'vitest';

import { REDACTED, redactArgv, redactText } from '../src/redact.js';

// The 64-hex-character example from Bright Data's own authentication docs.
const HEX_KEY = 'b5648e1096c6442f60a6c4bbbe73f8d2234d3d8324554bd6a7ec8f3f251f07df';

const NO_ENV: NodeJS.ProcessEnv = {};

describe('redactText', () => {
  it('removes a long hex API key', () => {
    expect(redactText(`token=${HEX_KEY}`, NO_ENV)).toBe(`token=${REDACTED}`);
  });

  it('removes a bearer token while keeping the scheme', () => {
    expect(redactText('Authorization: Bearer abc.def.ghi', NO_ENV)).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it('removes a key that does not match the hex shape, using the environment', () => {
    // Pattern matching alone would miss this one.
    const env: NodeJS.ProcessEnv = { BRIGHTDATA_API_KEY: 'not-hex-but-still-secret' };

    expect(redactText('key is not-hex-but-still-secret here', env)).toBe(
      `key is ${REDACTED} here`,
    );
  });

  it('ignores environment values too short to redact safely', () => {
    // Redacting a two-character value would mangle unrelated text.
    const env: NodeJS.ProcessEnv = { BRIGHTDATA_API_KEY: 'ab' };

    expect(redactText('a stable cab', env)).toBe('a stable cab');
  });

  it('leaves ordinary output alone', () => {
    const line = 'Step: code_generator — polling (attempt 112/600)';
    expect(redactText(line, NO_ENV)).toBe(line);
  });

  it('does not redact a collector id', () => {
    // Collector ids are not secrets — they are the production endpoint, and the
    // whole submission depends on showing them.
    expect(redactText('c_mt0z2fn11aj6lk4bdz', NO_ENV)).toBe('c_mt0z2fn11aj6lk4bdz');
  });
});

describe('redactArgv', () => {
  it('redacts the argument following a secret flag', () => {
    expect(redactArgv(['scraper', 'run', '--api-key', 'whatever-value'], NO_ENV)).toEqual([
      'scraper',
      'run',
      '--api-key',
      REDACTED,
    ]);
  });

  it('redacts the inline form of a secret flag', () => {
    expect(redactArgv(['--api-key=whatever-value'], NO_ENV)).toEqual([`--api-key=${REDACTED}`]);
  });

  it('handles the short flag', () => {
    expect(redactArgv(['-k', HEX_KEY], NO_ENV)).toEqual(['-k', REDACTED]);
  });

  it('redacts a secret embedded in a positional argument', () => {
    expect(redactArgv(['scraper', 'run', `https://x/?t=${HEX_KEY}`], NO_ENV)).toEqual([
      'scraper',
      'run',
      `https://x/?t=${REDACTED}`,
    ]);
  });

  it('preserves a heal prompt verbatim', () => {
    const prompt = 'The cvss_score field returns null since the redesign.';
    expect(redactArgv(['scraper', 'heal', 'c_abc', prompt], NO_ENV)).toEqual([
      'scraper',
      'heal',
      'c_abc',
      prompt,
    ]);
  });

  it('does not mistake a value for a flag after redacting one', () => {
    expect(redactArgv(['-k', 'secret-value', '--pretty'], NO_ENV)).toEqual([
      '-k',
      REDACTED,
      '--pretty',
    ]);
  });
});

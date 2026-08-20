import { describe, expect, it } from 'vitest';

import {
  classifyCommand,
  DEFAULT_CREDIT_WEIGHTS,
  estimateCommandCredits,
  summariseCredits,
  type CreditWeights,
} from '../src/credits.js';

/**
 * Credits estimation, offline.
 *
 * Classification is what matters most here: it is derived from the same
 * `argv` `runCli` actually records, so these fixtures are the real shapes a
 * command row would carry, not invented ones.
 */

const NODE = 'C:\\node.exe';
const ENTRY = 'D:\\repo\\node_modules\\@brightdata\\cli\\dist\\index.js';

function argv(...verbAndArgs: string[]): string[] {
  return [NODE, ENTRY, 'scraper', ...verbAndArgs];
}

describe('classifyCommand', () => {
  it('recognises a run', () => {
    expect(classifyCommand(argv('run', 'c_x', 'https://example.com', '--json'))).toBe('run');
  });

  it('recognises a heal', () => {
    expect(classifyCommand(argv('heal', 'c_x', 'fix it', '--url', 'https://x', '--json'))).toBe(
      'heal',
    );
  });

  it('recognises a create', () => {
    expect(classifyCommand(argv('create', 'https://x', 'extract everything', '--json'))).toBe(
      'create',
    );
  });

  it('splits approve from reject on the flag, not the verb', () => {
    expect(classifyCommand(argv('approve', 'c_x', '--json'))).toBe('approve');
    expect(classifyCommand(argv('approve', 'c_x', '--reject', '--json'))).toBe('reject');
  });

  it('falls back to unknown for anything unrecognised', () => {
    expect(classifyCommand([])).toBe('unknown');
    expect(classifyCommand([NODE, ENTRY, 'login'])).toBe('unknown');
    expect(classifyCommand(argv('frobnicate'))).toBe('unknown');
  });

  it('is robust to the node executable and entry path, only the verb matters', () => {
    const differentMachine = [
      '/usr/local/bin/node',
      '/home/x/project/node_modules/@brightdata/cli/dist/index.js',
      'scraper',
      'run',
      'c_x',
    ];
    expect(classifyCommand(differentMachine)).toBe('run');
  });
});

describe('estimateCommandCredits', () => {
  it('charges the default weight per kind', () => {
    expect(estimateCommandCredits(argv('run', 'c_x'))).toBe(DEFAULT_CREDIT_WEIGHTS.run);
    expect(estimateCommandCredits(argv('heal', 'c_x', 'p'))).toBe(DEFAULT_CREDIT_WEIGHTS.heal);
    expect(estimateCommandCredits(argv('approve', 'c_x', '--reject'))).toBe(0);
  });

  it('honours custom weights', () => {
    const weights: CreditWeights = {
      run: 2,
      heal: 100,
      approve: 5,
      reject: 0,
      create: 100,
      unknown: 0,
    };
    expect(estimateCommandCredits(argv('run', 'c_x'), weights)).toBe(2);
    expect(estimateCommandCredits(argv('heal', 'c_x', 'p'), weights)).toBe(100);
  });

  it('never charges for an unclassifiable command', () => {
    expect(estimateCommandCredits([])).toBe(0);
  });
});

describe('summariseCredits', () => {
  it('sums and breaks down a mixed transcript', () => {
    const commands = [
      { argv: argv('run', 'c_x') },
      { argv: argv('run', 'c_x') },
      { argv: argv('heal', 'c_x', 'fix') },
      { argv: argv('approve', 'c_x') },
      { argv: argv('approve', 'c_x', '--reject') },
    ];

    const summary = summariseCredits(commands);

    expect(summary.commandCount).toBe(5);
    expect(summary.byKind.run).toBe(2 * DEFAULT_CREDIT_WEIGHTS.run);
    expect(summary.byKind.heal).toBe(DEFAULT_CREDIT_WEIGHTS.heal);
    expect(summary.byKind.approve).toBe(DEFAULT_CREDIT_WEIGHTS.approve);
    expect(summary.byKind.reject).toBe(0);
    expect(summary.total).toBe(
      2 * DEFAULT_CREDIT_WEIGHTS.run + DEFAULT_CREDIT_WEIGHTS.heal + DEFAULT_CREDIT_WEIGHTS.approve,
    );
  });

  it('is zero on an empty transcript', () => {
    const summary = summariseCredits([]);
    expect(summary.total).toBe(0);
    expect(summary.commandCount).toBe(0);
  });
});

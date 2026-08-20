#!/usr/bin/env node
import { openContext } from './context.js';
import {
  cmdAdd,
  cmdBaseline,
  cmdCheck,
  cmdCredits,
  cmdDecide,
  cmdDoctor,
  cmdInit,
  cmdLog,
  cmdReview,
  cmdStatus,
  cmdUnblock,
  cmdWatch,
} from './commands.js';
import { bold, brand, dim, heading, write, writeError } from './ui.js';

/**
 * `molt` — the command line for Scraper Reliability Engineering.
 *
 * The terminal is the primary interface. The web UI exists only for the one thing
 * a terminal genuinely cannot do: render a twenty-row, twelve-field before/after
 * data diff. Everything else is here.
 */

const USAGE = `
${bold('molt')} ${dim('— Scraper Reliability Engineering for Bright Data Scraper Studio')}

  ${bold('molt init')}                     register the configured collectors
  ${bold('molt doctor')}                   check the environment is set up to run Molt at all
  ${bold('molt add')} <url> <description…>  preflight a target, generate a collector, baseline it
  ${bold('molt check')} [primary|chaos|c_*] run a collector and report on its health
  ${bold('molt status')}                   fleet overview with per-field fill-rate history
  ${bold('molt credits')} [collector]       estimated credit spend, fleet-wide or per collector
  ${bold('molt watch')}                    advance every open incident as far as it can go
  ${bold('molt review')} [incident]        inspect a proposed fix before committing it
  ${bold('molt approve')} [incident]       commit the fix, then verify it actually worked
  ${bold('molt reject')} [incident]        decline the fix and try a sharper prompt
  ${bold('molt unblock')} [collector]      reject a pending heal that is blocking new ones
  ${bold('molt baseline')} <show|set|reset> [collector] [snapshotId]  manage what "healthy" means
  ${bold('molt log')} [n]                  transcript of every bdata command Molt has run

${dim('Exit codes:')} 0 ok · 1 usage · 2 collector broken · 3 awaiting approval
${dim('Powered by')} ${brand('Bright Data Scraper Studio')}
`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    write(USAGE);
    return command === undefined ? 1 : 0;
  }

  const context = await openContext();

  try {
    switch (command) {
      case 'init':
        return await cmdInit(context);
      case 'doctor':
        return await cmdDoctor(context);
      case 'add':
        return await cmdAdd(context, rest);
      case 'check':
        return await cmdCheck(context, rest[0]);
      case 'status':
        return await cmdStatus(context);
      case 'credits':
        return await cmdCredits(context, rest[0]);
      case 'watch':
        return await cmdWatch(context);
      case 'review':
        return await cmdReview(context, rest[0]);
      case 'approve':
        return await cmdDecide(context, 'approve', rest[0]);
      case 'reject':
        return await cmdDecide(context, 'reject', rest[0]);
      case 'unblock':
        return await cmdUnblock(context, rest[0]);
      case 'baseline':
        return await cmdBaseline(context, rest);
      case 'log':
        return await cmdLog(context, rest[0]);
      default:
        writeError(`Unknown command "${command}".`);
        write(USAGE);
        return 1;
    }
  } finally {
    context.close();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // A stack trace is the wrong first thing to show someone mid-demo; the message
  // is what matters, and the stack is available behind a flag.
  writeError(`\n${heading('Failed')}`);
  writeError(`  ${error instanceof Error ? error.message : String(error)}`);

  if (process.env['MOLT_DEBUG'] === '1' && error instanceof Error) {
    writeError(`\n${dim(error.stack ?? '')}`);
  } else {
    writeError(dim('\n  Set MOLT_DEBUG=1 for a stack trace.'));
  }

  process.exitCode = 1;
}

/**
 * Credits estimation.
 *
 * Bright Data does not publish a per-operation credit price list — the closest
 * public number is that a single-page `run` costs one credit regardless of
 * how many rows it returns. `heal` and `create` are undocumented AI-Flow jobs
 * with no published cost at all.
 *
 * So this is deliberately an **estimate for relative usage**, not a billing
 * figure: it turns the one fact we do have (`run` = 1) into a fixed ratio
 * against the AI-Flow operations, so a fleet-wide "credits" number exists to
 * answer "which collector is expensive to keep healthy" rather than to
 * reconcile against an invoice. The weights are overridable for exactly that
 * reason — plug in real numbers the moment Bright Data publishes them, or the
 * moment your own account's invoice tells you what they actually are.
 *
 * Classification works from a command's own `argv` (as recorded by
 * `runCli`), never from a side channel, so the ledger is reconstructable from
 * the `commands` table alone with no additional bookkeeping anywhere else in
 * the system.
 */

/** The four `bdata scraper` subcommands, plus `reject` split out from `approve`. */
export type CommandKind = 'run' | 'heal' | 'approve' | 'reject' | 'create' | 'unknown';

export const COMMAND_KINDS: readonly CommandKind[] = [
  'run',
  'heal',
  'approve',
  'reject',
  'create',
  'unknown',
];

/**
 * Classify a recorded command by its argv.
 *
 * `argv` is `[node, cliEntry, 'scraper', <verb>, …]` (see `runCli`), so the
 * verb is whatever follows the literal `scraper` token — robust to the
 * absolute path of the node executable and the CLI entry point differing
 * between machines, which a fixed-index lookup would not be.
 */
export function classifyCommand(argv: readonly string[]): CommandKind {
  const scraperIndex = argv.indexOf('scraper');
  if (scraperIndex === -1) return 'unknown';

  const verb = argv[scraperIndex + 1];

  switch (verb) {
    case 'run':
      return 'run';
    case 'heal':
      return 'heal';
    case 'create':
      return 'create';
    case 'approve':
      // `molt reject` and `molt unblock` both call `bdata scraper approve
      // --reject`; the flag is what actually distinguishes them, not the verb.
      return argv.includes('--reject') ? 'reject' : 'approve';
    default:
      return 'unknown';
  }
}

export interface CreditWeights {
  /** One page load. The one number Bright Data has actually published. */
  readonly run: number;
  /** An AI-Flow refactor job: plan, preview, fix, revalidate. */
  readonly heal: number;
  /** Committing a fix — `save_new_template` / `user_approval`, not generation. */
  readonly approve: number;
  /** Declining a fix. No generation runs, so this is free. */
  readonly reject: number;
  /** A brand-new collector: the same AI-Flow pipeline `heal` runs, from scratch. */
  readonly create: number;
  /** Anything that could not be classified. Never assumed to cost something. */
  readonly unknown: number;
}

/**
 * Deliberately conservative relative weights. `heal` and `create` are the
 * same class of AI-Flow job — full generation — so they are weighted equally;
 * `approve` is comparatively cheap because it only ever saves what a heal
 * already produced.
 */
export const DEFAULT_CREDIT_WEIGHTS: CreditWeights = {
  run: 1,
  heal: 12,
  approve: 1,
  reject: 0,
  create: 12,
  unknown: 0,
};

/** The estimated cost of one command. */
export function estimateCommandCredits(
  argv: readonly string[],
  weights: CreditWeights = DEFAULT_CREDIT_WEIGHTS,
): number {
  return weights[classifyCommand(argv)];
}

export interface CreditsSummary {
  readonly total: number;
  readonly byKind: Readonly<Record<CommandKind, number>>;
  readonly commandCount: number;
}

/** Sum the estimated cost of a set of commands, broken down by kind. */
export function summariseCredits(
  commands: readonly { readonly argv: readonly string[] }[],
  weights: CreditWeights = DEFAULT_CREDIT_WEIGHTS,
): CreditsSummary {
  const byKind: Record<CommandKind, number> = {
    run: 0,
    heal: 0,
    approve: 0,
    reject: 0,
    create: 0,
    unknown: 0,
  };

  for (const command of commands) {
    const kind = classifyCommand(command.argv);
    byKind[kind] += weights[kind];
  }

  const total = COMMAND_KINDS.reduce((sum, kind) => sum + byKind[kind], 0);

  return { total, byKind, commandCount: commands.length };
}

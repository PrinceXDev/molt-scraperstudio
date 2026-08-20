import {
  approveEnvelopeSchema,
  extractRows,
  healEnvelopeSchema,
  parseJsonFromStdout,
  runCli,
  type ApproveEnvelope,
  type CommandRecord,
  type HealEnvelope,
} from '@molt/brightdata';

import type {
  ApproveOutcome,
  ApproveRequest,
  HealOutcome,
  HealRequest,
  RunOutcome,
  RunRequest,
  ScraperPort,
} from './ports.js';
import { SerialQueue } from './queue.js';

/**
 * The real {@link ScraperPort}: drives the `bdata` CLI.
 *
 * Deliberately the CLI rather than the REST endpoints it wraps. The hackathon's
 * first best practice is "the terminal is the UI", and running the same commands
 * a judge would type keeps that literally true — while the captured
 * {@link CommandRecord} becomes the content of Molt's terminal drawer. Molt is an
 * agent operating the CLI, not a reimplementation of it.
 */

export interface CliScraperOptions {
  /** Per-command ceiling. Generation can legitimately run 25 minutes. */
  readonly timeoutMs?: number;
  /** Streams redacted output for a live view. */
  readonly onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  /**
   * Shared queue for AI-Flow operations. Pass one in to serialise across several
   * collectors; otherwise each instance gets its own.
   */
  readonly queue?: SerialQueue;
}

export class CliScraper implements ScraperPort {
  private readonly timeoutMs: number | undefined;
  private readonly onOutput: CliScraperOptions['onOutput'];
  /** Only `heal` passes through here — see {@link SerialQueue}. */
  private readonly aiFlow: SerialQueue;

  constructor(options: CliScraperOptions = {}) {
    this.timeoutMs = options.timeoutMs;
    this.onOutput = options.onOutput;
    this.aiFlow = options.queue ?? new SerialQueue();
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const command = await this.exec(['scraper', 'run', request.collectorId, request.url, '--json']);

    const rows = extractRows(parseJsonFromStdout(command.stdout));

    return {
      rows,
      command,
      // A run that produced no rows is not an error at this layer — an empty
      // harvest is a health verdict, and `@molt/health` is what decides it.
      ok: !command.failed,
    };
  }

  async heal(request: HealRequest): Promise<HealOutcome> {
    // Queued: two concurrent heals will 429 and back off for minutes.
    const command = await this.aiFlow.add(() =>
      this.exec([
        'scraper',
        'heal',
        request.collectorId,
        request.prompt,
        '--url',
        request.url,
        '--json',
      ]),
    );

    const envelope = this.parseEnvelope(
      command,
      healEnvelopeSchema,
      request.collectorId,
    ) as HealEnvelope;

    return {
      envelope,
      command,
      previewRows: extractRows(envelope.preview_result),
    };
  }

  async approve(request: ApproveRequest): Promise<ApproveOutcome> {
    const args = ['scraper', 'approve', request.collectorId, '--url', request.url, '--json'];

    if (request.reject === true) {
      args.push('--reject');
    } else {
      // `--auto-save` is not optional. Without it, approving accepts the fix into
      // a *draft* and the production template is untouched — so the collector
      // goes on returning the broken data. Molt's own verification caught this:
      // the approve reported success, the re-run still showed zeros, and the
      // incident correctly refused to close.
      //
      // Confirmed by the envelope: with `--auto-save` the pipeline gains
      // `user_approval` *and* `save_new_template`.
      args.push('--auto-save');
    }

    const command = await this.aiFlow.add(() => this.exec(args));

    return {
      envelope: this.parseEnvelope(
        command,
        approveEnvelopeSchema,
        request.collectorId,
      ) as ApproveEnvelope,
      command,
    };
  }

  private async exec(args: readonly string[]): Promise<CommandRecord> {
    return runCli({
      args,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      ...(this.onOutput === undefined ? {} : { onOutput: this.onOutput }),
    });
  }

  /**
   * Parse an envelope, synthesising one when the CLI produced no parseable JSON.
   *
   * A failed command still has to yield a well-formed envelope, because the
   * engine records and displays it either way. Throwing here would lose the
   * stderr that explains what actually went wrong.
   */
  private parseEnvelope(
    command: CommandRecord,
    schema: typeof healEnvelopeSchema | typeof approveEnvelopeSchema,
    collectorId: string,
  ): HealEnvelope | ApproveEnvelope {
    const parsed = schema.safeParse(parseJsonFromStdout(command.stdout));
    if (parsed.success) return parsed.data;

    return {
      collector_id: collectorId,
      status: command.failed ? 'failed' : 'unknown',
      error:
        command.stderr.trim() ||
        `the CLI produced no parseable envelope (exit ${String(command.exitCode)})`,
    };
  }
}

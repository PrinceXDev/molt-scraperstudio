import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { redactArgv, redactText } from './redact.js';

/**
 * A single `bdata` invocation, recorded.
 *
 * This is the unit the UI's terminal drawer renders, and it is what makes the
 * claim "Molt drives the real CLI" auditable rather than decorative. Already
 * redacted — see `redact.ts`.
 */
export interface CommandRecord {
  /** Display-safe argv, secrets replaced. Includes the node executable. */
  readonly argv: readonly string[];
  /** Copy-pasteable form of the same command. */
  readonly display: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the process exited non-zero or was killed by the timeout. */
  readonly failed: boolean;
  readonly timedOut: boolean;
}

export interface SpawnOptions {
  /** Arguments after the CLI entrypoint, e.g. `['scraper', 'run', 'c_x', url]`. */
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Hard ceiling. Generation can legitimately run 25 minutes. */
  readonly timeoutMs?: number;
  /** Injected clock, so records are deterministic under test. */
  readonly now?: () => Date;
  /** Streaming hook for the live terminal drawer. Receives redacted chunks. */
  readonly onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

/** `create` can take 25 minutes; give it headroom and still bound it. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Absolute path to the Bright Data CLI's JavaScript entrypoint.
 *
 * Resolved from the pinned dependency rather than shelling out to `npx`, for
 * three reasons: no network round trip per call, a version a judge can
 * reproduce from the lockfile, and — most importantly — it is a plain `.js`
 * file, so it can be run by `node` with **no shell**. Node refuses to spawn
 * `.cmd` shims without `shell: true`, and enabling a shell would let quotes
 * inside a heal prompt be reinterpreted by the command processor.
 */
export function resolveCliEntry(): string {
  const require = createRequire(import.meta.url);

  // The package's `exports` map may not expose package.json, so try the
  // documented bin path first and fall back to direct resolution.
  const attempts: Array<() => string> = [
    () => join(dirname(require.resolve('@brightdata/cli/package.json')), 'dist', 'index.js'),
    () => require.resolve('@brightdata/cli/dist/index.js'),
    () => require.resolve('@brightdata/cli'),
  ];

  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `Could not locate the Bright Data CLI. Run \`pnpm install\`.\n${failures.join('\n')}`,
  );
}

/**
 * Run the Bright Data CLI once and return a redacted record of what happened.
 *
 * Never throws on a non-zero exit: a failed heal is data Molt needs to store and
 * display, not an exception to unwind. Only a spawn failure throws.
 */
export async function runCli(options: SpawnOptions): Promise<CommandRecord> {
  const {
    args,
    cwd,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => new Date(),
    onOutput,
  } = options;

  const entry = resolveCliEntry();
  const argv = [process.execPath, entry, ...args];

  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();

  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env,
    // No shell, deliberately. See `resolveCliEntry`.
    shell: false,
    windowsHide: true,
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, timeoutMs);

  const collect = (
    stream: 'stdout' | 'stderr',
    sink: string[],
  ): ((chunk: Buffer | string) => void) => {
    return (chunk) => {
      const text = redactText(chunk.toString(), env);
      sink.push(text);
      onOutput?.(text, stream);
    };
  };

  child.stdout?.on('data', collect('stdout', stdoutChunks));
  child.stderr?.on('data', collect('stderr', stderrChunks));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  const finishedAtDate = now();
  const safeArgv = redactArgv(argv, env);

  return {
    argv: safeArgv,
    // The node path and CLI entry are noise in a transcript; show the shape a
    // human would actually type.
    display: formatDisplay(redactArgv(args, env)),
    startedAt,
    finishedAt: finishedAtDate.toISOString(),
    durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
    exitCode,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    failed: timedOut || exitCode !== 0,
    timedOut,
  };
}

/** Longest argument shown in full before it is elided. */
const MAX_DISPLAY_ARG = 56;

/**
 * Render argv as a line a human could have typed.
 *
 * Heal prompts run to several hundred characters, and pasting one verbatim into
 * a transcript buries the command in prose — the full prompt is recorded on the
 * incident and shown deliberately elsewhere. Arguments containing whitespace are
 * quoted so the line stays copy-pasteable.
 */
export function formatDisplay(args: readonly string[]): string {
  const rendered = args.map((arg) => {
    const shortened =
      arg.length > MAX_DISPLAY_ARG ? `${arg.slice(0, MAX_DISPLAY_ARG).trimEnd()}…` : arg;

    return /\s/.test(shortened) ? `"${shortened}"` : shortened;
  });

  return ['bdata', ...rendered].join(' ');
}

/**
 * Parse JSON out of a command's stdout.
 *
 * The CLI interleaves human progress lines ("Step: code_generator — polling
 * (attempt 112/600)") with the JSON envelope, so a bare `JSON.parse` of stdout
 * fails. This finds the outermost JSON value instead.
 */
export function parseJsonFromStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed === '') return undefined;

  // Fast path: the whole thing is JSON.
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  // Otherwise take the widest delimited span. Order matters: whichever opener
  // appears *first* is the outermost one. Checking braces unconditionally first
  // would extract the inner object from `Running...\n[{"a":1}]` and silently
  // return one record where a whole array was intended.
  const candidates = (
    [
      ['{', '}'],
      ['[', ']'],
    ] as const
  )
    .map(([open, close]) => ({ start: trimmed.indexOf(open), end: trimmed.lastIndexOf(close) }))
    .filter(({ start, end }) => start !== -1 && end > start)
    .sort((a, b) => a.start - b.start);

  for (const { start, end } of candidates) {
    const parsed = tryParse(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

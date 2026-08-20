/**
 * Credential redaction.
 *
 * Molt records the argv and stdout of every `bdata` invocation and renders them
 * in the UI's terminal drawer, which is the whole point of the drawer — but it
 * means an API key could otherwise reach a screenshot, a committed fixture, or
 * a demo video. The hackathon's fourth best practice is explicit about this.
 *
 * Redaction happens at the boundary, before anything is stored, so no
 * downstream consumer has to remember to do it.
 */

export const REDACTED = '«redacted»';

/**
 * Bright Data API keys are long hex strings — the documented example is 64 hex
 * characters. Anything of that shape is replaced wherever it appears.
 */
const HEX_SECRET = /\b[0-9a-f]{32,}\b/gi;

/** Bearer tokens in any captured HTTP debug output. */
const BEARER = /\b(bearer\s+)\S+/gi;

/** Flags whose *following* argument is a secret. */
const SECRET_FLAGS: ReadonlySet<string> = new Set(['-k', '--api-key', '--token', '--apikey']);

/** Environment variables whose literal values must never be echoed. */
const SECRET_ENV_KEYS: readonly string[] = [
  'BRIGHTDATA_API_KEY',
  'BRIGHT_DATA_API_TOKEN',
  'ANTHROPIC_API_KEY',
];

/**
 * Literal secret values drawn from the environment.
 *
 * Redacting by pattern alone is not enough: a key that does not match the hex
 * shape would survive. Short values are skipped, since redacting a two-character
 * string would mangle unrelated text.
 */
function environmentSecrets(env: NodeJS.ProcessEnv): string[] {
  return (
    SECRET_ENV_KEYS.map((key) => env[key])
      .filter((value): value is string => typeof value === 'string' && value.length >= 8)
      // Longest first, so a key that contains another is redacted whole.
      .sort((a, b) => b.length - a.length)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Redact secrets from an arbitrary string. */
export function redactText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let output = text;

  for (const secret of environmentSecrets(env)) {
    output = output.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }

  output = output.replace(BEARER, `$1${REDACTED}`);
  output = output.replace(HEX_SECRET, REDACTED);

  return output;
}

/**
 * Redact an argv array, handling both `--api-key VALUE` and `--api-key=VALUE`.
 *
 * Positional arguments are still passed through {@link redactText}, because a
 * heal prompt or a URL could contain a token.
 */
export function redactArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const output: string[] = [];
  let redactNext = false;

  for (const arg of argv) {
    if (redactNext) {
      output.push(REDACTED);
      redactNext = false;
      continue;
    }

    const [flag = ''] = arg.split('=', 1);

    if (SECRET_FLAGS.has(flag)) {
      if (arg.includes('=')) {
        output.push(`${flag}=${REDACTED}`);
      } else {
        output.push(arg);
        redactNext = true;
      }
      continue;
    }

    output.push(redactText(arg, env));
  }

  return output;
}

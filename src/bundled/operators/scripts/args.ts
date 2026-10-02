/**
 * The `stretch` script's arguments: an action, its positional words and
 * its `--name=value` flags. A bare `--name` is `true`.
 *
 * @module bundled/operators/scripts/args
 */

/** One parsed command line. */
export interface Args {
  readonly action: string | undefined;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

/** Splits `argv` (the words after the script) into an {@link Args}. */
export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (const word of argv) {
    if (!word.startsWith('--')) {
      positional.push(word);
      continue;
    }
    const eq = word.indexOf('=');

    if (eq === -1) {
      flags[word.slice(2)] = true;
    } else {
      flags[word.slice(2, eq)] = word.slice(eq + 1);
    }
  }
  const [action, ...rest] = positional;

  return { action, positional: rest, flags };
}

/** A flag's value as text, or `fallback` when it is absent or bare. */
export function flagText(args: Args, name: string, fallback?: string): string | undefined {
  const value = args.flags[name];

  return typeof value === 'string'
    ? value
    : fallback;
}

/** Whether a flag was given at all. */
export function hasFlag(args: Args, name: string): boolean {
  return args.flags[name] !== undefined;
}

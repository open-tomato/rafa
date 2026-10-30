/**
 * The argv parser of `rafa effort collect`, apart from the collector in
 * `collect.ts` it configures.
 *
 * Every flag the command declares (`src/commands/effort/collect.ts`) is
 * compared against here and nowhere else, and any other argument is
 * refused. `collect.ts`'s module note says why each refusal exists:
 * `--since` is refused rather than handed to git, and an unrecognised
 * argument or a run left with nothing to collect is refused rather than
 * passed as a clean run.
 *
 * `--skills` widens the skill half (`collect-skills.ts`) from the
 * sessions this run appends to every session the store holds. It is what
 * keeps `--no-git --no-sessions` from being refused: with it, the run
 * still counts the skills of the sessions already stored.
 */

/** What the parsed argv asked for. */
export interface CollectArgs {
  /** The `--since` value as given, for reporting. */
  since: string | null;
  /** The same instant, resolved once and shared by every half. */
  sinceEpochMs: number | null;
  collectSessions: boolean;
  collectCommits: boolean;
  /** True on `--skills`: count the skills of every stored session, not only the ones this run appends. */
  collectHeldSkills: boolean;
  verbose: boolean;
  /** Every refusal, so all of them are reported and not just the first. */
  errors: string[];
}

/**
 * Resolves a `--since` value to an instant, or null when it cannot be
 * read. See `collect.ts`'s module note on why an unreadable value is
 * refused rather than handed to git.
 */
export function parseSinceInstant(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const epoch = Date.parse(trimmed);
  return Number.isNaN(epoch)
    ? null
    : epoch;
}

/**
 * Parses the collect argv.
 *
 * Every refusal is collected rather than thrown at the first one, so
 * an operator fixing a command line sees all of it at once. A
 * repeated flag takes its LAST occurrence, which is what a shell
 * alias appending an override expects.
 */
export function parseCollectArgs(args: readonly string[]): CollectArgs {
  const errors: string[] = [];
  let since: string | null = null;
  let sinceEpochMs: number | null = null;
  let collectSessions = true;
  let collectCommits = true;
  let collectHeldSkills = false;
  let verbose = false;

  for (const arg of args) {
    if (arg === '--no-git') {
      collectCommits = false;
    } else if (arg === '--no-sessions') {
      collectSessions = false;
    } else if (arg === '--skills') {
      collectHeldSkills = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--since') {
      errors.push('--since takes a value, as --since=<date>');
    } else if (arg.startsWith('--since=')) {
      const raw = arg.slice('--since='.length);
      const epoch = parseSinceInstant(raw);
      if (epoch === null) {
        errors.push(`--since value is not a date this can read: ${raw}`);
      } else {
        since = raw;
        sinceEpochMs = epoch;
      }
    } else {
      errors.push(`unrecognised argument: ${arg}`);
    }
  }

  if (!collectSessions && !collectCommits && !collectHeldSkills) {
    errors.push('--no-git with --no-sessions leaves nothing to collect, unless --skills counts the stored sessions');
  }
  return {
    since,
    sinceEpochMs,
    collectSessions,
    collectCommits,
    collectHeldSkills,
    verbose,
    errors,
  };
}

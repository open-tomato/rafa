/**
 * The command-line words the board routes of `rafa plan create` are read
 * with, in one module: the three spec sources, `--refresh`, `--dry-run`,
 * the two of check 3 of the readiness gate and the one of check 4.
 *
 * `plan create` is a wrapped phase 0 command, so `src/plan.ts` and the
 * modules it delegates to read its flags, and the flags
 * `src/commands/plan/create.ts` DECLARES are held equal to the quoted
 * `--` literals of those modules (`src/commands/index.test.ts`,
 * `context/cli.md`). Before this module the words sat in the three
 * modules that act on them, which left that case naming four files —
 * and one of the four cannot be named: `./issue.ts` spells the `--json`
 * of `gh issue view` as a quoted argument, which the case reads as a
 * flag `plan create` declares and does not, so the declaration and the
 * literals could never be made equal while `--refresh` lived there.
 * (That is not a guess: the first draft of this note quoted that word
 * the way the case reads, and the case went red naming it.)
 *
 * So the WORDS live here and the RULES stay where they are. Each module
 * that reads one imports it and re-exports it under the name it
 * already published, so nothing that imported one had to move, and the
 * parity case names `src/plan.ts` and this module alone.
 *
 * Nothing here reads, decides or defaults: it is eight strings. The
 * module that acts on each is named beside it.
 */

/** The flag naming a spec file outright; read in `./spec-source.ts`. */
export const SPEC_FLAG = '--spec';

/** The flag naming the issue the spec is the body of; read in `./spec-source.ts`. */
export const ISSUE_FLAG = '--issue';

/** The flag taking the first undone line of the roadmap; read in `./spec-source.ts`. */
export const NEXT_FLAG = '--next';

/**
 * The flag that takes the issue as it reads now over a snapshot that
 * differs. Read in `./spec-source.ts`; the rule it changes, and the
 * refusal that names it, are `./issue.ts`'s.
 */
export const REFRESH_FLAG = '--refresh';

/** The flag that reads and refuses everything, and writes nothing; read in `./spec-source.ts`. */
export const DRY_RUN_FLAG = '--dry-run';

/** The flag that bypasses check 3, and check 3 alone; read in `./gate.ts`. */
export const SKIP_REVIEW_FLAG = '--skip-review';

/** The flag that keeps the gaps off the board; read in `./gate.ts`. */
export const NO_COMMENT_FLAG = '--no-comment';

/**
 * The flag that re-stamps every reference of the spec as reviewed, so
 * check 4 refuses none of them on this run; read in `./refs-gate.ts`.
 */
export const ACCEPT_REFS_FLAG = '--accept-refs';

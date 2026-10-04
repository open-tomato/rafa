/**
 * Scoring fixture extract: reads the board's bug issues and their
 * `Reported again` comments with `gh` and writes
 * `src/triage/testdata/scoring.json`, which
 * `src/triage/similarity-scoring.test.ts` replays. The module note of
 * `src/triage/scoring-fixture.ts` says what a filing is, how its cause is
 * labelled and what is taken out.
 *
 * The cause labels come from the board's closing comments and from
 * `src/triage/testdata/scoring-causes.json`, a reading kept by hand, and
 * an issue numbered after that reading's `through` gives no filing.
 *
 * Usage:
 *   bun scripts/extract-scoring-fixture.ts [--out=<file>]
 *
 * It needs `gh` signed in with read access to the board. Every value goes
 * through the fixture scrub of `src/fixtures/scrub.ts` (home paths, email
 * addresses, the host name, named secrets), and nothing is written when a
 * value still holds a leak after it. Run it from the repository checkout,
 * and review the diff before committing it: the board changes, and so
 * does the fixture.
 *
 * Exit codes: 0 written, 2 the extract could not run.
 */
import type { ScrubContext } from '../src/fixtures/scrub.js';
import type { BoardIssue, CauseJudgement, Filing, ScoringFixture } from '../src/triage/scoring-fixture.js';

import { resolve } from 'node:path';

import { messageOf } from '../src/config-sections.js';
import { fixtureScrubber, machineScrubContext } from '../src/fixtures/scrub.js';
import { FIXTURE_REPO, filingsOf } from '../src/triage/scoring-fixture.js';

/** Prefix on every line this script writes. */
export const TAG = '[scoring-fixture]';

/** The most issues one `gh issue list` answers. */
const ISSUE_LIMIT = '2000';

/** The default file written, relative to the checkout. */
const DEFAULT_OUT = 'src/triage/testdata/scoring.json';

/** The indent `jsonc/indent` asks of every linted `.json` file. */
export const FIXTURE_INDENT = 2;

/**
 * `value` as the text of a fixture file: JSON at {@link FIXTURE_INDENT}
 * spaces, closed by one newline, so the file it writes passes `eslint`.
 * Both `scoring.json` and the hand-kept `scoring-causes.json` are held in
 * this form.
 */
export function serializeFixture(value: unknown): string {
  return `${JSON.stringify(value, null, FIXTURE_INDENT)}\n`;
}

/**
 * The filings of `issues`, each value through the fixture scrub built
 * from `context`. Throws `ScrubRefusal` when a value still holds a leak
 * after the scrub, so no fixture is written with one.
 */
export function scrubbedFilings(
  issues: readonly BoardIssue[],
  judgement: CauseJudgement,
  context: ScrubContext,
): Filing[] {
  return filingsOf(issues, fixtureScrubber(context), judgement);
}

/** The bug issues of the board, open and closed, with their comments. */
async function readBoard(): Promise<BoardIssue[]> {
  const run = Bun.spawnSync([
    'gh', 'issue', 'list', '--repo', FIXTURE_REPO, '--label', 'type:bug', '--state', 'all',
    '--limit', ISSUE_LIMIT, '--json', 'number,body,createdAt,comments',
  ]);
  if (run.exitCode !== 0) throw new Error(`gh issue list failed: ${run.stderr.toString().trim()}`);
  return JSON.parse(run.stdout.toString()) as BoardIssue[];
}

/** The judgement file beside the fixture, relative to the checkout. */
const CAUSES_FILE = 'src/triage/testdata/scoring-causes.json';

/** Writes the fixture to `out`, answering the exit code. */
async function main(argv: readonly string[]): Promise<number> {
  const outFlag = argv.find((word) => word.startsWith('--out='));
  const out = resolve(outFlag?.slice('--out='.length) ?? DEFAULT_OUT);
  const judgement = await Bun.file(resolve(CAUSES_FILE)).json() as CauseJudgement;
  const filings = scrubbedFilings(await readBoard(), judgement, machineScrubContext(process.cwd()));
  const fixture: ScoringFixture = { repo: FIXTURE_REPO, filings };
  await Bun.write(out, serializeFixture(fixture));
  console.log(`${TAG} wrote ${String(filings.length)} filings to ${out}`);
  return 0;
}

if (import.meta.main) {
  let code = 2;
  try {
    code = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`${TAG} FAIL — ${messageOf(err)}`);
  }
  process.exit(code);
}

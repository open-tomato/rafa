/**
 * Tests for `rafa issue check` (`check.ts`): a saved copy holding a
 * reference in each of the five states, read in text and json mode;
 * `--stamp` and the check after it; a copy's first check; the missing
 * copy and the line refusals.
 *
 * Every dispatched case runs from a project of its own under this
 * file's temporary directory (`tests/cli-capture.ts`), its copy planted
 * under the default `specs.dir`, and the targets read through a fake
 * verifier answering from a table, so nothing spawns `gh` or `git`.
 *
 * ## The controls
 *
 * The plain check of the five-state copy leaves its bytes as they were,
 * where a first check of a copy with no block writes one: the copy is
 * written only when a stamp is added. `--stamp` is followed by a second
 * check that reads every row `ok` but the unknown one, over the same
 * table that read four of them otherwise. The missing copy is refused
 * beside a local notes file of the same issue and a copy of another
 * issue, so the notes file and a neighbour are not read as the copy.
 */
import type { IssueCheckResult } from './check.js';
import type { RafaCommand } from '../../cli/command.js';
import type { LiveReading, RefStamp } from '../../refs/stamp.js';
import type { RefVerifier } from '../../refs/verify.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ABSENT, blobFingerprint, issueFingerprint, PRESENT, readRefsBlock, UNREADABLE, writeRefsBlock } from '../../refs/stamp.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { CHECK_USAGE, createIssueCheckCommand, missingCopyMessage } from './check.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-check-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The issue whose saved copy each case reads. */
const ISSUE = 151;

/** Where the copy is planted, under the default `specs.dir`. */
const COPY_PATH = '.rafa/specs/rafa-151-references-specs.md';

/** A blob sha, for a file that did not change. */
const SHA_A = 'a'.repeat(40);

/** Issue #8 as the copy was stamped, and as it reads now: its Design section rewritten. */
const EIGHT_THEN = issueFingerprint({ title: 'Eight', body: '## Design\n\nThe first design.\n', state: 'open' });
const EIGHT_NOW = issueFingerprint({ title: 'Eight', body: '## Design\n\nThe second design.\n', state: 'open' });

/** Issue #7, the blocker, stamped open and now closed. */
const SEVEN_THEN = issueFingerprint({ title: 'Seven', body: 'Blocking work.\n', state: 'open' });
const SEVEN_NOW = issueFingerprint({ title: 'Seven', body: 'Blocking work.\n', state: 'closed' });

/** The body of the copy; the line of each reference in the comments. */
const BODY = [
  '# Spec', // 1
  '', // 2
  'Blocked by: #7', // 3  resolved
  '', // 4
  '## Design', // 5
  '', // 6
  'Reads `src/a.ts` and `src/gone.ts`, calls `alphaValue()`, and #8.', // 7  ok, dangling, suspect, suspect
  '', // 8
  'See open-tomato/other#9.', // 9  unknown
  '',
].join('\n');

/** The stamps the copy keeps: none for the missing file or the unreadable issue. */
const STAMPS: readonly RefStamp[] = [
  { kind: 'issue', text: '#7', fingerprint: SEVEN_THEN },
  { kind: 'path', text: 'src/a.ts', fingerprint: blobFingerprint(SHA_A) },
  { kind: 'symbol', text: 'alphaValue', fingerprint: ABSENT },
  { kind: 'issue', text: '#8', fingerprint: EIGHT_THEN },
];

/** What each target reads as now. */
const LIVE: ReadonlyMap<string, LiveReading> = new Map<string, LiveReading>([
  ['#7', SEVEN_NOW],
  ['src/a.ts', blobFingerprint(SHA_A)],
  ['src/gone.ts', ABSENT],
  ['alphaValue', PRESENT],
  ['#8', EIGHT_NOW],
  ['open-tomato/other#9', UNREADABLE],
]);

/** A verifier over {@link LIVE}, counting the reads it answers. */
function tableVerifier(): { verify: RefVerifier; reads: string[] } {
  const reads: string[] = [];
  const verify: RefVerifier = (ref) => {
    reads.push(ref.text);
    const live = LIVE.get(ref.text);
    if (live === undefined) throw new Error(`the table holds no ${ref.text}`);
    return Promise.resolve(live);
  };
  return { verify, reads };
}

/** Writes `text` at `path` under `root`, making its directories. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A fresh project holding `copy` at {@link COPY_PATH}, or no copy when null. */
function plantCopyProject(copy: string | null): PlantedProject {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')));
  if (copy !== null) plant(project.root, COPY_PATH, copy);
  return project;
}

/** The copy's text as it is on disk now. */
function copyOf(project: PlantedProject): string {
  return readFileSync(join(project.root, COPY_PATH), 'utf8');
}

/** The command over a verifier. */
function command(verify: RefVerifier): RafaCommand {
  return createIssueCheckCommand({ verifier: () => verify });
}

/** The data of a json-mode run's one result event. */
function resultOf(stdout: string): IssueCheckResult {
  const events = eventsOf(stdout);
  expect(events.map((event) => event.type)).toEqual(['start', 'result']);
  const [, result] = events;
  if (result?.type !== 'result' || !result.ok) throw new Error(`no ok result in ${stdout}`);
  return result.data as IssueCheckResult;
}

/** The text-mode lines of the five-state copy read against its stamps. */
const FIVE_STATE_LINES = [
  `Issue #${String(ISSUE)}: ${COPY_PATH}`,
  `resolved issue #7 (line 3) — rafa issue unblock ${String(ISSUE)}`,
  'ok path src/a.ts (line 7)',
  'dangling path src/gone.ts (line 7)',
  'suspect symbol alphaValue (line 7)',
  'suspect issue #8: heading "Design" changed (line 7)',
  'unknown cross-issue open-tomato/other#9 (line 9) — its repository could not be read, so it is not checked',
  '6 references: 1 ok, 1 dangling, 2 suspect, 1 resolved, 1 unknown',
];

describe('rafa issue check over a copy with a reference in each state', () => {
  it('prints each reference with its state, then the count per state, exits 0, and leaves the copy as it was', async () => {
    const copy = writeRefsBlock(BODY, STAMPS);
    const project = plantCopyProject(copy);

    const outcome = await dispatchInProject(['issue', 'check', String(ISSUE)], SUBJECTS, [command(tableVerifier().verify)], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: `${FIVE_STATE_LINES.join('\n')}\n`, stderr: '' });
    expect(copyOf(project)).toBe(copy);
  });

  it('gives every reference with its kind, line, state and fingerprint as the result data in json mode', async () => {
    const project = plantCopyProject(writeRefsBlock(BODY, STAMPS));

    const outcome = await dispatchInProject(
      ['issue', 'check', String(ISSUE), '--output=json'],
      SUBJECTS,
      [command(tableVerifier().verify)],
      project,
    );
    const result = resultOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect([result.issue, result.path, result.stamped]).toEqual([ISSUE, COPY_PATH, false]);
    expect(result.references.map((ref) => [ref.kind, ref.text, ref.line, ref.state, ref.fingerprint, ref.stamp])).toEqual([
      ['issue', '#7', 3, 'resolved', `sha256:${SEVEN_NOW.digest}`, `sha256:${SEVEN_THEN.digest}`],
      ['path', 'src/a.ts', 7, 'ok', `blob:${SHA_A}`, `blob:${SHA_A}`],
      ['path', 'src/gone.ts', 7, 'dangling', 'absent', null],
      ['symbol', 'alphaValue', 7, 'suspect', 'present', 'absent'],
      ['issue', '#8', 7, 'suspect', `sha256:${EIGHT_NOW.digest}`, `sha256:${EIGHT_THEN.digest}`],
      ['cross-issue', 'open-tomato/other#9', 9, 'unknown', 'unreadable', null],
    ]);
    expect(result.references[4]?.changedHeadings).toEqual(['Design']);
    expect(result.references[0]?.unblock).toBe(`rafa issue unblock ${String(ISSUE)}`);
  });
});

describe('rafa issue check --stamp', () => {
  it('prints the reading against the old stamps, re-stamps every reference, and reads each target once', async () => {
    const project = plantCopyProject(writeRefsBlock(BODY, STAMPS));
    const { verify, reads } = tableVerifier();

    const outcome = await dispatchInProject(['issue', 'check', String(ISSUE), '--stamp'], SUBJECTS, [command(verify)], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: [
        ...FIVE_STATE_LINES,
        `🔖 Re-stamped 6 references of issue #${String(ISSUE)}; the next check reads them against what they hold now.`,
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(reads).toEqual([...LIVE.keys()]);
    expect(readRefsBlock(copyOf(project)).stamps?.map((stamp) => [stamp.text, stamp.fingerprint.kind])).toEqual([
      ['#7', 'issue'],
      ['src/a.ts', 'blob'],
      ['src/gone.ts', 'absent'],
      ['alphaValue', 'present'],
      ['#8', 'issue'],
    ]);
  });

  it('leaves a copy whose next check reads every reference ok but the unknown one', async () => {
    const project = plantCopyProject(writeRefsBlock(BODY, STAMPS));
    await dispatchInProject(['issue', 'check', String(ISSUE), '--stamp'], SUBJECTS, [command(tableVerifier().verify)], project);

    const outcome = await dispatchInProject(
      ['issue', 'check', String(ISSUE), '--output=json'],
      SUBJECTS,
      [command(tableVerifier().verify)],
      project,
    );

    expect(resultOf(outcome.stdout).references.map((ref) => ref.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'unknown']);
  });

  it('gives the stamps written as each reference\'s stamp in json mode, and says it stamped', async () => {
    const project = plantCopyProject(writeRefsBlock(BODY, STAMPS));

    const outcome = await dispatchInProject(
      ['issue', 'check', String(ISSUE), '--stamp', '--output=json'],
      SUBJECTS,
      [command(tableVerifier().verify)],
      project,
    );
    const result = resultOf(outcome.stdout);

    expect(result.stamped).toBe(true);
    expect(result.references.map((ref) => ref.stamp)).toEqual([
      `sha256:${SEVEN_NOW.digest}`,
      `blob:${SHA_A}`,
      'absent',
      'present',
      `sha256:${EIGHT_NOW.digest}`,
      null,
    ]);
  });

  it('refuses a word read into --stamp with exit code 1, naming where the flag goes', async () => {
    const project = plantCopyProject(writeRefsBlock(BODY, STAMPS));

    const outcome = await dispatchInProject(['issue', 'check', '--stamp', String(ISSUE)], SUBJECTS, [command(tableVerifier().verify)], project);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--stamp takes no value, and read "151" as one.');
  });
});

describe('a copy checked for the first time', () => {
  it('stamps every reference whose target is there, reads it ok, and writes the block into the copy', async () => {
    const project = plantCopyProject(BODY);

    const outcome = await dispatchInProject(
      ['issue', 'check', String(ISSUE), '--output=json'],
      SUBJECTS,
      [command(tableVerifier().verify)],
      project,
    );

    expect(resultOf(outcome.stdout).references.map((ref) => ref.state))
      .toEqual(['ok', 'ok', 'dangling', 'ok', 'ok', 'unknown']);
    expect(readRefsBlock(copyOf(project)).stamps?.map((stamp) => stamp.text)).toEqual(['#7', 'src/a.ts', 'alphaValue', '#8']);
  });
});

describe('the refusals', () => {
  it('refuses a missing copy with exit code 1 and the plan create line that writes one, beside notes and a neighbour', async () => {
    const project = plantCopyProject(null);
    plant(project.root, '.rafa/specs/rafa-151-notes.md', 'Local notes.\n');
    plant(project.root, '.rafa/specs/rafa-1510-other-spec.md', BODY);
    const { verify, reads } = tableVerifier();

    const outcome = await dispatchInProject(['issue', 'check', String(ISSUE)], SUBJECTS, [command(verify)], project);

    expect(outcome).toEqual({ exitCode: 1, stdout: '', stderr: `${missingCopyMessage(ISSUE, '.rafa/specs')}\n` });
    expect(missingCopyMessage(ISSUE, '.rafa/specs')).toContain('rafa plan create --issue=151');
    expect(reads).toEqual([]);
  });

  it('refuses two copies of one issue with exit code 1, naming both', async () => {
    const project = plantCopyProject(BODY);
    plant(project.root, '.rafa/specs/rafa-151-old-title.md', BODY);

    const outcome = await dispatchInProject(['issue', 'check', String(ISSUE)], SUBJECTS, [command(tableVerifier().verify)], project);

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: [
        '❌ Issue #151 has 2 saved copies under .rafa/specs; remove the stale one:',
        '   .rafa/specs/rafa-151-old-title.md',
        `   ${COPY_PATH}`,
        '',
      ].join('\n'),
    });
  });

  it('refuses a refs block the codec will not read with exit code 1', async () => {
    const project = plantCopyProject('<!-- rafa:refs\nrefs: []\n');

    const outcome = await dispatchInProject(['issue', 'check', String(ISSUE)], SUBJECTS, [command(tableVerifier().verify)], project);

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ The references of issue #151 could not be read: rafa:refs block: no --> line closes it\n',
    });
  });

  it.each([
    [[], 'Name the issue number to check'],
    [['1', '2'], 'Expected one issue number, got 2: 1 2'],
    [['abc'], '"abc" is no issue number, which is a whole number from 1'],
    [['0'], '"0" is no issue number, which is a whole number from 1'],
  ])('refuses the words %j with exit code 1 and the usage', async (words, problem) => {
    const project = plantCopyProject(BODY);

    expect(await dispatchInProject(['issue', 'check', ...words], SUBJECTS, [command(tableVerifier().verify)], project)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ ${problem}\nUsage: ${CHECK_USAGE}\n`,
    });
  });
});

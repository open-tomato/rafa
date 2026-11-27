/**
 * A `debt` record from filing to its move, run by the real CLI:
 * `bun src/rafa.ts` spawned through `./cli-capture.ts` in a scratch
 * project whose tracker is `local`, so every issue is a file under
 * `.rafa/issues/` and no case reads a store or a board.
 *
 * The cases, refusals first:
 *
 *   1. `issue create --type=debt` without `--reproduce` is refused and
 *      files nothing, under `--dry-run` or not;
 *   2. `issue create --type=chore` naming a record flag is refused and
 *      files nothing;
 *   3. `issue edit <n> --type=chore` on a filed debt is refused, the
 *      issue file left byte for byte;
 *   4. `--dry-run` of the whole debt line prints the rendered title and
 *      files nothing;
 *   5. the line files the record, `issue edit <n> --type=bug` changes its
 *      type and nothing else, and `--type=chore` is then refused on it.
 */
import type { CapturedRun, ScratchRepo } from './cli-capture.js';

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { localIssuesDir, parseLocalIssue } from '@open-tomato/rafa-board/adapters/tracker/local';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { RUN_TIMEOUT } from './loop-scratch.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-debt-record-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const MODULE = 'cli-gap';
const ACTION = 'issue list';
const SUMMARY = 'no line lists the reports of one cause';
const CAUSE = 'cli:new-context';
const REPRODUCE = 'rafa issue list --module=cli-gap';
const TITLE = `${MODULE} - ${ACTION}: ${SUMMARY}`;

/** The debt line less `--reproduce`, which a record cannot be filed without. */
const INCOMPLETE_LINE = [
  'issue', 'create', '--type=debt', `--module=${MODULE}`, `--action=${ACTION}`,
  `--summary=${SUMMARY}`, `--cause=${CAUSE}`,
] as const;

/** The whole debt line. */
const DEBT_LINE = [...INCOMPLETE_LINE, `--reproduce=${REPRODUCE}`] as const;

/** A scratch project whose tracker is `local`. */
function plantLocalProject(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, 'tracker:\n  default: local\n');
  return scratch;
}

/** Runs `rafa` with `words` from the scratch repository. */
function rafa(scratch: ScratchRepo, words: readonly string[]): CapturedRun {
  return runRafa(scratch, scratch.repo, words);
}

/** The path of the project's local issue `number`. */
function issueFile(scratch: ScratchRepo, number: number): string {
  return join(localIssuesDir(scratch.repo), `${String(number)}.md`);
}

/** The text of the project's first local issue, as it is on disk. */
function firstIssueText(scratch: ScratchRepo): string {
  return readFileSync(issueFile(scratch, 1), 'utf8');
}

/** Files {@link DEBT_LINE} as issue 1, failing the case when the run did not. */
function fileDebt(scratch: ScratchRepo): void {
  const run = rafa(scratch, DEBT_LINE);
  expectExit(run, 0, scratch);
  expect(run.stdout).toContain('Created local issue 1.');
}

describe('a debt record over the local tracker, spawned: refusals', () => {
  it('refuses a debt line without --reproduce, under --dry-run too, and files nothing', RUN_TIMEOUT, () => {
    const scratch = plantLocalProject();

    const dry = rafa(scratch, [...INCOMPLETE_LINE, '--dry-run']);
    const filed = rafa(scratch, INCOMPLETE_LINE);

    for (const run of [dry, filed]) {
      expectExit(run, 1, scratch);
      expect(run.stderr).toContain('--reproduce');
      expect(run.stdout).not.toContain(TITLE);
    }
    expect(existsSync(issueFile(scratch, 1))).toBe(false);
  });

  it('refuses the record flags on --type=chore, naming both record types, and files nothing', RUN_TIMEOUT, () => {
    const scratch = plantLocalProject();

    const run = rafa(scratch, ['issue', 'create', '--type=chore', '--title=Tidy', `--action=${ACTION}`]);

    expectExit(run, 1, scratch);
    expect(run.stderr).toContain('--action is read for --type=bug or --type=debt only');
    expect(existsSync(issueFile(scratch, 1))).toBe(false);
  });

  it('refuses issue edit --type=chore on a filed debt, the issue file left byte for byte', RUN_TIMEOUT, () => {
    const scratch = plantLocalProject();
    fileDebt(scratch);
    const before = firstIssueText(scratch);

    const run = rafa(scratch, ['issue', 'edit', '1', '--type=chore']);

    expectExit(run, 1, scratch);
    expect(run.stderr).toContain('--type');
    expect(run.stderr).toContain('chore');
    expect(run.stderr).toContain('bug, debt');
    expect(firstIssueText(scratch)).toBe(before);
  });
});

describe('a debt record over the local tracker, spawned: filing and moving', () => {
  it('prints the rendered title under --dry-run and files nothing', RUN_TIMEOUT, () => {
    const scratch = plantLocalProject();

    const run = rafa(scratch, [...DEBT_LINE, '--dry-run']);

    expectExit(run, 0, scratch);
    const lines = run.stdout.split('\n');
    expect(lines).toContain('--dry-run: nothing was filed.');
    expect(lines).toContain(`Title: ${TITLE}`);
    expect(lines).toContain(`Type: debt · Module: ${MODULE} · Priority: needs-triage · Cause: ${CAUSE}`);
    expect(existsSync(issueFile(scratch, 1))).toBe(false);
  });

  it('files the debt, moves it to bug keeping the rest of the record, then refuses --type=chore on it', RUN_TIMEOUT, () => {
    const scratch = plantLocalProject();
    fileDebt(scratch);
    const filed = parseLocalIssue(firstIssueText(scratch));
    expect(filed.draft).toMatchObject({ title: TITLE, type: 'debt', module: MODULE, cause: CAUSE, priority: null });
    expect(filed.draft.body).toContain(REPRODUCE);

    const moved = rafa(scratch, ['issue', 'edit', '1', '--type=bug']);

    expectExit(moved, 0, scratch);
    expect(moved.stdout).toContain('Moved local issue 1 to type bug.');
    const held = firstIssueText(scratch);
    expect(parseLocalIssue(held)).toEqual({ ...filed, draft: { ...filed.draft, type: 'bug' } });

    const refused = rafa(scratch, ['issue', 'edit', '1', '--type=chore']);

    expectExit(refused, 1, scratch);
    expect(refused.stderr).toContain('chore');
    expect(refused.stderr).toContain('bug, debt');
    expect(firstIssueText(scratch)).toBe(held);
  });
});

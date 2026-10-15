/**
 * Tests for the reading "filed bugs naming only documentation"
 * (`report-doc-bugs.ts`).
 *
 * The store cases write a fixture store of their own under the system's
 * temporary directory, through `writeTriage`, the writer the loop stores a
 * report's bugs with, so the `scope` each row carries is the one the
 * writer read off it and not one a case planted. None opens
 * `.rafa/effort/`.
 *
 * Each case that expects a row left out holds a row beside it that is
 * counted, so a reading of zero cannot come from a store that was never
 * read.
 */
import type { BugText } from './report-doc-bugs.js';
import type { ReportBug } from '@open-tomato/rafa/report/parse';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sqliteStorePath } from '@open-tomato/rafa/store/sqlite';
import { writeTriage } from '@open-tomato/rafa/store/triage';

import { countDocOnlyBugs, readDocOnlyBugs } from './report-doc-bugs.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-doc-bugs-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A root of its own under the suite's temporary directory, holding no store. */
function freshRoot(): string {
  planted += 1;
  return join(tempRoot, `${planted}-repo`);
}

/** A bug as `parseReport` answers one, its `what` never null. */
function bug(what: string, artifact: string | null = null): ReportBug & BugText {
  return { what, artifact, security: false, kind: 'bug', extras: [] };
}

/** Stores one session's bugs under a root, as the loop stores a report's. */
function storeBugs(root: string, sessionId: string, bugs: readonly ReportBug[]): void {
  const result = writeTriage(root, {
    dispatch: { sessionId, planStub: 'rafa-1072-fixture', taskLine: 'A task' },
    outcome: 'done',
    blockers: [],
    outOfScopeBugs: bugs,
  });
  if (result.outOfScopeBugs.appended !== bugs.length) {
    throw new Error(`stored ${result.outOfScopeBugs.appended} of ${bugs.length} bugs`);
  }
}

/** A stale page, written as a bug: its `what` names the page alone. */
const STALE_PAGE = bug('context/triage.md:12 still says three channels');

/** A bug about code. */
const CODE_BUG = bug('src/triage/triage.ts drops the last entry', 'expected 2, received 1');

/** A machine fault whose only path is a page: `ld:` makes its scope `machine`. */
const MACHINE_FAULT = bug('README.md build notes do not cover this', 'ld: tapi error: malformed file');

describe('countDocOnlyBugs', () => {
  it('counts a bug whose text names a page and nothing else', () => {
    expect(countDocOnlyBugs([STALE_PAGE, CODE_BUG])).toEqual({ bugs: 2, docOnly: 1 });
  });

  it('counts none of no bugs', () => {
    expect(countDocOnlyBugs([])).toEqual({ bugs: 0, docOnly: 0 });
  });

  it('reads what and artifact as one text', () => {
    const page = 'context/triage.md is stale';

    // A source path in the artifact makes the bug one about code.
    expect(countDocOnlyBugs([{ what: page, artifact: 'src/triage/triage.ts:40' }]).docOnly).toBe(0);
    // An artifact naming no path answers false alone, and nothing here.
    expect(countDocOnlyBugs([{ what: page, artifact: 'the loop files three channels' }]).docOnly).toBe(1);
    // The page may be named by the artifact alone.
    expect(countDocOnlyBugs([{ what: 'the page is stale', artifact: 'docs/triage.md' }]).docOnly).toBe(1);
    // The control: neither field names a path.
    expect(countDocOnlyBugs([{ what: 'the page is stale', artifact: null }]).docOnly).toBe(0);
  });

  it('keeps a path at the end of what apart from the artifact after it', () => {
    // Joined with no break, the two would read as the one piece
    // `context/triage.mdtriage.ts`, a path under `context/`.
    expect(countDocOnlyBugs([{ what: 'stale: context/triage.md', artifact: 'triage.ts:40' }]).docOnly).toBe(0);
    // The control: the same `what` beside an artifact naming a page.
    expect(countDocOnlyBugs([{ what: 'stale: context/triage.md', artifact: 'README.md:40' }]).docOnly).toBe(1);
  });
});

describe('readDocOnlyBugs', () => {
  it('counts the rows of scope rafa a fixture store holds, and those naming only documentation', () => {
    const root = freshRoot();
    storeBugs(root, 's-1', [STALE_PAGE, CODE_BUG, bug('the retry loop never ends')]);

    expect(readDocOnlyBugs(root)).toEqual({ bugs: 3, docOnly: 1 });
  });

  it('leaves a machine-scoped row out of both figures', () => {
    const root = freshRoot();
    storeBugs(root, 's-1', [MACHINE_FAULT, STALE_PAGE]);

    // The machine fault names only `README.md`, so the pure count takes
    // it: only its scope keeps it out of the stored reading.
    expect(countDocOnlyBugs([MACHINE_FAULT]).docOnly).toBe(1);
    expect(readDocOnlyBugs(root)).toEqual({ bugs: 1, docOnly: 1 });
  });

  it('counts a bug once per session that reported it', () => {
    const root = freshRoot();
    storeBugs(root, 's-1', [STALE_PAGE]);
    storeBugs(root, 's-2', [STALE_PAGE]);

    expect(readDocOnlyBugs(root)).toEqual({ bugs: 2, docOnly: 2 });
  });

  it('answers zeroes for a root with no store, and creates none', () => {
    const root = freshRoot();

    expect(readDocOnlyBugs(root)).toEqual({ bugs: 0, docOnly: 0 });
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });
});

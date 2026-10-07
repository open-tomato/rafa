/**
 * Tests for gate 4 of `rafa issue edit` (`src/board/issue-edit-state.ts`):
 * every row of the spec's Design table for an append and for a replace
 * or a title change, the `--while-in-development` opening, the branch
 * a claimed row names, and the saved-copy listing under `specs.dir`.
 *
 * Each refusal sits beside a control differing only in the part the
 * row reads, so a gate refusing everything and a gate refusing nothing
 * both fail here. The listing cases write in a temporary directory of
 * their own, under a RELATIVE `specs.dir` resolved against it.
 */
import type { EditKind, EditStateInput } from './issue-edit-state.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';

import {
  editStateRefusalMessage,
  findSavedCopies,
  isSavedCopyName,
  readEditState,
  refreshCommand,
  staleCopyMessage,
} from './issue-edit-state.js';
import { SPEC_LABEL } from './issue.js';
import { branchName } from './naming.js';
import { SPEC_READY_LABEL } from './readiness.js';

const ISSUE = 12;
const TITLE = 'Sync design for devices';
const BRANCH = branchName(ISSUE, TITLE);
const COPY = '.rafa/specs/rafa-12-sync-design-devices.md';
const CHANGES: readonly EditKind[] = ['replace', 'title'];

/** An open, unlabelled, unplanned issue edited by `kind`, with `over` on top. */
function inputOf(kind: EditKind, over: Partial<EditStateInput> = {}): EditStateInput {
  return {
    issue: ISSUE,
    title: TITLE,
    open: true,
    labels: [SPEC_LABEL],
    savedCopies: [],
    kind,
    whileInDevelopment: false,
    ...over,
  };
}

describe('readEditState, append', () => {
  test('appends to an issue with no plan and no ready label', () => {
    expect(readEditState(inputOf('append'))).toEqual({ pass: true, staleCopy: false, branch: null });
  });

  test('appends to a spec:ready issue with no saved copy', () => {
    const reading = readEditState(inputOf('append', { labels: [SPEC_LABEL, SPEC_READY_LABEL] }));
    expect(reading).toEqual({ pass: true, staleCopy: false, branch: null });
  });

  test('appends with stale-copy when a saved copy exists', () => {
    const reading = readEditState(inputOf('append', { labels: [SPEC_READY_LABEL], savedCopies: [COPY] }));
    expect(reading).toEqual({ pass: true, staleCopy: true, branch: null });
  });

  test.each([CLAIMED_LABEL, IN_DEVELOPMENT_LABEL])('refuses %s as in-development, naming the branch', (label) => {
    const reading = readEditState(inputOf('append', { labels: [SPEC_READY_LABEL, label] }));
    expect(reading).toEqual({ pass: false, refusal: 'in-development', branch: BRANCH });
  });

  test.each([CLAIMED_LABEL, IN_DEVELOPMENT_LABEL])('lets %s through under --while-in-development as stale-copy', (label) => {
    const reading = readEditState(inputOf('append', { labels: [label], whileInDevelopment: true }));
    expect(reading).toEqual({ pass: true, staleCopy: true, branch: BRANCH });
  });

  test('refuses a closed issue, even under --while-in-development', () => {
    const closed = inputOf('append', { open: false, labels: [IN_DEVELOPMENT_LABEL], whileInDevelopment: true });
    expect(readEditState(closed)).toEqual({ pass: false, refusal: 'closed', branch: null });
    expect(readEditState({ ...closed, open: true }).pass).toBe(true);
  });
});

describe.each(CHANGES)('readEditState, %s', (kind) => {
  test('is allowed on an issue with no plan and no ready label', () => {
    expect(readEditState(inputOf(kind))).toEqual({ pass: true, staleCopy: false, branch: null });
  });

  test('is refused on spec:ready', () => {
    const reading = readEditState(inputOf(kind, { labels: [SPEC_LABEL, SPEC_READY_LABEL] }));
    expect(reading).toEqual({ pass: false, refusal: 'spec-ready', branch: null });
  });

  test('is refused on a saved copy', () => {
    expect(readEditState(inputOf(kind, { savedCopies: [COPY] }))).toEqual({ pass: false, refusal: 'planned', branch: null });
  });

  test('is refused as spec-ready when the ready spec is also planned', () => {
    const reading = readEditState(inputOf(kind, { labels: [SPEC_READY_LABEL], savedCopies: [COPY] }));
    expect(reading).toEqual({ pass: false, refusal: 'spec-ready', branch: null });
  });

  test.each([CLAIMED_LABEL, IN_DEVELOPMENT_LABEL])('is refused on %s, even under --while-in-development', (label) => {
    const reading = readEditState(inputOf(kind, { labels: [label], whileInDevelopment: true }));
    expect(reading).toEqual({ pass: false, refusal: 'in-development', branch: BRANCH });
  });

  test('is refused on a closed issue', () => {
    expect(readEditState(inputOf(kind, { open: false }))).toEqual({ pass: false, refusal: 'closed', branch: null });
  });
});

describe('the messages', () => {
  test('a stale copy names the refresh line', () => {
    expect(refreshCommand(ISSUE)).toBe('rafa plan create --issue=12 --refresh');
    expect(staleCopyMessage(ISSUE, null)).toBe(
      'Issue #12 has a saved copy this edit makes stale: rafa plan create --issue=12 --refresh rebuilds it.',
    );
  });

  test('a stale copy under a loop says the loop plans from the copy it has', () => {
    const message = staleCopyMessage(ISSUE, BRANCH);
    expect(message).toContain(`on ${BRANCH}`);
    expect(message).toContain('the loop plans from the copy it already has');
    expect(message).toContain(refreshCommand(ISSUE));
  });

  test('an append refused in development names the branch and the opening flag', () => {
    const input = inputOf('append', { labels: [IN_DEVELOPMENT_LABEL] });
    const message = editStateRefusalMessage(input, readEditState(input));
    expect(message).toContain(BRANCH);
    expect(message).toContain('--while-in-development');
  });

  test('a replace refused in development points at an append under the flag', () => {
    const input = inputOf('replace', { labels: [CLAIMED_LABEL] });
    expect(editStateRefusalMessage(input, readEditState(input))).toContain(
      'rafa issue edit 12 --append-file=<file> --reason=<text> --while-in-development',
    );
  });

  test('a title change refused on spec:ready names the label and the append line', () => {
    const input = inputOf('title', { labels: [SPEC_READY_LABEL] });
    const message = editStateRefusalMessage(input, readEditState(input));
    expect(message).toStartWith('A title change on issue #12 is refused');
    expect(message).toContain(SPEC_READY_LABEL);
    expect(message).toEndWith('rafa issue edit 12 --append-file=<file> --reason=<text>');
  });

  test('a planned replace names the saved copy, a closed one the state', () => {
    const planned = inputOf('replace', { savedCopies: [COPY] });
    expect(editStateRefusalMessage(planned, readEditState(planned))).toContain('saved copy under specs.dir');
    const closed = inputOf('replace', { open: false });
    expect(editStateRefusalMessage(closed, readEditState(closed))).toContain('the issue is closed');
  });

  test('a passing reading has no refusal to name', () => {
    const input = inputOf('append');
    expect(() => editStateRefusalMessage(input, readEditState(input))).toThrow(TypeError);
  });
});

describe('isSavedCopyName', () => {
  test.each([
    ['rafa-12-sync-design.md', true],
    ['rafa-12-notes.md', false],
    ['rafa-12-.md', false],
    ['rafa-12-sync-design.txt', false],
    ['rafa-120-sync-design.md', false],
    ['rafa-1-sync-design.md', false],
  ])('%s answers %p', (name, expected) => {
    expect(isSavedCopyName(name, ISSUE)).toBe(expected);
  });
});

describe('findSavedCopies', () => {
  const specsDir = join('.rafa', 'specs');
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rafa-issue-edit-state-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Writes `name` under the specs directory. */
  function write(name: string): void {
    mkdirSync(join(root, specsDir), { recursive: true });
    writeFileSync(join(root, specsDir, name), 'body\n');
  }

  test('answers none when specs.dir does not exist', () => {
    expect(findSavedCopies(root, specsDir, ISSUE)).toEqual([]);
  });

  test('answers none when only the notes file and other issues are there', () => {
    write('rafa-12-notes.md');
    write('rafa-120-other.md');
    write('rafa-1-other.md');
    expect(findSavedCopies(root, specsDir, ISSUE)).toEqual([]);
  });

  test('lists the copy as configured, beside the notes file', () => {
    write('rafa-12-notes.md');
    write('rafa-12-sync-design.md');
    expect(findSavedCopies(root, specsDir, ISSUE)).toEqual([join(specsDir, 'rafa-12-sync-design.md')]);
  });

  test('lists two copies in name order and skips a directory by a copy name', () => {
    write('rafa-12-zeta.md');
    write('rafa-12-alpha.md');
    mkdirSync(join(root, specsDir, 'rafa-12-dir.md'));
    expect(findSavedCopies(root, specsDir, ISSUE)).toEqual([
      join(specsDir, 'rafa-12-alpha.md'),
      join(specsDir, 'rafa-12-zeta.md'),
    ]);
  });

  test('throws when specs.dir is a file rather than a directory', () => {
    mkdirSync(join(root, '.rafa'), { recursive: true });
    writeFileSync(join(root, specsDir), 'not a directory\n');
    expect(() => findSavedCopies(root, specsDir, ISSUE)).toThrow();
  });
});

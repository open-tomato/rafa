/**
 * Tests for the stretch's rules in the snapshot `writeSpecSnapshot`
 * writes (`packages/rafa-board/src/board/issue.ts`): the rules file
 * appended after the notes, a change in it rebuilt as a change in the
 * notes is (`notes-rebuilt`, the old copy moved to `previous/`), and a
 * write handed no rules writing what the write wrote before rules
 * existed. The rules text and how a saved copy is read for them are
 * `./snapshot-change.ts`'s, tested in `./snapshot-change.test.ts`; the
 * write's other cases are in `./issue.test.ts`, which this file leaves
 * as it was.
 *
 * The caller reads the rules file and hands its text in, so no case
 * here writes a `rules.md`: the path is a name the lines and
 * {@link SpecSnapshot.rules} carry, and the text is the test's own.
 * Every file written sits under a temporary directory made in `tmpdir`
 * for the case and removed after it.
 *
 * The byte-for-byte cases compare against literal text, not against a
 * second call of `snapshotText`: a write that appended a rules section
 * for no rules would match a recomputation that appended it too.
 */
import type { SpecIssue, SpecSnapshot, StretchRules } from './issue.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { notesPath } from '@open-tomato/rafa/board/naming';
import { afterEach, describe, expect, it } from 'bun:test';

import { LOCAL_NOTES_HEADING, SPEC_LABEL, STRETCH_RULES_HEADING, writeSpecSnapshot } from './issue.js';
import { previousDir } from './previous-copy.js';

/** Where `specs.dir` points: a relative setting, as configured. */
const SPECS_DIR = '.rafa/specs';

/** The body every case plans from. */
const BODY = '# Spec\n\nBody.\n';

/** The rules every case hands in, at a path no case writes. */
const RULES: StretchRules = { path: '/repo/.rafa/stretch/112/rules.md', text: 'Measure first.\n' };

/** The roots made by the case running, removed after it. */
let roots: readonly string[] = [];

afterEach(() => {
  for (const made of roots) rmSync(made, { recursive: true, force: true });
  roots = [];
});

/** A fresh project root with `specs.dir` made, and the notes file holding `notes` when it is not null. */
function project(notes: string | null = null): string {
  const made = mkdtempSync(join(tmpdir(), 'rafa-board-rules-'));
  roots = [...roots, made];
  mkdirSync(join(made, SPECS_DIR), { recursive: true });
  if (notes !== null) writeFileSync(join(made, notesPath(SPECS_DIR, 20)), notes);
  return made;
}

/** Issue 20 with {@link BODY}, open and labelled. */
function issueOf(): SpecIssue {
  return { number: 20, title: 'Plans from the board', body: BODY, state: 'OPEN', labels: [SPEC_LABEL], author: 'octocat' };
}

/** The write over `root`, handed `rules`; left out of the options when it is undefined. */
function write(root: string, rules?: StretchRules | null): SpecSnapshot {
  return writeSpecSnapshot({
    repoRoot: root,
    specsDir: SPECS_DIR,
    issue: issueOf(),
    refresh: false,
    ...rules === undefined
      ? {}
      : { rules },
  });
}

describe('writeSpecSnapshot with the stretch rules', () => {
  it('appends the rules after the notes, and answers the rules file it was handed', () => {
    const written = write(project('A note.\n'), RULES);

    expect(written.action).toBe('created');
    expect(written.rules).toBe(RULES.path);
    expect(readFileSync(written.absolute, 'utf8'))
      .toBe(`${BODY}\n${LOCAL_NOTES_HEADING}\n\nA note.\n\n${STRETCH_RULES_HEADING}\n\nMeasure first.\n`);
  });

  it('rebuilds a copy whose rules alone changed, keeping the old copy under previous/', () => {
    const root = project('A note.\n');
    const first = write(root, RULES);

    const rebuilt = write(root, { ...RULES, text: 'Measure first, then plan.\n' });

    expect(first.action).toBe('created');
    expect(rebuilt.action).toBe('notes-rebuilt');
    expect(readFileSync(rebuilt.absolute, 'utf8'))
      .toBe(`${BODY}\n${LOCAL_NOTES_HEADING}\n\nA note.\n\n${STRETCH_RULES_HEADING}\n\nMeasure first, then plan.\n`);
    expect(readdirSync(join(root, previousDir(SPECS_DIR)))).toHaveLength(1);
    expect(readFileSync(join(root, rebuilt.previous ?? ''), 'utf8')).toBe(first.text);
  });

  it('rebuilds a copy written with no notes and no rules when a rules file is added', () => {
    const root = project();
    const first = write(root);

    const rebuilt = write(root, RULES);

    expect(first.text).toBe(BODY);
    expect(rebuilt.action).toBe('notes-rebuilt');
    expect(rebuilt.notes).toBeNull();
    expect(readFileSync(rebuilt.absolute, 'utf8')).toBe(`${BODY}\n${STRETCH_RULES_HEADING}\n\nMeasure first.\n`);
    expect(readFileSync(join(root, rebuilt.previous ?? ''), 'utf8')).toBe(BODY);
  });

  it('rebuilds a copy whose rules file was removed, back to the body and the notes alone', () => {
    const root = project('A note.\n');
    write(root, RULES);

    const rebuilt = write(root, null);

    expect(rebuilt.action).toBe('notes-rebuilt');
    expect(rebuilt.rules).toBeNull();
    expect(readFileSync(rebuilt.absolute, 'utf8')).toBe(`${BODY}\n${LOCAL_NOTES_HEADING}\n\nA note.\n`);
  });

  it('leaves a copy whose rules match alone', () => {
    const root = project();
    const first = write(root, RULES);
    const stamp = statSync(first.absolute).mtimeMs;

    const again = write(root, RULES);

    expect(again.action).toBe('unchanged');
    expect(statSync(again.absolute).mtimeMs).toBe(stamp);
    expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
  });

  it('writes byte for byte what it wrote before rules existed when handed none, null or left out', () => {
    const omitted = write(project('A note.\n'));
    const nulled = write(project('A note.\n'), null);
    const bare = write(project());

    expect(readFileSync(omitted.absolute, 'utf8')).toBe(`${BODY}\n${LOCAL_NOTES_HEADING}\n\nA note.\n`);
    expect(readFileSync(nulled.absolute, 'utf8')).toBe(`${BODY}\n${LOCAL_NOTES_HEADING}\n\nA note.\n`);
    expect(readFileSync(bare.absolute, 'utf8')).toBe(BODY);
    expect([omitted.rules, nulled.rules, bare.rules]).toEqual([null, null, null]);
  });

  it('leaves a copy written before rules existed alone when this run is handed none', () => {
    const root = project('A note.\n');
    const saved = join(root, SPECS_DIR, 'rafa-20-plans-board.md');
    writeFileSync(saved, `${BODY}\n${LOCAL_NOTES_HEADING}\n\nA note.\n`);
    const stamp = statSync(saved).mtimeMs;

    const written = write(root, null);

    expect(written.absolute).toBe(saved);
    expect(written.action).toBe('unchanged');
    expect(statSync(saved).mtimeMs).toBe(stamp);
  });
});

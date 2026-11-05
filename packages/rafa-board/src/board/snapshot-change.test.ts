/**
 * Tests for the snapshot text and the reading of how a saved copy
 * differs (`packages/rafa-board/src/board/snapshot-change.ts`):
 * {@link snapshotText}, {@link readSnapshotChange} and
 * {@link changedHeadings}. Every case is a pure call over texts: none
 * writes a file, spawns or reads the environment. The cases up to the
 * stretch rules moved here from `./issue.test.ts` with the module,
 * unedited, and the cases of `./issue.test.ts` that write a snapshot
 * still read these functions through `./issue.ts`'s re-export. The two
 * `with the stretch rules` blocks are the rules section's own; the
 * write's rules cases are in `./issue-rules.test.ts`.
 *
 * ## Mutations driven
 *
 * The mutations below were driven while the module was part of
 * `./issue.ts` and these cases sat in `./issue.test.ts`, whose own
 * counts they are; the module note of that file keeps the mutations of
 * the write.
 *
 * Seven mutations of {@link readSnapshotChange} were driven on
 * 2026-09-22 over `env -u CLAUDECODE bun test packages/rafa-board/src/board/issue.test.ts`,
 * the module copied to a scratch path, restored from the copy and
 * verified with `shasum -c` after each. 44 pass either side:
 *
 *  - the body prefix test loosened to the saved copy starting with the
 *    body at all: 1 fail, the appended-and-cut paragraph case.
 *  - the old notes read after the FIRST separator rather than the last:
 *    1 fail, the body holding its own Local notes heading.
 *  - the fence tracking dropped: 1 fail, the fenced `#` line case.
 *  - the line counts taken as the lines one body has and the other
 *    lacks, not the longest common subsequence: 1 fail, the moved line.
 *  - the notes never compared once the body changed: 1 fail, the both
 *    case.
 *  - a heading named only when one body has it and the other lacks it:
 *    4 fail, every case whose heading keeps its line and changes its
 *    text.
 *  - the body read the same only when the copy holds no notes: 3 fail,
 *    the three cases whose reading is `notes`.
 *
 * One mutation of the refs block handling was driven on 2026-09-24
 * over the same command, restored from a scratch copy and verified with
 * `shasum -c` after it:
 *
 *  - `readSnapshotChange` comparing the copy with its block left in:
 *    5 fail, the three block readings, the unchanged copy left alone and
 *    the notes rebuild, which the unstripped block turns into a refusal.
 *
 * Five mutations of the rules section were driven on 2026-11-05 over
 * `env -u CLAUDECODE bun test` of this file, `./issue-rules.test.ts`,
 * `./issue.test.ts` and `./snapshot-settle.test.ts`, 88 cases, each
 * module restored from a scratch copy and verified by `sha256sum`
 * after each:
 *
 *  - `snapshotText` dropping the rules: 10 fail, every case that writes
 *    or reads a rules section.
 *  - the rules heading written for empty rules: 21 fail, the
 *    byte-for-byte cases of both files and every base case of the write.
 *  - a tail opening at the rules separator not read as the same body:
 *    2 fail, the rules-only change and the rules removed with no notes.
 *  - the rules clause spelled as the notes clause: 5 fail, every case
 *    naming the rules file or the removed clause.
 *  - the write deciding its action without the rules: 2 fail, the
 *    rules added to a notes-free copy and the copy whose rules match.
 */
import type { SnapshotChange, StretchRules } from './snapshot-change.js';
import type { RefStamp } from '../refs/stamp.js';

import { notesPath } from '@open-tomato/rafa/board/naming';
import { describe, expect, it } from 'bun:test';

import { blobFingerprint, REFS_BLOCK_OPEN, RefsBlockError, writeRefsBlock } from '../refs/stamp.js';

import {
  changedHeadings,
  LOCAL_NOTES_HEADING,
  readSnapshotChange,
  RULES_REMOVED_LINE,
  snapshotText,
  STRETCH_RULES_HEADING,
} from './snapshot-change.js';

/** Where `specs.dir` points, as `./issue.test.ts` configures it: the notes line names a path under it. */
const SPECS_DIR = '.rafa/specs';

describe('snapshotText', () => {
  it('answers the body under one trailing newline when there are no notes', () => {
    expect(snapshotText('# Spec\n\nBody.\n\n\n', null)).toBe('# Spec\n\nBody.\n');
    expect(snapshotText('# Spec\n\nBody.', null)).toBe('# Spec\n\nBody.\n');
  });

  it('appends the notes under the Local notes heading', () => {
    expect(snapshotText('# Spec\n', 'The host is behind the VPN.\n'))
      .toBe(`# Spec\n\n${LOCAL_NOTES_HEADING}\n\nThe host is behind the VPN.\n`);
  });

  it('writes no heading for a notes file holding nothing but whitespace', () => {
    expect(snapshotText('# Spec\n', '\n  \n')).toBe('# Spec\n');
    expect(snapshotText('# Spec\n', '')).toBe('# Spec\n');
  });

  it('normalises CRLF line endings, and keeps a markdown line break', () => {
    expect(snapshotText('# Spec\r\n\r\nBody.\r\n', null)).toBe('# Spec\n\nBody.\n');
    expect(snapshotText('One line  \nand the next\n', null)).toBe('One line  \nand the next\n');
  });
});

describe('readSnapshotChange', () => {
  /** Where the notes line says the notes are. */
  const NOTES = notesPath(SPECS_DIR, 20);

  /** The notes line, spelled out once so every case asserts the same bytes. */
  const NOTES_LINE = `local notes: ${NOTES} changed since the saved copy`;

  /** The reading of `saved` against `body` and `notes`. */
  const read = (saved: string, body: string, notes: string | null): SnapshotChange => readSnapshotChange({
    saved,
    body,
    notes,
    notesPath: NOTES,
  });

  /** A spec with two headed sections, `design` under the first. */
  const spec = (design: string): string => `# Spec\n\n## Design\n\n${design}\n\n## Risks\n\nNone.\n`;

  it('answers unchanged, with no line, for the copy this run would write', () => {
    expect(read(snapshotText(spec('Old.'), 'A note.'), spec('Old.'), 'A note.\n'))
      .toEqual({ kind: 'unchanged', bodyLine: null, notesLine: null });
    expect(read('# Spec\n', '# Spec\r\n\r\n', null).kind).toBe('unchanged');
  });

  it('answers notes, naming the notes file, when only the notes were edited', () => {
    expect(read(snapshotText(spec('Old.'), 'The first note.'), spec('Old.'), 'A second note.\n'))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: NOTES_LINE });
  });

  it('answers notes when a notes file was added to a copy that had none, or emptied', () => {
    expect(read(snapshotText(spec('Old.'), null), spec('Old.'), 'A new note.\n').kind).toBe('notes');
    expect(read(snapshotText(spec('Old.'), 'A note.'), spec('Old.'), ' \n').kind).toBe('notes');
    expect(read(snapshotText(spec('Old.'), 'A note.'), spec('Old.'), null).kind).toBe('notes');
  });

  it('answers body, counting lines and naming the heading whose text changed', () => {
    const change = read(snapshotText(spec('Old text.'), 'A note.'), spec('New text.\nAnd more.'), 'A note.\n');

    expect(change).toEqual({
      kind: 'body',
      bodyLine: 'issue body: +2 -1 lines; headings changed: Design',
      notesLine: null,
    });
  });

  it('answers both, with both lines, when the body and the notes changed', () => {
    const change = read(snapshotText(spec('Old text.'), 'The first note.'), spec('New text.'), 'Another.\n');

    expect(change).toEqual({
      kind: 'both',
      bodyLine: 'issue body: +1 -1 lines; headings changed: Design',
      notesLine: NOTES_LINE,
    });
  });

  it('names a heading renamed as both the one added and the one removed', () => {
    expect(read('## Before\n\nThe text.\n', '## After\n\nThe text.\n', null).bodyLine)
      .toBe('issue body: +1 -1 lines; headings changed: After, Before');
  });

  it('reads no heading changed for an edit above the first heading, and for a body with none', () => {
    expect(read('Intro.\n\n# Spec\n\nBody.\n', 'Intro, edited.\n\n# Spec\n\nBody.\n', null).bodyLine)
      .toBe('issue body: +1 -1 lines; no heading changed');
    expect(read('One line.\n', 'One line.\nTwo lines.\n', null).bodyLine)
      .toBe('issue body: +1 -0 lines; no heading changed');
  });

  it('reads a # line inside a fenced code block as text under its heading, not a heading', () => {
    const old = '## Setup\n\n```sh\n#!/bin/sh\n# install\nbun i\n```\n';
    const now = '## Setup\n\n```sh\n#!/bin/sh\n# install\nbun install\n```\n';

    expect(read(old, now, null).bodyLine).toBe('issue body: +1 -1 lines; headings changed: Setup');
  });

  it('counts a line moved once each way, as the longest common subsequence leaves it', () => {
    // A count of lines one body has and the other lacks reads +0 -0 here.
    expect(read('A.\nB.\nC.\n', 'B.\nC.\nA.\n', null).bodyLine)
      .toBe('issue body: +1 -1 lines; no heading changed');
  });

  it('counts an appended paragraph as lines added, and a cut one as lines removed', () => {
    // Controls on the prefix test: each body is a prefix of the other, and
    // neither ends at the notes separator, so both are body changes.
    expect(read('# Spec\n', '# Spec\n\nMore.\n', null))
      .toEqual({ kind: 'body', bodyLine: 'issue body: +2 -0 lines; headings changed: Spec', notesLine: null });
    expect(read('# Spec\n\nMore.\n', '# Spec\n', null).bodyLine)
      .toBe('issue body: +0 -2 lines; headings changed: Spec');
  });

  it('reads a body holding its own Local notes heading by the body as it reads now', () => {
    const body = `# Spec\n\n${LOCAL_NOTES_HEADING}\n\nWritten in the issue.\n`;
    const edited = `# The spec\n\n${LOCAL_NOTES_HEADING}\n\nWritten in the issue.\n`;
    const saved = snapshotText(body, 'The first note.');

    expect(read(saved, body, 'A second note.').kind).toBe('notes');
    expect(read(saved, edited, 'The first note.')).toEqual({
      kind: 'body',
      bodyLine: 'issue body: +1 -1 lines; headings changed: The spec, Spec',
      notesLine: null,
    });
  });
});

describe('readSnapshotChange over a copy carrying a refs block', () => {
  const NOTES = notesPath(SPECS_DIR, 20);
  const stamps: readonly RefStamp[] = [{ kind: 'path', text: 'src/a.ts', fingerprint: blobFingerprint('a'.repeat(40)) }];

  it('reads unchanged for a copy whose body and notes match, whatever its block holds', () => {
    const saved = writeRefsBlock(snapshotText('# Spec\n\nBody.\n', 'A note.'), stamps);

    expect(saved.startsWith(`${REFS_BLOCK_OPEN}\n`)).toBe(true);
    expect(readSnapshotChange({ saved, body: '# Spec\n\nBody.\n', notes: 'A note.\n', notesPath: NOTES }))
      .toEqual({ kind: 'unchanged', bodyLine: null, notesLine: null });
  });

  it('counts none of the block\'s lines in a body change, and still tells a notes change apart', () => {
    const saved = writeRefsBlock(snapshotText('# Spec\n\nOld.\n', 'A note.'), stamps);

    expect(readSnapshotChange({ saved, body: '# Spec\n\nNew.\n', notes: 'A note.', notesPath: NOTES }).bodyLine)
      .toBe('issue body: +1 -1 lines; headings changed: Spec');
    expect(readSnapshotChange({ saved, body: '# Spec\n\nOld.\n', notes: 'Another.', notesPath: NOTES }).kind)
      .toBe('notes');
  });

  it('throws for a block that does not close, rather than reading it as body text', () => {
    expect(() => readSnapshotChange({ saved: `${REFS_BLOCK_OPEN}\n# Spec\n`, body: '# Spec\n', notes: null, notesPath: NOTES }))
      .toThrow(RefsBlockError);
  });
});

describe('changedHeadings', () => {
  it('names the headings whose text changed, and each one only one side has, the new order first', () => {
    const before = ['## Design', 'Old.', '## Gone', 'x'];
    const after = ['## Added', 'y', '## Design', 'New.'];

    expect(changedHeadings(before, after)).toEqual(['Added', 'Design', 'Gone']);
    expect(changedHeadings(before, before)).toEqual([]);
  });
});

describe('snapshotText with the stretch rules', () => {
  it('appends the rules under the Stretch rules heading, after the notes', () => {
    expect(snapshotText('# Spec\n', 'A note.\n', 'Measure first.\n'))
      .toBe(`# Spec\n\n${LOCAL_NOTES_HEADING}\n\nA note.\n\n${STRETCH_RULES_HEADING}\n\nMeasure first.\n`);
    expect(snapshotText('# Spec\n', null, '\r\nMeasure first.\r\n\r\n'))
      .toBe(`# Spec\n\n${STRETCH_RULES_HEADING}\n\nMeasure first.\n`);
  });

  it('writes no heading for rules holding nothing but whitespace', () => {
    expect(snapshotText('# Spec\n', 'A note.', ' \n\n')).toBe(snapshotText('# Spec\n', 'A note.'));
  });

  it('writes the text the body and notes alone write when no rules are handed in', () => {
    // Literals, not a second call: a rules section written for null would
    // match a two-argument call that wrote it too.
    expect(snapshotText('# Spec\n', 'A note.', null)).toBe(`# Spec\n\n${LOCAL_NOTES_HEADING}\n\nA note.\n`);
    expect(snapshotText('# Spec\n\n\n', null, null)).toBe('# Spec\n');
  });
});

describe('readSnapshotChange with the stretch rules', () => {
  const NOTES = notesPath(SPECS_DIR, 20);
  const NOTES_LINE = `local notes: ${NOTES} changed since the saved copy`;
  const RULES: StretchRules = { path: '/repo/.rafa/stretch/112/rules.md', text: 'Measure first.\n' };
  const RULES_LINE = `stretch rules: ${RULES.path} changed since the saved copy`;
  const BODY = '# Spec\n\n## Design\n\nThe text.\n';

  /** The reading of `saved` against `BODY` or `body`, `notes` and `rules`. */
  const read = (saved: string, notes: string | null, rules: StretchRules | null, body = BODY): SnapshotChange => readSnapshotChange({
    saved,
    body,
    notes,
    notesPath: NOTES,
    rules,
  });

  it('answers unchanged for a copy whose rules match', () => {
    expect(read(snapshotText(BODY, 'A note.', RULES.text), 'A note.\n', RULES))
      .toEqual({ kind: 'unchanged', bodyLine: null, notesLine: null });
    expect(read(snapshotText(BODY, null, RULES.text), null, RULES).kind).toBe('unchanged');
  });

  it('answers notes, naming the rules file, when only the rules changed', () => {
    const edited = { ...RULES, text: 'Measure first, then plan.\n' };

    expect(read(snapshotText(BODY, 'A note.', RULES.text), 'A note.', edited))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: RULES_LINE });
    expect(read(snapshotText(BODY, null, RULES.text), null, edited))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: RULES_LINE });
  });

  it('answers notes, naming the rules file, when a rules file was added to a copy with no notes', () => {
    const saved = snapshotText(BODY, null);

    expect(saved).toBe(BODY);
    expect(read(saved, null, RULES)).toEqual({ kind: 'notes', bodyLine: null, notesLine: RULES_LINE });
  });

  it('answers notes, with the removed clause, when the rules file was removed', () => {
    expect(read(snapshotText(BODY, 'A note.', RULES.text), 'A note.', null))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: RULES_REMOVED_LINE });
    expect(read(snapshotText(BODY, null, RULES.text), null, null))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: RULES_REMOVED_LINE });
  });

  it('names both local parts when the notes and the rules changed', () => {
    const edited = { ...RULES, text: 'Another rule.' };

    expect(read(snapshotText(BODY, 'The first note.', RULES.text), 'A second note.', edited))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: `${NOTES_LINE}; ${RULES_LINE}` });
  });

  it('names the notes alone when only the notes changed under rules that match', () => {
    expect(read(snapshotText(BODY, 'The first note.', RULES.text), 'A second note.', RULES))
      .toEqual({ kind: 'notes', bodyLine: null, notesLine: NOTES_LINE });
  });

  it('answers both when the body and the rules changed, and body when only the body did', () => {
    const now = '# Spec\n\n## Design\n\nThe new text.\n';
    const edited = { ...RULES, text: 'Another rule.' };
    const saved = snapshotText(BODY, 'A note.', RULES.text);

    expect(read(saved, 'A note.', edited, now)).toEqual({
      kind: 'both',
      bodyLine: 'issue body: +1 -1 lines; headings changed: Design',
      notesLine: RULES_LINE,
    });
    expect(read(saved, 'A note.', RULES, now)).toEqual({
      kind: 'body',
      bodyLine: 'issue body: +1 -1 lines; headings changed: Design',
      notesLine: null,
    });
  });
});

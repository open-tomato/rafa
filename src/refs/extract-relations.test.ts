/**
 * Tests for which references `extractRefs` (`./extract.ts`) marks as
 * blockers, read in both modes of the board's relationships port, and
 * for the `resolved` state `readRefsText` (`./reading.ts`) reads off
 * that mark. The literal-body cases of the `labels` default stay in
 * `./extract.test.ts`.
 *
 * The native board, on `acme/board`, holds the spec #30:
 *
 * | Blocked by | State | Marks |
 * | --- | --- | --- |
 * | #20 | open | `#20` and `rafa-20` |
 * | #21 | closed as `NOT_PLANNED` | `#21` |
 * | `other/lib#5` | open | `other/lib#5`, never `#5` |
 *
 * ## The controls
 *
 *  - The spec's body carries a `Blocked by: #9` line and `spec:blocked`,
 *    the `labels` marks. Read with no reading handed in, the same body
 *    marks `#9` and nothing the nodes name, so a native read that fell
 *    back to the line would be seen marking `#9`.
 *  - `#5` is named locally beside the foreign `other/lib#5`, so a mark
 *    that dropped the node's repository marks `#5`.
 *  - A native reading of `none` over a body with a line marks nothing,
 *    so the reading handed in is what answers, not the line.
 *
 * Every read goes through the real adapters over a `gh` that fails any
 * call; nothing spawns.
 */
import type { LiveReading } from './stamp.js';
import type { RefVerifier } from './verify.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BlockersReading } from '../board/relations/port.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from '../board/roadmap-board.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { createLabelsRelations, labelsLineBlockersOf } from '../board/relations/labels.js';
import { createNativeRelations } from '../board/relations/native.js';

import { extractRefs } from './extract.js';
import { readCopyRefs, readRefsText } from './reading.js';
import { issueFingerprint, PRESENT, writeRefsBlock } from './stamp.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-extract-relations-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const BOARD = 'acme/board';

/** The spec's own issue number. */
const SPEC = 30;

/** A `gh` every call to which fails the case: the reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** The `labels` adapter. */
const LABELS = createLabelsRelations({ gh: NO_GH });

/** A `blockedBy` node: issue `number` on `repository`, in `state`. */
function node(number: number, state: 'OPEN' | 'CLOSED', repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** What a case sets on a native row. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly blockedBy?: BoardIssueLinks;
}

/** A native listing row: every relationship field present, empty unless set. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: null,
    blockedBy: fields.blockedBy ?? { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/** The spec's body: every target named in running text, and a labels-mode line naming #9. */
const BODY = [
  'Waits on #20 (rafa-20 on its branch) and #21.', // 1
  'The library is other/lib#5; our own #5 is unrelated.', // 2
  'Blocked by: #9', // 3
].join('\n');

/** The native blockers of the spec, as the module note tabulates them. */
const NODES: BoardIssueLinks = { nodes: [node(20, 'OPEN'), node(21, 'CLOSED'), node(5, 'OPEN', 'other/lib')] };

/** The native board the module note tabulates. */
const ROWS: readonly BoardIssue[] = [
  row(SPEC, { labels: ['spec:blocked'], body: BODY, blockedBy: NODES }),
  row(9),
  row(20),
  row(21, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
];

/** The spec's row. */
const SPEC_ROW = ROWS[0] ?? row(SPEC);

/** `kind text` of every reference marked a blocker. */
function marked(refs: ReturnType<typeof extractRefs>): readonly string[] {
  return refs.filter((ref) => ref.blocker).map((ref) => `${ref.kind} ${ref.text}`);
}

/** What the spec waits on, in `native` mode, over the one listing. */
function nativeReading(): BlockersReading {
  return NATIVE.read(ROWS).blockersOf(SPEC_ROW);
}

/** True when `text` is marked a blocker under `reading`. */
function refsMarked(reading: BlockersReading, text: string): boolean {
  return extractRefs(BODY, reading).find((ref) => ref.text === text)?.blocker ?? false;
}

describe('extractRefs in labels mode', () => {
  it('marks what the body\'s Blocked by: line names when no reading is handed in, not the native nodes', () => {
    expect(marked(extractRefs(BODY))).toEqual(['issue #9']);
  });

  it('marks the same with the labels adapter\'s own reading of the spec, as with none', () => {
    const reading = LABELS.read(ROWS).blockersOf(SPEC_ROW);

    expect(reading.kind).toBe('blocked');
    expect(extractRefs(BODY, reading)).toEqual(extractRefs(BODY));
  });

  it('reads the line whatever the labels, as the default reading of a bare body', () => {
    const reading = labelsLineBlockersOf(0, 'Follows #24.\nBlocked by: #24\n');

    expect(reading.kind).toBe('blocked');
    expect(marked(extractRefs('Follows #24.\nBlocked by: #24\n'))).toEqual(['issue #24']);
  });

  it('still marks a fault line\'s foreign tokens, as the line read before the port did', () => {
    const body = 'Needs open-tomato/other#4.\nBlocked by: open-tomato/other#4\n';

    expect(labelsLineBlockersOf(0, body).kind).toBe('fault');
    expect(marked(extractRefs(body))).toEqual(['cross-issue open-tomato/other#4']);
  });

  it('marks nothing on a body with no line', () => {
    expect(labelsLineBlockersOf(0, 'Follows #24.').kind).toBe('fault');
    expect(marked(extractRefs('Follows #24.'))).toEqual([]);
  });
});

describe('extractRefs in native mode', () => {
  it('marks each blockedBy node, local by #n and rafa-<n>, and never the body\'s Blocked by: line', () => {
    expect(marked(extractRefs(BODY, nativeReading()))).toEqual([
      'issue #20',
      'issue rafa-20',
      'issue #21',
      'cross-issue other/lib#5',
    ]);
  });

  it('marks a foreign node by its repository, leaving this board\'s #5 unmarked', () => {
    const refs = extractRefs(BODY, nativeReading());

    expect(refs.find((ref) => ref.text === '#5')?.blocker).toBe(false);
    expect(refs.find((ref) => ref.text === 'other/lib#5')?.blocker).toBe(true);
  });

  it('marks a blocker closed as NOT_PLANNED, since the mark is what the spec waits on and not its state', () => {
    expect(refsMarked(nativeReading(), '#21')).toBe(true);
  });

  it('marks the nodes a truncated reading holds, and nothing past them', () => {
    const truncated = row(SPEC, { body: BODY, blockedBy: { nodes: [node(20, 'OPEN')], truncated: { total: 60 } } });
    const reading = NATIVE.read([truncated]).blockersOf(truncated);

    expect(reading).toMatchObject({ kind: 'blocked', truncated: { total: 60 } });
    expect(marked(extractRefs(BODY, reading))).toEqual(['issue #20', 'issue rafa-20']);
  });

  it('marks nothing for a spec with no blockedBy link, whatever its body\'s line says', () => {
    const free = row(SPEC, { labels: ['spec:blocked'], body: BODY });
    const reading = NATIVE.read([free]).blockersOf(free);

    expect(reading.kind).toBe('none');
    expect(marked(extractRefs(BODY, reading))).toEqual([]);
  });
});

/** An issue fingerprint in `state`. */
function issueIn(state: 'open' | 'closed'): LiveReading {
  return issueFingerprint({ title: 'A blocker', body: '## Design\n\nThe design.\n', state });
}

/** Every issue now closed, every other target present. */
const ALL_CLOSED: RefVerifier = (ref) => Promise.resolve(ref.kind === 'issue' || ref.kind === 'cross-issue'
  ? issueIn('closed')
  : PRESENT);

/** The spec's copy with every issue it names stamped open. */
function copyStampedOpen(): string {
  const open = issueIn('open');
  if (open.kind !== 'issue') throw new Error('an issue fingerprint was not an issue');
  const texts = [['issue', '#20'], ['issue', 'rafa-20'], ['issue', '#21'], ['cross-issue', 'other/lib#5'], ['issue', '#5'], ['issue', '#9']] as const;
  return writeRefsBlock(BODY, texts.map(([kind, text]) => ({ kind, text, fingerprint: open })));
}

/** `text state` of every row read `resolved`. */
function resolvedRows(rows: readonly { readonly text: string; readonly state: string }[]): readonly string[] {
  return rows.filter((one) => one.state === 'resolved').map((one) => one.text);
}

describe('the resolved state, in both modes', () => {
  it('reads resolved only the line\'s #9 in labels mode, every other closed issue ok', async () => {
    const reading = await readRefsText({ copy: copyStampedOpen(), issue: SPEC, verify: ALL_CLOSED });

    expect(resolvedRows(reading.rows)).toEqual(['#9']);
    expect(reading.rows.find((one) => one.text === '#9')?.unblock).toBe('rafa issue unblock 30');
  });

  it('reads resolved every blockedBy node in native mode, and not the line\'s #9 nor this board\'s #5', async () => {
    const reading = await readRefsText({ copy: copyStampedOpen(), issue: SPEC, verify: ALL_CLOSED, blockers: nativeReading() });

    expect(resolvedRows(reading.rows)).toEqual(['#20', 'rafa-20', '#21', 'other/lib#5']);
    expect(reading.rows.find((one) => one.text === '#9')?.state).toBe('ok');
  });

  it('hands the native reading through a copy on disk, which the reading leaves unchanged', async () => {
    const path = join(tempBase, 'native-copy.md');
    const copy = copyStampedOpen();
    writeFileSync(path, copy);

    const reading = await readCopyRefs({ path, issue: SPEC, verify: ALL_CLOSED, blockers: nativeReading() });

    expect(resolvedRows(reading.rows)).toEqual(['#20', 'rafa-20', '#21', 'other/lib#5']);
    expect(readFileSync(path, 'utf8')).toBe(copy);
  });
});

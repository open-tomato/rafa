/**
 * Tests for the `--json` fields following `board.relationships` in the
 * three commands that send the board listing's fields: the board listing
 * (`./roadmap-board.ts`), the board lister (`./boards.ts`) and the epic
 * context lookup (`./epic-context.ts`), which sends its `--label` list
 * in the labels mode and the native board listing in the native mode.
 *
 * The labels-mode argv is written out here as literal words, never
 * rebuilt from `BOARD_LIST_FIELDS` or the modules' own builders, so a
 * change to what the default mode sends fails here even if every
 * constant moved with it. Each native case is paired with its control:
 * the same answer read in the labels mode has no native key (asserted
 * with `Object.keys`, since `toEqual` does not tell a left-out key from
 * one set to undefined), and a labels-shaped answer read in the native
 * mode is refused, which proves the mode reached the parser and not only
 * the argv. Every `gh` answer is planted; nothing spawns.
 */
import type { EpicRelations } from './epics.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../config-sections.js';

import { describe, expect, it } from 'bun:test';

import { sinkOutput } from '../tests/output-sinks.js';

import { BOARDS_LIST_ARGS, BOARDS_LIST_COMMAND, boardsListArgs, createGhBoardLister } from './boards.js';
import { epicContextArgs, readEpicContext } from './epic-context.js';
import { LABELS_READS } from './relations/labels.js';
import { createNativeRelations } from './relations/native.js';
import {
  BOARD_LIST_FIELDS,
  boardListFields,
  boardListingCommand,
  createGhBoardListing,
  nativeBoardListFields,
} from './roadmap-board.js';

/** The labels-mode `--json` list, as the default has always sent it. */
const LABELS_FIELDS = 'number,title,body,state,stateReason,labels';

/** The native-mode `--json` list. */
const NATIVE_FIELDS = 'number,title,body,state,stateReason,labels,parent,blockedBy,blocking,subIssuesSummary,subIssues';

/** The keys a labels-mode issue has, in order. */
const LABELS_KEYS = ['number', 'title', 'body', 'state', 'stateReason', 'labels', 'type', 'module'];

/** The keys a native-mode issue has, in order. */
const NATIVE_KEYS = [...LABELS_KEYS, 'parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'];

/** A labels-mode row, as `gh issue list --json <LABELS_FIELDS>` writes it. */
function labelsRow(): Record<string, unknown> {
  return {
    number: 31,
    title: 'Roadmap',
    body: 'body',
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:roadmap' }, { name: 'type:epic' }, { name: 'epic:auth' }],
  };
}

/** A native-mode row with no links, as `gh issue list --json <NATIVE_FIELDS>` writes it. */
function nativeRow(): Record<string, unknown> {
  const none = { nodes: [], totalCount: 0 };
  return {
    ...labelsRow(),
    parent: null,
    blockedBy: none,
    blocking: none,
    subIssuesSummary: { completed: 0, percentCompleted: 0, total: 0 },
    subIssues: none,
  };
}

/** A runner answering `rows` to every command, recording each. */
function planted(rows: readonly unknown[]): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const answer: GhResult = { ok: true, stdout: JSON.stringify(rows), stderr: '' };
  let calls: readonly (readonly string[])[] = [];
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      return Promise.resolve(answer);
    },
    calls: () => calls,
  };
}

describe('the fields per mode', () => {
  it('keeps BOARD_LIST_FIELDS as the labels value and adds the five native fields after it', () => {
    expect(BOARD_LIST_FIELDS).toBe(LABELS_FIELDS);
    expect(nativeBoardListFields).toBe(NATIVE_FIELDS);
    expect(boardListFields('labels')).toBe(LABELS_FIELDS);
    expect(boardListFields('native')).toBe(NATIVE_FIELDS);
  });
});

describe('createGhBoardListing', () => {
  it('sends the labels-mode argv unchanged when no mode is named and when labels is', async () => {
    const expected = ['issue', 'list', '--state', 'all', '--limit', '1000', '--json', LABELS_FIELDS];
    for (const mode of [undefined, 'labels'] as const) {
      const gh = planted([labelsRow()]);
      const [issue] = await createGhBoardListing(mode === undefined
        ? { gh: gh.run }
        : { gh: gh.run, mode })();
      expect(gh.calls()).toEqual([expected]);
      expect(Object.keys(issue ?? {})).toEqual(LABELS_KEYS);
    }
    expect(boardListingCommand(1000)).toBe(`gh issue list --state all --limit 1000 --json ${LABELS_FIELDS}`);
    expect(boardListingCommand(1000, 'labels')).toBe(boardListingCommand(1000));
  });

  it('asks for and reads the native fields in the native mode, in one gh call', async () => {
    const gh = planted([nativeRow()]);
    const [issue] = await createGhBoardListing({ gh: gh.run, limit: 5, mode: 'native' })();
    expect(gh.calls()).toEqual([['issue', 'list', '--state', 'all', '--limit', '5', '--json', NATIVE_FIELDS]]);
    expect(Object.keys(issue ?? {})).toEqual(NATIVE_KEYS);
  });

  it('leaves the native keys out of a native-shaped answer read in the labels mode', async () => {
    const [issue] = await createGhBoardListing({ gh: planted([nativeRow()]).run })();
    expect(Object.keys(issue ?? {})).toEqual(LABELS_KEYS);
  });

  it('refuses a labels-shaped answer in the native mode, naming the native command', async () => {
    const listing = createGhBoardListing({ gh: planted([labelsRow()]).run, mode: 'native' });
    const command = `gh issue list --state all --limit 1000 --json ${NATIVE_FIELDS}`;
    expect(boardListingCommand(1000, 'native')).toBe(command);
    await expect(listing()).rejects.toThrow(`board listing: ${command} answered row 0 with parent undefined`);
  });
});

describe('createGhBoardLister', () => {
  /** The labels-mode argv, written out. */
  const LABELS_ARGS = [
    'issue', 'list', '--label', 'type:roadmap', '--state', 'open', '--limit', '1000', '--json', LABELS_FIELDS,
  ];

  it('sends the labels-mode argv unchanged when no mode is named and when labels is', async () => {
    expect(BOARDS_LIST_ARGS).toEqual(LABELS_ARGS);
    expect(boardsListArgs('labels')).toEqual(LABELS_ARGS);
    expect(BOARDS_LIST_COMMAND).toBe(`gh ${LABELS_ARGS.join(' ')}`);
    for (const options of [{}, { mode: 'labels' as const }]) {
      const gh = planted([labelsRow()]);
      const [board] = await createGhBoardLister({ gh: gh.run, ...options })();
      expect(gh.calls()).toEqual([LABELS_ARGS]);
      expect(Object.keys(board ?? {})).toEqual(LABELS_KEYS);
    }
  });

  it('asks for and reads the native fields in the native mode, in one gh call', async () => {
    const gh = planted([nativeRow()]);
    const [board] = await createGhBoardLister({ gh: gh.run, mode: 'native' })();
    expect(gh.calls()).toEqual([[...LABELS_ARGS.slice(0, -1), NATIVE_FIELDS]]);
    expect(Object.keys(board ?? {})).toEqual(NATIVE_KEYS);
  });

  it('refuses a labels-shaped answer in the native mode, naming the native command', async () => {
    const lister = createGhBoardLister({ gh: planted([labelsRow()]).run, mode: 'native' });
    const command = `gh ${boardsListArgs('native').join(' ')}`;
    expect(command).not.toBe(BOARDS_LIST_COMMAND);
    await expect(lister()).rejects.toThrow(`board listing: ${command} answered row 0 with parent undefined`);
  });
});

describe('readEpicContext', () => {
  /** The labels-mode argv for slug `auth`, written out. */
  const LABELS_ARGS = [
    'issue', 'list', '--state', 'all', '--label', 'type:epic', '--label', 'epic:auth',
    '--limit', '20', '--json', LABELS_FIELDS,
  ];

  /** The native-mode listing argv, written out. */
  const NATIVE_LISTING_ARGS = ['issue', 'list', '--state', 'all', '--limit', '1000', '--json', NATIVE_FIELDS];

  /** The relationships each mode is read through; `undefined` leaves the option out. */
  function relationsFor(mode: BoardRelationshipMode | undefined, gh: GhRunner): EpicRelations | undefined {
    if (mode === undefined) return undefined;
    return mode === 'native'
      ? createNativeRelations({ gh, repository: 'acme/board' })
      : LABELS_READS;
  }

  /** The lookup for issue #7 labelled `epic:auth`, read in `mode`, with the warnings it left. */
  async function lookUp(rows: readonly unknown[], mode?: BoardRelationshipMode): Promise<{
    readonly calls: readonly (readonly string[])[];
    readonly found: number | null;
    readonly warnings: readonly string[];
  }> {
    const gh = planted(rows);
    const warnings: string[] = [];
    const output = sinkOutput({
      warn: (message) => {
        warnings.push(message);
      },
    });
    const base = { issue: 7, labels: ['epic:auth'], gh: gh.run, output };
    const relations = relationsFor(mode, gh.run);
    const context = await readEpicContext(relations === undefined
      ? base
      : { ...base, relations });
    return { calls: gh.calls(), found: context?.number ?? null, warnings };
  }

  it('sends the labels-mode argv unchanged when no mode is named and when labels is', async () => {
    expect(epicContextArgs('auth')).toEqual(LABELS_ARGS);
    for (const mode of [undefined, 'labels'] as const) {
      const read = await lookUp([labelsRow()], mode);
      expect(read).toEqual({ calls: [LABELS_ARGS], found: 31, warnings: [] });
    }
  });

  it('sends the native board listing, and no --label list, in the native mode', async () => {
    const parent = { number: 31, title: 'Roadmap', url: 'https://github.com/acme/board/issues/31', state: 'OPEN' };
    const child = { ...nativeRow(), number: 7, labels: [{ name: 'type:spec' }], parent };
    // #31's first `type:` label is `type:roadmap`, so it is typed epic here only by relabelling it.
    const epic = { ...nativeRow(), labels: [{ name: 'type:epic' }] };
    const read = await lookUp([epic, child], 'native');
    expect(read).toEqual({ calls: [NATIVE_LISTING_ARGS], found: 31, warnings: [] });
  });

  it('warns and answers null for a labels-shaped answer in the native mode', async () => {
    const read = await lookUp([labelsRow()], 'native');
    expect(read.found).toBeNull();
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain(`--json ${NATIVE_FIELDS} answered row 0 with parent undefined`);
  });
});

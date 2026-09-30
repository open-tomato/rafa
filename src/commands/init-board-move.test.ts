/**
 * Tests for the relationships move `rafa init --board` ends with
 * (`./init-board.ts`, `runRelationsMoveStep`): every write printed before
 * one question, nothing written on a no, the writes sent on a yes, and
 * then the second question about the old marks.
 *
 * Every step case drives {@link fakeGh}, an in-process `gh` answering the
 * board listing, the repository read and the body reads from fixture rows
 * written as `gh issue list --json <native fields>` writes them, and
 * recording every argv; and {@link scriptedPrompter}, which answers the
 * questions from a list and records what it was told. Each "nothing
 * written" reading is paired with a yes over the same board, which does
 * write, so the reading could have failed.
 *
 * The command cases dispatch `rafa init --board` over a repository whose
 * `.rafa/config.yaml` sets the key or leaves it out, so the key is read
 * the way `init` reads it and no case reaches GitHub.
 */
import type { BoardStepResult, RelationsMoveStepOptions } from './init-board.js';
import type { InitResult, InitSeams } from './init.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../cli/prompt/confirm.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchCaptured, eventsOf } from '../tests/cli-capture.js';

import {
  MOVE_FIX,
  moveQuestion,
  relationsMoveChanged,
  renderRelationsMoveStep,
  runRelationsMoveStep,
} from './init-board.js';
import { createInitCommand, DEFAULT_INIT_SEAMS } from './init.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-board-move-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh directory under this file's own temporary root. */
function freshDir(label: string): string {
  return mkdtempSync(join(tempBase, `${label}-`));
}

const REPOSITORY = 'acme/board';

/** A board step that ran, which is all the move reads of it. */
const BOARD_RAN: BoardStepResult = Object.freeze({
  status: 'ran',
  asked: false,
  report: { parts: [], roadmapIssue: null, problems: [] },
  warnings: [],
});

/** A link node naming issue `number` on the board, as `gh` writes it. */
function node(number: number): object {
  return { number, title: `Issue ${String(number)}`, state: 'OPEN', url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
}

/** A list of link nodes, as `gh` writes one. */
function links(numbers: readonly number[]): object {
  return { nodes: numbers.map(node), totalCount: numbers.length };
}

/** The fields a fixture row may set; everything left out is empty. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly parent?: number;
  readonly blockedBy?: readonly number[];
  readonly subIssues?: readonly number[];
}

/** One issue as `gh issue list --json <native fields>` writes it. */
function row(number: number, fields: RowFields = {}): { readonly number: number; readonly body: string } & object {
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state: 'OPEN',
    stateReason: null,
    labels: (fields.labels ?? []).map((name) => ({ name })),
    parent: fields.parent === undefined
      ? null
      : node(fields.parent),
    blockedBy: links(fields.blockedBy ?? []),
    blocking: links([]),
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: links(subIssues),
  };
}

type Row = ReturnType<typeof row>;

/** An epic, `epic:alpha`, whose checklist orders #11 before #10. */
const EPIC_LABELS = ['type:epic', 'epic:alpha'];

/** A board recorded in labels: two members of epic #1, #30 blocked by #31. */
const LABELS_BOARD: readonly Row[] = [
  row(1, { labels: EPIC_LABELS, body: '- [ ] #11 second\n- [ ] #10 first\n' }),
  row(10, { labels: ['epic:alpha'] }),
  row(11, { labels: ['epic:alpha'] }),
  row(30, { labels: ['spec:blocked'], body: 'Blocked by: #31\n' }),
  row(31),
];

/** {@link LABELS_BOARD} once the move to native went through, the old marks kept. */
const MOVED_MARKS_KEPT: readonly Row[] = [
  row(1, { labels: EPIC_LABELS, body: '- [ ] #11 second\n- [ ] #10 first\n', subIssues: [11, 10] }),
  row(10, { labels: ['epic:alpha'], parent: 1 }),
  row(11, { labels: ['epic:alpha'], parent: 1 }),
  row(30, { labels: ['spec:blocked'], body: 'Blocked by: #31\n', blockedBy: [31] }),
  row(31),
];

/** A board recorded natively, with no labels mark on it; the epic keeps its own `epic:alpha`. */
const NATIVE_BOARD: readonly Row[] = [
  row(1, { labels: EPIC_LABELS, subIssues: [11, 10] }),
  row(10, { parent: 1 }),
  row(11, { parent: 1 }),
  row(30, { blockedBy: [31] }),
  row(31),
];

/** What {@link fakeGh} is told to do beyond answering. */
interface FakeOptions {
  /** An `issue edit` whose argv contains this is refused. */
  readonly refuse?: string;
  /** The listing fails. */
  readonly listingFails?: boolean;
}

/** An in-process `gh` over `rows`, recording each argv. */
function fakeGh(rows: readonly Row[], options: FakeOptions = {}): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const bodies = new Map(rows.map((each) => [each.number, each.body]));
  const answer = (stdout: string, ok = true): Promise<GhResult> => Promise.resolve({ ok, stdout, stderr: ok
    ? ''
    : 'refused by the fake' });
  const run: GhRunner = (args) => {
    calls.push([...args]);
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue list') {
      return options.listingFails === true
        ? answer('', false)
        : answer(JSON.stringify(rows));
    }
    if (route === 'repo view') return answer(JSON.stringify({ nameWithOwner: REPOSITORY }));
    if (route === 'issue edit') {
      const refused = options.refuse !== undefined && args.join(' ').includes(options.refuse);
      const body = args.find((arg) => arg.startsWith('--body='));
      if (!refused && body !== undefined) bodies.set(Number(args[2]), body.slice('--body='.length));
      return answer('', !refused);
    }
    if (args[0] === 'api') {
      const number = Number(args[1]?.split('/').pop());
      const patched = args.find((arg) => arg.startsWith('body='));
      if (patched !== undefined) bodies.set(number, patched.slice('body='.length));
      return answer(JSON.stringify({ body: bodies.get(number) ?? '' }));
    }
    return answer('', false);
  };
  return { run, calls: () => [...calls] };
}

/** The `issue edit` calls among `calls`, each joined by spaces. */
function edits(calls: readonly (readonly string[])[]): readonly string[] {
  return calls.filter((call) => call[0] === 'issue' && call[1] === 'edit').map((call) => call.join(' '));
}

/** A prompter answering from `answers` in order, recording what it said and asked. */
function scriptedPrompter(answers: readonly (string | null)[]): { prompter: Prompter; said: string[]; asked: string[] } {
  const said: string[] = [];
  const asked: string[] = [];
  const prompter: Prompter = {
    say: (text) => {
      said.push(text);
    },
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answers[asked.length - 1] ?? null);
    },
    close: () => undefined,
  };
  return { prompter, said, asked };
}

/** A prompter nobody may open. */
function noPrompter(): Prompter {
  throw new Error('the move opened a prompter where none was expected');
}

/** A runner nobody may open. */
function noGh(): GhRunner {
  throw new Error('the move opened a gh runner where none was expected');
}

/** Options over `gh` on a terminal answering through `prompter`. */
function optionsOn(gh: GhRunner, prompter: Prompter, relationships: 'labels' | 'native' = 'native'): RelationsMoveStepOptions {
  return {
    board: BOARD_RAN,
    relationships,
    root: freshDir('step'),
    openGh: () => gh,
    isTerminal: () => true,
    openPrompter: () => prompter,
  };
}

describe('the relationships move is only there when board.relationships is set', () => {
  it('answers null and opens nothing when the key is left at its default', async () => {
    const result = await runRelationsMoveStep({
      board: BOARD_RAN,
      relationships: null,
      root: freshDir('unset'),
      openGh: noGh,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toBeNull();
    expect(renderRelationsMoveStep(result)).toEqual([]);
    expect(relationsMoveChanged(result)).toBe(false);
  });

  it('reads nothing when the board step did not run', async () => {
    const board: BoardStepResult = { status: 'declined', asked: true, report: null, warnings: [] };

    const result = await runRelationsMoveStep({
      board,
      relationships: 'native',
      root: freshDir('no-board'),
      openGh: noGh,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toMatchObject({ status: 'not-run', from: 'labels', to: 'native', plan: null, move: null });
  });
});

describe('the relationships move from labels to native', () => {
  it('prints every write before asking once, and writes nothing on a no', async () => {
    const gh = fakeGh(LABELS_BOARD);
    const { prompter, said, asked } = scriptedPrompter(['n']);

    const result = await runRelationsMoveStep(optionsOn(gh.run, prompter));

    expect(result?.status).toBe('declined');
    expect(result?.asked).toBe(true);
    expect(said).toEqual([
      'Moving the board\'s relationships from labels to native:',
      '  write    make #11, #10 sub-issues of epic #1',
      '  write    link #30 as blocked by #31',
    ]);
    expect(asked).toEqual(['Send the 2 writes above, moving the board from labels to native? [y/N] ']);
    expect(edits(gh.calls())).toEqual([]);
    expect(gh.calls().map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list', 'repo view']);
    expect(relationsMoveChanged(result)).toBe(false);
    expect(renderRelationsMoveStep(result)).toEqual([`The board's labels relationships were left alone; run ${MOVE_FIX} to move them to native.`]);
  });

  it('reads the listing once, in the native fields', async () => {
    const gh = fakeGh(LABELS_BOARD);

    await runRelationsMoveStep(optionsOn(gh.run, scriptedPrompter(['n']).prompter));

    const listings = gh.calls().filter((call) => call[1] === 'list');
    expect(listings).toHaveLength(1);
    expect(listings[0]?.join(' ')).toContain('parent,blockedBy,blocking,subIssuesSummary,subIssues');
  });

  it('sends the writes on a yes, then asks the second question and keeps every old mark on a no', async () => {
    const gh = fakeGh(LABELS_BOARD);
    const { prompter, said, asked } = scriptedPrompter(['y', 'n']);

    const result = await runRelationsMoveStep(optionsOn(gh.run, prompter));

    expect(edits(gh.calls())).toEqual(['issue edit 1 --add-sub-issue 11,10', 'issue edit 30 --add-blocked-by 31']);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toBe('Remove the 3 old labels marks from the board? [y/N] ');
    expect(said.filter((line) => line.startsWith('  mark     '))).toHaveLength(3);
    expect(result?.status).toBe('moved');
    expect(result?.move?.removed).toEqual([]);
    expect(result?.move?.kept).toHaveLength(3);
    expect(result?.warnings).toEqual([]);
    expect(relationsMoveChanged(result)).toBe(true);
    const lines = renderRelationsMoveStep(result);
    expect(lines[0]).toBe('Board relationships, labels to native:');
    expect(lines).toContain('  sent     make #11, #10 sub-issues of epic #1');
    expect(lines.filter((line) => line.startsWith('  kept     '))).toHaveLength(3);
    expect(lines.at(-1)).toBe(`The old labels marks were kept; rafa doctor names them, and ${MOVE_FIX} asks again.`);
  });

  it('removes the old marks when the second question is answered yes', async () => {
    const gh = fakeGh(LABELS_BOARD);

    const result = await runRelationsMoveStep(optionsOn(gh.run, scriptedPrompter(['yes', 'Y']).prompter));

    const sent = edits(gh.calls());
    expect(sent.slice(0, 2)).toEqual(['issue edit 1 --add-sub-issue 11,10', 'issue edit 30 --add-blocked-by 31']);
    expect(sent).toContain('issue edit 10 --remove-label epic:alpha');
    expect(sent).toContain('issue edit 11 --remove-label epic:alpha');
    expect(sent.find((edit) => edit.startsWith('issue edit 30 --remove-label spec:blocked'))).toBeDefined();
    expect(result?.move?.removed).toHaveLength(3);
    expect(result?.move?.kept).toEqual([]);
    expect(renderRelationsMoveStep(result).filter((line) => line.startsWith('  removed  '))).toHaveLength(3);
  });

  it('on a second run with the marks kept, plans no write and asks only the second question', async () => {
    const gh = fakeGh(MOVED_MARKS_KEPT);
    const { prompter, asked } = scriptedPrompter(['n']);

    const result = await runRelationsMoveStep(optionsOn(gh.run, prompter));

    expect(result?.plan?.writes).toEqual([]);
    expect(result?.asked).toBe(false);
    expect(asked).toEqual(['Remove the 3 old labels marks from the board? [y/N] ']);
    expect(edits(gh.calls())).toEqual([]);
  });

  it('on a run over a finished move, says there is nothing to move and asks nothing', async () => {
    const gh = fakeGh(NATIVE_BOARD);

    const result = await runRelationsMoveStep({ ...optionsOn(gh.run, scriptedPrompter([]).prompter), openPrompter: noPrompter });

    expect(result?.status).toBe('nothing');
    expect(edits(gh.calls())).toEqual([]);
    expect(renderRelationsMoveStep(result)).toEqual(['Board relationships: nothing to move from labels to native.']);
  });

  it('stops at the write the board refuses, keeps every mark, asks no second question and warns naming the rerun', async () => {
    const gh = fakeGh(LABELS_BOARD, { refuse: '--add-sub-issue' });
    const { prompter, asked } = scriptedPrompter(['y', 'y']);

    const result = await runRelationsMoveStep(optionsOn(gh.run, prompter));

    expect(edits(gh.calls())).toEqual(['issue edit 1 --add-sub-issue 11,10']);
    expect(asked).toHaveLength(1);
    expect(result?.move?.done).toEqual([]);
    expect(result?.move?.left).toHaveLength(2);
    expect(result?.warnings).toEqual([
      'the board refused "make #11, #10 sub-issues of epic #1": refused by the fake. 0 write(s) went through and 2'
        + ` did not, and the old marks were kept; every write is idempotent, so run ${MOVE_FIX} again to finish the move.`,
    ]);
    expect(renderRelationsMoveStep(result).filter((line) => line.startsWith('  left     '))).toHaveLength(2);
  });

  it('writes nothing and asks nothing without a terminal, naming rafa init --board; a terminal control writes', async () => {
    const gh = fakeGh(LABELS_BOARD);
    const control = fakeGh(LABELS_BOARD);

    const result = await runRelationsMoveStep({ ...optionsOn(gh.run, scriptedPrompter([]).prompter), isTerminal: () => false, openPrompter: noPrompter });
    await runRelationsMoveStep(optionsOn(control.run, scriptedPrompter(['y', 'n']).prompter));

    expect(result?.status).toBe('unasked');
    expect(edits(gh.calls())).toEqual([]);
    expect(edits(control.calls())).toHaveLength(2);
    expect(renderRelationsMoveStep(result)).toEqual([`Moving the board from labels to native (2 write(s)) needs a terminal; run ${MOVE_FIX} to move it.`]);
  });

  it('warns and asks nothing when the listing cannot be read', async () => {
    const gh = fakeGh(LABELS_BOARD, { listingFails: true });

    const result = await runRelationsMoveStep({ ...optionsOn(gh.run, scriptedPrompter([]).prompter), openPrompter: noPrompter });

    expect(result?.status).toBe('unread');
    expect(result?.warnings).toHaveLength(1);
    expect(result?.warnings[0]).toStartWith('board.relationships is native: the board could not be read for relationships to move');
    expect(result?.warnings[0]).toEndWith(`run ${MOVE_FIX} again.`);
    expect(renderRelationsMoveStep(result)).toEqual([]);
  });
});

describe('the relationships move from native to labels', () => {
  it('prints the label, checklist and blocked-line writes, and sends them on a yes', async () => {
    const gh = fakeGh(NATIVE_BOARD);
    const { prompter, said, asked } = scriptedPrompter(['y', 'n']);

    const result = await runRelationsMoveStep(optionsOn(gh.run, prompter, 'labels'));

    expect(said[0]).toBe('Moving the board\'s relationships from native to labels:');
    expect(said.filter((line) => line.startsWith('  write    '))).toHaveLength(result?.plan?.writes.length ?? -1);
    expect(asked[0]).toBe(moveQuestion(result?.plan ?? { from: 'native', to: 'labels', writes: [], marks: [], skipped: [] }));
    const sent = edits(gh.calls());
    expect(sent.slice(0, 2)).toEqual(['issue edit 11 --add-label epic:alpha', 'issue edit 10 --add-label epic:alpha']);
    expect(sent.find((edit) => edit.startsWith('issue edit 30 --add-label spec:blocked --body='))).toContain('Blocked by: #31');
    expect(asked[1]).toBe('Remove the 3 old native marks from the board? [y/N] ');
    expect(result?.status).toBe('moved');
    expect(result?.move?.left).toEqual([]);
  });

  it('sends nothing on a no', async () => {
    const gh = fakeGh(NATIVE_BOARD);

    const result = await runRelationsMoveStep(optionsOn(gh.run, scriptedPrompter([null]).prompter, 'labels'));

    expect(result?.status).toBe('declined');
    expect(edits(gh.calls())).toEqual([]);
    expect(gh.calls().some((call) => call.includes('PATCH'))).toBe(false);
  });
});

/** A `gh` runner answering what the board step and the move send, recording each argv. */
function commandGh(): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const board = fakeGh(LABELS_BOARD);
  const labels: string[] = [];
  const run: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
    if (route === 'label list') return ok(JSON.stringify(labels.map((name) => ({ name }))));
    if (route === 'label create') {
      labels.push(args[2] ?? '');
      return ok('');
    }
    if (route === 'issue create') return ok('https://github.com/acme/widgets/issues/7\n');
    if (route === 'issue pin') return ok('');
    return board.run(args);
  };
  return { run, calls: board.calls };
}

/** A repository whose `.rafa/config.yaml` holds `config`, and a home beside it. */
function plantProject(label: string, config: string): { repo: string; home: string } {
  const base = freshDir(label);
  const repo = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(join(repo, '.rafa'), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(repo, '.rafa', 'config.yaml'), config, 'utf8');
  return { repo, home };
}

/** Runs `rafa init --board` in json mode over a project holding `config`, with no terminal. */
async function initBoard(label: string, config: string) {
  const project = plantProject(label, config);
  const gh = commandGh();
  const seams: InitSeams = {
    ...DEFAULT_INIT_SEAMS,
    cwd: () => project.repo,
    home: () => project.home,
    entry: () => join(project.home, 'dist', 'cli.js'),
    isTerminal: () => false,
    openPrompter: noPrompter,
    gitToplevel: (dir) => dir === project.repo
      ? project.repo
      : null,
    readRemote: () => 'https://github.com/acme/widgets.git',
    gh: () => gh.run,
  };
  const words = ['init', `--root=${project.repo}`, '--board', '--no-epic-guard', '--output=json'];
  const run = await dispatchCaptured(words, [], [createInitCommand(seams)], { PATH: join(project.home, '.rafa', 'bin') });
  const result = eventsOf(run.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;
  return { gh, run, result: result?.data as InitResult };
}

describe('rafa init --board reads board.relationships off the project config', () => {
  it('leaves relationsMove out and sends no move read with the key unset; the key set reads the board', async () => {
    const unset = await initBoard('init-unset', 'board:\n  trustedAuthors: []\n');
    const set = await initBoard('init-set', 'board:\n  relationships: native\n');
    const nativeListing = (call: readonly string[]): boolean => call.join(' ').includes('subIssues');

    expect(unset.run.exitCode).toBe(0);
    expect(Object.keys(unset.result)).not.toContain('relationsMove');
    expect(unset.gh.calls().some(nativeListing)).toBe(false);
    expect(unset.gh.calls().some((call) => call.join(' ') === 'repo view --json nameWithOwner')).toBe(false);
    expect(set.run.exitCode).toBe(0);
    expect(Object.keys(set.result)).toContain('relationsMove');
    expect(set.result.relationsMove?.status).toBe('unasked');
    expect(set.gh.calls().filter(nativeListing)).toHaveLength(1);
    expect(edits(set.gh.calls())).toEqual([]);
  });
});

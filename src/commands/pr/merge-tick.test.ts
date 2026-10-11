/**
 * Tests for what `rafa pr merge` decides about the roadmap tick
 * (`src/commands/pr/merge-tick.ts`): whether there is anything to tick,
 * which boards list a closed issue, the default board while none is
 * labelled, and that nothing on the way out throws.
 *
 * Every case drives a `gh` runner of its own, routing on the argument
 * list and keeping every call, so no case spawns a process or reaches
 * GitHub. The rule the tick applies and the retry it makes are
 * `src/board/roadmap-tick.test.ts`'s; what is measured here is the calls
 * SENT, because the way this module passes while wrong is by spending a
 * search on a merge that ticks nothing or by failing a merge that is
 * already done.
 *
 * The epic tick sends one board listing of its own before the boards.
 * The stub keeps that listing out of `calls()`, counting it in
 * `listings()` instead, so the board cases read the calls they read
 * before the epic tick existed and a case that spends it says so; the
 * epic cases read `epicCalls()`, the reads and writes of the epics'
 * bodies, and assert each sentence through `epicTickSentence` itself.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { EpicTickResult } from '../../board/epic-tick.js';

import { describe, expect, it } from 'bun:test';

import { BOARDS_LIST_ARGS, BOARDS_LIST_COMMAND } from '../../board/boards.js';
import { epicTickProblemLine, epicTickSentence } from '../../board/epic-tick.js';
import { BOARD_LISTING_LIMIT, boardListingCommand } from '../../board/roadmap-board.js';

import { noBoardListsLine, tickProblemLine, tickRoadmapAfterMerge } from './merge-tick.js';

/** The roadmap body every case plants. */
const ROADMAP = '- [ ] #20 plans from the board\n- [ ] #33 the board setup\n';

/** A recorded `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** One labelled board as the `type:roadmap` listing writes it, open and holding `body` unless told otherwise. */
function labelledBoard(
  number: number,
  body = ROADMAP,
  more: { readonly state?: string; readonly labels?: readonly string[] } = {},
): object {
  const labels = (more.labels ?? ['type:roadmap']).map((name) => ({ name }));
  return { number, title: 'Team board', body, state: more.state ?? 'OPEN', stateReason: null, labels };
}

/** The issue number an `api` call's path names. */
function issueOfPath(args: readonly string[]): number {
  return Number(/issues\/(\d+)$/u.exec(args[1] ?? '')?.[1]);
}

/** The path of every `api` call, in order. */
function apiPaths(calls: readonly (readonly string[])[]): readonly string[] {
  return calls.filter((call) => call[0] === 'api').map((call) => call[1] ?? '');
}

/** The board listing the epic tick sends, as `gh` is handed it. */
const LISTING_COMMAND = boardListingCommand(BOARD_LISTING_LIMIT);

/** True for the epic tick's board listing: `--state all` and no `--label`, never by the first two words alone. */
function isListing(args: readonly string[]): boolean {
  return `gh ${args.join(' ')}` === LISTING_COMMAND;
}

/** One issue as the board listing writes it, open and holding an empty body unless told otherwise. */
function listed(
  number: number,
  labels: readonly string[],
  more: { readonly body?: string; readonly state?: string } = {},
): object {
  const names = labels.map((name) => ({ name }));
  return { number, title: `Issue ${String(number)}`, body: more.body ?? '', state: more.state ?? 'OPEN', stateReason: null, labels: names };
}

/** An open epic of `slug` as the board listing writes it. */
function epicRow(number: number, slug: string, body: string): object {
  return listed(number, ['type:epic', `epic:${slug}`], { body });
}

/** A member of `slug` the merge closed, as the board listing writes it. */
function memberRow(number: number, ...slugs: readonly string[]): object {
  return listed(number, ['type:spec', ...slugs.map((slug) => `epic:${slug}`)], { state: 'CLOSED' });
}

/** What a stubbed runner kept. */
interface StubGh {
  readonly run: GhRunner;
  /** Every call but the epic tick's board listing. */
  readonly calls: () => readonly (readonly string[])[];
  /** How many board listings the epic tick sent. */
  readonly listings: () => number;
  /** The path of every `api` call naming one of the planted epics, in order. */
  readonly epicCalls: () => readonly string[];
  /** The body issue `number` holds now. */
  readonly bodyOf: (number: number) => string | undefined;
}

/**
 * A runner answering the board listing, the `type:roadmap` listing, the
 * search, the read and the write, keeping every call. The board listing
 * answers `listing`, empty unless planted, and `failListing` fails it;
 * the `type:roadmap` listing answers no board unless `boards` plants
 * some, so roadmap.issue and the title decide as before; `fail` fails
 * every call but the two listings, which `failBoards` fails, and
 * `failIssue` fails the reads and writes of that one issue. Each issue
 * read keeps its own body: a planted board's or listed issue's own, else
 * {@link ROADMAP}, until a write replaces it.
 */
function stubGh(options: {
  readonly boards?: readonly object[];
  readonly failBoards?: boolean;
  readonly listing?: readonly object[];
  readonly failListing?: boolean;
  readonly search?: string;
  readonly fail?: boolean;
  readonly failIssue?: number;
} = {}): StubGh {
  const calls: (readonly string[])[] = [];
  const epicPaths: string[] = [];
  let listings = 0;
  type Planted = readonly { readonly number: number; readonly body: string; readonly labels?: readonly object[] }[];
  const rows = (options.listing ?? []) as Planted;
  const planted = [...rows, ...(options.boards ?? []) as Planted];
  const epics = new Set(rows
    .filter((row) => JSON.stringify(row.labels ?? []).includes('"type:epic"'))
    .map((row) => row.number));
  const stored = new Map<number, string>(planted.map((board) => [board.number, board.body]));
  const run: GhRunner = (args) => {
    if (isListing(args)) {
      listings += 1;
      return Promise.resolve(options.failListing === true
        ? { ok: false, stdout: '', stderr: 'gh could not list all' }
        : wrote(JSON.stringify(options.listing ?? [])));
    }
    calls.push([...args]);
    if (args[0] === 'api' && epics.has(issueOfPath(args))) epicPaths.push(args[1] ?? '');
    if (args[0] === 'issue' && args.includes('--label')) {
      return Promise.resolve(options.failBoards === true
        ? { ok: false, stdout: '', stderr: 'gh could not list' }
        : wrote(JSON.stringify(options.boards ?? [])));
    }
    if (options.fail === true) return Promise.resolve({ ok: false, stdout: '', stderr: 'gh said no' });
    if (args[0] === 'issue') return Promise.resolve(wrote(options.search ?? '[{"number":31,"title":"Roadmap"}]'));
    const issue = issueOfPath(args);
    if (issue === options.failIssue) return Promise.resolve({ ok: false, stdout: '', stderr: 'gh said no' });
    const sent = args.find((arg) => arg.startsWith('body='));
    if (sent !== undefined) stored.set(issue, sent.slice('body='.length));
    return Promise.resolve(wrote(JSON.stringify({ number: issue, body: stored.get(issue) ?? ROADMAP })));
  };
  return {
    run,
    calls: () => calls,
    listings: () => listings,
    epicCalls: () => epicPaths,
    bodyOf: (number) => stored.get(number),
  };
}

/** A sink keeping every warning and every epic's tick. */
function sink(): {
  warn: (message: string) => void;
  lines: () => readonly string[];
  epicTicked: (result: EpicTickResult) => void;
  epics: () => readonly EpicTickResult[];
} {
  const lines: string[] = [];
  const epics: EpicTickResult[] = [];
  return {
    warn: (message: string): void => void lines.push(message),
    lines: () => lines,
    epicTicked: (result: EpicTickResult): void => void epics.push(result),
    epics: () => epics,
  };
}

/** The two sinks a call hands the tick, from `into`, a fresh sink unless given. */
function hooks(into: ReturnType<typeof sink> = sink()): Pick<ReturnType<typeof sink>, 'warn' | 'epicTicked'> {
  return { warn: into.warn, epicTicked: into.epicTicked };
}

describe('tickRoadmapAfterMerge', () => {
  it('spends no gh call at all on a pull request whose body closes no issue', async () => {
    const stub = stubGh();
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'A pull request about nothing on the roadmap.',
      configured: 31,
      gh: stub.run,
      ...hooks(warnings),
    });

    expect(result).toBeNull();
    expect(stub.calls()).toEqual([]);
    expect(warnings.lines()).toEqual([]);
  });

  it('ticks the line of the issue the body closes, through the configured roadmap and no search', async () => {
    const stub = stubGh();
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: 31,
      gh: stub.run,
      ...hooks(warnings),
    });

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ roadmap: 31, status: 'ticked', ticked: [20], attempts: 1 });
    // `api` first, then the path: the tick sends a gh subcommand, not a
    // bare REST path (`board/roadmap-tick.ts`).
    expect(stub.calls().map((call) => call.slice(0, 2))).toEqual([
      ['issue', 'list'],
      ['api', 'repos/{owner}/{repo}/issues/31'],
      ['api', 'repos/{owner}/{repo}/issues/31'],
    ]);
    expect(stub.calls()[0]).toEqual([...BOARDS_LIST_ARGS]);
    expect(stub.calls()[2]).toContain('body=- [x] #20 plans from the board\n- [ ] #33 the board setup\n');
    expect(warnings.lines()).toEqual([]);
  });

  it('searches for the issue titled Roadmap when the config names none', async () => {
    const stub = stubGh();

    const result = await tickRoadmapAfterMerge({
      body: 'Fixes #33',
      configured: null,
      gh: stub.run,
      ...hooks(),
    });

    expect(stub.calls()[0]).toEqual([...BOARDS_LIST_ARGS]);
    expect(stub.calls()[1]).toContain('--search');
    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'ticked', ticked: [33] })]);
  });

  it('ticks the default board while none is labelled even when its checklist lacks the line, as before', async () => {
    const stub = stubGh();

    const result = await tickRoadmapAfterMerge({ body: 'Fixes #99', configured: 31, gh: stub.run, ...hooks() });

    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'nothing-to-tick', absent: [99] })]);
    expect(apiPaths(stub.calls())).toEqual(['repos/{owner}/{repo}/issues/31']);
  });

  it('ticks every type:roadmap board listing the issue, lowest first, and spends no title search', async () => {
    const stub = stubGh({ boards: [labelledBoard(44), labelledBoard(40)] });

    const result = await tickRoadmapAfterMerge({
      body: 'Fixes #33',
      configured: null,
      gh: stub.run,
      ...hooks(),
    });

    expect(result?.map((tick) => [tick.roadmap, tick.status, tick.ticked])).toEqual([
      [40, 'ticked', [33]],
      [44, 'ticked', [33]],
    ]);
    expect(apiPaths(stub.calls())).toEqual([
      'repos/{owner}/{repo}/issues/40',
      'repos/{owner}/{repo}/issues/40',
      'repos/{owner}/{repo}/issues/44',
      'repos/{owner}/{repo}/issues/44',
    ]);
    expect(stub.calls().filter((call) => call.includes('--search'))).toEqual([]);
  });

  it('neither reads nor writes a board whose checklist lists none of the closed issues', async () => {
    const stub = stubGh({ boards: [labelledBoard(40, '- [ ] #99 elsewhere\n'), labelledBoard(44)] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, ...hooks() });

    expect(result?.map((tick) => tick.roadmap)).toEqual([44]);
    expect(apiPaths(stub.calls())).toEqual(['repos/{owner}/{repo}/issues/44', 'repos/{owner}/{repo}/issues/44']);
  });

  it('reports a line ticked by hand on a listing board as ticked already, writing nothing', async () => {
    const stub = stubGh({ boards: [labelledBoard(40, '- [x] #20 plans from the board\n')] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, ...hooks() });

    expect(result).toEqual([expect.objectContaining({ roadmap: 40, status: 'nothing-to-tick', already: [20] })]);
    expect(apiPaths(stub.calls())).toEqual(['repos/{owner}/{repo}/issues/40']);
  });

  it('answers an empty list when labelled boards exist and none lists a closed issue, reading none', async () => {
    const stub = stubGh({ boards: [labelledBoard(40, '- [ ] #99 elsewhere\n')] });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, ...hooks(warnings) });

    expect(result).toEqual([]);
    expect(stub.calls()).toEqual([[...BOARDS_LIST_ARGS]]);
    expect(warnings.lines()).toEqual([]);
  });

  it('skips a listed row that is closed or lacks the label, whatever its checklist lists', async () => {
    const stub = stubGh({
      boards: [
        labelledBoard(40, ROADMAP, { state: 'CLOSED' }),
        labelledBoard(42, ROADMAP, { labels: ['type:epic'] }),
        labelledBoard(44),
      ],
    });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, ...hooks() });

    expect(result?.map((tick) => tick.roadmap)).toEqual([44]);
  });

  it('ticks a configured roadmap the listing does not hold first, then every listing board', async () => {
    const stub = stubGh({ boards: [labelledBoard(44), labelledBoard(40, '- [ ] #99 elsewhere\n')] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks() });

    expect(result?.map((tick) => [tick.roadmap, tick.status])).toEqual([[31, 'ticked'], [44, 'ticked']]);
  });

  it('puts a configured board that is labelled and lists the issue first, over lower numbers', async () => {
    const stub = stubGh({ boards: [labelledBoard(40), labelledBoard(44)] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 44, gh: stub.run, ...hooks() });

    expect(result?.map((tick) => tick.roadmap)).toEqual([44, 40]);
  });

  it('leaves out a configured board that is labelled but lists none of the closed issues', async () => {
    const stub = stubGh({ boards: [labelledBoard(40), labelledBoard(44, '- [ ] #99 elsewhere\n')] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 44, gh: stub.run, ...hooks() });

    expect(result?.map((tick) => tick.roadmap)).toEqual([40]);
  });

  it('goes on to the next board when one board would not take the tick', async () => {
    const stub = stubGh({ boards: [labelledBoard(40), labelledBoard(44)], failIssue: 40 });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, ...hooks(warnings) });

    expect(result?.map((tick) => [tick.roadmap, tick.status])).toEqual([[40, 'failed'], [44, 'ticked']]);
    expect(warnings.lines()).toEqual([]);
  });

  it('warns rather than throwing when the type:roadmap listing fails', async () => {
    const stub = stubGh({ failBoards: true });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: 31,
      gh: stub.run,
      ...hooks(warnings),
    });

    expect(result).toBeNull();
    expect(warnings.lines()).toEqual([tickProblemLine(`board listing: ${BOARDS_LIST_COMMAND} failed: gh could not list`)]);
    expect(stub.calls()).toHaveLength(1);
  });

  it('warns rather than throwing when no issue is titled Roadmap', async () => {
    const stub = stubGh({ search: '[]' });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: null,
      gh: stub.run,
      ...hooks(warnings),
    });

    expect(result).toBeNull();
    expect(warnings.lines()).toHaveLength(1);
    expect(warnings.lines()[0]).toContain('the roadmap was not ticked');
    expect(warnings.lines()[0]).toContain('no open issue is titled Roadmap');
  });

  it('answers a board that would not be read as a failed tick rather than throwing', async () => {
    const stub = stubGh({ fail: true });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: 31,
      gh: stub.run,
      ...hooks(warnings),
    });

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ status: 'failed', attempts: 2 });
    expect(result?.[0]?.problem).toContain('gh said no');
    expect(warnings.lines()).toEqual([]);
  });
});

describe('tickRoadmapAfterMerge, on the epic its epic: label names', () => {
  const EPIC_BODY = 'Why this epic.\r\n\r\n## Specs\r\n\r\n- [ ] #20 plans from the board\r\n- [ ] #21 the rest\r\n';

  it('ticks the member line on its epic, keeping every other byte, and still ticks the roadmap listing it', async () => {
    const stub = stubGh({ listing: [epicRow(252, 'boards', EPIC_BODY), memberRow(20, 'boards')] });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(stub.bodyOf(252)).toBe(EPIC_BODY.replace('- [ ] #20', '- [x] #20'));
    expect(warnings.epics()).toEqual([
      { issue: 252, status: 'edited', attempts: 1, problem: '', members: [20] },
    ]);
    expect(epicTickSentence(warnings.epics()[0]!)).toBe('Ticked #20 on epic #252.');
    expect(stub.epicCalls()).toEqual([
      'repos/{owner}/{repo}/issues/252',
      'repos/{owner}/{repo}/issues/252',
      'repos/{owner}/{repo}/issues/252',
    ]);
    // The roadmap tick is the one it was: the same result, the same calls after the epic's.
    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'ticked', ticked: [20], attempts: 1 })]);
    expect(stub.bodyOf(31)).toBe('- [x] #20 plans from the board\n- [ ] #33 the board setup\n');
    expect(stub.calls().slice(3)[0]).toEqual([...BOARDS_LIST_ARGS]);
    expect(stub.listings()).toBe(1);
    expect(warnings.lines()).toEqual([]);
  });

  it('pays one board listing and hands nothing on when no open issue is an epic', async () => {
    const stub = stubGh({ listing: [memberRow(20, 'boards'), listed(252, ['type:epic', 'epic:boards'], { body: EPIC_BODY, state: 'CLOSED' })] });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(stub.listings()).toBe(1);
    expect(stub.epicCalls()).toEqual([]);
    expect(warnings.epics()).toEqual([]);
    expect(warnings.lines()).toEqual([]);
    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'ticked', ticked: [20] })]);
  });

  it('sends no listing at all for a pull request closing no issue', async () => {
    const stub = stubGh({ listing: [epicRow(252, 'boards', EPIC_BODY), memberRow(20, 'boards')] });

    await tickRoadmapAfterMerge({ body: 'Refs #20', configured: 31, gh: stub.run, ...hooks() });

    expect(stub.listings()).toBe(0);
  });

  it('neither reads nor writes an epic whose checklist lists none of its closed members', async () => {
    const stub = stubGh({ listing: [epicRow(252, 'boards', '- [ ] #21 the rest\n'), memberRow(20, 'boards')] });
    const warnings = sink();

    await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(stub.epicCalls()).toEqual([]);
    expect(warnings.epics()).toEqual([]);
  });

  it('leaves an issue with no epic: label, and the epic issue itself, to the boards alone', async () => {
    const stub = stubGh({ listing: [epicRow(252, 'boards', '- [ ] #20 x\n- [ ] #252 itself\n'), listed(20, ['type:spec'])] });
    const warnings = sink();

    await tickRoadmapAfterMerge({ body: 'Closes #20, closes #252', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(stub.epicCalls()).toEqual([]);
    expect(warnings.epics()).toEqual([]);
    expect(warnings.lines()).toEqual([]);
  });

  it('ticks two members of one epic in one edit, and each epic once, lowest epic first', async () => {
    const stub = stubGh({
      listing: [
        epicRow(260, 'later', '- [ ] #33 later\n'),
        epicRow(252, 'boards', EPIC_BODY),
        memberRow(20, 'boards'),
        memberRow(21, 'boards'),
        memberRow(33, 'later'),
      ],
    });
    const warnings = sink();

    await tickRoadmapAfterMerge({ body: 'Closes #33, closes #21, closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(warnings.epics().map((epic) => [epic.issue, epic.status, epic.members])).toEqual([
      [252, 'edited', [20, 21]],
      [260, 'edited', [33]],
    ]);
    expect(stub.bodyOf(252)).toBe(EPIC_BODY.replace('- [ ] #20', '- [x] #20').replace('- [ ] #21', '- [x] #21'));
    expect(stub.epicCalls().filter((path) => path.endsWith('/252'))).toHaveLength(3);
  });

  it('answers a line ticked by hand as needing no tick, writing nothing', async () => {
    const ticked = EPIC_BODY.replace('- [ ] #20', '- [x] #20');
    const stub = stubGh({ listing: [epicRow(252, 'boards', ticked), memberRow(20, 'boards')] });
    const warnings = sink();

    await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(warnings.epics()).toEqual([{ issue: 252, status: 'nothing-to-edit', attempts: 0, problem: '', members: [20] }]);
    expect(epicTickSentence(warnings.epics()[0]!)).toBe('#20 needed no tick on epic #252.');
    expect(stub.epicCalls()).toEqual(['repos/{owner}/{repo}/issues/252']);
  });

  it('warns and ticks no epic for an issue carrying two epic: labels', async () => {
    const stub = stubGh({
      listing: [epicRow(252, 'boards', EPIC_BODY), epicRow(260, 'later', '- [ ] #20 x\n'), memberRow(20, 'boards', 'later')],
    });
    const warnings = sink();

    await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(warnings.lines()).toEqual([epicTickProblemLine(
      '#20 carries 2 epic labels ("epic:boards", "epic:later"), so no epic was ticked for it',
    )]);
    expect(stub.epicCalls()).toEqual([]);
  });

  it('warns and ticks neither when two open epics carry the member label', async () => {
    const stub = stubGh({
      listing: [epicRow(252, 'boards', EPIC_BODY), epicRow(260, 'boards', EPIC_BODY), memberRow(20, 'boards')],
    });
    const warnings = sink();

    await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(warnings.lines()).toEqual([epicTickProblemLine(
      '2 open type:epic issues carry "epic:boards" (#252, #260), so none was ticked for #20',
    )]);
    expect(stub.epicCalls()).toEqual([]);
  });

  it('warns once when the board listing fails, and ticks the boards all the same', async () => {
    const stub = stubGh({ failListing: true });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(warnings.lines()).toHaveLength(1);
    expect(warnings.lines()[0]).toStartWith(epicTickProblemLine(''));
    expect(warnings.lines()[0]).toContain('gh could not list all');
    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'ticked', ticked: [20] })]);
  });

  it('answers an epic that would not take the tick as failed, and ticks the boards all the same', async () => {
    const stub = stubGh({ listing: [epicRow(252, 'boards', EPIC_BODY), memberRow(20, 'boards')], failIssue: 252 });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, ...hooks(warnings) });

    expect(warnings.epics()).toEqual([expect.objectContaining({ issue: 252, status: 'failed', attempts: 2, members: [20] })]);
    expect(epicTickSentence(warnings.epics()[0]!)).toStartWith('epic #252 was not ticked after 2 attempts: ');
    expect(warnings.lines()).toEqual([]);
    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'ticked' })]);
  });
});

describe('epicTickSentence', () => {
  const result = { issue: 252, attempts: 1, problem: '', members: [20, 21] } as const;

  it('names the members and the epic, one sentence per status', () => {
    expect(epicTickSentence({ ...result, status: 'edited' })).toBe('Ticked #20, #21 on epic #252.');
    expect(epicTickSentence({ ...result, status: 'nothing-to-edit' })).toBe('#20, #21 needed no tick on epic #252.');
    expect(epicTickSentence({ ...result, status: 'failed', attempts: 2, problem: 'gh said no' }))
      .toBe('epic #252 was not ticked after 2 attempts: gh said no');
  });
});

describe('epicTickProblemLine', () => {
  it('names the epic tick, so the line is never read as something the merge did', () => {
    expect(epicTickProblemLine('gh said no')).toBe('the epic checklists were not ticked: gh said no');
  });
});

describe('noBoardListsLine', () => {
  it('names the label and every closed issue no board lists', () => {
    expect(noBoardListsLine([20, 33])).toBe('no open type:roadmap board lists #20, #33, so nothing was ticked.');
  });
});

describe('tickProblemLine', () => {
  it('names the tick, so the line is never read as something the merge did', () => {
    expect(tickProblemLine('gh said no')).toBe('the roadmap was not ticked: gh said no');
  });
});

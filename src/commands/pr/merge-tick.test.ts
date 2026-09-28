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
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { BOARDS_LIST_ARGS, BOARDS_LIST_COMMAND } from '../../board/boards.js';

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

/**
 * A runner answering the `type:roadmap` listing, the search, the read and
 * the write, keeping every call. The listing answers no board unless
 * `boards` plants some, so roadmap.issue and the title decide as before;
 * `fail` fails every call but the listing, which `failBoards` fails, and
 * `failIssue` fails the reads and writes of that one issue. Each issue
 * read keeps its own body: a planted board's own, else {@link ROADMAP},
 * until a write replaces it.
 */
function stubGh(options: {
  readonly boards?: readonly object[];
  readonly failBoards?: boolean;
  readonly search?: string;
  readonly fail?: boolean;
  readonly failIssue?: number;
} = {}): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const planted = (options.boards ?? []) as readonly { readonly number: number; readonly body: string }[];
  const stored = new Map<number, string>(planted.map((board) => [board.number, board.body]));
  const run: GhRunner = (args) => {
    calls.push([...args]);
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
  return { run, calls: () => calls };
}

/** A warn sink keeping every line. */
function sink(): { warn: (message: string) => void; lines: () => readonly string[] } {
  const lines: string[] = [];
  return { warn: (message: string): void => void lines.push(message), lines: () => lines };
}

describe('tickRoadmapAfterMerge', () => {
  it('spends no gh call at all on a pull request whose body closes no issue', async () => {
    const stub = stubGh();
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'A pull request about nothing on the roadmap.',
      configured: 31,
      gh: stub.run,
      warn: warnings.warn,
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
      warn: warnings.warn,
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
      warn: sink().warn,
    });

    expect(stub.calls()[0]).toEqual([...BOARDS_LIST_ARGS]);
    expect(stub.calls()[1]).toContain('--search');
    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'ticked', ticked: [33] })]);
  });

  it('ticks the default board while none is labelled even when its checklist lacks the line, as before', async () => {
    const stub = stubGh();

    const result = await tickRoadmapAfterMerge({ body: 'Fixes #99', configured: 31, gh: stub.run, warn: sink().warn });

    expect(result).toEqual([expect.objectContaining({ roadmap: 31, status: 'nothing-to-tick', absent: [99] })]);
    expect(apiPaths(stub.calls())).toEqual(['repos/{owner}/{repo}/issues/31']);
  });

  it('ticks every type:roadmap board listing the issue, lowest first, and spends no title search', async () => {
    const stub = stubGh({ boards: [labelledBoard(44), labelledBoard(40)] });

    const result = await tickRoadmapAfterMerge({
      body: 'Fixes #33',
      configured: null,
      gh: stub.run,
      warn: sink().warn,
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

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, warn: sink().warn });

    expect(result?.map((tick) => tick.roadmap)).toEqual([44]);
    expect(apiPaths(stub.calls())).toEqual(['repos/{owner}/{repo}/issues/44', 'repos/{owner}/{repo}/issues/44']);
  });

  it('reports a line ticked by hand on a listing board as ticked already, writing nothing', async () => {
    const stub = stubGh({ boards: [labelledBoard(40, '- [x] #20 plans from the board\n')] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, warn: sink().warn });

    expect(result).toEqual([expect.objectContaining({ roadmap: 40, status: 'nothing-to-tick', already: [20] })]);
    expect(apiPaths(stub.calls())).toEqual(['repos/{owner}/{repo}/issues/40']);
  });

  it('answers an empty list when labelled boards exist and none lists a closed issue, reading none', async () => {
    const stub = stubGh({ boards: [labelledBoard(40, '- [ ] #99 elsewhere\n')] });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, warn: warnings.warn });

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

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, warn: sink().warn });

    expect(result?.map((tick) => tick.roadmap)).toEqual([44]);
  });

  it('ticks a configured roadmap the listing does not hold first, then every listing board', async () => {
    const stub = stubGh({ boards: [labelledBoard(44), labelledBoard(40, '- [ ] #99 elsewhere\n')] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 31, gh: stub.run, warn: sink().warn });

    expect(result?.map((tick) => [tick.roadmap, tick.status])).toEqual([[31, 'ticked'], [44, 'ticked']]);
  });

  it('puts a configured board that is labelled and lists the issue first, over lower numbers', async () => {
    const stub = stubGh({ boards: [labelledBoard(40), labelledBoard(44)] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 44, gh: stub.run, warn: sink().warn });

    expect(result?.map((tick) => tick.roadmap)).toEqual([44, 40]);
  });

  it('leaves out a configured board that is labelled but lists none of the closed issues', async () => {
    const stub = stubGh({ boards: [labelledBoard(40), labelledBoard(44, '- [ ] #99 elsewhere\n')] });

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: 44, gh: stub.run, warn: sink().warn });

    expect(result?.map((tick) => tick.roadmap)).toEqual([40]);
  });

  it('goes on to the next board when one board would not take the tick', async () => {
    const stub = stubGh({ boards: [labelledBoard(40), labelledBoard(44)], failIssue: 40 });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({ body: 'Closes #20', configured: null, gh: stub.run, warn: warnings.warn });

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
      warn: warnings.warn,
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
      warn: warnings.warn,
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
      warn: warnings.warn,
    });

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ status: 'failed', attempts: 2 });
    expect(result?.[0]?.problem).toContain('gh said no');
    expect(warnings.lines()).toEqual([]);
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

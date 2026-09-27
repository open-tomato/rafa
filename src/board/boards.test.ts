/**
 * Tests for the board lister and the default-board resolver
 * (`src/board/boards.ts`).
 *
 * Every case plants a stand-in `gh` that tells the two `gh issue list`
 * calls apart by their other flags — `--label type:roadmap` for the board
 * listing, `--search "Roadmap in:title"` for the title rule — never by
 * `args[0]`/`args[1]`, and answers anything else as a failure so an
 * unexpected command cannot pass unseen. No case reaches a real `gh`.
 *
 * ## The controls
 *
 * Readings that could pass while wrong are each paired with one that must
 * read the other way:
 *
 *  - The lowest-numbered board is picked from a listing planted out of
 *    order, so a resolver taking the first row fails.
 *  - A labelled board that is ALSO titled "Roadmap" is left out of the
 *    unlabelled list beside one that is not, so a resolver naming every
 *    titled issue, or none, fails.
 *  - The title rule's refusals are asserted with nothing labelled AND their
 *    absence with a board labelled, so a resolver that always, or never,
 *    ran the title rule fails one of the two.
 *  - The search counts are asserted as zero where the module note says no
 *    search is spent, beside cases where it is spent once.
 */
import type { BoardIssue } from './roadmap-board.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import {
  BOARDS_LIST_ARGS,
  BOARDS_LIST_COMMAND,
  createGhBoardLister,
  resolveDefaultBoard,
  unlabelledRoadmapMessage,
} from './boards.js';
import { BOARD_LIST_FIELDS, BOARD_LISTING_LIMIT } from './roadmap-board.js';
import {
  createGhRoadmapSearch,
  noRoadmapMessage,
  ROADMAP_REFUSAL_EXIT,
  severalRoadmapsMessage,
} from './roadmap.js';
import { ROADMAP_LABEL } from './setup.js';

/** One open issue as `gh issue list --json <BOARD_LIST_FIELDS>` writes it. */
interface Row {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
}

/** The JSON row `gh` writes for `row`, every listed field present. */
function ghRow(row: Row): Readonly<Record<string, unknown>> {
  return {
    number: row.number,
    title: row.title,
    body: `- [ ] #${String(row.number + 100)} an epic`,
    state: 'OPEN',
    stateReason: '',
    labels: row.labels.map((name) => ({ name })),
  };
}

/** A `gh` result with nothing wrong. */
function ghOk(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `gh` result that failed with `stderr`. */
function ghFailed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** What a stand-in `gh` answers, per route. */
interface Planted {
  /** The open issues of the repository, labelled or not. */
  readonly issues: readonly Row[];
  /** Answers the label listing with this instead of the planted issues. */
  readonly listing?: GhResult;
  /** Answers the title search with this instead of the planted issues. */
  readonly search?: GhResult;
}

/** The value after `flag` in `args`, or null. */
function flagValue(args: readonly string[], flag: string): string | null {
  const at = args.indexOf(flag);
  return at === -1
    ? null
    : args[at + 1] ?? null;
}

/**
 * A stand-in `gh` over `planted`: the label listing answers the issues
 * carrying the label, the title search the issues whose title holds
 * "roadmap" (loosely, as GitHub's search does), anything else fails.
 */
function standInGh(planted: Planted): {
  run: GhRunner;
  routes: () => readonly string[];
} {
  let routes: readonly string[] = [];
  const run: GhRunner = (args) => {
    const label = flagValue(args, '--label');
    const search = flagValue(args, '--search');
    if (label === ROADMAP_LABEL && search === null) {
      routes = [...routes, 'listing'];
      const rows = planted.issues.filter((issue) => issue.labels.includes(ROADMAP_LABEL)).map(ghRow);
      return Promise.resolve(planted.listing ?? ghOk(JSON.stringify(rows)));
    }
    if (search === 'Roadmap in:title' && label === null) {
      routes = [...routes, 'search'];
      const rows = planted.issues
        .filter((issue) => issue.title.toLowerCase().includes('roadmap'))
        .map((issue) => ({ number: issue.number, title: issue.title }));
      return Promise.resolve(planted.search ?? ghOk(JSON.stringify(rows)));
    }
    routes = [...routes, `unrouted: ${args.join(' ')}`];
    return Promise.resolve(ghFailed('no route'));
  };
  return { run, routes: () => routes };
}

/** The resolver over a stand-in `gh` planted with `planted`. */
function resolveOver(planted: Planted, configured: number | null = null): {
  answer: ReturnType<typeof resolveDefaultBoard>;
  routes: () => readonly string[];
} {
  const gh = standInGh(planted);
  const answer = resolveDefaultBoard({
    configured,
    listBoards: createGhBoardLister({ gh: gh.run }),
    search: createGhRoadmapSearch({ gh: gh.run }),
  });
  return { answer, routes: gh.routes };
}

/** The `CommandExit` `run` rejected with; fails the case when it resolved or threw anything else. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit refusal, and the call resolved');
}

/** The numbers of `boards`, in order. */
function numbersOf(boards: readonly BoardIssue[]): readonly number[] {
  return boards.map((board) => board.number);
}

/** An issue carrying the board label. */
function board(number: number, title = `Board ${String(number)}`): Row {
  return { number, title, labels: [ROADMAP_LABEL] };
}

/** An issue carrying no label. */
function plain(number: number, title: string): Row {
  return { number, title, labels: [] };
}

describe('createGhBoardLister', () => {
  it('sends one gh issue list for open type:roadmap issues through the board listing fields', async () => {
    const gh = standInGh({ issues: [board(31)] });
    let sent: readonly (readonly string[])[] = [];
    const recording: GhRunner = (args) => {
      sent = [...sent, [...args]];
      return gh.run(args);
    };

    const boards = await createGhBoardLister({ gh: recording })();

    expect(sent).toEqual([[
      'issue', 'list',
      '--label', 'type:roadmap',
      '--state', 'open',
      '--limit', String(BOARD_LISTING_LIMIT),
      '--json', BOARD_LIST_FIELDS,
    ]]);
    expect(sent).toEqual([BOARDS_LIST_ARGS]);
    expect(numbersOf(boards)).toEqual([31]);
  });

  it('answers each board as the board listing parses it, labels, type and body included', async () => {
    const gh = standInGh({ issues: [board(31, 'Roadmap')] });

    const [read] = await createGhBoardLister({ gh: gh.run })();

    expect(read).toEqual({
      number: 31,
      title: 'Roadmap',
      body: '- [ ] #131 an epic',
      state: 'OPEN',
      stateReason: null,
      labels: ['type:roadmap'],
      type: 'code',
      module: 'unassigned',
    });
  });

  it('answers an empty list for a repository where nothing carries the label', async () => {
    const gh = standInGh({ issues: [plain(31, 'Roadmap')] });

    expect(await createGhBoardLister({ gh: gh.run })()).toEqual([]);
  });

  it('rejects naming the command when gh failed', () => {
    const gh = standInGh({ issues: [], listing: ghFailed('HTTP 401') });

    expect(createGhBoardLister({ gh: gh.run })())
      .rejects.toThrow(`board listing: ${BOARDS_LIST_COMMAND} failed: HTTP 401`);
  });

  it('rejects a gh that failed and wrote nothing, saying so', () => {
    const gh = standInGh({ issues: [], listing: ghFailed('') });

    expect(createGhBoardLister({ gh: gh.run })())
      .rejects.toThrow(`${BOARDS_LIST_COMMAND} failed and wrote nothing`);
  });

  it('refuses rows from a narrower --json list, naming the first missing field', () => {
    const narrow = ghOk(JSON.stringify([{ number: 31, title: 'Roadmap' }]));
    const gh = standInGh({ issues: [], listing: narrow });

    expect(createGhBoardLister({ gh: gh.run })())
      .rejects.toThrow(`${BOARDS_LIST_COMMAND} answered row 0 with body undefined, expected a string`);
  });
});

describe('resolveDefaultBoard: roadmap.issue', () => {
  it('answers the configured issue over labelled boards, reading the listing once', async () => {
    const { answer, routes } = resolveOver({ issues: [board(12), board(31)] }, 7);

    const read = await answer;

    expect([read.number, read.source]).toEqual([7, 'configured']);
    expect(numbersOf(read.boards)).toEqual([12, 31]);
    expect(routes()).toEqual(['listing', 'search']);
  });

  it('spends no title search when nothing is labelled, as resolveRoadmapIssue did', async () => {
    const { answer, routes } = resolveOver({ issues: [plain(31, 'Roadmap')] }, 7);

    const read = await answer;

    expect(read).toEqual({ number: 7, source: 'configured', boards: [], unlabelled: [] });
    expect(routes()).toEqual(['listing']);
  });

  it('names an unlabelled Roadmap beside labelled boards even when roadmap.issue chose the default', async () => {
    const { answer } = resolveOver({ issues: [board(12), plain(31, 'Roadmap')] }, 12);

    expect((await answer).unlabelled).toEqual([31]);
  });
});

describe('resolveDefaultBoard: the lowest-numbered labelled board', () => {
  it('answers the lowest number from a listing planted out of order, with every board sorted', async () => {
    const { answer } = resolveOver({ issues: [board(40), board(12), board(31)] });

    const read = await answer;

    expect([read.number, read.source]).toEqual([12, 'label']);
    expect(numbersOf(read.boards)).toEqual([12, 31, 40]);
  });

  it('prefers a labelled board to an unlabelled issue titled Roadmap, and names the unlabelled one', async () => {
    const { answer, routes } = resolveOver({ issues: [plain(5, 'Roadmap'), board(31, 'Team board')] });

    const read = await answer;

    expect([read.number, read.source]).toEqual([31, 'label']);
    expect(read.unlabelled).toEqual([5]);
    expect(routes()).toEqual(['listing', 'search']);
  });

  it('leaves a labelled board titled Roadmap out of the unlabelled list, beside one that is named', async () => {
    const { answer } = resolveOver({
      issues: [board(12, 'Roadmap'), plain(31, '  roadmap '), plain(40, 'Roadmap for the API')],
    });

    const read = await answer;

    expect(read.number).toBe(12);
    expect(read.unlabelled).toEqual([31]);
  });

  it('refuses nothing when several unlabelled issues are titled Roadmap beside a board, naming them lowest first', async () => {
    const { answer } = resolveOver({ issues: [plain(55, 'ROADMAP'), board(40), plain(31, 'Roadmap')] });

    const read = await answer;

    expect([read.number, read.unlabelled]).toEqual([40, [31, 55]]);
  });

  it('answers an empty unlabelled list when every board is labelled', async () => {
    const { answer } = resolveOver({ issues: [board(12), board(31, 'Roadmap')] });

    expect((await answer).unlabelled).toEqual([]);
  });
});

describe('resolveDefaultBoard: the title rule, while nothing is labelled', () => {
  it('answers the one open issue titled Roadmap, spending the search once', async () => {
    const { answer, routes } = resolveOver({ issues: [plain(12, 'Roadmap for the API'), plain(31, 'Roadmap')] });

    const read = await answer;

    expect(read).toEqual({ number: 31, source: 'title', boards: [], unlabelled: [] });
    expect(routes()).toEqual(['listing', 'search']);
  });

  it('refuses with resolveRoadmapIssue\'s sentence and exit when no issue is titled Roadmap', async () => {
    const { answer } = resolveOver({ issues: [plain(12, 'Roadmap for the API')] });

    const exit = await refusal(() => answer);

    expect([exit.exitCode, exit.message]).toEqual([ROADMAP_REFUSAL_EXIT, noRoadmapMessage()]);
  });

  it('refuses with resolveRoadmapIssue\'s sentence and exit when two issues are titled Roadmap', async () => {
    const { answer } = resolveOver({ issues: [plain(31, 'Roadmap'), plain(55, 'ROADMAP')] });

    const exit = await refusal(() => answer);

    expect([exit.exitCode, exit.message]).toEqual([ROADMAP_REFUSAL_EXIT, severalRoadmapsMessage([31, 55])]);
  });
});

describe('resolveDefaultBoard: failures', () => {
  it('rejects with the listing\'s failure and spends no search', async () => {
    const { answer, routes } = resolveOver({ issues: [plain(31, 'Roadmap')], listing: ghFailed('HTTP 502') });

    expect(answer).rejects.toThrow(`${BOARDS_LIST_COMMAND} failed: HTTP 502`);
    await answer.catch(() => null);
    expect(routes()).toEqual(['listing']);
  });

  it('rejects with the search\'s failure when labelled boards exist', () => {
    const { answer } = resolveOver({ issues: [board(12)], search: ghFailed('HTTP 502') });

    expect(answer).rejects.toThrow('failed: HTTP 502');
  });
});

describe('unlabelledRoadmapMessage', () => {
  it('names one issue, the label and what to do', () => {
    expect(unlabelledRoadmapMessage([31])).toBe(
      'open issue #31 is titled Roadmap but lacks the type:roadmap label,'
        + ' so no reader takes it as a board while labelled boards exist;'
        + ' add the label to make it one, or retitle or close it',
    );
  });

  it('names several issues in the order given, in the plural', () => {
    expect(unlabelledRoadmapMessage([31, 55])).toStartWith('open issues #31, #55 are titled Roadmap but lack the type:roadmap label');
  });

  it('throws for an empty list', () => {
    expect(() => unlabelledRoadmapMessage([])).toThrow(RangeError);
  });
});

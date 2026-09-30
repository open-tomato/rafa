/**
 * Tests for the freed-issue reading `rafa pr merge` runs after its
 * clean-up under `board.relationships: native` (`./merge-freed.ts`):
 * which open issues a merge freed, the `gh` calls the reading sends, what
 * it prints, and that nothing on the way out throws.
 *
 * Every case drives an in-process `gh` runner answering the repository
 * and one native board listing, recording each argv, so no case spawns
 * a process or reaches GitHub. The rule for "freed" is the port's and
 * `src/board/relations/freed.test.ts` holds it; what is measured here is
 * the listing READ, the calls SENT and the lines PRINTED, since this
 * module passes while wrong by writing to the board, by listing once per
 * blocker, or by failing a merge that is already done.
 *
 * ## The controls
 *
 *  - The selection case runs one board against a body closing #20 and
 *    against a body closing #20 and #26, and holds the two answers
 *    against each other: a reading that named every blocked issue, or
 *    none, would look right on one half alone.
 *  - The silence case pairs a body closing no issue, which sends no call,
 *    with a body closing one, which sends exactly two, so "it sent
 *    nothing" is a reading of the recorder rather than of a dead runner.
 *  - Each failure case asserts the warning AND the calls that were not
 *    sent after it.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { boardListingCommand, BOARD_LISTING_LIMIT } from '../../board/roadmap-board.js';

import { INDENT } from './merge-cleanup.js';
import { freedAfterMerge, freedHeaderLine, freedIssueLine, freedProblemLine } from './merge-freed.js';

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** Another repository. */
const FOREIGN = 'acme/other';

/** The repository read, as the recorder spells it. */
const REPO_VIEW = 'repo view --json nameWithOwner';

/** The one native listing, as the recorder spells it. */
const NATIVE_LISTING = boardListingCommand(BOARD_LISTING_LIMIT, 'native').slice('gh '.length);

/** A link node naming issue `number` on `repository`, as `gh` writes it. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository: string = REPOSITORY): object {
  return { number, title: `Issue ${String(number)}`, state, url: `https://github.com/${repository}/issues/${String(number)}` };
}

/** A list of link nodes, as `gh` writes one, `total` defaulting to the node count. */
function links(nodes: readonly object[], total: number = nodes.length): object {
  return { nodes, totalCount: total };
}

/** The fields a row may set. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly title?: string;
  readonly blockedBy?: readonly object[];
  readonly blockedTotal?: number;
}

/** One issue as `gh issue list --json <native fields>` writes it. */
function row(number: number, fields: RowFields = {}): object {
  const state = fields.state ?? 'OPEN';
  const blockedBy = fields.blockedBy ?? [];
  return {
    number,
    title: fields.title ?? `Spec ${String(number)}`,
    body: '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: [],
    parent: null,
    blockedBy: links(blockedBy, fields.blockedTotal),
    blocking: links([]),
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: links([]),
  };
}

/**
 * The board every case reads. The listing was read after the merge but
 * holds #20's node as `OPEN` still, as a listing racing GitHub's close
 * can, so a freed issue is read off the merge's closing keywords and not
 * off the node alone.
 *
 *  - #12 waits on #20 alone: freed by closing #20.
 *  - #13 waits on #20 and #26: freed only once #26 closes as well.
 *  - #14 waits on #21, which no case closes.
 *  - #15 waits on #20 and on an open blocker in another repository.
 *  - #16 waits on #20, with more blockers than `gh` answered.
 *  - #17 is closed, and waited on #20.
 */
const LISTING: readonly object[] = [
  row(20, { state: 'CLOSED' }),
  row(21),
  row(26),
  row(12, { title: 'Sign-in page', blockedBy: [node(20)] }),
  row(13, { title: 'Session store', blockedBy: [node(20), node(26)] }),
  row(14, { blockedBy: [node(21)] }),
  row(15, { blockedBy: [node(20), node(3, 'OPEN', FOREIGN)] }),
  row(16, { blockedBy: [node(20)], blockedTotal: 51 }),
  row(17, { state: 'CLOSED', blockedBy: [node(20)] }),
];

/** What a case's runner answers instead of the board. */
interface FakeAnswers {
  readonly repo?: GhResult;
  readonly listing?: GhResult;
}

/** A runner over {@link LISTING}, and every argv it was handed. */
interface FakeGh {
  readonly run: GhRunner;
  readonly ran: () => readonly string[];
}

/** A runner answering the repository and the listing; any other call fails the case. */
function fakeGh(answers: FakeAnswers = {}): FakeGh {
  const ran: string[] = [];
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const run: GhRunner = (args) => {
    const line = args.join(' ');
    ran.push(line);
    if (line === REPO_VIEW) return Promise.resolve(answers.repo ?? ok(JSON.stringify({ nameWithOwner: REPOSITORY })));
    if (line === NATIVE_LISTING) return Promise.resolve(answers.listing ?? ok(JSON.stringify(LISTING)));
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${line}` });
  };
  return { run, ran: () => [...ran] };
}

/** Where the two kinds of line land, kept apart and in order. */
interface Sink {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly infos: () => readonly string[];
  readonly warnings: () => readonly string[];
}

/** A sink keeping every line at each level. */
function sink(): Sink {
  const infos: string[] = [];
  const warnings: string[] = [];
  return {
    info: (message: string): void => void infos.push(message),
    warn: (message: string): void => void warnings.push(message),
    infos: () => [...infos],
    warnings: () => [...warnings],
  };
}

/** Runs the reading over `body` and `gh`, into a fresh sink. */
async function read(body: string, gh: FakeGh): Promise<{ report: Awaited<ReturnType<typeof freedAfterMerge>>; out: Sink }> {
  const out = sink();
  const report = await freedAfterMerge({ body, gh: gh.run, info: out.info, warn: out.warn });
  return { report, out };
}

describe('nothing is spent on a merge closing no issue', () => {
  it('answers null and sends no call for a body with no closing keyword', async () => {
    const gh = fakeGh();
    const { report, out } = await read('Refactors the listing.', gh);

    expect(report).toBeNull();
    expect(gh.ran()).toEqual([]);
    expect([out.infos(), out.warnings()]).toEqual([[], []]);
  });

  it('sends the repository read and one listing, and nothing else, for a body closing an issue', async () => {
    const gh = fakeGh();
    await read('Closes #20', gh);

    expect(gh.ran()).toEqual([REPO_VIEW, NATIVE_LISTING]);
  });
});

describe('which issues a merge freed', () => {
  it('names the open issue whose last blocker the merge closed, and no other', async () => {
    const gh = fakeGh();
    const { report, out } = await read('Closes #20', gh);

    expect(report).toEqual({
      relationships: 'native',
      closed: [20],
      freed: [{ number: 12, title: 'Sign-in page' }],
      problem: null,
    });
    expect(out.infos()).toEqual([
      freedHeaderLine([20], 1),
      `${INDENT}#12 Sign-in page`,
    ]);
    expect(out.warnings()).toEqual([]);
  });

  it('frees the issue waiting on two blockers once the merge closes both, lowest first', async () => {
    const { report, out } = await read('Closes #20\nFixes #26', fakeGh());

    expect(report?.closed).toEqual([20, 26]);
    expect(report?.freed.map((issue) => issue.number)).toEqual([12, 13]);
    expect(out.infos()).toEqual([
      freedHeaderLine([20, 26], 2),
      `${INDENT}#12 Sign-in page`,
      `${INDENT}#13 Session store`,
    ]);
  });

  it('prints nothing when the merge freed no issue, and still answers what it read', async () => {
    // #13 waits on #26 and on #20, whose node the listing holds open and this merge does not close.
    const { report, out } = await read('Closes #26', fakeGh());

    expect(report).toEqual({ relationships: 'native', closed: [26], freed: [], problem: null });
    expect([out.infos(), out.warnings()]).toEqual([[], []]);
  });

  it('names an issue once and each closed issue once, however often the body names them', async () => {
    const gh = fakeGh();
    const { report } = await read('Closes #20, closes #20', gh);

    expect(report?.closed).toEqual([20]);
    expect(report?.freed.map((issue) => issue.number)).toEqual([12]);
    expect(gh.ran()).toEqual([REPO_VIEW, NATIVE_LISTING]);
  });
});

describe('the lines it prints', () => {
  it('opens the header with the mode, naming the count, the closed issues and that nothing was written', () => {
    expect(freedHeaderLine([20], 1)).toBe('board.relationships is native: the merge freed 1 issue, whose blockers'
      + ' GitHub cleared when #20 closed, so nothing was written:');
    expect(freedHeaderLine([20, 26], 2)).toContain('freed 2 issues, whose blockers GitHub cleared when #20, #26 closed');
  });

  it('names an issue with no title by its number alone', () => {
    expect(freedIssueLine({ number: 12, title: '  ' })).toBe(`${INDENT}#12`);
    expect(freedIssueLine({ number: 12, title: 'Sign-in page' })).toBe(`${INDENT}#12 Sign-in page`);
  });
});

describe('every failure is a warning', () => {
  it('warns, and lists nothing, when gh will not name the repository', async () => {
    const gh = fakeGh({ repo: { ok: false, stdout: '', stderr: 'gh: not a git repository' } });
    const { report, out } = await read('Closes #20', gh);

    expect(gh.ran()).toEqual([REPO_VIEW]);
    expect(report?.freed).toEqual([]);
    expect(report?.problem).toContain('gh: not a git repository');
    expect(out.warnings()).toEqual([freedProblemLine(report?.problem ?? '')]);
    expect(out.infos()).toEqual([]);
  });

  it('warns when the listing fails', async () => {
    const gh = fakeGh({ listing: { ok: false, stdout: '', stderr: 'gh: HTTP 502' } });
    const { report, out } = await read('Closes #20', gh);

    expect(gh.ran()).toEqual([REPO_VIEW, NATIVE_LISTING]);
    expect(report?.problem).toContain('HTTP 502');
    expect(out.warnings()).toHaveLength(1);
    expect(out.warnings()[0]).toStartWith('the freed-issue reading did not run: ');
  });

  it('warns rather than reading a listing without the native fields as a board with no blocker', async () => {
    const labelsRows = [{ number: 12, title: 'x', body: '', state: 'OPEN', stateReason: null, labels: [] }];
    const gh = fakeGh({ listing: { ok: true, stdout: JSON.stringify(labelsRows), stderr: '' } });
    const { report, out } = await read('Closes #20', gh);

    expect(report?.problem).not.toBeNull();
    expect(out.warnings()).toHaveLength(1);
    expect(out.infos()).toEqual([]);
  });
});

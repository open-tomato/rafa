/**
 * Tests for the roadmap `plan create --next` reads its order off
 * (`src/board/roadmap.ts`): the body parsed into ordered `#<n>` lines,
 * which issue the roadmap is, the done and taken readings, the pick and
 * the exhausted answer.
 *
 * Every case plants its own roadmap body and drives its own seams. The
 * open pull request list goes through the strict recorded fake
 * (`src/pr/gh-fake.ts`), which models
 * `gh pr list --state open --json <fields> --limit <n>` and refuses a
 * `--json` field it does not know, so a field list this module got
 * wrong is refused by the fake rather than quietly answered. The
 * roadmap search, the payloads the fake cannot produce and the git
 * reads go through {@link stubGh} and {@link stubGit}, runners
 * answering one recorded result per command. No case spawns `gh` or
 * `git`, reaches GitHub, reads a real repository or touches the
 * configuration either keeps under the home.
 *
 * ## What passes while wrong
 *
 * A walk is the shape that passes for the wrong reason most easily: a
 * pick stuck on the FIRST line satisfies every case whose answer is the
 * first line, and one stuck on "everything is taken" satisfies the
 * exhausted case. So the readings are driven against COUNTING seams and
 * paired with their opposites:
 *
 *  - each of the four skip readings has a case where it alone fires,
 *    beside a line the same seam lets through, and the four sentences
 *    are asserted apart: an operator told "#20 taken: PR #33 open"
 *    about a line that was merely ticked looks for a pull request that
 *    is not there;
 *  - the cheapest-first order is measured, not assumed — the ticked
 *    case asserts the issue reader was never called, and the branch
 *    case asserts the pull request list was not read — so a walk that
 *    asked everything about every line would redden even though its
 *    pick is right;
 *  - `pickNextRoadmapLine` has a case where the answer is the THIRD
 *    line and the two before it are skipped for two different reasons,
 *    which no implementation that stops at the first or the last line
 *    passes;
 *  - the failed remote branch read sits beside a scan where both reads
 *    succeed, so a `scanClaimBranches` that reported a problem always,
 *    or never, fails one of the two.
 *
 * ## Mutations driven
 *
 * Twelve mutations of `roadmap.ts` were driven on 2026-09-19, one at a
 * time, over `env -u CLAUDECODE bun test src/board/`, the module
 * restored from a scratch copy and verified with `shasum -c` after
 * each. 249 pass either side, and each count below is that run's own:
 *
 *  - the code fence skipped over rather than entered, so a fenced line
 *    is read as a commitment: 1 fail, the fenced case. Its control, the
 *    same line outside a fence, still passes, which is the half of that
 *    case that says the parser did not simply stop reading.
 *  - the ticked reading dropped: 5 fail.
 *  - the closed reading dropped: 4 fail.
 *  - the branch reading dropped: 3 fail.
 *  - the pull request reading dropped: 2 fail.
 *  - the walk reading every line instead of stopping at the pick, which
 *    still answers a first line correctly: 4 fail, the three picks whose
 *    answer is not the last line and the spend count.
 *  - the remote half of the branch scan not read at all: 4 fail.
 *  - a failed remote read swallowed, its problem left unsaid while the
 *    refs it would have carried are missing: 1 fail, and only that one,
 *    which is why the scan case asserts `problems` and not just `refs`.
 *  - the several-roadmaps refusal dropped, so the first of two issues
 *    titled `Roadmap` is picked: 1 fail.
 *  - the pull request list read afresh per line: 1 fail, the count in
 *    `createRoadmapReadings`. Every pick still answers the same line,
 *    which is what makes the count the only reading that can see it.
 *  - the exact title comparison dropped, taking whatever the loose
 *    search matched: 2 fail.
 *  - `branchClaims` matching anywhere in the ref rather than at a path
 *    boundary, so `feat/rafa-200-x` claims issue 20: 1 fail.
 */
import type { SpecIssue } from './issue.js';
import type { RoadmapLine, RoadmapReadings, RoadmapSkip } from './roadmap.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createFakePrGh } from '../pr/gh-fake.js';

import {
  branchClaims,
  closedIssuesIn,
  createGhOpenPullRequests,
  createGhRoadmapSearch,
  createRoadmapReadings,
  DEFAULT_REMOTE,
  exhaustedMessage,
  ISSUE_LIST_FIELDS,
  noRoadmapMessage,
  OPEN_PULL_REQUEST_LIMIT,
  parseRoadmapBody,
  pickNextRoadmapLine,
  PR_LIST_FIELDS,
  resolveRoadmapIssue,
  ROADMAP_REFUSAL_EXIT,
  ROADMAP_SETTING,
  ROADMAP_TITLE,
  scanClaimBranches,
  severalRoadmapsMessage,
  skipSentence,
} from './roadmap.js';

/** The roadmap body every walk case plants, with its three lines. */
const BODY = [
  '## Next, in order',
  '',
  '- [x] #17 the pull request port, merged',
  '- [ ] #20 pull request commands',
  '- [ ] #33 the board setup',
  '- [ ] #34 naming and close-out',
].join('\n');

/** A `gh` result with nothing wrong. */
function ghOk(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A runner answering `result` to every command, recording what it was handed. */
function stubGh(result: GhResult): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  let calls: readonly (readonly string[])[] = [];
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      return Promise.resolve(result);
    },
    calls: () => calls,
  };
}

/** A git runner answering a recorded result per first argument. */
function stubGit(answers: Readonly<Record<string, GitResult>>): {
  run: GitRunner;
  calls: () => readonly (readonly string[])[];
} {
  let calls: readonly (readonly string[])[] = [];
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      return answers[args[0] ?? ''] ?? { ok: false, stdout: '', stderr: 'stubGit: no answer recorded' };
    },
    calls: () => calls,
  };
}

/** A git result with nothing wrong. */
function gitOk(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** What the readings a walk case drives were asked, in order. */
interface ReadingLog {
  readonly issues: readonly number[];
  readonly pulls: number;
}

/** Readings over planted data, counting what each line actually spent. */
function plantedReadings(planted: {
  readonly closed?: readonly number[];
  readonly refs?: readonly string[];
  readonly pulls?: Readonly<Record<number, number>>;
}): { readings: RoadmapReadings; log: () => ReadingLog } {
  let issues: readonly number[] = [];
  let pulls = 0;

  const readings: RoadmapReadings = {
    isClosed: (issue) => {
      issues = [...issues, issue];
      return Promise.resolve((planted.closed ?? []).includes(issue));
    },
    branchFor: (issue) => (planted.refs ?? []).find((ref) => branchClaims(ref, issue)) ?? null,
    pullRequestFor: (issue) => {
      pulls += 1;
      return Promise.resolve((planted.pulls ?? {})[issue] ?? null);
    },
  };

  return { readings, log: () => ({ issues, pulls }) };
}

/** An issue as a `SpecIssueReader` answers one. */
function specIssue(number: number, state: 'OPEN' | 'CLOSED'): SpecIssue {
  return { number, title: `issue ${String(number)}`, body: '', state, labels: ['type:spec'] };
}

/** What a thrown `CommandExit` carried, or the failure of a call that did not throw. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

describe('parseRoadmapBody', () => {
  it('reads each task-list line in order, with its tick, its why and its line number', () => {
    const lines = parseRoadmapBody(BODY);

    expect(lines).toEqual([
      { issue: 17, ticked: true, why: 'the pull request port, merged', lineNumber: 3 },
      { issue: 20, ticked: false, why: 'pull request commands', lineNumber: 4 },
      { issue: 33, ticked: false, why: 'the board setup', lineNumber: 5 },
      { issue: 34, ticked: false, why: 'naming and close-out', lineNumber: 6 },
    ]);
  });

  it('reads the other bullet characters and an upper-case tick', () => {
    const lines = parseRoadmapBody(['* [X] #7 starred', '+ [ ] #8 plussed'].join('\n'));

    expect(lines.map((line) => [line.issue, line.ticked])).toEqual([[7, true], [8, false]]);
  });

  it('drops a separator between the reference and the why, and answers an empty why for a bare line', () => {
    const lines = parseRoadmapBody(['- [ ] #1 - dashed', '- [ ] #2: colonned', '- [ ] #3'].join('\n'));

    expect(lines.map((line) => line.why)).toEqual(['dashed', 'colonned', '']);
  });

  it('reads no line inside a fenced code block, and reads the same line outside one', () => {
    const fenced = ['```text', '- [ ] #3 an example', '```', '- [ ] #4 a commitment'].join('\n');

    expect(parseRoadmapBody(fenced).map((line) => line.issue)).toEqual([4]);
    expect(parseRoadmapBody('- [ ] #3 an example').map((line) => line.issue)).toEqual([3]);
  });

  it('drops a task-list item that does not open with an issue reference', () => {
    const body = ['- [ ] write the changelog', '- [ ] see #9 for context', '- [ ] #9 the spec'].join('\n');

    expect(parseRoadmapBody(body).map((line) => line.issue)).toEqual([9]);
  });

  it('drops a reference that is no issue number, and keeps a duplicated one on both lines', () => {
    const body = ['- [ ] #0 nothing', '- [x] #20 first', '- [ ] #20 again'].join('\n');

    expect(parseRoadmapBody(body).map((line) => [line.issue, line.ticked]))
      .toEqual([[20, true], [20, false]]);
  });

  it('reads a body written with CRLF line endings', () => {
    expect(parseRoadmapBody('- [ ] #5 five\r\n- [ ] #6 six\r\n').map((line) => line.issue))
      .toEqual([5, 6]);
  });

  it('answers nothing for a body with no task list at all', () => {
    expect(parseRoadmapBody('# Roadmap\n\nnothing yet.\n')).toEqual([]);
  });
});

describe('createGhRoadmapSearch', () => {
  it('sends one issue list, searching the title, and reads the rows back', async () => {
    const gh = stubGh(ghOk(JSON.stringify([{ number: 31, title: 'Roadmap' }])));

    const found = await createGhRoadmapSearch({ gh: gh.run })();

    expect(gh.calls()).toEqual([[
      'issue', 'list', '--state', 'open',
      '--search', `${ROADMAP_TITLE} in:title`,
      '--json', ISSUE_LIST_FIELDS,
    ]]);
    expect(found).toEqual([{ number: 31, title: 'Roadmap' }]);
  });

  it('rejects naming the command when gh failed', async () => {
    const gh = stubGh({ ok: false, stdout: '', stderr: 'gh: could not authenticate' });

    expect(createGhRoadmapSearch({ gh: gh.run })())
      .rejects.toThrow('gh issue list --state open --search "Roadmap in:title" --json number,title failed: gh: could not authenticate');
  });

  it('rejects naming the command when the output is not JSON, and when it is not a list', async () => {
    const notJson = stubGh(ghOk('Roadmap\n'));
    const notList = stubGh(ghOk('{"number":31}'));

    expect(createGhRoadmapSearch({ gh: notJson.run })()).rejects.toThrow('wrote output that is not JSON');
    expect(createGhRoadmapSearch({ gh: notList.run })()).rejects.toThrow('expected a list');
  });

  it('rejects naming the field when a row answers no title', async () => {
    const gh = stubGh(ghOk(JSON.stringify([{ number: 31 }])));

    expect(createGhRoadmapSearch({ gh: gh.run })())
      .rejects.toThrow('answered issue 0.title as undefined, expected a string');
  });
});

describe('resolveRoadmapIssue', () => {
  /** A search answering `titles`, counting whether it was spent at all. */
  function search(titles: readonly (readonly [number, string])[]): {
    run: () => Promise<readonly { number: number; title: string }[]>;
    spent: () => number;
  } {
    let spent = 0;
    return {
      run: () => {
        spent += 1;
        return Promise.resolve(titles.map(([number, title]) => ({ number, title })));
      },
      spent: () => spent,
    };
  }

  it('answers the configured issue and spends no search on it', async () => {
    const found = search([[31, 'Roadmap']]);

    expect(await resolveRoadmapIssue({ configured: 7, search: found.run })).toBe(7);
    expect(found.spent()).toBe(0);
  });

  it('answers the one open issue titled Roadmap, folding case and padding', async () => {
    const found = search([[12, 'Roadmap for the API'], [31, '  roadmap '], [40, 'Roadmapping']]);

    expect(await resolveRoadmapIssue({ configured: null, search: found.run })).toBe(31);
    expect(found.spent()).toBe(1);
  });

  it('refuses when the search matched loosely and nothing is titled Roadmap', async () => {
    const found = search([[12, 'Roadmap for the API']]);

    const exit = await refusal(() => resolveRoadmapIssue({ configured: null, search: found.run }));

    expect([exit.exitCode, exit.message]).toEqual([ROADMAP_REFUSAL_EXIT, noRoadmapMessage()]);
    expect(exit.message).toContain(ROADMAP_SETTING);
  });

  it('refuses when two open issues carry the title, naming both and the setting', async () => {
    const found = search([[31, 'Roadmap'], [55, 'ROADMAP']]);

    const exit = await refusal(() => resolveRoadmapIssue({ configured: null, search: found.run }));

    expect([exit.exitCode, exit.message]).toEqual([ROADMAP_REFUSAL_EXIT, severalRoadmapsMessage([31, 55])]);
    expect(exit.message).toContain('#31, #55');
    expect(exit.message).toContain(ROADMAP_SETTING);
  });
});

describe('createGhOpenPullRequests', () => {
  it('reads the open pull requests through a gh that models the field list it asks for', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 33, headRefName: 'feat/rafa-20-pr-commands', body: 'Closes #20' });
    fake.plant({ number: 34, headRefName: 'feat/other', body: 'no reference', state: 'MERGED' });

    const open = await createGhOpenPullRequests({ gh: fake.run })();

    expect(fake.calls()).toEqual([[
      'pr', 'list', '--state', 'open',
      '--json', PR_LIST_FIELDS,
      '--limit', String(OPEN_PULL_REQUEST_LIMIT),
    ]]);
    expect(open).toEqual([{ number: 33, headRefName: 'feat/rafa-20-pr-commands', body: 'Closes #20' }]);
  });

  it('rejects naming the command when gh failed', async () => {
    const gh = stubGh({ ok: false, stdout: '', stderr: 'gh: no git remotes found' });

    expect(createGhOpenPullRequests({ gh: gh.run })())
      .rejects.toThrow('gh pr list --state open --json number,headRefName,body --limit 100 failed: gh: no git remotes found');
  });

  it('rejects naming the field when a row answers no body', async () => {
    const gh = stubGh(ghOk(JSON.stringify([{ number: 33, headRefName: 'feat/x' }])));

    expect(createGhOpenPullRequests({ gh: gh.run })())
      .rejects.toThrow('answered pull request 0.body as undefined, expected a string');
  });
});

describe('closedIssuesIn', () => {
  it('reads every closing keyword GitHub honours', () => {
    const body = 'Closes #1, closed #2, close #3, Fixes #4, fixed #5, fix #6, resolves #7, resolved #8, resolve #9';

    expect(closedIssuesIn(body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reads a colon between the keyword and the reference, and reads no bare reference', () => {
    expect(closedIssuesIn('Closes: #20')).toEqual([20]);
    expect(closedIssuesIn('see #20 and rafa-20')).toEqual([]);
    expect(closedIssuesIn('unclosed #20')).toEqual([]);
  });
});

describe('branchClaims', () => {
  it('claims the issue from a local name, a remote-tracking name and a full ref', () => {
    const claimed = [
      'feat/rafa-20-pr-commands',
      'origin/feat/rafa-20-pr-commands',
      'refs/heads/feat/rafa-20-pr-commands',
      'refs/remotes/origin/feat/rafa-20-pr-commands',
      'feat/rafa-20',
    ].map((ref) => branchClaims(ref, 20));

    expect(claimed).toEqual([true, true, true, true, true]);
  });

  it('claims no other issue and no branch outside the feat prefix', () => {
    const claimed = [
      'feat/rafa-2-pr-commands',
      'feat/rafa-200-pr-commands',
      'myfeat/rafa-20-pr-commands',
      'fix/rafa-20-pr-commands',
      'feat/rafa-20x',
    ].map((ref) => branchClaims(ref, 20));

    expect(claimed).toEqual([false, false, false, false, false]);
  });
});

describe('scanClaimBranches', () => {
  /** What `git for-each-ref` answers in the scan cases. */
  const LOCAL = 'refs/heads/main\nrefs/heads/feat/rafa-20-pr-commands\nrefs/remotes/origin/main\n';

  /** What `git ls-remote --heads origin` answers in the scan cases. */
  const REMOTE = '9f1\trefs/heads/main\nab2\trefs/heads/feat/rafa-33-board-setup\n';

  it('reads the refs of this checkout and of the remote into one list, with no problem', () => {
    const git = stubGit({ 'for-each-ref': gitOk(LOCAL), 'ls-remote': gitOk(REMOTE) });

    const scan = scanClaimBranches(git.run);

    expect(git.calls()).toEqual([
      ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'],
      ['ls-remote', '--heads', DEFAULT_REMOTE],
    ]);
    expect(scan.refs).toEqual([
      'refs/heads/main',
      'refs/heads/feat/rafa-20-pr-commands',
      'refs/remotes/origin/main',
      'refs/heads/main',
      'refs/heads/feat/rafa-33-board-setup',
    ]);
    expect(scan.problems).toEqual([]);
  });

  it('names the remote it could not read, keeping the refs this checkout holds', () => {
    const git = stubGit({
      'for-each-ref': gitOk(LOCAL),
      'ls-remote': { ok: false, stdout: '', stderr: 'fatal: could not read from remote repository' },
    });

    const scan = scanClaimBranches(git.run);

    expect(scan.refs).toEqual(['refs/heads/main', 'refs/heads/feat/rafa-20-pr-commands', 'refs/remotes/origin/main']);
    expect(scan.problems).toEqual([
      'the branches on origin could not be read, so a branch pushed but not fetched was not seen:'
        + ' git ls-remote --heads origin failed: fatal: could not read from remote repository',
    ]);
  });

  it('names the checkout it could not read, keeping the refs the remote holds', () => {
    const git = stubGit({
      'for-each-ref': { ok: false, stdout: '', stderr: '' },
      'ls-remote': gitOk(REMOTE),
    });

    const scan = scanClaimBranches(git.run, 'upstream');

    expect(scan.refs).toEqual(['refs/heads/main', 'refs/heads/feat/rafa-33-board-setup']);
    expect(scan.problems).toEqual([
      'the branches of this checkout could not be read, so a branch held only here was not seen:'
        + ' git for-each-ref failed and wrote nothing',
    ]);
  });

  it('asks the remote the caller named', () => {
    const git = stubGit({ 'for-each-ref': gitOk(''), 'ls-remote': gitOk('') });

    scanClaimBranches(git.run, 'upstream');

    expect(git.calls()[1]).toEqual(['ls-remote', '--heads', 'upstream']);
  });
});

describe('createRoadmapReadings', () => {
  /** A scan holding `refs` and nothing wrong. */
  const scan = (refs: readonly string[]): { refs: readonly string[]; problems: readonly string[] } => ({
    refs,
    problems: [],
  });

  it('reads an issue state per ask, and the pull request list once for several asks', async () => {
    let issueReads: readonly number[] = [];
    let listReads = 0;
    const readings = createRoadmapReadings({
      issues: (issue) => {
        issueReads = [...issueReads, issue];
        return Promise.resolve(specIssue(issue, issue === 17
          ? 'CLOSED'
          : 'OPEN'));
      },
      branches: scan(['origin/feat/rafa-33-board-setup']),
      pullRequests: () => {
        listReads += 1;
        return Promise.resolve([{ number: 41, headRefName: 'feat/rafa-20-x', body: 'Closes #20' }]);
      },
    });

    expect([await readings.isClosed(17), await readings.isClosed(20)]).toEqual([true, false]);
    expect([readings.branchFor(33), readings.branchFor(20)]).toEqual(['origin/feat/rafa-33-board-setup', null]);
    expect([await readings.pullRequestFor(20), await readings.pullRequestFor(34)]).toEqual([41, null]);

    expect(issueReads).toEqual([17, 20]);
    expect(listReads).toBe(1);
  });

  it('reads no pull request list at all until a line asks for one', () => {
    let listReads = 0;
    const readings = createRoadmapReadings({
      issues: (issue) => Promise.resolve(specIssue(issue, 'OPEN')),
      branches: scan([]),
      pullRequests: () => {
        listReads += 1;
        return Promise.resolve([]);
      },
    });

    expect(readings.branchFor(20)).toBeNull();
    expect(listReads).toBe(0);
  });
});

describe('skipSentence', () => {
  /** A skip over the line for issue `issue`. */
  const skip = (issue: number, reason: RoadmapSkip['reason'], detail: string): RoadmapSkip => ({
    line: { issue, ticked: reason === 'ticked', why: '', lineNumber: 1 },
    reason,
    detail,
  });

  it('says which of the four readings passed the line over, each in its own words', () => {
    expect([
      skipSentence(skip(17, 'ticked', '')),
      skipSentence(skip(18, 'closed', '')),
      skipSentence(skip(19, 'branch', 'feat/rafa-19-worktrees')),
      skipSentence(skip(20, 'pull-request', '#33')),
    ]).toEqual([
      '#17 done: ticked on the roadmap',
      '#18 done: the issue is closed',
      '#19 taken: branch feat/rafa-19-worktrees exists',
      '#20 taken: PR #33 open',
    ]);
  });
});

describe('pickNextRoadmapLine', () => {
  /** The three unticked lines and the ticked one of {@link BODY}. */
  const lines = (): readonly RoadmapLine[] => parseRoadmapBody(BODY);

  it('answers the first line neither done nor taken, naming every line it passed and why', async () => {
    const planted = plantedReadings({
      closed: [20],
      refs: ['refs/heads/feat/rafa-33-board-setup'],
    });

    const pick = await pickNextRoadmapLine(lines(), planted.readings);

    expect(pick.line?.issue).toBe(34);
    expect(pick.skipped.map(skipSentence)).toEqual([
      '#17 done: ticked on the roadmap',
      '#20 done: the issue is closed',
      '#33 taken: branch refs/heads/feat/rafa-33-board-setup exists',
    ]);
  });

  it('spends no issue read on a ticked line, and no pull request read on a line a branch claims', async () => {
    const planted = plantedReadings({ refs: ['feat/rafa-20-pr-commands'] });

    const pick = await pickNextRoadmapLine(lines(), planted.readings);

    expect([pick.line?.issue, pick.skipped.length]).toEqual([33, 2]);
    expect(planted.log()).toEqual({ issues: [20, 33], pulls: 1 });
  });

  it('calls a line taken when an open pull request closes it, naming the pull request', async () => {
    const planted = plantedReadings({ pulls: { 20: 41 } });

    const pick = await pickNextRoadmapLine(lines(), planted.readings);

    expect(pick.line?.issue).toBe(33);
    expect(pick.skipped.map((skip) => [skip.reason, skip.detail]))
      .toEqual([['ticked', ''], ['pull-request', '#41']]);
  });

  it('stops at the first line nothing accounts for, rather than skipping ahead to a later one', async () => {
    const planted = plantedReadings({ closed: [33, 34], refs: ['feat/rafa-33-board-setup'] });

    const pick = await pickNextRoadmapLine(lines(), planted.readings);

    expect(pick.line?.issue).toBe(20);
    expect(pick.skipped.map((skip) => skip.line.issue)).toEqual([17]);
    expect(planted.log().issues).toEqual([20]);
  });

  it('answers no line when every line is done or taken, with each one skipped', async () => {
    const planted = plantedReadings({ closed: [20, 34], refs: ['origin/feat/rafa-33-board-setup'] });

    const pick = await pickNextRoadmapLine(lines(), planted.readings);

    expect(pick.line).toBeNull();
    expect(pick.skipped.map((skip) => [skip.line.issue, skip.reason])).toEqual([
      [17, 'ticked'],
      [20, 'closed'],
      [33, 'branch'],
      [34, 'closed'],
    ]);
  });

  it('answers no line and no skip for a roadmap with no task list', async () => {
    const planted = plantedReadings({});

    const pick = await pickNextRoadmapLine(parseRoadmapBody('# Roadmap\n'), planted.readings);

    expect([pick.line, pick.skipped]).toEqual([null, []]);
    expect(planted.log()).toEqual({ issues: [], pulls: 0 });
  });
});

describe('exhaustedMessage', () => {
  it('says the roadmap carries no line at all when nothing was skipped', () => {
    const said = exhaustedMessage(31, []);

    expect(said).toContain('issue #31');
    expect(said).toContain('carries no "- [ ] #<n>" line');
  });

  it('counts the lines it accounted for when every one was skipped', () => {
    const skips: readonly RoadmapSkip[] = parseRoadmapBody(BODY)
      .map((line) => ({ line, reason: 'ticked' as const, detail: '' }));

    const said = exhaustedMessage(31, skips);

    expect(said).toContain('every line of the roadmap, issue #31, is done or taken (4 of them)');
  });
});

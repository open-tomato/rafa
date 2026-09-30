/**
 * Tests for the roadmap pick behind `plan create --next`
 * (`src/board/spec-source-roadmap.ts`): where the walk starts, the lines
 * it prints, a blocked pick and the offer past it, the roadmap's own
 * checks and the walk into an epic. Each case drives the whole route
 * through `resolveSpecSource` (`./spec-source.ts`), since the pick
 * answers only a number and what a case asserts — the snapshot written,
 * the reads made — is the funnel's around it.
 *
 * Every seam is planted here and nothing spawns. The issue reader is a
 * map of planted issues that COUNTS its reads, the roadmap search, the
 * open pull request list and the git runner answer what a case recorded,
 * the board listing is REFUSED unless a case plants one that counts its
 * calls, and the output is a `sinkOutput` handed in through the options.
 * Every file a case writes, the position file included, sits under a
 * temporary directory made per case in `tmpdir`, so no case reads the
 * checkout's own `.rafa/position.json`.
 *
 * ## What passes while wrong
 *
 *  - The memo over the issue reader changes no answer at all: a
 *    resolution that read the picked issue twice picks the same line and
 *    writes the same snapshot. Only the count can see it, so the walk
 *    case asserts one read per issue and the whole read order.
 *  - `--next` stopping at a line that is not ready rather than skipping
 *    past it is measured the only way it can be: the roadmap carries a
 *    line AFTER the pick that would resolve cleanly, an `inspect` that
 *    refuses the pick is planted, and the case asserts the refusal names
 *    the pick and that the line below it was never read.
 *
 * ## The roadmap's own checks
 *
 * `inspectRoadmap` is the second checks seam, run on the roadmap as
 * read, and the same two shapes pass for the wrong reason: a seam called
 * too LATE refuses with the same sentence and writes nothing either, and
 * one never called at all changes no pick. So the two cases for it
 * record what was IN HAND at the moment it ran — the numbers the reader
 * had been asked, and the `git` commands sent — and the refusing one
 * asserts that no line was read, no branch scanned, and that the only
 * line printed is the header.
 *
 * ## The blocked line, and the three endings that plan nothing
 *
 * A `--next` pick whose issue carries `spec:blocked` with a blocker
 * still open is offered past rather than planned, and three of its four
 * endings write nothing — a no, no offer at all, and no line under it
 * worth offering. Each of those looks like the others from the outside,
 * so each case asserts the SENTENCE it ends with as well as the stop,
 * and the ones that could have written assert that no snapshot is there.
 *
 * The blocked reading itself is held by a pair: the same board with #24
 * open and with #24 closed. The closed half plans the blocked line
 * ITSELF and prints no blocked line at all, which is what holds "the
 * label alone does not block" against a reading that called every
 * labelled issue blocked.
 *
 * ## A roadmap naming an epic
 *
 * The epic cases each carry their control: the walk into an epic lists
 * the board once where the same seam on a roadmap with no epic line is
 * never called; the dry epic beside the same board with that epic
 * closed, which reaches the second epic's spec; and the blocked pick
 * inside an epic beside the same two lines bare, which offers the line
 * under it.
 *
 * ## The current place
 *
 * Each place case plants a position file and one listing counting its
 * calls, and the first case is the control the others lean on: the same
 * fixture with NO position file walks the default roadmap and never
 * lists the board, so a listing call or a header naming another board
 * in a later case is the place's doing. The epic case asserts the
 * board's first line is never asked about, which is what tells walking
 * the epic ALONE apart from descending the board into it; `--next=<n>`
 * is asserted over a position naming another board and epic, where a
 * pick that weighed the place would read either.
 *
 * Five mutations of `spec-source-roadmap.ts` were driven on 2026-09-28,
 * one at a time, over this file and `./spec-source.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c` after each,
 * against 62 pass and 0 fail:
 *
 *  - the place never read: 57 pass and 5 fail, every place case but the
 *    control and `--next=<n>`'s.
 *  - `--next=<n>` no longer ranking first: 61 pass and 1 fail.
 *  - the place's notices not warned: 60 pass and 2 fail.
 *  - an epic place walked by descending its board: 60 pass and 2 fail,
 *    the two epic cases.
 *  - the listing not kept across the place and the walk: 61 pass and 1
 *    fail, the epic case counting one listing.
 *
 * ## Under `--roadmap`
 *
 * Each hop case plants a position whose current board is {@link BOARD},
 * so a pick that did NOT follow the hop answers #42 and never C, #90,
 * which no board lists: the pick of C is only the record's doing. The
 * first hop case's control is the same checkout with no `followHop`.
 * Five mutations were driven on 2026-09-28, one at a time, over this
 * file and `./spec-source.test.ts` against 76 pass and 0 fail, each
 * module restored from a scratch copy and verified with `shasum -c`:
 * the stale check dropped, the `away` check dropped, C's blocked
 * reading skipped and the `--roadmap` refusal dropped each went 75 pass
 * and 1 fail; the funnel not passing `followHop` on went 70 and 6.
 *
 * ## Mutations recorded before the move
 *
 * These cases lived in `./spec-source.test.ts` until the pick moved out
 * of `./spec-source.ts`, and the mutations below were driven against
 * that module then, each count that run's own:
 *
 *  - 2026-09-21, `inspectRoadmap` call dropped: 424 pass and 6 fail over
 *    `src/board/`; the call moved BELOW the branch scan: 426 pass and 4
 *    fail, the two recorded-order cases here and two in
 *    `./plan-spec.test.ts`.
 *  - 2026-09-21, the blocked reading ignored, so every pick is planned:
 *    86 pass and 10 fail, all eight blocked cases here and both in
 *    `./plan-spec.test.ts`; the offer's ANSWER ignored: 93 pass and 3
 *    fail, the case that answers no here and the two there.
 *  - 2026-09-27, every issue's labels hidden from the descent: 50 pass
 *    and 4 fail; the epic header and label-only lines, the passed lines
 *    or the dry-epic line not printed, the exhausted message counting
 *    the walk's own skips only, or the blocked alternative looked for
 *    over the whole roadmap: 53 pass and 1 fail each.
 *  - 2026-09-19, the memo dropped: 4 fail; the skip lines not printed: 2
 *    fail; the branch scan's problems swallowed: 1 fail;
 *    `roadmap.issue` outranking `--next=<n>`: 1 fail; the exhausted
 *    message not printed: 1 fail.
 */
import type { AlternativeOfferRequest } from './blocked-line.js';
import type { DescendedEpic } from './epic-walk.js';
import type { SpecIssue } from './issue.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { RoadmapSeams } from './spec-source-roadmap.js';
import type { ResolvedSpec, SpecSourceResolution } from './spec-source.js';
import type { HopRecord } from '../next/hop-record.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { Place, Position } from '../project/position.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { CommandExit } from '../cli/command.js';
import { hopFilePath, writeHopRecord } from '../next/hop-record.js';
import { positionAt, writePositionFile } from '../project/position.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  blockedLineSentence,
  declinedMessage,
  noAlternativeMessage,
  notReadySentence,
  unaskedMessage,
} from './blocked-line.js';
import { SPEC_BLOCKED_LABEL } from './blocked.js';
import { dryEpicSentence, NOW_HORIZON_LABEL } from './epic-walk.js';
import { ISSUE_REFUSAL_EXIT, SPEC_LABEL } from './issue.js';
import { specPath } from './naming.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { unweighedPositionNotice } from './roadmap-rows.js';
import { exhaustedMessage, ROADMAP_SETTING, ROADMAP_TITLE } from './roadmap.js';
import {
  alternativeLine,
  blockedPickLine,
  descentPassLine,
  epicHeaderLine,
  hopBlockedMessage,
  hopHeaderLine,
  hopPickLine,
  labelOnlyLine,
  pickLine,
  passedLine,
  roadmapHeaderLine,
  skipLine,
  unfollowedHopNotice,
} from './spec-source-roadmap.js';
import {
  claimAheadWithoutNextMessage,
  describeIssue,
  dryRunLine,
  readSpecSourceFlags,
  resolveSpecSource,
  ROADMAP_REFUSAL_EXIT,
  roadmapWithoutNextMessage,
  SOURCE_REFUSAL_EXIT,
} from './spec-source.js';

/** Where the per-case roots are made. */
let parent = '';

/**
 * Where one case writes. It is made afresh per case on purpose: several
 * cases plan from the same issue number, and a root shared across them
 * would let the snapshot one case wrote answer another case's "was
 * nothing written?" — the state leak that makes a `--dry-run` assertion
 * pass or fail on the order bun ran the file in.
 */
let root = '';

/** Where `specs.dir` points in every case: a relative setting, as configured. */
const SPECS_DIR = '.rafa/specs';

/** The roadmap issue every `--next` case reads, unless it names another. */
const ROADMAP = 31;

/** The lines the planted roadmap carries, in order. */
const ROADMAP_BODY = [
  '## Next, in order',
  '',
  '- [x] #17 the pull request port, merged',
  '- [ ] #20 pull request commands',
  '- [ ] #33 the board setup',
  '- [ ] #34 naming and close-out',
].join('\n');

/** An issue as the reader answers one. */
function issueOf(number: number, fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: `## What you get\n\nThe body of issue ${String(number)}.\n`,
    state: 'OPEN',
    labels: [SPEC_LABEL],
    author: 'octocat',
    ...fields,
  };
}

/** The issues every `--next` case plants: the roadmap and its four lines. */
function boardIssues(): readonly SpecIssue[] {
  return [
    issueOf(ROADMAP, { title: ROADMAP_TITLE, body: ROADMAP_BODY, labels: [] }),
    issueOf(17, { state: 'CLOSED' }),
    issueOf(20),
    issueOf(33),
    issueOf(34),
  ];
}

/** A reader over planted issues, keeping every number it was asked, in order. */
function plantedIssues(issues: readonly SpecIssue[]): {
  read: (issue: number) => Promise<SpecIssue>;
  asked: () => readonly number[];
} {
  let asked: readonly number[] = [];
  return {
    read: (issue: number) => {
      asked = [...asked, issue];
      const found = issues.find((planted) => planted.number === issue);
      return found === undefined
        ? Promise.reject(new Error(`no issue ${String(issue)} was planted`))
        : Promise.resolve(found);
    },
    asked: () => asked,
  };
}

/** A search answering one open issue titled `Roadmap`, numbered `roadmap`. */
function plantedSearch(roadmap: number): RoadmapSearch {
  return () => Promise.resolve([{ number: roadmap, title: ROADMAP_TITLE }]);
}

/** A git runner answering `stdout` to the local read and `remote` to the pushed one. */
function plantedGit(local: string, remote: GitResult = { ok: true, stdout: '', stderr: '' }): GitRunner {
  return (args) => (args[0] === 'for-each-ref'
    ? { ok: true, stdout: local, stderr: '' }
    : remote);
}

/** A git runner answering no branch either side, keeping every command it was sent. */
function countingGit(): { git: GitRunner; sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  return {
    git: (args) => {
      sent = [...sent, args.join(' ')];
      return { ok: true, stdout: '', stderr: '' };
    },
    sent: () => sent,
  };
}

/** A lister answering the planted open pull requests. */
function plantedPulls(pulls: readonly RoadmapPullRequest[] = []): () => Promise<readonly RoadmapPullRequest[]> {
  return () => Promise.resolve(pulls);
}

/** The lines a resolution wrote, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** An Output keeping the lines it is handed. */
function capture(): { lines: Lines; output: ReturnType<typeof sinkOutput> } {
  const lines: Lines = { info: [], warn: [] };
  return {
    lines,
    output: sinkOutput({
      info: (message) => {
        lines.info.push(message);
      },
      warn: (message) => {
        lines.warn.push(message);
      },
    }),
  };
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

/** The snapshot `--issue` and `--next` write for a planted issue. */
function snapshotAt(issue: number): string {
  return specPath(SPECS_DIR, issue, `Issue ${String(issue)}`);
}

/** Whether the temporary root holds `path`. */
function exists(path: string): boolean {
  return existsSync(join(root, path));
}

/** The spec a resolution answered, or the failure of one that stopped. */
function specOf(resolution: SpecSourceResolution): {
  path: string;
  issue: number | null;
  source: string;
} {
  if (resolution.outcome !== 'spec') {
    throw new Error(`expected a spec, and the resolution stopped: ${resolution.reason}`);
  }
  return {
    path: resolution.spec.path,
    issue: resolution.spec.issue,
    source: resolution.spec.source,
  };
}

beforeAll(() => {
  parent = mkdtempSync(join(tmpdir(), 'rafa-spec-source-roadmap-'));
});

beforeEach(() => {
  root = mkdtempSync(join(parent, 'case-'));
});

afterAll(() => {
  rmSync(parent, { recursive: true, force: true });
});

/** What a `--next` case is driven with, over the planted board. */
function nextRun(options: {
  readonly roadmap?: number | null;
  readonly issues?: ReturnType<typeof plantedIssues>;
  readonly seams?: Partial<RoadmapSeams>;
  readonly dryRun?: boolean;
  readonly inspect?: (issue: SpecIssue) => Promise<void>;
  readonly output?: ReturnType<typeof sinkOutput>;
  readonly followHop?: boolean;
  readonly claimAhead?: boolean;
}): Promise<SpecSourceResolution> {
  return resolveSpecSource({
    request: {
      kind: 'next',
      roadmap: options.roadmap ?? null,
      ...options.followHop === true
        ? { followHop: true as const }
        : {},
      ...options.claimAhead === true
        ? { claimAhead: true as const }
        : {},
    },
    refresh: false,
    dryRun: options.dryRun ?? false,
    repoRoot: root,
    specsDir: SPECS_DIR,
    findSpec: () => 'never',
    issues: (options.issues ?? plantedIssues(boardIssues())).read,
    inspect: options.inspect,
    output: options.output ?? capture().output,
    roadmap: {
      configured: ROADMAP,
      // No issue carries type:roadmap, so roadmap.issue and the title
      // decide as they did before boards were found by label.
      listBoards: () => Promise.resolve([]),
      search: plantedSearch(ROADMAP),
      git: plantedGit(''),
      pullRequests: plantedPulls(),
      // Refused, so a roadmap with no epic line that listed the board
      // anyway reddens the case rather than passing unseen.
      listing: () => Promise.reject(new Error('the board was listed for a roadmap with no epic line')),
      ...options.seams,
    },
  });
}

describe('resolveSpecSource over --next', () => {
  it('takes the first line neither done nor taken, printing the roadmap, each skip and the pick', async () => {
    const { lines, output } = capture();
    const issues = plantedIssues(boardIssues());

    const resolution = await nextRun({
      issues,
      output,
      seams: {
        git: plantedGit('refs/heads/feat/rafa-20-pull-request-commands\n'),
      },
    });

    expect(specOf(resolution)).toEqual({ path: snapshotAt(33), issue: 33, source: 'issue #33' });
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      skipLine({ line: { issue: 17, ticked: true, why: 'the pull request port, merged', lineNumber: 3 }, reason: 'ticked', detail: '' }),
      skipLine({
        line: { issue: 20, ticked: false, why: 'pull request commands', lineNumber: 4 },
        reason: 'branch',
        detail: 'refs/heads/feat/rafa-20-pull-request-commands',
      }),
      pickLine({ issue: 33, ticked: false, why: 'the board setup', lineNumber: 5 }),
    ]);
    expect(lines.warn).toEqual([]);
    expect(issues.asked()).toEqual([ROADMAP, 20, 33]);
  });

  it('reads the picked issue once, for the walk and the snapshot both', async () => {
    const issues = plantedIssues(boardIssues());

    await nextRun({ issues, seams: { git: plantedGit('') } });

    expect(issues.asked()).toEqual([ROADMAP, 20]);
    expect(issues.asked().filter((issue) => issue === 20)).toHaveLength(1);
  });

  it('calls a line taken when an open pull request closes it', async () => {
    const { lines, output } = capture();

    const resolution = await nextRun({
      output,
      seams: {
        pullRequests: plantedPulls([{ number: 88, headRefName: 'feat/rafa-20-x', body: 'Closes #20' }]),
      },
    });

    expect(specOf(resolution).issue).toBe(33);
    expect(lines.info).toContain(skipLine({
      line: { issue: 20, ticked: false, why: 'pull request commands', lineNumber: 4 },
      reason: 'pull-request',
      detail: '#88',
    }));
  });

  it('stops with the exhausted message when every line is done or taken, and writes nothing', async () => {
    const { lines, output } = capture();
    const done = [
      issueOf(ROADMAP, { title: ROADMAP_TITLE, body: '- [x] #91 done', labels: [] }),
      issueOf(91),
    ];

    const resolution = await nextRun({ issues: plantedIssues(done), output });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'exhausted' });
    expect(lines.info.at(-1)).toBe(exhaustedMessage(ROADMAP, [{
      line: { issue: 91, ticked: true, why: 'done', lineNumber: 1 },
      reason: 'ticked',
      detail: '',
    }]));
    expect(exists(snapshotAt(91))).toBe(false);
  });

  it('under --dry-run prints the pick and stops before the snapshot', async () => {
    const { lines, output } = capture();

    const resolution = await nextRun({ dryRun: true, output });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(lines.info.slice(-2)).toEqual([
      pickLine({ issue: 20, ticked: false, why: 'pull request commands', lineNumber: 4 }),
      dryRunLine(describeIssue(issueOf(20))),
    ]);
    expect(exists(snapshotAt(20))).toBe(false);
  });

  it('warns each problem the branch scan carried and still answers a pick', async () => {
    const { lines, output } = capture();

    const resolution = await nextRun({
      output,
      seams: { git: plantedGit('', { ok: false, stdout: '', stderr: 'no such remote' }) },
    });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('no such remote');
  });

  it('stops at a line the checks refuse rather than taking the line below it', async () => {
    const issues = plantedIssues(boardIssues());
    const refused = await refusal(() => nextRun({
      issues,
      inspect: (issue) => Promise.reject(new CommandExit(
        ISSUE_REFUSAL_EXIT,
        `issue #${String(issue.number)} is not marked spec:ready`,
      )),
    }));

    expect(refused.message).toBe('issue #20 is not marked spec:ready');
    expect(issues.asked()).toEqual([ROADMAP, 20]);
    expect(exists(snapshotAt(33))).toBe(false);
  });

  it('hands the roadmap as read to its own checks, before a line is walked or a branch scanned', async () => {
    const issues = plantedIssues(boardIssues());
    const git = countingGit();
    let checked: number | null = null;
    let askedWhenChecked: readonly number[] = [];
    let sentWhenChecked: readonly string[] = [];

    const resolution = await nextRun({
      issues,
      seams: {
        git: git.git,
        inspectRoadmap: (issue) => {
          checked = issue.number;
          askedWhenChecked = issues.asked();
          sentWhenChecked = git.sent();
          return Promise.resolve();
        },
      },
    });

    // What was in hand when the check ran: the roadmap, read once, and
    // nothing else — no line of its body, and neither branch read.
    expect(checked).toBe(ROADMAP);
    expect(askedWhenChecked).toEqual([ROADMAP]);
    expect(sentWhenChecked).toEqual([]);
    expect(specOf(resolution).issue).toBe(20);
  });

  it('stops a run whose roadmap the checks refuse, reading no line of it and printing none', async () => {
    const { lines, output } = capture();
    const issues = plantedIssues(boardIssues());
    const git = countingGit();

    const refused = await refusal(() => nextRun({
      issues,
      output,
      seams: {
        git: git.git,
        inspectRoadmap: (issue) => Promise.reject(new CommandExit(
          ISSUE_REFUSAL_EXIT,
          `issue #${String(issue.number)} was opened by an outsider`,
        )),
      },
    }));

    expect(refused.message).toBe(`issue #${String(ROADMAP)} was opened by an outsider`);
    expect(issues.asked()).toEqual([ROADMAP]);
    expect(git.sent()).toEqual([]);
    expect(lines.info).toEqual([roadmapHeaderLine(ROADMAP)]);
    expect(exists(snapshotAt(20))).toBe(false);
    // The control: the same run, with the roadmap checks passing, walks
    // to the pick and writes its snapshot.
    await nextRun({ seams: { git: git.git } });
    expect(exists(snapshotAt(20))).toBe(true);
  });

  it('reads the roadmap --next names over the one config configured', async () => {
    const issues = plantedIssues([
      issueOf(77, { title: ROADMAP_TITLE, body: '- [ ] #78 named on the command line', labels: [] }),
      issueOf(78),
    ]);

    const resolution = await nextRun({ roadmap: 77, issues });

    expect(specOf(resolution).issue).toBe(78);
    expect(issues.asked()).toEqual([77, 78]);
  });

  it('falls back to the search when neither the flag nor config names a roadmap', async () => {
    const issues = plantedIssues(boardIssues());

    const resolution = await nextRun({
      issues,
      seams: { configured: null, search: plantedSearch(ROADMAP) },
    });

    expect(specOf(resolution).issue).toBe(20);
    expect(issues.asked()[0]).toBe(ROADMAP);
  });

  it('reads the lowest-numbered type:roadmap board over the issue titled Roadmap when nothing names one', async () => {
    const board = issueOf(77, { title: 'Team board', body: '- [ ] #78 on the labelled board', labels: ['type:roadmap'] });
    const issues = plantedIssues([...boardIssues(), board, issueOf(78)]);

    const resolution = await nextRun({
      issues,
      seams: { configured: null, listBoards: () => Promise.resolve([rowOf(board)]), search: plantedSearch(ROADMAP) },
    });

    expect(specOf(resolution).issue).toBe(78);
    expect(issues.asked()[0]).toBe(77);
  });

  it('carries the roadmap refusal through when the search finds none', async () => {
    const refused = await refusal(() => nextRun({
      seams: { configured: null, search: () => Promise.resolve([]) },
    }));

    expect(refused.message).toContain(ROADMAP_SETTING);
  });
});

/** The roadmap a blocked-line case reads: three open lines, the first blocked. */
const BLOCKED_ROADMAP = [
  '## Next, in order',
  '',
  '- [ ] #20 pull request commands',
  '- [ ] #33 the board setup',
  '- [ ] #34 naming and close-out',
].join('\n');

/** A body carrying the `Blocked by:` field, under a template heading. */
function blockedBody(...ids: readonly number[]): string {
  const named = ids.map((id) => `#${String(id)}`).join(' ');
  return `## What you get\n\nThe commands.\n\nBlocked by: ${named}\n`;
}

/**
 * The board a blocked-line case reads: #20 labelled `spec:blocked` and
 * waiting on #24, with #33 and #34 ready under it.
 */
function blockedBoard(fields: Partial<Record<number, Partial<SpecIssue>>> = {}): readonly SpecIssue[] {
  const ready = (number: number): SpecIssue => issueOf(number, {
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
    ...fields[number],
  });
  return [
    issueOf(ROADMAP, { title: ROADMAP_TITLE, body: BLOCKED_ROADMAP, labels: [] }),
    issueOf(20, {
      labels: [SPEC_LABEL, SPEC_READY_LABEL, SPEC_BLOCKED_LABEL],
      body: blockedBody(24),
      ...fields[20],
    }),
    issueOf(24, { labels: [SPEC_LABEL], ...fields[24] }),
    ready(33),
    ready(34),
  ];
}

/** The blocked reading a case asserts against: #20, waiting on an open #24. */
function blockedOf(open: readonly number[] = [24], unread: readonly number[] = []): {
  issue: number;
  blockers: readonly number[];
  open: readonly number[];
  unread: readonly number[];
  fault: string | null;
} {
  return { issue: 20, blockers: [...open, ...unread], open, unread, fault: null };
}

/** An offer answering `planned`, keeping every request it was handed. */
function plantedOffer(planned: boolean): {
  offer: (request: AlternativeOfferRequest) => Promise<boolean>;
  taken: () => readonly AlternativeOfferRequest[];
} {
  let taken: readonly AlternativeOfferRequest[] = [];
  return {
    offer: (request) => {
      taken = [...taken, request];
      return Promise.resolve(planned);
    },
    taken: () => taken,
  };
}

describe('resolveSpecSource over --next on a blocked line', () => {
  it('names the open blocker, offers the line under it and plans that one on a yes', async () => {
    const { lines, output } = capture();
    const issues = plantedIssues(blockedBoard());
    const planted = plantedOffer(true);

    const resolution = await nextRun({ issues, output, seams: { offerAlternative: planted.offer } });

    expect(specOf(resolution)).toEqual({ path: snapshotAt(33), issue: 33, source: 'issue #33' });
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      pickLine({ issue: 20, ticked: false, why: 'pull request commands', lineNumber: 3 }),
      blockedPickLine(blockedOf()),
      alternativeLine({ issue: 33, ticked: false, why: 'the board setup', lineNumber: 4 }),
    ]);
    expect(blockedLineSentence(blockedOf())).toBe('#20 is blocked by #24 (open)');
    // The blocked reading costs the blocker's state and nothing else:
    // #20 was read by the walk, and #34 is never reached.
    expect(issues.asked()).toEqual([ROADMAP, 20, 24, 33]);
    expect(exists(snapshotAt(33))).toBe(true);
    expect(exists(snapshotAt(20))).toBe(false);
  });

  it('hands the offer the blocked reading and the line it names, and asks once', async () => {
    const planted = plantedOffer(true);

    await nextRun({ issues: plantedIssues(blockedBoard()), seams: { offerAlternative: planted.offer } });

    expect(planted.taken()).toHaveLength(1);
    expect(planted.taken()[0]?.blocked.open).toEqual([24]);
    expect(planted.taken()[0]?.blocked.issue).toBe(20);
    expect(planted.taken()[0]?.line.issue).toBe(33);
  });

  it('plans nothing when the answer is not yes, and says so', async () => {
    const { lines, output } = capture();
    const planted = plantedOffer(false);

    const resolution = await nextRun({
      issues: plantedIssues(blockedBoard()),
      output,
      seams: { offerAlternative: planted.offer },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(lines.info.at(-1)).toBe(declinedMessage(33));
    expect(exists(snapshotAt(33))).toBe(false);
    expect(exists(snapshotAt(20))).toBe(false);
  });

  it('plans nothing and names both ways forward for a run handed no offer', async () => {
    const { lines, output } = capture();

    const resolution = await nextRun({ issues: plantedIssues(blockedBoard()), output });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(lines.info.slice(-2)).toEqual([
      alternativeLine({ issue: 33, ticked: false, why: 'the board setup', lineNumber: 4 }),
      unaskedMessage(20, 33),
    ]);
    expect(exists(snapshotAt(33))).toBe(false);
  });

  it('plans the blocked line itself, with no blocked line printed, once every blocker has closed', async () => {
    const { lines, output } = capture();
    const cleared = blockedBoard({ 24: { state: 'CLOSED' } });

    const resolution = await nextRun({
      issues: plantedIssues(cleared),
      output,
      seams: { offerAlternative: plantedOffer(true).offer },
    });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      pickLine({ issue: 20, ticked: false, why: 'pull request commands', lineNumber: 3 }),
    ]);
    expect(exists(snapshotAt(20))).toBe(true);
  });

  it('holds the line when a blocker cannot be read at all, naming it as unread', async () => {
    const { lines, output } = capture();
    const missing = blockedBoard({ 20: { body: blockedBody(26) } });

    const resolution = await nextRun({ issues: plantedIssues(missing), output });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(lines.info).toContain(blockedPickLine(blockedOf([], [26])));
  });

  it('passes over a line that is not ready on the way to the one it offers', async () => {
    const { lines, output } = capture();
    const unready = blockedBoard({ 33: { labels: [SPEC_LABEL] } });
    const planted = plantedOffer(true);

    const resolution = await nextRun({
      issues: plantedIssues(unready),
      output,
      seams: { offerAlternative: planted.offer },
    });

    expect(specOf(resolution).issue).toBe(34);
    expect(lines.info).toContain(passedLine({
      line: { issue: 33, ticked: false, why: 'the board setup', lineNumber: 4 },
      reason: 'not-ready',
      sentence: notReadySentence(33),
    }));
  });

  it('stops with nothing to offer when every line under the blocked one is passed over', async () => {
    const { lines, output } = capture();
    const none = blockedBoard({ 33: { labels: [SPEC_LABEL] }, 34: { labels: [SPEC_LABEL] } });

    const resolution = await nextRun({
      issues: plantedIssues(none),
      output,
      seams: { offerAlternative: plantedOffer(true).offer },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(lines.info.at(-1)).toBe(noAlternativeMessage(20));
    expect(exists(snapshotAt(33))).toBe(false);
  });

  it('runs the picked issue checks on the line the offer named, and not on the blocked one', async () => {
    let checked: readonly number[] = [];
    const planted = plantedOffer(true);

    await nextRun({
      issues: plantedIssues(blockedBoard()),
      inspect: (issue) => {
        checked = [...checked, issue.number];
        return Promise.resolve();
      },
      seams: { offerAlternative: planted.offer },
    });

    expect(checked).toEqual([33]);
  });
});

/** The epic every epic case reads, and its slug. */
const EPIC = 50;
const EPIC_SLUG = 'board';

/** The labels an epic's member carries. */
const MEMBER_LABELS = [SPEC_LABEL, `epic:${EPIC_SLUG}`];

/** An epic body: the fields the reader expects, then `checklist` as its order. */
function epicBody(checklist: readonly number[]): string {
  const lines = checklist.map((item) => `- [ ] #${String(item)} spec ${String(item)}`);
  return ['## Acceptance criteria', '', '- it works', '', 'Estimate: a week', '', ...lines].join('\n');
}

/** An epic issue labelled `horizon:now` unless `fields` say otherwise. */
function epicIssue(number: number, slug: string, checklist: readonly number[], fields: Partial<SpecIssue> = {}): SpecIssue {
  return issueOf(number, {
    title: `The ${slug} epic`,
    body: epicBody(checklist),
    labels: ['type:epic', `epic:${slug}`, NOW_HORIZON_LABEL],
    ...fields,
  });
}

/**
 * The board an epic case reads: the roadmap names epic #50 and then #20;
 * #50's checklist is #51, closed, and #52, and #53 carries its label
 * without being on it.
 */
function epicBoard(roadmapBody: string, fields: Partial<Record<number, Partial<SpecIssue>>> = {}): readonly SpecIssue[] {
  return [
    issueOf(ROADMAP, { title: ROADMAP_TITLE, body: roadmapBody, labels: [] }),
    epicIssue(EPIC, EPIC_SLUG, [51, 52], fields[EPIC]),
    issueOf(51, { state: 'CLOSED', labels: MEMBER_LABELS, ...fields[51] }),
    issueOf(52, { labels: MEMBER_LABELS, ...fields[52] }),
    issueOf(53, { title: 'A member off the checklist', labels: MEMBER_LABELS, ...fields[53] }),
    issueOf(20),
  ];
}

/** The roadmap body most epic cases read: the epic, then a spec line under it. */
const EPIC_ROADMAP = '- [ ] #50 the board epic\n- [ ] #20 pull request commands';

/** One board row as the listing answers it, for the planted issue. */
function rowOf(issue: SpecIssue): BoardIssue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: issue.labels,
    type: typeOfLabels(issue.labels),
    module: 'unassigned',
  };
}

/** A listing answering `issues` as rows, counting how often it was read. */
function plantedListing(issues: readonly SpecIssue[]): { listing: BoardListing; calls: () => number } {
  let calls = 0;
  const rows = issues.map(rowOf);
  return {
    listing: () => {
      calls += 1;
      return Promise.resolve(rows);
    },
    calls: () => calls,
  };
}

/** The epic walked into, as the lines naming it read it: only these fields reach a sentence. */
function descended(progress: { done: number; total: number }, labelOnly: readonly BoardIssue[] = []): DescendedEpic {
  return {
    line: { issue: EPIC, ticked: false, why: 'the board epic', lineNumber: 1 },
    number: EPIC,
    title: `The ${EPIC_SLUG} epic`,
    slug: EPIC_SLUG,
    progress: { ...progress, notPlanned: 0 },
    checklist: [],
    labelOnly,
  };
}

/** The issue `number` on `board`; a case naming one not planted is a defect in the case. */
function plantedOf(board: readonly SpecIssue[], number: number): SpecIssue {
  const found = board.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`no issue ${String(number)} is planted`);
  return found;
}

describe('resolveSpecSource over --next on a roadmap naming an epic', () => {
  it('walks into the epic, naming it and its member off the checklist, and plans its first open spec', async () => {
    const { lines, output } = capture();
    const board = epicBoard(EPIC_ROADMAP);
    const issues = plantedIssues(board);
    const listing = plantedListing(board);

    const resolution = await nextRun({ issues, output, seams: { listing: listing.listing } });

    const epic = descended({ done: 1, total: 3 }, [rowOf(plantedOf(board, 53))]);
    expect(specOf(resolution)).toEqual({ path: snapshotAt(52), issue: 52, source: 'issue #52' });
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      epicHeaderLine(epic),
      labelOnlyLine(epic, rowOf(plantedOf(board, 53))),
      skipLine({ line: { issue: 51, ticked: false, why: 'spec 51', lineNumber: 7 }, reason: 'closed', detail: '' }),
      pickLine({ issue: 52, ticked: false, why: 'spec 52', lineNumber: 8 }),
    ]);
    // One listing, and each issue read once: the epic's label came off
    // the read that asked whether it was closed, and #20 under the epic
    // is never reached.
    expect(listing.calls()).toBe(1);
    expect(issues.asked()).toEqual([ROADMAP, EPIC, 51, 52]);
    expect(exists(snapshotAt(52))).toBe(true);
  });

  it('lists nothing and prints the lines it always printed for a roadmap with no epic line', async () => {
    const { lines, output } = capture();
    const listing = plantedListing(boardIssues());

    const resolution = await nextRun({ output, seams: { listing: listing.listing } });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      skipLine({ line: { issue: 17, ticked: true, why: 'the pull request port, merged', lineNumber: 3 }, reason: 'ticked', detail: '' }),
      pickLine({ issue: 20, ticked: false, why: 'pull request commands', lineNumber: 4 }),
    ]);
    // The control is the case above: the same seam, read once, on a
    // roadmap whose first line is an epic.
    expect(listing.calls()).toBe(0);
  });

  it('stops at an epic run dry, naming neither the second epic nor its member', async () => {
    const { lines, output } = capture();
    const roadmapBody = '- [ ] #50 the board epic\n- [ ] #60 the next epic';
    const board = [
      ...epicBoard(roadmapBody, { 53: { state: 'CLOSED' } }),
      epicIssue(60, 'next', [61]),
      issueOf(61, { labels: [SPEC_LABEL, 'epic:next'] }),
    ];
    const issues = plantedIssues(board);

    const resolution = await nextRun({
      issues,
      output,
      seams: {
        listing: plantedListing(board).listing,
        git: plantedGit('refs/heads/feat/rafa-52-the-board\n'),
      },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'exhausted' });
    expect(lines.info.at(-1)).toBe(dryEpicSentence(descended({ done: 2, total: 3 })));
    expect(lines.info.filter((line) => line.includes('#60') || line.includes('#61'))).toEqual([]);
    expect(issues.asked()).not.toContain(60);
    expect(issues.asked()).not.toContain(61);
    expect(exists(snapshotAt(52))).toBe(false);
    expect(exists(snapshotAt(61))).toBe(false);

    // The control: with the first epic closed, the walk passes it and
    // reaches the second, so the stop above was the dry epic's.
    const passed = [...board.filter((issue) => issue.number !== EPIC), epicIssue(EPIC, EPIC_SLUG, [51, 52], { state: 'CLOSED' })];
    const next = await nextRun({ issues: plantedIssues(passed), seams: { listing: plantedListing(passed).listing } });
    expect(specOf(next).issue).toBe(61);
  });

  it('passes an epic that is not now without listing the board, and plans the line under it', async () => {
    const { lines, output } = capture();
    const board = epicBoard(EPIC_ROADMAP, { [EPIC]: { labels: ['type:epic', `epic:${EPIC_SLUG}`, 'horizon:later'] } });
    const listing = plantedListing(board);

    const resolution = await nextRun({ issues: plantedIssues(board), output, seams: { listing: listing.listing } });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      descentPassLine({
        kind: 'epic',
        skip: { line: { issue: EPIC, ticked: false, why: 'the board epic', lineNumber: 1 }, reason: 'horizon', detail: 'horizon:later' },
      }),
      pickLine({ issue: 20, ticked: false, why: 'pull request commands', lineNumber: 2 }),
    ]);
    expect(listing.calls()).toBe(0);
  });

  it('counts a passed epic line in the exhausted message rather than calling the roadmap empty', async () => {
    const { lines, output } = capture();
    const board = epicBoard('- [ ] #50 the board epic', { [EPIC]: { state: 'CLOSED' } });

    const resolution = await nextRun({ issues: plantedIssues(board), output, seams: { listing: plantedListing(board).listing } });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'exhausted' });
    expect(lines.info.at(-1)).toBe(exhaustedMessage(ROADMAP, [EPIC]));
    expect(lines.info.at(-1)).not.toBe(exhaustedMessage(ROADMAP, []));
  });

  it('looks for a blocked pick\'s alternative inside the epic only, never on the roadmap line under it', async () => {
    const { lines, output } = capture();
    const board = [
      ...blockedBoard().filter((issue) => issue.number !== ROADMAP),
      issueOf(ROADMAP, { title: ROADMAP_TITLE, body: '- [ ] #50 the board epic\n- [ ] #34 naming and close-out', labels: [] }),
      epicIssue(EPIC, EPIC_SLUG, [20]),
    ];
    const issues = plantedIssues(board);

    const resolution = await nextRun({
      issues,
      output,
      seams: { listing: plantedListing(board).listing, offerAlternative: plantedOffer(true).offer },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(lines.info.at(-1)).toBe(noAlternativeMessage(20));
    expect(issues.asked()).not.toContain(34);

    // The control: the same two lines with no epic around the first,
    // where the alternative under it is offered and planned.
    const bare = [
      ...board.filter((issue) => issue.number !== ROADMAP),
      issueOf(ROADMAP, { title: ROADMAP_TITLE, body: '- [ ] #20 pull request commands\n- [ ] #34 naming and close-out', labels: [] }),
    ];
    const planned = await nextRun({ issues: plantedIssues(bare), seams: { offerAlternative: plantedOffer(true).offer } });
    expect(specOf(planned).issue).toBe(34);
  });
});

/** The second board a place case switches to, labelled, whose checklist names #42 first. */
const BOARD = 40;

/** A board that was closed after a checkout switched to it. */
const CLOSED_BOARD = 41;

/** An epic no board lists, `horizon:later`, so only a switch could start a walk there. */
const LATER_EPIC = 80;

/** The body of {@link BOARD}. */
const BOARD_BODY = '- [ ] #42 the first line of the other board';

/**
 * The board a place case reads: the default roadmap and its lines, the
 * second board and its line, a closed board, and the later epic with
 * #81 closed and #82 open on its checklist.
 */
function placeBoard(fields: Partial<Record<number, Partial<SpecIssue>>> = {}): readonly SpecIssue[] {
  const later = [SPEC_LABEL, 'epic:later'];
  return [
    ...boardIssues(),
    issueOf(BOARD, { title: 'Team board', body: BOARD_BODY, labels: ['type:roadmap'] }),
    issueOf(42),
    issueOf(CLOSED_BOARD, { title: 'Old board', body: '- [ ] #42 moved', state: 'CLOSED', labels: ['type:roadmap'] }),
    epicIssue(LATER_EPIC, 'later', [81, 82], { labels: ['type:epic', 'epic:later', 'horizon:later'], ...fields[LATER_EPIC] }),
    issueOf(81, { state: 'CLOSED', labels: later, ...fields[81] }),
    issueOf(82, { labels: later, ...fields[82] }),
  ];
}

/** The later epic as its header names it: only these fields reach the sentence. */
function laterEpic(progress: { done: number; total: number }): DescendedEpic {
  return {
    line: { issue: LATER_EPIC, ticked: false, why: 'The later epic', lineNumber: 0 },
    number: LATER_EPIC,
    title: 'The later epic',
    slug: 'later',
    progress: { ...progress, notPlanned: 0 },
    checklist: [],
    labelOnly: [],
  };
}

/** Writes `place` as this case's current place and home. */
function switchTo(place: Place): void {
  writePositionFile(root, positionAt(place));
}

describe('pickRoadmapIssue from the current place', () => {
  it('walks the default roadmap and lists nothing when the root holds no position file', async () => {
    const { lines, output } = capture();
    const board = placeBoard();
    const issues = plantedIssues(board);
    const listing = plantedListing(board);

    const resolution = await nextRun({ issues, output, seams: { listing: listing.listing } });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.info[0]).toBe(roadmapHeaderLine(ROADMAP));
    expect(lines.warn).toEqual([]);
    expect(issues.asked()).toEqual([ROADMAP, 20]);
    // The control for every case below: with no position file the
    // position is never weighed, so the board is never listed.
    expect(listing.calls()).toBe(0);
  });

  it('walks the board the place names, and never reads the default roadmap', async () => {
    const { lines, output } = capture();
    const board = placeBoard();
    const issues = plantedIssues(board);
    const listing = plantedListing(board);
    switchTo({ board: BOARD, epic: null });

    const resolution = await nextRun({ issues, output, seams: { listing: listing.listing } });

    expect(specOf(resolution)).toEqual({ path: snapshotAt(42), issue: 42, source: 'issue #42' });
    expect(lines.info).toEqual([
      roadmapHeaderLine(BOARD),
      pickLine({ issue: 42, ticked: false, why: 'the first line of the other board', lineNumber: 1 }),
    ]);
    expect(lines.warn).toEqual([]);
    expect(issues.asked()).toEqual([BOARD, 42]);
    expect(listing.calls()).toBe(1);
  });

  it('walks the epic the place names alone, whatever its horizon, checking its board\'s author and listing once', async () => {
    const { lines, output } = capture();
    const board = placeBoard();
    const issues = plantedIssues(board);
    const listing = plantedListing(board);
    let checked: readonly number[] = [];
    switchTo({ board: BOARD, epic: LATER_EPIC });

    const resolution = await nextRun({
      issues,
      output,
      seams: {
        listing: listing.listing,
        inspectRoadmap: (issue) => {
          checked = [...checked, issue.number];
          return Promise.resolve();
        },
      },
    });

    expect(specOf(resolution)).toEqual({ path: snapshotAt(82), issue: 82, source: 'issue #82' });
    expect(lines.info).toEqual([
      roadmapHeaderLine(BOARD),
      epicHeaderLine(laterEpic({ done: 1, total: 2 })),
      skipLine({ line: { issue: 81, ticked: false, why: 'spec 81', lineNumber: 7 }, reason: 'closed', detail: '' }),
      pickLine({ issue: 82, ticked: false, why: 'spec 82', lineNumber: 8 }),
    ]);
    expect(checked).toEqual([BOARD]);
    // The board's body is read for its author and none of its lines is
    // walked: #42, its first line, is never asked about.
    expect(issues.asked()).toEqual([BOARD, 81, 82]);
    expect(listing.calls()).toBe(1);
  });

  it('stops on the dry-epic sentence when every line of the epic the place names is done or taken', async () => {
    const { lines, output } = capture();
    const board = placeBoard();
    switchTo({ board: BOARD, epic: LATER_EPIC });

    const resolution = await nextRun({
      issues: plantedIssues(board),
      output,
      seams: { listing: plantedListing(board).listing, git: plantedGit('refs/heads/feat/rafa-82-the-later-spec\n') },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'exhausted' });
    expect(lines.info.at(-1)).toBe(dryEpicSentence(laterEpic({ done: 1, total: 2 })));
    expect(exists(snapshotAt(82))).toBe(false);
    expect(exists(snapshotAt(42))).toBe(false);
  });

  it('ranks --next=<n> over the place, reading neither the position nor the board it names', async () => {
    const { lines, output } = capture();
    const board = placeBoard();
    const issues = plantedIssues(board);
    const listing = plantedListing(board);
    switchTo({ board: BOARD, epic: LATER_EPIC });

    const resolution = await nextRun({ roadmap: ROADMAP, issues, output, seams: { configured: null, listing: listing.listing } });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.info[0]).toBe(roadmapHeaderLine(ROADMAP));
    expect(issues.asked()).not.toContain(BOARD);
    expect(issues.asked()).not.toContain(82);
    expect(listing.calls()).toBe(0);
  });

  it('warns that a place no longer stands and walks the default roadmap it falls back to', async () => {
    const { lines, output } = capture();
    const board = placeBoard();
    const issues = plantedIssues(board);
    switchTo({ board: CLOSED_BOARD, epic: null });

    const resolution = await nextRun({ issues, output, seams: { listing: plantedListing(board).listing } });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.info[0]).toBe(roadmapHeaderLine(ROADMAP));
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain(`board #${String(CLOSED_BOARD)}, which is closed`);
    expect(issues.asked()).not.toContain(CLOSED_BOARD);
  });

  it('warns that the position was not weighed when the board cannot be listed, and walks the default roadmap', async () => {
    const { lines, output } = capture();
    const issues = plantedIssues(placeBoard());
    switchTo({ board: BOARD, epic: null });

    const resolution = await nextRun({ issues, output });

    expect(specOf(resolution).issue).toBe(20);
    expect(lines.warn).toEqual([unweighedPositionNotice(ROADMAP)]);
    expect(issues.asked()).not.toContain(BOARD);
  });
});

/** C, the away hop's target: on no board a walk reads, so only the record can pick it. */
const HOP_TARGET = 90;

/** H, the home issue C blocks. */
const HOP_BLOCKED = 20;

/** B, the open blocker a halted C waits on. */
const HOP_BLOCKER = 91;

/** The epic C is in, on {@link BOARD}. */
const HOP_EPIC = 95;

/** The place a hop case calls home: the default roadmap, no epic. */
const HOME: Place = { board: ROADMAP, epic: null };

/**
 * The board a hop case reads: the place fixture, C ready on {@link BOARD}'s
 * far epic, and B open. `fields` changes one issue.
 */
function hopBoard(fields: Partial<Record<number, Partial<SpecIssue>>> = {}): readonly SpecIssue[] {
  return [
    ...placeBoard(),
    issueOf(HOP_TARGET, { labels: [SPEC_LABEL, SPEC_READY_LABEL], ...fields[HOP_TARGET] }),
    issueOf(HOP_BLOCKER, { labels: [SPEC_LABEL], ...fields[HOP_BLOCKER] }),
  ];
}

/** A blocker hop from {@link HOME} to C, in `state`. */
function hopRecord(fields: Partial<HopRecord> = {}): HopRecord {
  return {
    kind: 'blocker',
    home: HOME,
    from: HOME,
    blocked: HOP_BLOCKED,
    target: HOP_TARGET,
    targetEpic: HOP_EPIC,
    targetBoard: BOARD,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-09-28T10:00:00.000Z',
    ...fields,
  };
}

/**
 * Writes a checkout away on a hop: the position at {@link BOARD} with
 * `home` as its home, and the hop record. The position's current place
 * is {@link BOARD} with no epic, so a walk that did not follow the hop
 * picks #42, that board's first line, and never C.
 */
function awayOnHop(record: HopRecord | null, home: Place = HOME): void {
  const position: Position = { current: { board: BOARD, epic: null }, previous: home, home };
  writePositionFile(root, position);
  if (record !== null) writeHopRecord(root, record);
}

/** The seams a hop case walks with: the listing counted, and no board or search a hop may reach. */
function hopSeams(board: readonly SpecIssue[]): { seams: Partial<RoadmapSeams>; listing: ReturnType<typeof plantedListing> } {
  const listing = plantedListing(board);
  return { listing, seams: { listing: listing.listing } };
}

/** The lines a hop to C prints before it answers C. */
const HOP_LINES: readonly string[] = [
  hopHeaderLine({ record: hopRecord(), target: HOP_TARGET }),
  hopPickLine(HOP_TARGET),
];

describe('readSpecSourceFlags with --roadmap', () => {
  it('marks a --next request to follow the hop, bare and with a roadmap named', () => {
    expect(readSpecSourceFlags(['--next', '--roadmap']).request).toEqual({ kind: 'next', roadmap: null, followHop: true });
    expect(readSpecSourceFlags(['--roadmap', '--next=31']).request).toEqual({ kind: 'next', roadmap: 31, followHop: true });
  });

  it('leaves the key out of a --next request read without --roadmap', () => {
    // `toEqual` ignores a key set to undefined, so the keys are counted.
    const request = readSpecSourceFlags(['--next']).request;

    expect(request).toEqual({ kind: 'next', roadmap: null });
    expect(Object.keys(request ?? {})).toEqual(['kind', 'roadmap']);
  });

  it('refuses --roadmap without --next with exit 2, alone or beside another source', () => {
    for (const args of [['--roadmap'], ['--issue=20', '--roadmap'], ['--spec=a.md', '--roadmap']]) {
      let thrown: unknown = null;
      try {
        readSpecSourceFlags(args);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CommandExit);
      expect((thrown as CommandExit).exitCode).toBe(ROADMAP_REFUSAL_EXIT);
      expect((thrown as CommandExit).message).toBe(roadmapWithoutNextMessage());
    }
    expect(ROADMAP_REFUSAL_EXIT).toBe(2);
  });

  it('refuses a line naming two sources for that first, exit 1, whatever --roadmap says', () => {
    let thrown: unknown = null;
    try {
      readSpecSourceFlags(['--issue=20', '--next', '--roadmap']);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as CommandExit).exitCode).toBe(SOURCE_REFUSAL_EXIT);
  });
});

describe('pickRoadmapIssue under --roadmap', () => {
  it('plans the away hop\'s target C, reading no board, no roadmap and no listing', async () => {
    const { lines, output } = capture();
    const board = hopBoard();
    const issues = plantedIssues(board);
    const { seams, listing } = hopSeams(board);
    const git = countingGit();
    let inspected: readonly number[] = [];
    awayOnHop(hopRecord());

    const resolution = await nextRun({
      issues,
      output,
      followHop: true,
      seams: {
        ...seams,
        git: git.git,
        listBoards: () => Promise.reject(new Error('a hop listed the boards')),
        search: () => Promise.reject(new Error('a hop searched for the roadmap')),
        inspectRoadmap: () => Promise.reject(new Error('a hop inspected a roadmap')),
      },
      inspect: (issue) => {
        inspected = [...inspected, issue.number];
        return Promise.resolve();
      },
    });

    expect(specOf(resolution)).toEqual({ path: snapshotAt(HOP_TARGET), issue: HOP_TARGET, source: `issue #${String(HOP_TARGET)}` });
    expect(lines.info).toEqual(HOP_LINES);
    expect(lines.info[0]).toBe('🧭 Away on a hop: issue #90, the blocker of #20, in epic #95 on board #40');
    expect(lines.warn).toEqual([]);
    // C through the readiness gate, as a line picked at home goes.
    expect(inspected).toEqual([HOP_TARGET]);
    expect(issues.asked()).toEqual([HOP_TARGET]);
    expect(listing.calls()).toBe(0);
    expect(git.sent()).toEqual([]);
  });

  it('walks the current place as --next does over the same checkout when the request does not follow the hop', async () => {
    // The control for the case above: the same record and position, no
    // `followHop`, and the walk reads the position's board and picks #42.
    const { lines, output } = capture();
    const board = hopBoard();
    const issues = plantedIssues(board);
    awayOnHop(hopRecord());

    const resolution = await nextRun({ issues, output, seams: hopSeams(board).seams });

    expect(specOf(resolution).issue).toBe(42);
    expect(lines.info[0]).toBe(roadmapHeaderLine(BOARD));
    expect(issues.asked()).not.toContain(HOP_TARGET);
  });

  it('follows the hop over a roadmap --next=<n> names', async () => {
    const board = hopBoard();
    awayOnHop(hopRecord());

    const resolution = await nextRun({ roadmap: ROADMAP, issues: plantedIssues(board), followHop: true, seams: hopSeams(board).seams });

    expect(specOf(resolution).issue).toBe(HOP_TARGET);
  });

  it('carries the readiness gate\'s refusal of C through, writing nothing', async () => {
    const board = hopBoard();
    awayOnHop(hopRecord());

    const thrown = await refusal(() => nextRun({
      issues: plantedIssues(board),
      followHop: true,
      seams: hopSeams(board).seams,
      inspect: (issue) => Promise.reject(new CommandExit(ISSUE_REFUSAL_EXIT, `#${String(issue.number)} is not ready`)),
    }));

    expect(thrown.exitCode).toBe(ISSUE_REFUSAL_EXIT);
    expect(thrown.message).toBe(`#${String(HOP_TARGET)} is not ready`);
    expect(exists(snapshotAt(HOP_TARGET))).toBe(false);
    expect(exists(snapshotAt(42))).toBe(false);
  });

  it('under --dry-run names C and stops before the snapshot', async () => {
    const { lines, output } = capture();
    const board = hopBoard();
    awayOnHop(hopRecord());

    const resolution = await nextRun({ issues: plantedIssues(board), output, dryRun: true, followHop: true, seams: hopSeams(board).seams });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(lines.info).toEqual([...HOP_LINES, dryRunLine(describeIssue(issueOf(HOP_TARGET)))]);
    expect(exists(snapshotAt(HOP_TARGET))).toBe(false);
  });

  it('stops blocked, offering nothing, when C still has an open blocker', async () => {
    const { lines, output } = capture();
    const board = hopBoard({
      [HOP_TARGET]: { labels: [SPEC_LABEL, SPEC_READY_LABEL, SPEC_BLOCKED_LABEL], body: blockedBody(HOP_BLOCKER) },
    });
    const offer = plantedOffer(true);
    awayOnHop(hopRecord());

    const resolution = await nextRun({
      issues: plantedIssues(board),
      output,
      followHop: true,
      seams: { ...hopSeams(board).seams, offerAlternative: offer.offer },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'blocked' });
    expect(lines.info).toEqual([
      HOP_LINES[0],
      blockedPickLine({ issue: HOP_TARGET, blockers: [HOP_BLOCKER], open: [HOP_BLOCKER], unread: [], fault: null }),
      hopBlockedMessage(HOP_TARGET),
    ]);
    expect(offer.taken()).toEqual([]);
    expect(exists(snapshotAt(HOP_TARGET))).toBe(false);

    // The control: B closed, and the same C is planned.
    const closed = hopBoard({
      [HOP_TARGET]: { labels: [SPEC_LABEL, SPEC_READY_LABEL, SPEC_BLOCKED_LABEL], body: blockedBody(HOP_BLOCKER) },
      [HOP_BLOCKER]: { state: 'CLOSED' },
    });
    const planned = await nextRun({ issues: plantedIssues(closed), followHop: true, seams: hopSeams(closed).seams });
    expect(specOf(planned).issue).toBe(HOP_TARGET);
  });

  it('picks as --next does, printing the same lines, when the root holds no hop record', async () => {
    const board = hopBoard();
    awayOnHop(null);
    const followed = capture();
    const plain = capture();

    const hop = await nextRun({ issues: plantedIssues(board), output: followed.output, followHop: true, seams: hopSeams(board).seams });
    rmSync(join(root, SPECS_DIR), { recursive: true, force: true });
    const bare = await nextRun({ issues: plantedIssues(board), output: plain.output, seams: hopSeams(board).seams });

    expect(specOf(hop).issue).toBe(42);
    expect(specOf(bare).issue).toBe(42);
    expect(followed.lines).toEqual(plain.lines);
  });

  it('picks as --next does over a stale record, whose home a switch by hand has moved', async () => {
    const { lines, output } = capture();
    const board = hopBoard();
    awayOnHop(hopRecord(), { board: BOARD, epic: null });

    const resolution = await nextRun({ issues: plantedIssues(board), output, followHop: true, seams: hopSeams(board).seams });

    expect(specOf(resolution).issue).toBe(42);
    expect(lines.info[0]).toBe(roadmapHeaderLine(BOARD));
    expect(lines.warn).toEqual([]);
  });

  it('picks as --next does once the hop is no longer away, and on a dry hop', async () => {
    const board = hopBoard();
    const records = [
      hopRecord({ state: 'waiting', pullRequest: 7 }),
      hopRecord({ state: 'merged' }),
      hopRecord({ state: 'halted' }),
      hopRecord({ kind: 'dry', blocked: null, target: null }),
    ];

    for (const record of records) {
      const { lines, output } = capture();
      awayOnHop(record);
      await nextRun({ issues: plantedIssues(board), output, dryRun: true, followHop: true, seams: hopSeams(board).seams });

      // #42, the position's board's first line; C would name #90.
      expect(lines.info.at(-1)).toBe(dryRunLine(describeIssue(issueOf(42))));
    }
  });

  it('warns a record that is not one, and picks as --next does', async () => {
    const { lines, output } = capture();
    const board = hopBoard();
    awayOnHop(null);
    const file = hopFilePath(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{"kind":"blocker"}\n');

    const resolution = await nextRun({ issues: plantedIssues(board), output, followHop: true, seams: hopSeams(board).seams });

    expect(specOf(resolution).issue).toBe(42);
    expect(lines.warn).toEqual([unfollowedHopNotice(`${file} does not hold a hop record`)]);
  });
});

describe('pickRoadmapIssue passing over issues whose claim was refused', () => {
  it('reads a passed-over line as taken by the branch that refused it, and picks the line under it', async () => {
    const { lines, output } = capture();

    const resolution = await nextRun({
      output,
      seams: { passOver: new Map([[20, 'feat/rafa-20-pull-request-commands']]) },
    });

    expect(specOf(resolution).issue).toBe(33);
    expect(lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      skipLine({ line: { issue: 17, ticked: true, why: 'the pull request port, merged', lineNumber: 3 }, reason: 'ticked', detail: '' }),
      skipLine({
        line: { issue: 20, ticked: false, why: 'pull request commands', lineNumber: 4 },
        reason: 'branch',
        detail: 'feat/rafa-20-pull-request-commands',
      }),
      pickLine({ issue: 33, ticked: false, why: 'the board setup', lineNumber: 5 }),
    ]);
    expect(exists(snapshotAt(20))).toBe(false);
  });

  it('picks #20 as it always did with an empty pass-over, the control for the case above', async () => {
    const resolution = await nextRun({ seams: { passOver: new Map() } });

    expect(specOf(resolution).issue).toBe(20);
  });

  it('passes the refused line over on the way to a blocked line\'s alternative too', async () => {
    const { lines, output } = capture();
    const planted = plantedOffer(true);

    const resolution = await nextRun({
      issues: plantedIssues(blockedBoard()),
      output,
      seams: { offerAlternative: planted.offer, passOver: new Map([[33, 'feat/rafa-33-board-setup']]) },
    });

    // #33 is the alternative the blocked-line cases plan; passed over,
    // the offer names #34, the line under it.
    expect(planted.taken().map((taken) => taken.line.issue)).toEqual([34]);
    expect(specOf(resolution).issue).toBe(34);
    expect(lines.info).toContain(alternativeLine({ issue: 34, ticked: false, why: 'naming and close-out', lineNumber: 5 }));
    expect(lines.info.join('\n')).toContain('#33 taken: branch feat/rafa-33-board-setup exists');
  });

  it('follows no hop whose target was refused, warning why, and walks as --next does', async () => {
    const { lines, output } = capture();
    const board = hopBoard();
    awayOnHop(hopRecord());

    const resolution = await nextRun({
      issues: plantedIssues(board),
      output,
      followHop: true,
      seams: { ...hopSeams(board).seams, passOver: new Map([[HOP_TARGET, 'feat/rafa-90-x']]) },
    });

    expect(specOf(resolution).issue).toBe(42);
    expect(lines.warn).toEqual([
      unfollowedHopNotice(`issue #${String(HOP_TARGET)}, the hop's target, was refused its claim on feat/rafa-90-x`),
    ]);
    expect(lines.info).not.toContain(hopPickLine(HOP_TARGET));
  });
});

/** The line-ahead reading a `--next` resolution answered, or the failure of one that answered none. */
function aheadOf(resolution: SpecSourceResolution): NonNullable<ResolvedSpec['ahead']> {
  if (resolution.outcome !== 'spec' || resolution.spec.ahead === undefined) {
    throw new Error('expected a --next spec carrying the line ahead');
  }
  return resolution.spec.ahead;
}

describe('readSpecSourceFlags with --claim-ahead', () => {
  it('marks a --next request to claim ahead, beside --roadmap or not', () => {
    expect(readSpecSourceFlags(['--next', '--claim-ahead']).request).toEqual({ kind: 'next', roadmap: null, claimAhead: true });
    expect(readSpecSourceFlags(['--claim-ahead', '--next=31', '--roadmap']).request)
      .toEqual({ kind: 'next', roadmap: 31, followHop: true, claimAhead: true });
    expect(Object.keys(readSpecSourceFlags(['--next', '--roadmap']).request ?? {})).toEqual(['kind', 'roadmap', 'followHop']);
  });

  it('refuses --claim-ahead without --next with exit 2, alone or beside another source', () => {
    for (const args of [['--claim-ahead'], ['--issue=20', '--claim-ahead'], ['--spec=a.md', '--claim-ahead']]) {
      let thrown: unknown = null;
      try {
        readSpecSourceFlags(args);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CommandExit);
      expect((thrown as CommandExit).exitCode).toBe(ROADMAP_REFUSAL_EXIT);
      expect((thrown as CommandExit).message).toBe(claimAheadWithoutNextMessage());
    }
    expect(claimAheadWithoutNextMessage())
      .toBe('--claim-ahead claims the line after the one --next picks, and this line gives no --next; write --next --claim-ahead, or drop --claim-ahead');
  });
});

describe('resolveSpecSource over --next, the line ahead', () => {
  it('answers the walk\'s board and reads the next undone line after the pick only when asked', async () => {
    const issues = plantedIssues(boardIssues());

    const ahead = aheadOf(await nextRun({ issues, claimAhead: true }));
    const askedBefore = issues.asked();
    const candidate = await ahead.walk?.candidate();

    expect(ahead.flag).toBe(true);
    expect(ahead.walk?.board).toBe(ROADMAP);
    expect(askedBefore).toEqual([ROADMAP, 20]);
    expect(candidate).toEqual({ issue: 33, title: 'Issue 33', board: ROADMAP, labels: [SPEC_LABEL] });
    expect(issues.asked()).toEqual([ROADMAP, 20, 33]);
  });

  it('answers the flag false for a --next run without --claim-ahead, the walk still carried', async () => {
    const ahead = aheadOf(await nextRun({}));

    expect(ahead.flag).toBe(false);
    expect(ahead.walk?.board).toBe(ROADMAP);
  });

  it('passes a closed line after the pick, and a taken one is still the line ahead', async () => {
    const board = boardIssues().map((issue) => issue.number === 33
      ? { ...issue, state: 'CLOSED' as const }
      : issue);
    const taken = plantedIssues(boardIssues());

    const pastClosed = await aheadOf(await nextRun({ issues: plantedIssues(board) })).walk?.candidate();
    // #33 is taken by a branch here, and the walk passes it, yet it is
    // still the line after #20 as the walk read the roadmap.
    const pick = await nextRun({ issues: taken, seams: { git: plantedGit('refs/heads/feat/rafa-33-the-board-setup\n') } });
    const pastTaken = await aheadOf(pick).walk?.candidate();

    expect(pastClosed?.issue).toBe(34);
    expect(specOf(pick).issue).toBe(20);
    expect(pastTaken?.issue).toBe(33);
  });

  it('answers null for a pick that is the last undone line', async () => {
    const git = plantedGit('refs/heads/feat/rafa-20-pull-request-commands\nrefs/heads/feat/rafa-33-the-board-setup\n');

    const resolution = await nextRun({ seams: { git } });

    expect(specOf(resolution).issue).toBe(34);
    expect(await aheadOf(resolution).walk?.candidate()).toBeNull();
  });

  it('answers no walk for a pick that followed a hop, and no line ahead at all under --issue', async () => {
    const board = hopBoard();
    awayOnHop(hopRecord());

    const hop = aheadOf(await nextRun({ issues: plantedIssues(board), followHop: true, claimAhead: true, seams: hopSeams(board).seams }));
    const issue = await resolveSpecSource({
      request: { kind: 'issue', issue: 20 },
      refresh: false,
      dryRun: false,
      repoRoot: root,
      specsDir: SPECS_DIR,
      findSpec: () => 'never',
      issues: plantedIssues(boardIssues()).read,
      output: capture().output,
    });

    expect(hop).toEqual({ flag: true, walk: null });
    expect(issue.outcome === 'spec' && 'ahead' in issue.spec).toBe(false);
    expect(specOf(issue).issue).toBe(20);
  });
});

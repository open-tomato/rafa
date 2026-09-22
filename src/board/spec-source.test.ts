/**
 * Tests for the one spec a `plan create` run plans from
 * (`src/board/spec-source.ts`): the three flags read, their mutual
 * exclusion, each route resolved into a path, the lines `--next`
 * prints and what `--dry-run` stops before.
 *
 * Every seam is planted here and nothing spawns. The issue reader is a
 * map of planted issues that COUNTS its reads, the roadmap search, the
 * open pull request list and the git runner answer what a case recorded,
 * and the output is a `sinkOutput` handed in through the options. No
 * case reaches GitHub, spawns `gh` or `git`, reads a real repository, or
 * touches the configuration either keeps under the home.
 *
 * Every file a case writes sits under a temporary directory made in
 * `tmpdir` and removed afterwards, and `specs.dir` is a RELATIVE
 * setting, as a project configures it, so a resolution that reached the
 * real home or the real `.rafa/specs` would find nothing there and
 * redden.
 *
 * ## What passes while wrong
 *
 * Three shapes here pass for the wrong reason easily, and each is
 * paired with the control that catches it:
 *
 *  - A mutual exclusion that refused EVERY line satisfies all three
 *    refusal cases, so each pair that is refused sits beside the same
 *    flag given alone, and the two refusal sentences are asserted apart:
 *    an operator told `--spec and --issue` about a line that gave
 *    `--issue` and `--next` looks at the wrong word.
 *  - A `--dry-run` that stopped one step too early would still print a
 *    line and still write nothing, so the dry run on the issue route
 *    asserts the checks RAN — the refusal of a closed issue under
 *    `--dry-run` reaches the operator — and the one on the spec route
 *    asserts the path was resolved.
 *  - The memo over the issue reader changes no answer at all: a
 *    resolution that read the picked issue twice picks the same line and
 *    writes the same snapshot. Only the count can see it, so the walk
 *    case asserts one read per issue and the whole read order.
 *
 * `--next` stopping at a line that is not ready rather than skipping
 * past it is measured the only way it can be: the roadmap below carries
 * a line AFTER the pick that would resolve cleanly, an `inspect` that
 * refuses the pick is planted, and the case asserts the refusal names
 * the pick and that the line below it was never read.
 *
 * ## The roadmap's own checks
 *
 * `inspectRoadmap` is the second checks seam, run on the roadmap as
 * read (`spec-source.ts`), and the same two shapes pass for the wrong
 * reason: a seam called too LATE refuses with the same sentence and
 * writes nothing either, and one never called at all changes no pick.
 * So the two cases for it record what was IN HAND at the moment it ran
 * — the numbers the reader had been asked, and the `git` commands sent
 * — and the refusing one asserts that no line was read, no branch
 * scanned, and that the only line printed is the header.
 *
 * Two mutations of `spec-source.ts` were driven on 2026-09-21, one at
 * a time, over `env -u CLAUDECODE bun test src/board/`, the module
 * restored from a scratch copy and verified with `shasum -c` each
 * time. 430 pass and 0 fail either side, and the counts are that whole
 * run's, since `./plan-spec.test.ts` drives the same seam wired:
 *
 *  - the `inspectRoadmap` call dropped: 424 pass and 6 fail, these two
 *    and four there.
 *  - the call moved BELOW the branch scan: 426 pass and 4 fail, these
 *    two and two there.
 *
 * ## The blocked line, and the three endings that plan nothing
 *
 * A `--next` pick whose issue carries `spec:blocked` with a blocker
 * still open is offered past rather than planned (`spec-source.ts`),
 * and three of its four endings write nothing — a no, no offer at all,
 * and no line under it worth offering. Each of those looks like the
 * others from the outside, so each case asserts the SENTENCE it ends
 * with as well as the stop, and the ones that could have written assert
 * that no snapshot is there.
 *
 * The blocked reading itself is held by a pair: the same board with
 * #24 open and with #24 closed. The closed half plans the blocked line
 * ITSELF and prints no blocked line at all, which is what holds "the
 * label alone does not block" against a reading that called every
 * labelled issue blocked.
 *
 * Two mutations of `spec-source.ts` were driven on 2026-09-21, one at
 * a time, over `env -u CLAUDECODE bun test
 * src/board/blocked-line.test.ts src/board/spec-source.test.ts
 * src/board/plan-spec.test.ts`, the module restored from a scratch copy
 * and verified with `shasum -c` each time, against 96 pass and 0 fail
 * either side:
 *
 *  - the blocked reading ignored, so every pick is planned: 86 pass and
 *    10 fail, all eight blocked cases here and both in
 *    `./plan-spec.test.ts`.
 *  - the offer's ANSWER ignored, so a no plans the alternative anyway:
 *    93 pass and 3 fail — the case that answers no here and the two
 *    there. Only a case that answers no can see it, which is why every
 *    yes case is paired with one.
 *
 * ## Mutations driven
 *
 * Eleven mutations of `spec-source.ts` were driven on 2026-09-19, one
 * at a time, over `env -u CLAUDECODE bun test src/board/`, the module
 * restored from a scratch copy and verified with `shasum -c` after
 * each. 283 pass either side, and each count below is that run's own:
 *
 *  - the mutual exclusion dropped, so the first flag given wins: 3
 *    fail, the three pairs.
 *  - `--dry-run` moved ABOVE `requireSpecIssue` and the checks, which
 *    still prints a line and still writes nothing: 2 fail, the dry run
 *    that counts the checks and the closed issue refused under one.
 *  - the memo over the issue reader dropped: 4 fail, every `--next`
 *    case that asserts what was asked. No pick changes, which is why
 *    the counts are written down.
 *  - the skip lines not printed: 2 fail.
 *  - the branch scan's problems swallowed rather than warned: 1 fail,
 *    and only that one, since the pick is unaffected.
 *  - `roadmap.issue` outranking `--next=<n>`: 1 fail.
 *  - the snapshot written with `refresh` forced true: 1 fail, the
 *    `--refresh` case, whose first half is the refusal.
 *  - `inspect` never called: 3 fail.
 *  - the exhausted message not printed: 1 fail.
 *  - `requireSpecIssue` dropped, so a closed or unlabelled issue is
 *    snapshotted: 3 fail.
 *  - `--dry-run` ignored on the `--spec` route: 1 fail.
 */
import type { AlternativeOfferRequest } from './blocked-line.js';
import type { SpecIssue } from './issue.js';
import type { RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { RoadmapSeams, SpecSourceResolution } from './spec-source.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  blockedLineSentence,
  declinedMessage,
  noAlternativeMessage,
  notReadySentence,
  unaskedMessage,
} from './blocked-line.js';
import { SPEC_BLOCKED_LABEL } from './blocked.js';
import {
  closedIssueMessage,
  ISSUE_REFUSAL_EXIT,
  missingSpecLabelMessage,
  REFRESH_FLAG,
  SPEC_LABEL,
} from './issue.js';
import { specPath } from './naming.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { exhaustedMessage, ROADMAP_SETTING, ROADMAP_TITLE } from './roadmap.js';
import {
  alternativeLine,
  blockedPickLine,
  describeIssue,
  DRY_RUN_FLAG,
  dryRunLine,
  ISSUE_FLAG,
  missingValueMessage,
  NEXT_FLAG,
  noSourceMessage,
  notAnIssueMessage,
  pickLine,
  passedLine,
  readSpecSourceFlags,
  resolveSpecSource,
  roadmapHeaderLine,
  severalSourcesMessage,
  skipLine,
  SOURCE_REFUSAL_EXIT,
  SPEC_FLAG,
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

/** What a thrown `CommandExit` carried, for a call that does not return a promise. */
function refusalOf(run: () => unknown): CommandExit {
  try {
    run();
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
  parent = mkdtempSync(join(tmpdir(), 'rafa-spec-source-'));
});

beforeEach(() => {
  root = mkdtempSync(join(parent, 'case-'));
});

afterAll(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe('readSpecSourceFlags', () => {
  it('reads --spec into a spec request, with neither refresh nor dry run', () => {
    expect(readSpecSourceFlags([`${SPEC_FLAG}=.specs/rafa-20.md`])).toEqual({
      request: { kind: 'spec', spec: '.specs/rafa-20.md' },
      refresh: false,
      dryRun: false,
    });
  });

  it('reads --issue into an issue request', () => {
    expect(readSpecSourceFlags([`${ISSUE_FLAG}=20`]).request).toEqual({ kind: 'issue', issue: 20 });
  });

  it('reads a bare --next as the configured roadmap, and --next=<n> as that issue', () => {
    expect(readSpecSourceFlags([NEXT_FLAG]).request).toEqual({ kind: 'next', roadmap: null });
    expect(readSpecSourceFlags([`${NEXT_FLAG}=31`]).request).toEqual({ kind: 'next', roadmap: 31 });
  });

  it('reads --refresh and --dry-run beside the source', () => {
    const flags = readSpecSourceFlags([`${ISSUE_FLAG}=20`, REFRESH_FLAG, DRY_RUN_FLAG]);

    expect([flags.refresh, flags.dryRun]).toEqual([true, true]);
  });

  it('answers a null request for a line naming no source, and still reads the other flags', () => {
    const flags = readSpecSourceFlags(['--stub=rafa-20', DRY_RUN_FLAG]);

    expect([flags.request, flags.dryRun]).toEqual([null, true]);
  });

  it('reads --no-next as naming no source, the meaning it had before the ending hint declared --next as a flag', () => {
    // `parseArgs` reads `--no-next` as `next: false` on the parsed flags
    // (`src/cli/core/parseArgs.ts`), but this module reads the raw words
    // of `args` for the literal `--next` and `--next=`, and `--no-next`
    // is neither, so it lands here exactly where a line naming nothing
    // at all does: a null request, refused by `plan create` with
    // {@link noSourceMessage}, not read as `--next` given.
    expect(readSpecSourceFlags(['--no-next']).request).toBe(null);
    expect(readSpecSourceFlags(['--no-next', NEXT_FLAG]).request).toEqual({ kind: 'next', roadmap: null });
  });

  it('refuses --spec with --issue, naming both, and lets either alone through', () => {
    const refused = refusalOf(() => readSpecSourceFlags([`${SPEC_FLAG}=a.md`, `${ISSUE_FLAG}=20`]));

    expect(refused.exitCode).toBe(SOURCE_REFUSAL_EXIT);
    expect(refused.message).toBe(severalSourcesMessage([SPEC_FLAG, ISSUE_FLAG]));
    expect(readSpecSourceFlags([`${SPEC_FLAG}=a.md`]).request).toEqual({ kind: 'spec', spec: 'a.md' });
    expect(readSpecSourceFlags([`${ISSUE_FLAG}=20`]).request).toEqual({ kind: 'issue', issue: 20 });
  });

  it('refuses --issue with --next, naming those two and not --spec', () => {
    const refused = refusalOf(() => readSpecSourceFlags([`${ISSUE_FLAG}=20`, NEXT_FLAG]));

    expect(refused.message).toBe(severalSourcesMessage([ISSUE_FLAG, NEXT_FLAG]));
    expect(refused.message).not.toContain(SPEC_FLAG);
  });

  it('refuses all three at once, naming each', () => {
    const refused = refusalOf(() => readSpecSourceFlags([`${SPEC_FLAG}=a.md`, `${ISSUE_FLAG}=20`, NEXT_FLAG]));

    expect(refused.message).toBe(severalSourcesMessage([SPEC_FLAG, ISSUE_FLAG, NEXT_FLAG]));
  });

  it('reads a repeated flag as one source, taking the first value', () => {
    expect(readSpecSourceFlags([`${SPEC_FLAG}=first.md`, `${SPEC_FLAG}=second.md`]).request)
      .toEqual({ kind: 'spec', spec: 'first.md' });
  });

  it('refuses --spec given no file, bare or with an empty value', () => {
    const bare = refusalOf(() => readSpecSourceFlags([SPEC_FLAG]));
    const empty = refusalOf(() => readSpecSourceFlags([`${SPEC_FLAG}=`]));

    expect(bare.exitCode).toBe(SOURCE_REFUSAL_EXIT);
    expect(bare.message).toBe(missingValueMessage(SPEC_FLAG, '<file>.md'));
    expect(empty.message).toBe(bare.message);
  });

  it('refuses --issue given no number, and one that is not an issue number', () => {
    expect(refusalOf(() => readSpecSourceFlags([ISSUE_FLAG])).message)
      .toBe(missingValueMessage(ISSUE_FLAG, '<n>'));
    expect(refusalOf(() => readSpecSourceFlags([`${ISSUE_FLAG}=twenty`])).message)
      .toBe(notAnIssueMessage(ISSUE_FLAG, 'twenty'));
    expect(refusalOf(() => readSpecSourceFlags([`${ISSUE_FLAG}=0`])).message)
      .toBe(notAnIssueMessage(ISSUE_FLAG, '0'));
    expect(refusalOf(() => readSpecSourceFlags([`${ISSUE_FLAG}=20x`])).message)
      .toBe(notAnIssueMessage(ISSUE_FLAG, '20x'));
  });

  it('refuses --next= with nothing after it, and a roadmap that is not an issue number', () => {
    expect(refusalOf(() => readSpecSourceFlags([`${NEXT_FLAG}=`])).message)
      .toBe(missingValueMessage(NEXT_FLAG, '<roadmap-issue>'));
    expect(refusalOf(() => readSpecSourceFlags([`${NEXT_FLAG}=roadmap`])).message)
      .toBe(notAnIssueMessage(NEXT_FLAG, 'roadmap'));
  });

  it('names all three sources and specs.dir in the sentence for a line naming none', () => {
    const message = noSourceMessage(SPECS_DIR);

    expect(message).toContain(SPECS_DIR);
    expect([SPEC_FLAG, ISSUE_FLAG, NEXT_FLAG].every((flag) => message.includes(flag))).toBe(true);
  });
});

describe('resolveSpecSource over --spec', () => {
  it('answers the file findSpec found, with no issue and no read', async () => {
    const issues = plantedIssues([]);
    const resolution = await resolveSpecSource({
      request: { kind: 'spec', spec: 'rafa-20.md' },
      refresh: false,
      dryRun: false,
      repoRoot: root,
      specsDir: SPECS_DIR,
      findSpec: (spec) => join(SPECS_DIR, spec),
      issues: issues.read,
      output: capture().output,
    });

    expect(specOf(resolution)).toEqual({
      path: join(SPECS_DIR, 'rafa-20.md'),
      issue: null,
      source: join(SPECS_DIR, 'rafa-20.md'),
    });
    expect(issues.asked()).toEqual([]);
  });

  it('under --dry-run resolves the path, prints it and stops', async () => {
    const { lines, output } = capture();
    let looked: readonly string[] = [];

    const resolution = await resolveSpecSource({
      request: { kind: 'spec', spec: 'rafa-20.md' },
      refresh: false,
      dryRun: true,
      repoRoot: root,
      specsDir: SPECS_DIR,
      findSpec: (spec) => {
        looked = [...looked, spec];
        return join(SPECS_DIR, spec);
      },
      issues: plantedIssues([]).read,
      output,
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(looked).toEqual(['rafa-20.md']);
    expect(lines.info).toEqual([dryRunLine(join(SPECS_DIR, 'rafa-20.md'))]);
  });
});

/** What an `--issue` case is driven with, over the planted issues. */
function issueRun(options: {
  readonly issue: number;
  readonly issues?: readonly SpecIssue[];
  readonly refresh?: boolean;
  readonly dryRun?: boolean;
  readonly inspect?: (issue: SpecIssue) => Promise<void>;
  readonly output?: ReturnType<typeof sinkOutput>;
}): Promise<SpecSourceResolution> {
  return resolveSpecSource({
    request: { kind: 'issue', issue: options.issue },
    refresh: options.refresh ?? false,
    dryRun: options.dryRun ?? false,
    repoRoot: root,
    specsDir: SPECS_DIR,
    findSpec: () => 'never',
    issues: plantedIssues(options.issues ?? boardIssues()).read,
    inspect: options.inspect,
    output: options.output ?? capture().output,
  });
}

describe('resolveSpecSource over --issue', () => {
  it('snapshots the body under specs.dir and answers that file', async () => {
    expect(exists(snapshotAt(20))).toBe(false);

    const resolution = await issueRun({ issue: 20 });

    expect(specOf(resolution)).toEqual({
      path: snapshotAt(20),
      issue: 20,
      source: 'issue #20',
    });
    expect(readFileSync(join(root, snapshotAt(20)), 'utf8')).toBe(issueOf(20).body);
  });

  it('runs the checks with the issue as read, before a byte is written', async () => {
    let inspected: readonly SpecIssue[] = [];
    const refused = await refusal(() => issueRun({
      issue: 33,
      inspect: (issue) => {
        inspected = [...inspected, issue];
        return Promise.reject(new CommandExit(ISSUE_REFUSAL_EXIT, 'the checks said no'));
      },
    }));

    expect(refused.message).toBe('the checks said no');
    expect(inspected).toEqual([issueOf(33)]);
    expect(exists(snapshotAt(33))).toBe(false);
  });

  it('refuses a closed issue, and writes the open one beside it', async () => {
    const refused = await refusal(() => issueRun({ issue: 17 }));

    expect(refused.exitCode).toBe(ISSUE_REFUSAL_EXIT);
    expect(refused.message).toBe(closedIssueMessage(17));
    expect(exists(snapshotAt(17))).toBe(false);
    expect(specOf(await issueRun({ issue: 34 })).path).toBe(snapshotAt(34));
  });

  it('refuses an issue that is not labelled type:spec, with its own sentence', async () => {
    const unlabelled = [issueOf(41, { labels: ['bug'] })];
    const refused = await refusal(() => issueRun({ issue: 41, issues: unlabelled }));

    expect(refused.message).toBe(missingSpecLabelMessage(41));
    expect(refused.message).not.toBe(closedIssueMessage(41));
    expect(exists(snapshotAt(41))).toBe(false);
  });

  it('refuses a snapshot that differs without --refresh, and rewrites it with one', async () => {
    const stale = [issueOf(52)];
    mkdirSync(join(root, SPECS_DIR), { recursive: true });
    writeFileSync(join(root, snapshotAt(52)), 'what an older run planned from\n');

    const refused = await refusal(() => issueRun({ issue: 52, issues: stale }));
    expect(refused.message).toContain(REFRESH_FLAG);
    expect(readFileSync(join(root, snapshotAt(52)), 'utf8')).toBe('what an older run planned from\n');

    const resolution = await issueRun({ issue: 52, issues: stale, refresh: true });
    expect(specOf(resolution).path).toBe(snapshotAt(52));
    expect(readFileSync(join(root, snapshotAt(52)), 'utf8')).toBe(issueOf(52).body);
  });

  it('under --dry-run reads the issue, runs the checks, prints it and writes nothing', async () => {
    const { lines, output } = capture();
    let inspected = 0;

    const resolution = await issueRun({
      issue: 63,
      issues: [issueOf(63)],
      dryRun: true,
      output,
      inspect: () => {
        inspected += 1;
        return Promise.resolve();
      },
    });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(inspected).toBe(1);
    expect(lines.info).toEqual([dryRunLine(describeIssue(issueOf(63)))]);
    expect(exists(snapshotAt(63))).toBe(false);
  });

  it('under --dry-run still refuses a closed issue, so a dry run reports what a real one would', async () => {
    const refused = await refusal(() => issueRun({ issue: 17, dryRun: true }));

    expect(refused.message).toBe(closedIssueMessage(17));
  });

  it('writes through the active output when the caller hands none', async () => {
    const { lines, output } = capture();
    setActiveOutput(output);
    try {
      await resolveSpecSource({
        request: { kind: 'issue', issue: 74 },
        refresh: false,
        dryRun: true,
        repoRoot: root,
        specsDir: SPECS_DIR,
        findSpec: () => 'never',
        issues: plantedIssues([issueOf(74)]).read,
      });
    } finally {
      setActiveOutput(null);
    }

    expect(lines.info).toEqual([dryRunLine(describeIssue(issueOf(74)))]);
  });
});

/** What a `--next` case is driven with, over the planted board. */
function nextRun(options: {
  readonly roadmap?: number | null;
  readonly issues?: ReturnType<typeof plantedIssues>;
  readonly seams?: Partial<RoadmapSeams>;
  readonly dryRun?: boolean;
  readonly inspect?: (issue: SpecIssue) => Promise<void>;
  readonly output?: ReturnType<typeof sinkOutput>;
}): Promise<SpecSourceResolution> {
  return resolveSpecSource({
    request: { kind: 'next', roadmap: options.roadmap ?? null },
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
      search: plantedSearch(ROADMAP),
      git: plantedGit(''),
      pullRequests: plantedPulls(),
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

  it('carries the roadmap refusal through when the search finds none', async () => {
    const refused = await refusal(() => nextRun({
      seams: { configured: null, search: () => Promise.resolve([]) },
    }));

    expect(refused.message).toContain(ROADMAP_SETTING);
  });

  it('refuses to resolve --next with no roadmap seams, which is a defect in the caller', async () => {
    const failing = resolveSpecSource({
      request: { kind: 'next', roadmap: null },
      refresh: false,
      dryRun: false,
      repoRoot: root,
      specsDir: SPECS_DIR,
      findSpec: () => 'never',
      issues: plantedIssues(boardIssues()).read,
      output: capture().output,
    });

    await expect(failing).rejects.toThrow(TypeError);
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

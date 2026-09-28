/**
 * Tests for the one spec a `plan create` run plans from
 * (`src/board/spec-source.ts`): the three flags read, their mutual
 * exclusion, the `--spec` and `--issue` routes resolved into a path,
 * what `--dry-run` stops before, and the refusal of a `--next` run handed
 * no roadmap seams. The `--next` walk itself — where it starts, the lines
 * it prints, a blocked pick and the walk into an epic — is
 * `./spec-source-roadmap.test.ts`'s, since the pick moved out of this
 * module into `./spec-source-roadmap.ts`.
 *
 * Every seam is planted here and nothing spawns. The issue reader is a
 * map of planted issues that COUNTS its reads, and the output is a
 * `sinkOutput` handed in through the options. No case reaches GitHub,
 * spawns `gh` or `git`, reads a real repository, or touches the
 * configuration either keeps under the home.
 *
 * Every file a case writes sits under a temporary directory made in
 * `tmpdir` and removed afterwards, and `specs.dir` is a RELATIVE
 * setting, as a project configures it, so a resolution that reached the
 * real home or the real `.rafa/specs` would find nothing there and
 * redden.
 *
 * ## What passes while wrong
 *
 * Two shapes here pass for the wrong reason easily, and each is paired
 * with the control that catches it:
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
 *
 * ## Mutations driven
 *
 * Eleven mutations of `spec-source.ts` were driven on 2026-09-19, one
 * at a time, over `env -u CLAUDECODE bun test src/board/`, the module
 * restored from a scratch copy and verified with `shasum -c` after
 * each. 283 pass either side, and each count below is that run's own.
 * The five that read the roadmap walk — the memo, the skip lines, the
 * branch scan's problems, `roadmap.issue` outranking `--next=<n>` and the
 * exhausted message — are recorded in `./spec-source-roadmap.test.ts`
 * beside the cases that moved there. These six are mutations of the
 * funnel itself, and a case that failed under one may now sit in either
 * file:
 *
 *  - the mutual exclusion dropped, so the first flag given wins: 3
 *    fail, the three pairs.
 *  - `--dry-run` moved ABOVE `requireSpecIssue` and the checks, which
 *    still prints a line and still writes nothing: 2 fail, the dry run
 *    that counts the checks and the closed issue refused under one.
 *  - the snapshot written with `refresh` forced true: 1 fail, the
 *    `--refresh` case, whose first half is the refusal.
 *  - `inspect` never called: 3 fail.
 *  - `requireSpecIssue` dropped, so a closed or unlabelled issue is
 *    snapshotted: 3 fail.
 *  - `--dry-run` ignored on the `--spec` route: 1 fail.
 */
import type { SpecIssue } from './issue.js';
import type { RefreshOffer, RefreshOfferRequest } from './snapshot-settle.js';
import type { SpecSourceResolution } from './spec-source.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  closedIssueMessage,
  ISSUE_REFUSAL_EXIT,
  missingSpecLabelMessage,
  REFRESH_FLAG,
  snapshotDiffersMessage,
  SPEC_LABEL,
} from './issue.js';
import { specPath } from './naming.js';
import { ROADMAP_TITLE } from './roadmap.js';
import {
  describeIssue,
  DRY_RUN_FLAG,
  dryRunLine,
  ISSUE_FLAG,
  missingValueMessage,
  NEXT_FLAG,
  noSourceMessage,
  notAnIssueMessage,
  readSpecSourceFlags,
  resolveSpecSource,
  severalSourcesMessage,
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

/** The roadmap issue the planted board carries; the `--issue` cases plan from its lines. */
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

/** The issues an `--issue` case plants unless it names its own: the roadmap and its four lines. */
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
  readonly offerRefresh?: RefreshOffer | null;
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
    offerRefresh: options.offerRefresh,
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

  it('hands a changed body to offerRefresh after the checks, and plans from it on a yes', async () => {
    const stale = [issueOf(53)];
    mkdirSync(join(root, SPECS_DIR), { recursive: true });
    writeFileSync(join(root, snapshotAt(53)), 'what an older run planned from\n');
    const order: string[] = [];
    const asked: RefreshOfferRequest[] = [];

    const resolution = await issueRun({
      issue: 53,
      issues: stale,
      inspect: () => {
        order.push('inspect');
        return Promise.resolve();
      },
      offerRefresh: (request) => {
        order.push('offer');
        asked.push(request);
        return Promise.resolve(true);
      },
    });

    expect(order).toEqual(['inspect', 'offer']);
    expect(asked.map(({ issue, path }) => ({ issue, path }))).toEqual([{ issue: 53, path: snapshotAt(53) }]);
    expect(specOf(resolution).path).toBe(snapshotAt(53));
    expect(readFileSync(join(root, snapshotAt(53)), 'utf8')).toBe(issueOf(53).body);
  });

  it('refuses a changed body the offer answers no to, and leaves the saved copy', async () => {
    const stale = [issueOf(54)];
    mkdirSync(join(root, SPECS_DIR), { recursive: true });
    writeFileSync(join(root, snapshotAt(54)), 'what an older run planned from\n');

    const refused = await refusal(() => issueRun({
      issue: 54,
      issues: stale,
      offerRefresh: () => Promise.resolve(false),
    }));

    expect(refused.message).toBe(snapshotDiffersMessage(snapshotAt(54), 54));
    expect(readFileSync(join(root, snapshotAt(54)), 'utf8')).toBe('what an older run planned from\n');
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

// The walk `--next` makes is `./spec-source-roadmap.test.ts`'s subject;
// only the seams' absence is the funnel's own refusal.
describe('resolveSpecSource over --next', () => {
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

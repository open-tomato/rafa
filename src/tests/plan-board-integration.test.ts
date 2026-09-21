/**
 * An integration test over one stubbed `gh`, for the board routes of
 * `rafa plan create` and the roadmap tick `rafa pr merge` writes.
 *
 * `src/board/issue.ts`, `src/board/roadmap.ts`, `src/board/spec-source.ts`,
 * `src/board/plan-spec.ts`, `src/board/roadmap-tick.ts` and
 * `src/commands/pr/merge-tick.ts` each drive their own module, or a pair
 * of them, over planted fakes; this file drives none of that again. It
 * exists for the SEAM across all of them, which `src/plan.test.ts` names
 * in its own module note and does not cover itself:
 *
 *  - `--issue` end to end there is one planted issue, one snapshot, one
 *    plan; nothing there plants a LOCAL NOTES file, and nothing composes
 *    every one of `./issue.ts`'s own refusals against a real command
 *    line.
 *  - `--next` is "not driven [in `plan.test.ts`] — its walk is three more
 *    `gh` and `git` reads, driven over planted runners in
 *    `src/board/plan-spec.test.ts` and end to end in the integration
 *    suite." This is that suite: a real roadmap body, walked by the
 *    real command, over a real (if bare) git repository, past a done
 *    reading, a closed reading, a branch taken and a pull request taken,
 *    to the line it picks.
 *  - `rafa pr merge` ticks a roadmap line after a merge
 *    (`src/commands/pr/merge-tick.test.ts`, `src/board/roadmap-tick.test.ts`),
 *    and `plan create --next` reads a ticked line as done
 *    (`src/board/roadmap.test.ts`). Nothing anywhere plays the two in
 *    sequence over the SAME board: a tick written by one, read as done
 *    by the other. That is the second half of this file.
 *
 * The first half spawns `bun src/rafa.ts plan create` in a scratch git
 * repository, exactly as `src/plan.test.ts` does and for the same
 * reason: the board routes build their own `gh` and `git` runners
 * (`src/board/plan-spec.ts`) unless the caller hands one over, and
 * `src/plan.ts` hands none over, so only a real process with a stand-in
 * `gh` first on its PATH drives them without reaching GitHub. The
 * planner is a fixture resolved through a registry handed to the
 * command in place of core's, as `src/plan.test.ts`'s is; unlike that
 * file's, this fixture reads the SNAPSHOT ITSELF off disk rather than
 * handing the context's builder a fixed string, so what it records is
 * proof that the session was handed the exact file the board route wrote
 * — notes appended — and not a copy of the claim.
 *
 * The second half runs in-process, over `tickRoadmapAfterMerge` and
 * `resolvePlanSpec` called directly with one shared `gh` fake between
 * them: no process is spawned, and no case reaches GitHub, spawns `gh`
 * or `git`, or touches a real home.
 *
 * Both halves answer check 0, the author's trust: every planted issue
 * carries an author, and both stubs answer
 * `gh api repos/{owner}/{repo}/collaborators/<login>/permission` with
 * `admin`. That check runs first (`src/board/plan-spec.ts`), so a board
 * that did not answer it would refuse every case here for its author
 * and no case could reach the reading it is about. `--next` also reads
 * `origin` through `git` for the label a refusal would carry, which a
 * scratch repository answers with no remote.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { SpecIssue } from '../board/issue.js';
import type { RoadmapLine, RoadmapSkip } from '../board/roadmap.js';
import type { GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  closedIssueMessage,
  missingSpecLabelMessage,
  notesCollisionMessage,
  snapshotDiffersMessage,
  snapshotText,
  SPEC_LABEL,
} from '../board/issue.js';
import { notesPath as localNotesPath, specPath } from '../board/naming.js';
import { resolvePlanSpec } from '../board/plan-spec.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import {
  noRoadmapMessage,
  parseRoadmapBody,
  severalRoadmapsMessage,
} from '../board/roadmap.js';
import { describeIssue, dryRunLine, pickLine, roadmapHeaderLine, skipLine } from '../board/spec-source.js';
import { tickRoadmapAfterMerge } from '../commands/pr/merge-tick.js';

import { plantProjectConfig } from './cli-capture.js';
import { sinkOutput } from './output-sinks.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's directory, `src/tests/`, one level under the modules the probe imports. */
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** `src/`, where every module the probe imports lives. */
const SRC_DIR = join(TESTS_DIR, '..');

/** Where `--issue` and `--next` write snapshots; a project's own default. */
const SPECS_DIR = '.rafa/specs';

/**
 * The child process: a registry holding a fixture planner in place of
 * core's, handed to the command exactly as `src/rafa.ts` builds it. The
 * fixture reads the spec `request.specPath` names, off disk, so what it
 * records is the file the board route actually wrote — never a copy the
 * fixture made up — and writes a minimal plan so the command finishes
 * whole. `claude` never runs: a line that went around the registry to
 * spawn a session would reach the stand-in beside `gh` on the PATH, and
 * every case here holds that stand-in's marker absent.
 */
const PROBE = [
  'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'registry.ts'))};`,
  `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
  `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
  `import declared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
  `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
  `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
  '',
  'const [record, ...args] = process.argv.slice(2);',
  'const registry = createAdapterRegistry([{',
  '  port: "planner",',
  '  kind: "claude",',
  '  portVersion: 1,',
  '  create: (context) => ({',
  '    create: async (request) => {',
  '      const specContent = readFileSync(join(context.repoRoot, request.specPath), "utf8");',
  '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
  '      mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  '      writeFileSync(',
  '        join(context.repoRoot, planPath),',
  '        "# Plan\\n\\n```rafa:plan\\nstub: " + request.stub + "\\n```\\n\\n- [ ] one task\\n",',
  '      );',
  '      writeFileSync(record, JSON.stringify({ specPath: request.specPath, stub: request.stub, specContent }));',
  '      return { planPath, prerequisitesPath: null };',
  '    },',
  '  }),',
  '}]);',
  'const command = wrapPhaseZeroCommand(declared, (words, root) => plan(words, root, registry));',
  'const commands = createCommandRegistry({ subjects: [{ name: "plan", summary: "plans" }], commands: [command] });',
  'const { exitCode } = await dispatch(["plan", "create", ...args], { registry: commands });',
  'process.exitCode = exitCode;',
  '',
].join('\n');

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-board-integration-')));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A run of `git`, throwing what it wrote to stderr when it failed. */
function git(args: readonly string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
}

/**
 * A planted issue, every field filled in unless `over` says otherwise.
 * The default body is EMPTY, which the readiness gate refuses whole
 * (`src/board/plan-spec.ts`): an issue a case means `plan create` to
 * plan FROM carries {@link completeSpecBody} instead, and the ones left
 * empty are the roadmap itself and the lines the walk skips, neither of
 * which is ever inspected.
 */
function issueOf(over: Partial<SpecIssue> & { readonly number: number }): SpecIssue {
  return {
    title: `Issue ${String(over.number)}`,
    body: '',
    state: 'OPEN',
    labels: [],
    author: 'octocat',
    ...over,
  };
}

/** One open pull request, as the roadmap's taken reading needs it. */
interface StubPullRequest {
  readonly number: number;
  readonly headRefName: string;
  readonly body: string;
}

/** What one scratch repository's stand-in `gh` answers. */
interface GhTable {
  readonly issues: readonly SpecIssue[];
  readonly pullRequests?: readonly StubPullRequest[];
  readonly roadmapSearch?: readonly { readonly number: number; readonly title: string }[];
}

/** A JSON payload quoted for a single-quoted shell string. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/** Writes the stand-in `gh` a `GhTable` answers, into `bin`. */
function writeGhStub(bin: string, table: GhTable): void {
  const lines = ['#!/bin/sh'];
  for (const issue of table.issues) {
    lines.push(`if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(issue.number)}" ]; then`);
    lines.push(`  printf '%s' '${shellQuoted({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.map((name) => ({ name })),
      author: { login: issue.author },
    })}'`);
    lines.push('  exit 0');
    lines.push('fi');
  }
  // Check 0's own read: every planted author holds write access here,
  // so the trust check clears and the case's own subject is what fails.
  for (const login of new Set(table.issues.map((issue) => issue.author))) {
    lines.push(`if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/${login}/permission" ]; then`);
    lines.push(`  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`);
    lines.push('  exit 0');
    lines.push('fi');
  }
  lines.push('if [ "$1" = "pr" ] && [ "$2" = "list" ]; then');
  lines.push(`  printf '%s' '${shellQuoted(table.pullRequests ?? [])}'`);
  lines.push('  exit 0');
  lines.push('fi');
  lines.push('if [ "$1" = "issue" ] && [ "$2" = "list" ]; then');
  lines.push(`  printf '%s' '${shellQuoted(table.roadmapSearch ?? [])}'`);
  lines.push('  exit 0');
  lines.push('fi');
  lines.push('echo "the stand-in gh was asked $*" >&2');
  lines.push('exit 1');
  lines.push('');
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** One scratch repository, its own `bin/`, `home/` and probe. */
interface Scratch {
  readonly root: string;
  readonly repo: string;
  readonly path: string;
  readonly home: string;
  readonly probe: string;
}

/**
 * Plants a scratch git repository holding `config`, with a bare `origin`
 * beside it (so `git ls-remote --heads origin` answers instead of
 * failing), a stand-in `claude` that must never run, and no `gh` yet:
 * {@link writeGhStub} writes that once a case knows its table.
 */
function plantScratch(config: string): Scratch {
  planted += 1;
  const root = join(tempDir, `run-${String(planted)}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', 'echo "the stand-in claude ran" >&2', 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(['init', '-q', '.'], repo);
  const origin = join(root, 'origin.git');
  git(['init', '--bare', '-q', origin], root);
  git(['remote', 'add', 'origin', origin], repo);
  plantProjectConfig(repo, config);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(gitBinary)].join(delimiter);
  const resolved = Bun.which('claude', { PATH: path });
  if (resolved !== claude) throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, PROBE, 'utf8');

  return { root, repo, path, home, probe };
}

/** Commits once (empty) and branches `feat/rafa-<issue>-<suffix>` off it, claiming `issue`. */
function claimWithBranch(scratch: Scratch, issue: number, suffix: string): void {
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '--allow-empty', '-q', '-m', 'init'], scratch.repo);
  git(['branch', `feat/rafa-${String(issue)}-${suffix}`], scratch.repo);
}

/** What one command run did, and the record path it may have written. */
interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly record: string;
}

/** Runs `plan create` in `scratch`, under its stand-in PATH and HOME. */
function runPlan(scratch: Scratch, recordName: string, args: readonly string[]): CommandRun {
  const record = join(scratch.root, `${recordName}.json`);
  const proc = Bun.spawnSync(
    [process.execPath, scratch.probe, record, ...args],
    { cwd: scratch.repo, env: { PATH: scratch.path, HOME: scratch.home } },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), record };
}

/** What the fixture recorded, once a run wrote it. */
function readRecord(run: CommandRun): { readonly specPath: string; readonly stub: string; readonly specContent: string } {
  return JSON.parse(readFileSync(run.record, 'utf8')) as { specPath: string; stub: string; specContent: string };
}

/** Every index `needles` is found at in `haystack`, in the order given; -1 for a miss. */
function positionsOf(haystack: string, needles: readonly string[]): readonly number[] {
  return needles.map((needle) => haystack.indexOf(needle));
}

describe('plan create --next, walked end to end over one stubbed gh', () => {
  /** The roadmap: a done reading of each kind, a taken reading of each kind, then the pick. */
  const ROADMAP_BODY = [
    '- [x] #10 — nothing left to do',
    '- [ ] #11 — the tracker already closed it',
    '- [ ] #22 — a branch already claims it',
    '- [ ] #23 — a pull request already closes it',
    '- [ ] #20 — the board routes',
    '',
  ].join('\n');

  const ROADMAP = issueOf({ number: 31, title: 'Roadmap', body: ROADMAP_BODY });
  const CLOSED = issueOf({ number: 11, state: 'CLOSED' });
  const BRANCH_CLAIMED = issueOf({ number: 22 });
  const PR_CLAIMED = issueOf({ number: 23 });
  const PICKED_BODY = completeSpecBody('The board routes', 'Read the board, snapshot the issue, and plan from it.');
  const PICKED = issueOf({
    number: 20,
    title: 'The board routes',
    body: PICKED_BODY,
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
  });
  const CLAIMING_PR: StubPullRequest = { number: 55, headRefName: 'feat/pr-55', body: 'Closes #23' };
  const NOTES = 'Local repro: enable verbose logging before rerunning the failing task.\n';

  const [tenLine, elevenLine, twentyTwoLine, twentyThreeLine, twentyLine] = parseRoadmapBody(ROADMAP_BODY) as [
    RoadmapLine, RoadmapLine, RoadmapLine, RoadmapLine, RoadmapLine,
  ];

  /** The lines a walk of this roadmap prints, in order, ending at the pick. */
  function expectedWalkLines(branchRef: string): readonly string[] {
    const skips: readonly RoadmapSkip[] = [
      { line: tenLine, reason: 'ticked', detail: '' },
      { line: elevenLine, reason: 'closed', detail: '' },
      { line: twentyTwoLine, reason: 'branch', detail: branchRef },
      { line: twentyThreeLine, reason: 'pull-request', detail: `#${String(CLAIMING_PR.number)}` },
    ];
    return [roadmapHeaderLine(31), ...skips.map((skip) => skipLine(skip)), pickLine(twentyLine)];
  }

  it('passes a done, a closed, a branch-taken and a pull-request-taken line, then snapshots the pick with its local notes appended, and plans from that exact file', () => {
    const scratch = plantScratch('roadmap:\n  issue: 31\n');
    writeGhStub(join(scratch.root, 'bin'), {
      issues: [ROADMAP, CLOSED, BRANCH_CLAIMED, PR_CLAIMED, PICKED],
      pullRequests: [CLAIMING_PR],
    });
    claimWithBranch(scratch, 22, 'taken');
    mkdirSync(join(scratch.repo, SPECS_DIR), { recursive: true });
    writeFileSync(join(scratch.repo, localNotesPath(SPECS_DIR, 20)), NOTES, 'utf8');

    const run = runPlan(scratch, 'picked', ['--next', '--no-progress']);

    expect(run.exitCode).toBe(0);
    const branchRef = 'refs/heads/feat/rafa-22-taken';
    const positions = positionsOf(run.stdout, expectedWalkLines(branchRef));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));

    const snapshot = specPath(SPECS_DIR, 20, 'The board routes');
    expect(snapshot).toBe(`${SPECS_DIR}/rafa-20-board-routes.md`);
    const onDisk = readFileSync(join(scratch.repo, snapshot), 'utf8');
    // Read directly rather than only against a recomputed `snapshotText`
    // call, whose own answer would go missing right alongside the
    // written file's if the append it names ever broke: the issue's own
    // body, the heading and the notes' own words must each be there.
    expect(onDisk).toContain(PICKED_BODY.trim());
    expect(onDisk).toContain('## Local notes');
    expect(onDisk).toContain(NOTES.trim());
    expect(onDisk).toBe(snapshotText(PICKED_BODY, NOTES));
    // "Planned from" means the session was handed THIS file, byte for
    // byte — read back from the fixture's own record of what it opened,
    // never a second call to the function that wrote it.
    expect(readRecord(run)).toEqual({ specPath: snapshot, stub: 'rafa-20-board-routes', specContent: onDisk });
  }, 30_000);

  it('under --dry-run does every one of those reads and stops before the snapshot or the session', () => {
    const scratch = plantScratch('roadmap:\n  issue: 31\n');
    writeGhStub(join(scratch.root, 'bin'), {
      issues: [ROADMAP, CLOSED, BRANCH_CLAIMED, PR_CLAIMED, PICKED],
      pullRequests: [CLAIMING_PR],
    });
    claimWithBranch(scratch, 22, 'taken');

    const run = runPlan(scratch, 'dry-run', ['--next', '--dry-run', '--no-progress']);

    expect(run.exitCode).toBe(0);
    const branchRef = 'refs/heads/feat/rafa-22-taken';
    const positions = positionsOf(run.stdout, [
      ...expectedWalkLines(branchRef),
      dryRunLine(describeIssue(PICKED)),
    ]);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(existsSync(join(scratch.repo, specPath(SPECS_DIR, 20, 'The board routes')))).toBe(false);
    expect(existsSync(run.record)).toBe(false);
  }, 30_000);

  it('exits 0 naming the roadmap exhausted once every line is done or taken, starting no session', () => {
    const exhaustedBody = [
      '- [x] #10 — nothing left to do',
      '- [ ] #11 — the tracker already closed it',
      '',
    ].join('\n');
    const scratch = plantScratch('roadmap:\n  issue: 31\n');
    writeGhStub(join(scratch.root, 'bin'), { issues: [issueOf({ number: 31, title: 'Roadmap', body: exhaustedBody }), CLOSED] });

    const run = runPlan(scratch, 'exhausted', ['--next', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('issue #31');
    expect(run.stdout).toContain('is done or taken (2 of them)');
    expect(existsSync(run.record)).toBe(false);
    expect(existsSync(join(scratch.repo, '.rafa', 'plans'))).toBe(false);
  }, 30_000);
});

describe('each refusal plan create --issue meets on the board', () => {
  it('refuses a closed issue, writing no snapshot', () => {
    const scratch = plantScratch('');
    writeGhStub(join(scratch.root, 'bin'), { issues: [issueOf({ number: 40, title: 'Old work', state: 'CLOSED', labels: [SPEC_LABEL] })] });

    const run = runPlan(scratch, 'closed', ['--issue=40', '--no-progress']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(closedIssueMessage(40));
    expect(existsSync(join(scratch.repo, specPath(SPECS_DIR, 40, 'Old work')))).toBe(false);
  }, 30_000);

  it('refuses an issue with no type:spec label, writing no snapshot', () => {
    const scratch = plantScratch('');
    writeGhStub(join(scratch.root, 'bin'), { issues: [issueOf({ number: 41, title: 'No label' })] });

    const run = runPlan(scratch, 'unlabelled', ['--issue=41', '--no-progress']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(missingSpecLabelMessage(41));
    expect(existsSync(join(scratch.repo, specPath(SPECS_DIR, 41, 'No label')))).toBe(false);
  }, 30_000);

  it('refuses a snapshot that no longer matches the issue, without --refresh', () => {
    const scratch = plantScratch('');
    const title = 'Steady title';
    writeGhStub(join(scratch.root, 'bin'), {
      issues: [issueOf({ number: 42, title, body: completeSpecBody(title, 'first body'), labels: [SPEC_LABEL, SPEC_READY_LABEL] })],
    });
    const first = runPlan(scratch, 'first', ['--issue=42', '--no-progress']);
    expect(first.exitCode).toBe(0);

    writeGhStub(join(scratch.root, 'bin'), {
      issues: [issueOf({ number: 42, title, body: completeSpecBody(title, 'a different body'), labels: [SPEC_LABEL, SPEC_READY_LABEL] })],
    });
    const second = runPlan(scratch, 'second', ['--issue=42', '--no-progress']);

    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain(snapshotDiffersMessage(specPath(SPECS_DIR, 42, title), 42));
  }, 30_000);

  it('refuses an issue whose snapshot name collides with its own local notes file', () => {
    const scratch = plantScratch('');
    writeGhStub(join(scratch.root, 'bin'), {
      issues: [issueOf({ number: 43, title: 'Notes', body: completeSpecBody('Notes'), labels: [SPEC_LABEL, SPEC_READY_LABEL] })],
    });

    const run = runPlan(scratch, 'collision', ['--issue=43', '--no-progress']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(notesCollisionMessage(specPath(SPECS_DIR, 43, 'Notes'), 43));
  }, 30_000);
});

describe('each refusal about which issue is the roadmap', () => {
  it('refuses a repository with no open issue titled Roadmap', () => {
    const scratch = plantScratch('');
    writeGhStub(join(scratch.root, 'bin'), { issues: [], roadmapSearch: [] });

    const run = runPlan(scratch, 'no-roadmap', ['--next', '--no-progress']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(noRoadmapMessage());
  }, 30_000);

  it('refuses a repository with several open issues titled Roadmap, naming both', () => {
    const scratch = plantScratch('');
    writeGhStub(join(scratch.root, 'bin'), {
      issues: [],
      roadmapSearch: [{ number: 1, title: 'Roadmap' }, { number: 2, title: 'Roadmap' }],
    });

    const run = runPlan(scratch, 'several-roadmaps', ['--next', '--no-progress']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(severalRoadmapsMessage([1, 2]));
  }, 30_000);
});

/** A `GhResult` that succeeded, writing `stdout`. */
function said(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `GitRunner` answering every read with no branch at all, for a walk the tick section does not exercise. */
function noBranches(): GitRunner {
  return () => ({ ok: true, stdout: '', stderr: '' });
}

/**
 * One board, shared between a `pr merge` tick and a `plan create --next`
 * walk: `gh issue view` and `gh issue list --search` for the walk,
 * `gh pr list` answering no open pull request, and the `gh api
 * repos/{owner}/{repo}/issues/<n>` pair the tick reads and writes,
 * over the SAME roadmap body, mutated in place by a write.
 */
function sharedBoard(roadmap: SpecIssue, others: readonly SpecIssue[]): { readonly gh: GhRunner; readonly roadmapBody: () => string } {
  let body = roadmap.body;
  const issues = new Map<number, SpecIssue>([roadmap, ...others].map((issue) => [issue.number, issue]));

  const gh: GhRunner = (args) => {
    if (args[0] === 'issue' && args[1] === 'view') {
      const found = issues.get(Number(args[2]));
      if (found === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no planted issue ${String(args[2])}` });
      const current = found.number === roadmap.number
        ? body
        : found.body;
      return Promise.resolve(said(JSON.stringify({
        number: found.number,
        title: found.title,
        body: current,
        state: found.state,
        labels: found.labels.map((name) => ({ name })),
        author: { login: found.author },
      })));
    }
    if (args[0] === 'pr' && args[1] === 'list') return Promise.resolve(said('[]'));
    if (args[0] === 'api' && args[1] === 'repos/{owner}/{repo}/collaborators/octocat/permission') {
      return Promise.resolve(said(JSON.stringify({ permission: 'admin', role_name: 'admin' })));
    }
    if (typeof args[0] === 'string' && args[0].startsWith(`repos/{owner}/{repo}/issues/${String(roadmap.number)}`)) {
      if (args.includes('-X') && args.includes('PATCH')) {
        const bodyArg = args.find((arg) => arg.startsWith('body='));
        if (bodyArg !== undefined) body = bodyArg.slice('body='.length);
      }
      return Promise.resolve(said(JSON.stringify({ number: roadmap.number, body })));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no planted answer for ${args.join(' ')}` });
  };

  return { gh, roadmapBody: () => body };
}

describe('the tick pr merge writes, read back by the very walk plan create --next makes', () => {
  const ROADMAP_NUMBER = 31;
  const ROADMAP_BODY = '- [ ] #20 plans from the board\n- [ ] #33 the board setup\n';

  function freshBoard(): ReturnType<typeof sharedBoard> {
    return sharedBoard(
      issueOf({ number: ROADMAP_NUMBER, title: 'Roadmap', body: ROADMAP_BODY }),
      [
        issueOf({ number: 20, title: 'Plans from the board', labels: [SPEC_LABEL, SPEC_READY_LABEL], body: completeSpecBody('Plans from the board', 'A spec.') }),
        issueOf({ number: 33, title: 'The board setup', labels: [SPEC_LABEL, SPEC_READY_LABEL], body: completeSpecBody('The board setup', 'Another spec.') }),
      ],
    );
  }

  /** Ticks `board` for a pull request closing `issue`, over a root of its own, with no board failure. */
  async function tick(board: ReturnType<typeof sharedBoard>, issue: number): Promise<void> {
    const warnings: string[] = [];
    const result = await tickRoadmapAfterMerge({
      body: `Closes #${String(issue)}`,
      configured: ROADMAP_NUMBER,
      gh: board.gh,
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([]);
    expect(result).toMatchObject({ status: 'ticked', ticked: [issue] });
  }

  /** Walks `--next` over `board`'s roadmap, in a scratch root of its own, removed after. */
  async function walkNext(board: ReturnType<typeof sharedBoard>): Promise<Awaited<ReturnType<typeof resolvePlanSpec>>> {
    const root = mkdtempSync(join(tmpdir(), 'rafa-tick-walk-'));
    try {
      return await resolvePlanSpec({
        request: { kind: 'next', roadmap: null },
        refresh: false,
        dryRun: false,
        repoRoot: root,
        specsDir: SPECS_DIR,
        roadmapIssue: ROADMAP_NUMBER,
        trustedAuthors: [],
        findSpec: (spec) => spec,
        gh: board.gh,
        git: noBranches(),
        output: sinkOutput({}),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('ticks the line the merged pull request closes, which the next walk then reads as done and skips', async () => {
    const board = freshBoard();

    await tick(board, 20);
    expect(board.roadmapBody()).toBe('- [x] #20 plans from the board\n- [ ] #33 the board setup\n');

    const resolved = await walkNext(board);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'next', issue: 33 });
  });

  it('reports the roadmap exhausted once a second merge ticks the last undone line', async () => {
    const board = freshBoard();

    await tick(board, 20);
    await tick(board, 33);
    expect(board.roadmapBody()).toBe('- [x] #20 plans from the board\n- [x] #33 the board setup\n');

    const resolved = await walkNext(board);
    expect(resolved).toEqual({ outcome: 'stopped', reason: 'exhausted' });
  });
});


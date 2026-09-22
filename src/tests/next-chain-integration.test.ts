/**
 * A scratch-repository suite driving `rafa next` end to end, over a real
 * git repository with a bare remote standing in for GitHub: from the
 * same green open pull request, every case here runs one `rafa next`
 * invocation of its own — the full chain to a started loop, a `--yes`
 * ceiling that stops short of it at each of the three costly steps, the
 * `ready` list refused before anything is read, and `--dry-run` at each
 * stage the chain passes through.
 *
 * `src/commands/next.test.ts` drives the chain's own logic over scripted
 * states and fakes, and `src/commands/pr/merge-driven.test.ts` drives
 * `pr merge`'s clean-up over a real repository the way this file borrows
 * from. Neither runs the THREE actions in sequence: this is the first
 * suite to walk `merge` → `plan` → `start` as one `rafa next` invocation
 * would, over a repository real enough that the base checkout, the
 * pull, both branch deletions and the branch `loop start` cuts are real
 * git rather than a scripted answer.
 *
 * `./next-chain-zero-checks-integration.test.ts` is this suite's
 * sibling: the same scratch-repository shape, over a pull request that
 * reports no check at all rather than the green one this file merges,
 * sharing `./next-chain-fixtures.ts` rather than this file's own
 * `plantScratch` and `buildProbe`, which are shaped for the plan-and-loop
 * chain neither its rows nor its cases reach.
 *
 * ## Why this runs as a spawned process
 *
 * `plan create`'s own board walk (`src/board/plan-spec.ts`) makes its
 * `gh` and `git` runners itself, unseamed from the command that wraps
 * `src/plan.ts` — the same reason `plan-board-integration.test.ts` runs
 * as a process rather than in this file's own. Worse, `src/plan.ts`
 * calls `requireNoticesAnswered()`, which reads `os.homedir()` directly:
 * driven in THIS process, that would read and write the operator's real
 * `~/.rafa/notices.json`, which is unacceptable for a suite that must
 * leave the machine it runs on untouched. So the chain is assembled and
 * run inside {@link buildProbe}, a small program written to
 * `<scratch>/probe.ts` and spawned with `HOME` pointed at a scratch
 * directory and `gh` (a stand-in) and `git` (the real binary) first on
 * its `PATH` — the two things `resolvePlanSpec` and `requireNoticesAnswered`
 * cannot be handed directly.
 *
 * ## The doubles, and the one shared log
 *
 * Every double the probe builds pushes one tag into a single `events`
 * array, written to a JSON record this file reads back once the process
 * ends, which is what lets one test assert the ORDER across pieces that
 * are otherwise unrelated seams:
 *
 *  - The pull request double ({@link createPullRequestsDouble}) answers
 *    `findOpen`, `get` and `checks` for the open pull request, and its
 *    `merge` answer pushes `"merge"` before answering merged.
 *  - The git seam wraps the real runner (`createGitRunner`): every
 *    call still runs for real, and every one is also pushed as
 *    `"git <args>"`, which is how the base checkout, the pull, both
 *    branch deletions and the branch `loop start` cuts from the pulled
 *    base all land in the one log, each in git's own words.
 *  - The planner adapter — the stand-in planner session `plan create`
 *    resolves in place of a real Claude Code session — pushes
 *    `"plan create"` before writing `PLAN-<stub>.md` itself.
 *  - `loop start` is replaced with a command that pushes nothing of its
 *    own UNTIL it has created the branch for real, through the actual
 *    `offerRunBranch` (`src/start/branch.ts`) over the same git seam —
 *    proving the branch really is cut from the base `pr merge` just
 *    pulled — and only then pushes `"loop start"`. No session is
 *    spawned: the chain only needs to know a loop WOULD have started.
 *
 * `pr merge` and `plan create` are the real registered commands, run
 * exactly as `rafa next`'s own action table would call them
 * (`src/next/actions.ts`); only their seams and, for `plan create`, the
 * planner adapter are replaced. The probe reads the words `rafa next`
 * runs with off its OWN `argv`, past the record path, rather than
 * hard-coding one ceiling: every case below is the same probe, spawned
 * with different words after `next`, so a `--yes` ceiling naming enough
 * of `merge`, `sync`, `plan` and `start` lets the chain run that far
 * unasked, and the one thing left to answer is the order the doubles
 * recorded them in and where the chain stopped.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { planStub } from '../board/naming.js';
import { DRY_RUN_FLAG } from '../commands/next.js';
import { BARE_YES_ACTIONS, CEILING_REFUSAL_EXIT, YES_FLAG } from '../next/ceiling.js';

import { plantProjectConfig } from './cli-capture.js';
import {
  BASE, CONFIG_TEXT, NEXT_ISSUE, NEXT_TITLE, OLD_BRANCH, PR_DETAIL, PR_NUMBER, PR_SUMMARY,
  type Scratch,
  SRC_DIR, git, makeTempBase, positionsOf, runProbe, writeStandInGh,
} from './next-chain-fixtures.js';

/** A temporary directory this file's own scratch repositories sit under. */
const tempBase = makeTempBase('rafa-next-chain-integration-');

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The stub `plan create --next` derives from {@link NEXT_ISSUE} and {@link NEXT_TITLE}. */
const NEW_STUB = planStub(NEXT_ISSUE, NEXT_TITLE);

/** The branch `loop start` cuts for {@link NEW_STUB}. */
const NEW_BRANCH = `feat/${NEW_STUB}`;

/** The roadmap issue's body: one undone line, naming {@link NEXT_ISSUE}. */
const ROADMAP_BODY = `- [ ] #${NEXT_ISSUE} — ${NEXT_TITLE}\n`;

/**
 * Writes a stand-in `claude` that fails loudly rather than run: nothing
 * this chain does should ever reach it, since the planner is replaced by
 * a fixture adapter and `loop start` by a double that spawns no session.
 */
function writeStandInClaude(bin: string): void {
  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', 'echo "the stand-in claude ran" >&2', 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/**
 * The probe: one program that composes `rafa next`, a real `pr merge`
 * and `plan create`, and a `loop start` double, over the doubles the
 * module note describes, and runs `rafa next` once with the words
 * {@link runProbe} hands it, its own `argv` past the record path. Every
 * ending — a clean run or a throw — writes the shared `events` log to
 * `recordPath`, its first command-line argument.
 */
function buildProbe(): string {
  return [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'registry.ts'))};`,
    `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
    `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
    `import { createNextCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'next.ts'))};`,
    `import { createPrMergeCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'pr', 'merge.ts'))};`,
    `import planCreateDeclared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
    `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
    `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
    `import { offerRunBranch } from ${JSON.stringify(join(SRC_DIR, 'start', 'branch.ts'))};`,
    `import { createGitRunner } from ${JSON.stringify(join(SRC_DIR, 'pr', 'index.ts'))};`,
    `import { createPullRequestsDouble } from ${JSON.stringify(join(SRC_DIR, 'pr', 'pull-requests-double.ts'))};`,
    `import { planStubFromPath } from ${JSON.stringify(join(SRC_DIR, 'utils', 'plan-stamp.ts'))};`,
    '',
    'const [recordPath, ...nextArgv] = process.argv.slice(2);',
    'const events = [];',
    '',
    `const BASE = ${JSON.stringify(BASE)};`,
    `const OLD_BRANCH = ${JSON.stringify(OLD_BRANCH)};`,
    '',
    '/** The real git runner, wrapped to push every call onto the shared log before running it. */',
    'function wrapGit(root) {',
    '  const real = createGitRunner(root);',
    '  return (args) => {',
    '    events.push("git " + args.join(" "));',
    '    return real(args);',
    '  };',
    '}',
    '',
    `const summary = ${JSON.stringify(PR_SUMMARY)};`,
    `const detail = ${JSON.stringify(PR_DETAIL)};`,
    '',
    'const prDouble = createPullRequestsDouble({',
    '  findOpen: (branch) => Promise.resolve(branch === OLD_BRANCH ? summary : null),',
    '  get: () => Promise.resolve(detail),',
    '  checks: () => Promise.resolve({ rows: [], verdict: "green" }),',
    '  merge: () => {',
    '    events.push("merge");',
    '    return Promise.resolve({ merged: true, detail: "Squashed and merged pull request" });',
    '  },',
    '});',
    '',
    '/** The stand-in planner session `plan create` resolves in place of a real Claude Code session. */',
    'const plannerRegistry = createAdapterRegistry([{',
    '  port: "planner",',
    '  kind: "claude",',
    '  portVersion: 1,',
    '  create: (context) => ({',
    '    create: async (request) => {',
    '      events.push("plan create");',
    '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
    '      mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
    '      writeFileSync(',
    '        join(context.repoRoot, planPath),',
    '        "# Plan\\n\\n```rafa:plan\\nstub: " + request.stub + "\\n```\\n\\n- [ ] one task\\n",',
    '      );',
    '      return { planPath, prerequisitesPath: null };',
    '    },',
    '  }),',
    '}]);',
    '',
    'const nextCommand = createNextCommand({',
    '  isTerminal: () => false,',
    '  openGit: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  openPrompter: () => {',
    '    throw new Error("rafa next opened a prompter: every case this suite drives either runs unasked or stops before asking");',
    '  },',
    '});',
    '',
    'const mergeCommand = createPrMergeCommand({',
    '  git: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  isTerminal: () => true,',
    '  openPrompter: () => {',
    '    throw new Error("pr merge should not ask: rafa next always passes --yes");',
    '  },',
    '});',
    '',
    'const planCommand = wrapPhaseZeroCommand(',
    '  planCreateDeclared,',
    '  (words, root) => plan(words, root, plannerRegistry),',
    ');',
    '',
    '/** A stand-in for rafa loop start: real branch creation, then one record, no session spawned. */',
    'const loopStartCommand = {',
    '  name: "loop start",',
    '  subject: "loop",',
    '  action: "start",',
    '  summary: "a stand-in that creates the branch for real and records the loop as started",',
    '  description: "Creates the plan branch through the real offerRunBranch over the pulled base, then records the loop as started without spawning a session.",',
    '  args: [],',
    '  flags: [',
    '    { name: "plan", description: "the plan file", type: "string" },',
    '    { name: "create-branch", description: "creates the branch", type: "boolean" },',
    '  ],',
    '  examples: [{ cmd: "rafa loop start --plan=P.md --create-branch", note: "records it" }],',
    '  outputs: ["text"],',
    '  run: async (context) => {',
    '    const planPath = String(context.flags.plan || "");',
    '    const stub = planStubFromPath(planPath);',
    '    if (stub === null) throw new Error("the stand-in loop start read no stub from " + planPath);',
    '    const outcome = await offerRunBranch(',
    '      { repoRoot: context.project.root, planStub: stub, base: BASE, anyBranch: false, createBranch: true },',
    '      { git: wrapGit, isTerminal: () => false },',
    '    );',
    '    if (outcome.kind !== "moved") {',
    '      throw new Error("the stand-in loop start could not create the branch: " + outcome.kind);',
    '    }',
    '    events.push("loop start");',
    '  },',
    '};',
    '',
    'const commands = createCommandRegistry({',
    '  subjects: [',
    '    { name: "pr", summary: "pull requests" },',
    '    { name: "plan", summary: "plans" },',
    '    { name: "loop", summary: "the loop" },',
    '  ],',
    '  commands: [nextCommand, mergeCommand, planCommand, loopStartCommand],',
    '});',
    '',
    'let outcome = { ok: false };',
    'try {',
    '  const result = await dispatch(["next", ...nextArgv], { registry: commands });',
    '  outcome = { ok: result.exitCode === 0, exitCode: result.exitCode, result: result.result };',
    '} catch (error) {',
    '  outcome = { ok: false, error: String((error && error.message) || error) };',
    '} finally {',
    '  writeFileSync(recordPath, JSON.stringify({ events, outcome }));',
    '}',
    '',
  ].join('\n');
}

/**
 * Plants a work tree on {@link BASE} with one commit, pushed to a bare
 * `origin.git` beside it, then {@link OLD_BRANCH} off it with one more
 * commit, pushed too and left checked out — the ordinary shape of an
 * operator about to merge their own feature branch, exactly as
 * `merge-driven.test.ts` plants it.
 */
function plantScratch(): Scratch {
  const root = mkdtempSync(join(tempBase, 'repo-'));
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  expect(git(root, home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare).ok).toBe(true);
  expect(git(root, home, 'init', '-q', `--initial-branch=${BASE}`, work).ok).toBe(true);
  // `.rafa/` is ignored from the first commit, so planting the project's
  // config, the spec snapshot and the plan after never dirties the tree.
  writeFileSync(join(work, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(work, 'README.md'), 'a scratch repository for the next chain suite\n', 'utf8');
  expect(git(work, home, 'add', '.gitignore', 'README.md').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'first').ok).toBe(true);
  expect(git(work, home, 'remote', 'add', 'origin', bare).ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', BASE).ok).toBe(true);
  expect(git(work, home, 'switch', '-q', '-c', OLD_BRANCH).ok).toBe(true);
  writeFileSync(join(work, 'feature.txt'), 'a feature\n', 'utf8');
  expect(git(work, home, 'add', 'feature.txt').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'feature').ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', OLD_BRANCH).ok).toBe(true);
  plantProjectConfig(work, CONFIG_TEXT);

  writeStandInGh(bin, ROADMAP_BODY);
  writeStandInClaude(bin);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(gitBinary)].join(delimiter);

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, buildProbe(), 'utf8');

  return { root, work, home, probe, path };
}

/** What a run that changes nothing must leave exactly as it found it. */
interface RepoSnapshot {
  /** The branch, or detached commit, the work tree sits on. */
  readonly head: string;
  /** Whether {@link OLD_BRANCH} still exists in the work tree. */
  readonly oldBranchLocal: boolean;
  /** Whether {@link OLD_BRANCH} still exists on the bare remote. */
  readonly oldBranchRemote: boolean;
  /** Whether {@link NEW_BRANCH} has been cut in the work tree. */
  readonly newBranchLocal: boolean;
  /** Whether the plan {@link NEW_STUB} names has been written. */
  readonly planExists: boolean;
}

/** Reads off real git and the filesystem what {@link RepoSnapshot} names, never off a probe's own log. */
function snapshotOf(scratch: Scratch): RepoSnapshot {
  return {
    head: git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout,
    oldBranchLocal: git(scratch.work, scratch.home, 'branch', '--list', OLD_BRANCH).stdout !== '',
    oldBranchRemote: git(join(scratch.root, 'origin.git'), scratch.home, 'show-ref', '--verify', `refs/heads/${OLD_BRANCH}`).ok,
    newBranchLocal: git(scratch.work, scratch.home, 'branch', '--list', NEW_BRANCH).stdout !== '',
    planExists: existsSync(join(scratch.work, '.rafa', 'plans', `PLAN-${NEW_STUB}.md`)),
  };
}

describe('rafa next, over a real repository from a green pull request to a started loop', () => {
  it('records the merge, the base checkout and pull, both branch deletions, the plan creation, the branch creation from the pulled base and the loop start, in that order', () => {
    const scratch = plantScratch();
    const { record } = runProbe(scratch, ['--yes=merge,plan,start']);

    if (!record.outcome.ok) {
      throw new Error(`the chain did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }

    // The order the task names: the merge, the base checkout, the pull,
    // both branch deletions, the plan creation, the branch creation from
    // the pulled base, then the loop start.
    const markers = [
      'merge',
      `git switch ${BASE}`,
      'git pull --ff-only',
      `git branch -D ${OLD_BRANCH}`,
      `git push origin --delete ${OLD_BRANCH}`,
      'plan create',
      `git switch -c ${NEW_BRANCH}`,
      'loop start',
    ];
    const positions = positionsOf(record.events, markers);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(new Set(positions).size).toBe(positions.length);

    // Read off real git, not the log: the branch really moved, the old
    // one is really gone on both sides, and the plan the fixture wrote
    // is really on disk.
    expect(git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(NEW_BRANCH);
    expect(git(scratch.work, scratch.home, 'branch', '--list', OLD_BRANCH).stdout).toBe('');
    expect(git(join(scratch.root, 'origin.git'), scratch.home, 'show-ref', '--verify', `refs/heads/${OLD_BRANCH}`).ok).toBe(false);
    expect(git(scratch.work, scratch.home, 'rev-parse', NEW_BRANCH).stdout)
      .toBe(git(scratch.work, scratch.home, 'rev-parse', `origin/${BASE}`).stdout);
    expect(existsSync(join(scratch.work, '.rafa', 'plans', `PLAN-${NEW_STUB}.md`))).toBe(true);
  }, 30_000);
});

describe('rafa next --yes, over the same repository, at each ceiling this suite names', () => {
  it('prints the merge proposal and merges nothing under bare --yes, which allows sync, wait, unblock and plan but not merge', () => {
    const scratch = plantScratch();
    const before = snapshotOf(scratch);

    const { record, stdout } = runProbe(scratch, ['--yes']);

    if (!record.outcome.ok) {
      throw new Error(`bare --yes did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }
    // Nothing the merge, the plan or the loop would have logged ran.
    expect(record.events.includes('merge')).toBe(false);
    expect(record.events.includes('plan create')).toBe(false);
    expect(record.events.includes('loop start')).toBe(false);

    expect(stdout).toContain(`👉 merge #${PR_NUMBER} into \`${BASE}\``);
    expect(stdout).toContain(`--${YES_FLAG} allows ${BARE_YES_ACTIONS.join(', ')}, and this step is merge, so nothing ran`);

    expect(snapshotOf(scratch)).toEqual(before);
  }, 30_000);

  it('merges and creates the next plan, then stops before starting the loop under --yes=merge,sync,plan', () => {
    const scratch = plantScratch();
    const { record, stdout } = runProbe(scratch, ['--yes=merge,sync,plan']);

    if (!record.outcome.ok) {
      throw new Error(`the chain did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }

    // The merge and its clean-up, then the plan, land in this order;
    // `sync` is allowed too but never asked for, since the base this
    // scratch pulls to is never behind its own remote.
    const markers = [
      'merge',
      `git switch ${BASE}`,
      'git pull --ff-only',
      `git branch -D ${OLD_BRANCH}`,
      `git push origin --delete ${OLD_BRANCH}`,
      'plan create',
    ];
    const positions = positionsOf(record.events, markers);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));

    // The loop is `start`, which this ceiling leaves out: nothing of its
    // own ran, and the branch it would have cut was never cut.
    expect(record.events.includes('loop start')).toBe(false);
    expect(record.events.some((event) => event.startsWith(`git switch -c ${NEW_BRANCH}`))).toBe(false);
    expect(stdout).toContain(`start the loop on \`${NEW_STUB}\`, creating its branch`);

    expect(git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(BASE);
    expect(existsSync(join(scratch.work, '.rafa', 'plans', `PLAN-${NEW_STUB}.md`))).toBe(true);
  }, 30_000);

  it('runs the full chain to a started loop under --yes=merge,sync,plan,start', () => {
    const scratch = plantScratch();
    const { record } = runProbe(scratch, ['--yes=merge,sync,plan,start']);

    if (!record.outcome.ok) {
      throw new Error(`the chain did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }

    const markers = [
      'merge',
      `git switch ${BASE}`,
      'git pull --ff-only',
      `git branch -D ${OLD_BRANCH}`,
      `git push origin --delete ${OLD_BRANCH}`,
      'plan create',
      `git switch -c ${NEW_BRANCH}`,
      'loop start',
    ];
    const positions = positionsOf(record.events, markers);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(new Set(positions).size).toBe(positions.length);

    expect(git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(NEW_BRANCH);
    expect(git(scratch.work, scratch.home, 'branch', '--list', OLD_BRANCH).stdout).toBe('');
    expect(git(join(scratch.root, 'origin.git'), scratch.home, 'show-ref', '--verify', `refs/heads/${OLD_BRANCH}`).ok).toBe(false);
    expect(existsSync(join(scratch.work, '.rafa', 'plans', `PLAN-${NEW_STUB}.md`))).toBe(true);
  }, 30_000);

  it('refuses --yes=ready with exit code 2, reading and changing nothing', () => {
    const scratch = plantScratch();
    const before = snapshotOf(scratch);

    const { record, stderr } = runProbe(scratch, ['--yes=ready']);

    expect(record.outcome.ok).toBe(false);
    expect(record.outcome.exitCode).toBe(CEILING_REFUSAL_EXIT);
    // Refused before the sources are even opened: no git call at all, real or read-only.
    expect(record.events).toEqual([]);
    expect(stderr).toContain('which no list runs unasked');

    expect(snapshotOf(scratch)).toEqual(before);
  }, 30_000);

  it('refuses --yes=merge-unchecked with exit code 2, reading and changing nothing', () => {
    const scratch = plantScratch();
    const before = snapshotOf(scratch);

    const { record, stderr } = runProbe(scratch, ['--yes=merge-unchecked']);

    expect(record.outcome.ok).toBe(false);
    expect(record.outcome.exitCode).toBe(CEILING_REFUSAL_EXIT);
    // Refused before the sources are even opened: no git call at all, real or read-only.
    expect(record.events).toEqual([]);
    expect(stderr).toContain('which no list runs unasked');

    expect(snapshotOf(scratch)).toEqual(before);
  }, 30_000);
});

/**
 * One stage the chain above passes through: `advance` is the `--yes`
 * list {@link runProbe} runs first to reach it, or null for the
 * pristine start, `readingContains` and `proposalContains` are
 * substrings of the two lines a fresh `rafa next` reads there, and
 * `expected` is what the repository looks like once it has, which a
 * `--dry-run` run afterward must leave exactly as found.
 */
type DryRunStage = readonly [
  name: string,
  advance: readonly string[] | null,
  readingContains: string,
  proposalContains: string,
  expected: RepoSnapshot,
];

const DRY_RUN_STAGES: readonly DryRunStage[] = [
  [
    'a green pull request, before anything has merged',
    null,
    `#${PR_NUMBER} is open on \`${OLD_BRANCH}\`, green and merges into \`${BASE}\``,
    `merge #${PR_NUMBER} into \`${BASE}\``,
    { head: OLD_BRANCH, oldBranchLocal: true, oldBranchRemote: true, newBranchLocal: false, planExists: false },
  ],
  [
    'the next plan, after the pull request has merged',
    ['--yes=merge'],
    `#${NEXT_ISSUE} is next on the roadmap and carries`,
    `create the plan for #${NEXT_ISSUE}`,
    { head: BASE, oldBranchLocal: false, oldBranchRemote: false, newBranchLocal: false, planExists: false },
  ],
  [
    'the loop, after the plan has been created',
    ['--yes=merge,plan'],
    `\`${NEW_STUB}\` is planned, with no run and no branch`,
    `start the loop on \`${NEW_STUB}\`, creating its branch`,
    { head: BASE, oldBranchLocal: false, oldBranchRemote: false, newBranchLocal: false, planExists: true },
  ],
];

describe('rafa next --dry-run, over the same repository, at every stage the chain passes through', () => {
  it.each(DRY_RUN_STAGES)('prints the two lines for %s, and changes nothing', (_name, advance, readingContains, proposalContains, expected) => {
    const scratch = plantScratch();
    if (advance !== null) {
      const setup = runProbe(scratch, advance, 'advance.json');
      if (!setup.record.outcome.ok) {
        throw new Error(`the fixture did not reach that stage: ${JSON.stringify(setup.record.outcome)}`);
      }
    }
    expect(snapshotOf(scratch)).toEqual(expected);

    const { record, stdout } = runProbe(scratch, ['--dry-run'], 'dry-run.json');

    if (!record.outcome.ok) {
      throw new Error(`--dry-run did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }
    // Every git call the read made was read-only: nothing the merge, the
    // plan or the loop would have logged is among them.
    expect(record.events.every((event) => event.startsWith('git '))).toBe(true);

    expect(stdout).toContain(readingContains);
    expect(stdout).toContain(proposalContains);
    expect(stdout).toContain(`⏹ --${DRY_RUN_FLAG}: nothing ran.`);

    expect(snapshotOf(scratch)).toEqual(expected);
  }, 30_000);
});

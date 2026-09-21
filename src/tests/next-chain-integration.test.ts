/**
 * A scratch-repository suite driving `rafa next` end to end, over a real
 * git repository with a bare remote standing in for GitHub: from a green
 * open pull request, through its merge, the next plan and a started
 * loop, in one chain.
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
 * planner adapter are replaced. A `--yes=merge,plan,start` ceiling lets
 * the chain run all three unasked, so the one thing left to answer is
 * the order the doubles recorded them in.
 */
import type { PullRequestDetail, PullRequestSummary } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { planStub } from '../board/naming.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';

import { plantProjectConfig } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's directory, `src/tests/`, one level under every module the probe imports. */
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** `src/`, where every module the probe imports lives. */
const SRC_DIR = join(TESTS_DIR, '..');

/** A temporary directory this file's own scratch repositories sit under. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-chain-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch of the scratch repository. */
const BASE = 'main';

/** The open pull request's head branch, merged and deleted by this chain. */
const OLD_BRANCH = 'feat/rafa-63';

/** The pull request number every double answers for. */
const PR_NUMBER = 41;

/** The roadmap issue `rafa next` and `plan create --next` both resolve. */
const ROADMAP_ISSUE = 31;

/** The one undone roadmap line, and the issue `plan create` plans from. */
const NEXT_ISSUE = 64;

/** The login every planted issue is authored by, trusted through the permission stand-in. */
const AUTHOR_LOGIN = 'octocat';

/** The next issue's title, short enough that every word survives the slug. */
const NEXT_TITLE = 'Ship next feature';

/** The stub `plan create --next` derives from {@link NEXT_ISSUE} and {@link NEXT_TITLE}. */
const NEW_STUB = planStub(NEXT_ISSUE, NEXT_TITLE);

/** The branch `loop start` cuts for {@link NEW_STUB}. */
const NEW_BRANCH = `feat/${NEW_STUB}`;

/** The project config: a GitHub provider so no origin remote needs probing, and the roadmap issue. */
const CONFIG_TEXT = [
  'pr:',
  '  provider: gh',
  `  base: ${BASE}`,
  'roadmap:',
  `  issue: ${ROADMAP_ISSUE}`,
  '',
].join('\n');

/** The roadmap issue's body: one undone line, naming {@link NEXT_ISSUE}. */
const ROADMAP_BODY = `- [ ] #${NEXT_ISSUE} — ${NEXT_TITLE}\n`;

/** Runs real git in `cwd`, isolated from the operator's real HOME; see `merge-driven.test.ts`'s own. */
function git(cwd: string, home: string, ...args: readonly string[]): { readonly ok: boolean; readonly stdout: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      LC_ALL: 'C',
    },
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

/** A pull request summary the double answers `findOpen` with, on {@link OLD_BRANCH}. */
const PR_SUMMARY: PullRequestSummary = Object.freeze({
  number: PR_NUMBER,
  title: 'rafa-63: the open pull request this suite merges',
  url: `https://example.invalid/pull/${PR_NUMBER}`,
  state: 'open',
  headRefName: OLD_BRANCH,
  baseRefName: BASE,
  author: { login: AUTHOR_LOGIN, isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-22T11:00:00Z',
});

/** The detail the double answers `get` with: green, mergeable, and closing nothing on the roadmap. */
const PR_DETAIL: PullRequestDetail = Object.freeze({
  ...PR_SUMMARY,
  body: '',
  headRefOid: 'abc1234',
  mergeable: 'mergeable',
  mergeStateStatus: 'CLEAN',
  labels: [],
});

/** A JSON payload quoted for a single-quoted shell string; `plan-board-integration.test.ts`'s own. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/**
 * Writes the stand-in `gh` this suite's `PATH` resolves to: the roadmap
 * issue, the next issue, the collaborator permission both are trusted
 * through, and an empty `pr list`/`issue list` for the walk's other
 * reads. Anything else fails loudly, naming what it was asked.
 */
function writeStandInGh(bin: string): void {
  const roadmapIssue = {
    number: ROADMAP_ISSUE,
    title: 'Roadmap',
    body: ROADMAP_BODY,
    state: 'OPEN',
    labels: [],
    author: { login: AUTHOR_LOGIN },
  };
  const nextIssue = {
    number: NEXT_ISSUE,
    title: NEXT_TITLE,
    body: completeSpecBody(NEXT_TITLE),
    state: 'OPEN',
    labels: [{ name: SPEC_LABEL }, { name: SPEC_READY_LABEL }],
    author: { login: AUTHOR_LOGIN },
  };
  const lines = [
    '#!/bin/sh',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${ROADMAP_ISSUE}" ]; then`,
    `  printf '%s' '${shellQuoted(roadmapIssue)}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${NEXT_ISSUE}" ]; then`,
    `  printf '%s' '${shellQuoted(nextIssue)}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/${AUTHOR_LOGIN}/permission" ]; then`,
    `  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ];
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

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
 * module note describes, and runs `rafa next --yes=merge,plan,start`
 * once. Every ending — a clean run or a throw — writes the shared
 * `events` log to `recordPath`, its first command-line argument.
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
    'const [recordPath] = process.argv.slice(2);',
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
    '    throw new Error("rafa next should run unasked under --yes=merge,plan,start");',
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
    '  const result = await dispatch(["next", "--yes=merge,plan,start"], { registry: commands });',
    '  outcome = { ok: result.exitCode === 0, exitCode: result.exitCode, result: result.result };',
    '} catch (error) {',
    '  outcome = { ok: false, error: String((error && error.message) || error) };',
    '} finally {',
    '  writeFileSync(recordPath, JSON.stringify({ events, outcome }));',
    '}',
    '',
  ].join('\n');
}

/** A scratch repository, its bare remote, and the process it is driven through. */
interface Scratch {
  /** Where everything for one case sits. */
  readonly root: string;
  /** The work tree, checked out on {@link OLD_BRANCH}, which the probe dispatches over. */
  readonly work: string;
  /** The HOME the probe runs under. */
  readonly home: string;
  /** The probe script, ready to spawn. */
  readonly probe: string;
  /** The PATH the probe runs under: its own `bin/`, then git's real directory. */
  readonly path: string;
}

/**
 * Plants a work tree on {@link BASE} with one commit, pushed to a bare
 * `origin.git` beside it, then {@link OLD_BRANCH} off it with one more
 * commit, pushed too and left checked out — the ordinary shape of an
 * operator about to merge their own feature branch, exactly as
 * `merge-driven.test.ts` plants it.
 */
function plantScratch(): Scratch {
  const root = realpathSync(mkdtempSync(join(tempBase, 'repo-')));
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

  writeStandInGh(bin);
  writeStandInClaude(bin);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(gitBinary)].join(delimiter);

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, buildProbe(), 'utf8');

  return { root, work, home, probe, path };
}

/** What the probe recorded: the shared log, and how the chain ended. */
interface ProbeRecord {
  readonly events: readonly string[];
  readonly outcome: {
    readonly ok: boolean;
    readonly exitCode?: number;
    readonly error?: string;
  };
}

/** The index every `needle` is found at in `haystack`, in the order given; `-1` for a miss. */
function positionsOf(haystack: readonly string[], needles: readonly string[]): readonly number[] {
  return needles.map((needle) => haystack.indexOf(needle));
}

describe('rafa next, over a real repository from a green pull request to a started loop', () => {
  it('records the merge, the base checkout and pull, both branch deletions, the plan creation, the branch creation from the pulled base and the loop start, in that order', () => {
    const scratch = plantScratch();
    const recordPath = join(scratch.root, 'record.json');

    const proc = Bun.spawnSync([process.execPath, scratch.probe, recordPath], {
      cwd: scratch.work,
      env: { PATH: scratch.path, HOME: scratch.home, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' },
    });

    if (proc.exitCode !== 0 || !existsSync(recordPath)) {
      throw new Error(
        `the probe exited ${String(proc.exitCode)}\nstdout:\n${proc.stdout.toString()}\nstderr:\n${proc.stderr.toString()}`,
      );
    }
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as ProbeRecord;

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

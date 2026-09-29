/**
 * Tests for `start/worktree.ts`: the worktree a loop runs in, added at
 * `loop.worktreeDir/<stub>` on `feat/<stub>` without touching the main
 * checkout.
 *
 * Most cases drive the runner over a stubbed `GitRunner` that answers
 * from a table keyed by the argv after `git` and records every command.
 * A command the table has no reply for THROWS, so a run that spawns
 * something no case planned for reddens rather than passing on an empty
 * result. Every case varies one axis of `CLEAN`, and each refusal sits
 * beside the clean run it was varied from, so a runner that refused
 * everything and one that refused nothing both redden.
 *
 * The last block runs the same function against a real repository under
 * the temporary directory — a bare remote and its clone — so the argv
 * the table assumes is proven to be argv git accepts, and the path a
 * refusal names is the one git itself lists. The stubbed fixtures are
 * what git 2.50.1 (Apple Git-155) wrote under `LC_ALL=C` on 2026-09-29.
 *
 * The active output is module state and bun runs every test file in one
 * process, so each case sets a sink and the last one sets it back.
 */
import type { WorktreeOutcome, WorktreeRequest } from './worktree.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { addRunWorktree, holderOf, worktreePathFor, worktreeSteps } from './worktree.js';

/** The plan every stubbed case runs. */
const STUB = 'rafa-370';

/** The branch that stub names. */
const BRANCH = `feat/${STUB}`;

/** The base every case cuts from. */
const BASE = 'main';

/** A project root that is not the working directory the suite runs in. */
const ROOT = join('/', 'nonesuch', 'project');

/** Where the default `loop.worktreeDir` puts the stubbed plan's worktree. */
const PATH = join(ROOT, '.rafa', 'worktrees', STUB);

/** A checkout elsewhere that holds the plan's branch in the stubbed listing. */
const ELSEWHERE = join('/', 'nonesuch', 'other-tree');

/** git exited 0, having written `stdout`. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** git exited nonzero, having written `stderr`. */
function failed(stderr = ''): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** The show-ref command that reads the plan's branch locally. */
const LOCAL_READ = `show-ref --verify --quiet refs/heads/${BRANCH}`;

/** The show-ref command that reads the plan's branch on the remote-tracking side. */
const REMOTE_READ = `show-ref --verify --quiet refs/remotes/origin/${BRANCH}`;

/** The add the create route runs: a new branch cut from the fetched base, tracking nothing. */
const CREATE_ADD = `worktree add --no-track -b ${BRANCH} ${PATH} origin/${BASE}`;

/** The add the switch-local route runs. */
const LOCAL_ADD = `worktree add ${PATH} ${BRANCH}`;

/** The add the switch-remote route runs. */
const REMOTE_ADD = `worktree add --track -b ${BRANCH} ${PATH} origin/${BRANCH}`;

/** The listing command a failed add reads. */
const LIST = 'worktree list --porcelain';

/** A listing in which the main checkout holds `main` and a second checkout holds the plan's branch. */
const HELD_ELSEWHERE = [
  `worktree ${ROOT}`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${ELSEWHERE}`,
  'HEAD 2222222222222222222222222222222222222222',
  `branch refs/heads/${BRANCH}`,
  '',
].join('\n');

/** What git wrote when the branch was held by another worktree; see the module note. */
const HELD_SAID = `Preparing worktree (checking out '${BRANCH}')\n`
  + `fatal: '${BRANCH}' is already used by worktree at '${ELSEWHERE}'\n`;

/** What a stubbed git answers, keyed by the argv after `git`, joined by spaces. */
type GitReplies = Readonly<Record<string, GitResult>>;

/** The world every stubbed case varies: no branch anywhere, every step exiting 0. */
const CLEAN: GitReplies = {
  [LOCAL_READ]: failed(),
  [REMOTE_READ]: failed(),
  'fetch origin main': ok(),
  [CREATE_ADD]: ok(),
  [LOCAL_ADD]: ok(),
  [REMOTE_ADD]: ok(),
  [LIST]: ok(`worktree ${ROOT}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\n`),
};

/** A stubbed git, the roots it was made for and the commands it was given. */
interface World {
  readonly git: (root: string) => GitRunner;
  readonly roots: readonly string[];
  readonly ran: readonly string[];
}

/** {@link CLEAN} with `over` laid over it; an unplanned command throws. See the file note. */
function world(over: GitReplies = {}): World {
  const replies: GitReplies = { ...CLEAN, ...over };
  const ran: string[] = [];
  const roots: string[] = [];
  return {
    ran,
    roots,
    git: (root) => {
      roots.push(root);
      return (args) => {
        const key = args.join(' ');
        ran.push(key);
        const reply = replies[key];
        if (reply === undefined) throw new Error(`the stub has no reply for git ${key}`);
        return reply;
      };
    },
  };
}

/** A worktree for the plan under the default `loop.worktreeDir`; `over` varies one axis. */
function request(over: Partial<WorktreeRequest> = {}): WorktreeRequest {
  return {
    projectRoot: ROOT,
    worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
    planStub: STUB,
    base: BASE,
    ...over,
  };
}

/** What a run refused with, throwing when it did not refuse. */
function refusalOf(run: () => WorktreeOutcome): { exitCode: number; message: string } {
  try {
    const outcome = run();
    throw new Error(`expected a refusal, got a worktree at ${outcome.path}`);
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    return { exitCode: error.exitCode, message: error.message };
  }
}

/** The lines the case under way wrote through the active output. */
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(message);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

describe('worktreePathFor', () => {
  it('puts the worktree under loop.worktreeDir, read from the project root, named by the stub', () => {
    expect(worktreePathFor(ROOT, CONFIG_DEFAULTS.loopWorktreeDir, STUB)).toBe(PATH);
    expect(worktreePathFor(ROOT, join('..', 'trees'), STUB)).toBe(join('/', 'nonesuch', 'trees', STUB));
  });
});

describe('worktreeSteps', () => {
  const plan = { branch: BRANCH, base: BASE };

  it('fetches the base, then adds a new untracked branch from origin/<base> on create', () => {
    const argv = worktreeSteps('create', plan, PATH).map((step) => step.argv.join(' '));

    expect(argv).toEqual([`git fetch origin ${BASE}`, `git ${CREATE_ADD}`]);
  });

  it('fetches nothing for a branch that already exists, local or remote', () => {
    expect(worktreeSteps('switch-local', plan, PATH).map((step) => step.argv.join(' '))).toEqual([`git ${LOCAL_ADD}`]);
    expect(worktreeSteps('switch-remote', plan, PATH).map((step) => step.argv.join(' '))).toEqual([`git ${REMOTE_ADD}`]);
  });
});

describe('holderOf', () => {
  it('names the checkout holding the branch, and whether it is the main one', () => {
    const listing = [
      { path: ROOT, branch: 'main' },
      { path: ELSEWHERE, branch: BRANCH },
    ];

    expect(holderOf(listing, BRANCH)).toEqual({ path: ELSEWHERE, main: false });
    expect(holderOf(listing, 'main')).toEqual({ path: ROOT, main: true });
    expect(holderOf(listing, 'feat/nobody')).toBeNull();
  });
});

describe('addRunWorktree over a stubbed git', () => {
  it('creates the branch from the latest origin/<base> in the project root, touching nothing else', () => {
    const git = world();
    const outcome = addRunWorktree(request(), { git: git.git });

    expect(outcome).toEqual({
      branch: BRANCH,
      path: PATH,
      route: 'create',
      steps: worktreeSteps('create', { branch: BRANCH, base: BASE }, PATH),
    });
    expect(git.roots).toEqual([ROOT]);
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'fetch origin main', CREATE_ADD]);
    expect(lines.at(-1)).toBe(`   The run is on ${BRANCH} in ${PATH}.`);
  });

  it('never runs a command that moves the main checkout', () => {
    const git = world();
    addRunWorktree(request(), { git: git.git });

    const moves = git.ran.filter((command) => /^(switch|checkout|merge|reset|pull)\b/.test(command));
    expect(git.ran.length).toBeGreaterThan(0);
    expect(moves).toEqual([]);
  });

  it('adds the worktree on the existing local branch without fetching', () => {
    const git = world({ [LOCAL_READ]: ok(), [REMOTE_READ]: ok() });
    const outcome = addRunWorktree(request(), { git: git.git });

    expect(outcome.route).toBe('switch-local');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, LOCAL_ADD]);
  });

  it('tracks a branch only the remote has, without fetching', () => {
    const git = world({ [REMOTE_READ]: ok() });
    const outcome = addRunWorktree(request(), { git: git.git });

    expect(outcome.route).toBe('switch-remote');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, REMOTE_ADD]);
  });

  it('trims the stub, as the branch offer does', () => {
    const git = world();

    expect(addRunWorktree(request({ planStub: `  ${STUB} ` }), { git: git.git }).path).toBe(PATH);
  });

  it('refuses a plan with no stub before reaching git', () => {
    const git = world();
    const missing = refusalOf(() => addRunWorktree(request({ planStub: null }), { git: git.git }));
    const blank = refusalOf(() => addRunWorktree(request({ planStub: '  ' }), { git: git.git }));

    expect(missing.exitCode).toBe(1);
    expect(missing.message).toContain('plan with no stub');
    expect(blank.message).toBe(missing.message);
    expect(git.ran).toEqual([]);
  });

  it('names the other worktree\'s path when git refuses a branch checked out elsewhere', () => {
    const git = world({ [LOCAL_READ]: ok(), [LOCAL_ADD]: failed(HELD_SAID), [LIST]: ok(HELD_ELSEWHERE) });
    const refusal = refusalOf(() => addRunWorktree(request(), { git: git.git }));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(
      `❌ Refusing to add a worktree for ${BRANCH}: it is checked out in another worktree at ${ELSEWHERE}.`,
    );
    expect(refusal.message).toContain(`   fatal: '${BRANCH}' is already used by worktree at '${ELSEWHERE}'`);
    expect(refusal.message).toContain('The main checkout\'s branch and working tree were not touched.');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, LOCAL_ADD, LIST]);
  });

  it('says the main checkout when that is the one holding the branch', () => {
    const heldByMain = `worktree ${ROOT}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/${BRANCH}\n\n`;
    const git = world({ [LOCAL_READ]: ok(), [LOCAL_ADD]: failed(HELD_SAID), [LIST]: ok(heldByMain) });
    const refusal = refusalOf(() => addRunWorktree(request(), { git: git.git }));

    expect(refusal.message).toContain(`it is checked out in the main checkout at ${ROOT}.`);
  });

  it('names the failed step when no checkout holds the branch', () => {
    const said = `fatal: '${PATH}' already exists`;
    const git = world({ [LOCAL_READ]: ok(), [LOCAL_ADD]: failed(said) });
    const refusal = refusalOf(() => addRunWorktree(request(), { git: git.git }));

    expect(refusal.message).toContain(`❌ Could not add the worktree for ${BRANCH} at ${PATH}.`);
    expect(refusal.message).toContain(`   ${said}`);
    expect(refusal.message).not.toContain('checked out in');
  });

  it('refuses a failed fetch before adding anything, and reads no listing', () => {
    const said = 'fatal: couldn\'t find remote ref main';
    const git = world({ 'fetch origin main': failed(said) });
    const refusal = refusalOf(() => addRunWorktree(request(), { git: git.git }));

    expect(refusal.message).toContain(`❌ Could not fetch origin ${BASE}.`);
    expect(refusal.message).toContain(`Refusing to cut ${BRANCH} from a stale origin/${BASE}.`);
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'fetch origin main']);
  });
});

describe('addRunWorktree against a real repository', () => {
  let scratch = '';
  let project = '';

  /** Runs git in `cwd` with a fixed identity, under `LC_ALL=C`, and answers its trimmed stdout. */
  const run = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-')));
    const remote = join(scratch, 'remote.git');
    project = join(scratch, 'project');
    run(scratch, ['init', '-q', '--bare', remote]);
    run(scratch, ['init', '-q', '-b', 'main', project]);
    run(project, ['commit', '-q', '--allow-empty', '-m', 'one']);
    run(project, ['remote', 'add', 'origin', remote]);
    run(project, ['push', '-q', 'origin', 'main']);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('adds the worktree on a new untracked branch and leaves the main checkout where it was', () => {
    const outcome = addRunWorktree(request({ projectRoot: project, planStub: 'real' }));
    const path = join(project, '.rafa', 'worktrees', 'real');

    expect(outcome.path).toBe(path);
    expect(run(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feat/real');
    expect(run(path, ['rev-parse', 'HEAD'])).toBe(run(project, ['rev-parse', 'origin/main']));
    expect(run(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    expect(run(project, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
    expect(() => run(project, ['config', '--get', 'branch.feat/real.merge'])).toThrow();
  });

  it('names the path git lists when the branch is checked out elsewhere', () => {
    const elsewhere = join(scratch, 'elsewhere');
    run(project, ['worktree', 'add', '-q', '-b', 'feat/held', elsewhere, 'main']);
    const refusal = refusalOf(() => addRunWorktree(request({ projectRoot: project, planStub: 'held' })));

    expect(refusal.message).toContain(`checked out in another worktree at ${elsewhere}.`);
    expect(run(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  });

});

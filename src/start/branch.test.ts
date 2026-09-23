/**
 * Tests for the branch runner (`start/branch.ts`): what it reads off
 * git, when it asks, and which commands a yes actually spawns.
 *
 * The runner is driven over a stubbed `GitRunner` that answers from a
 * table keyed by the argv after `git` and records every command it was
 * given, and over a stubbed `Prompter` that records what it was asked
 * and counts its opens and closes. Two things follow, and both are the
 * point of the seams:
 *
 *  - A command the table has no reply for THROWS rather than defaulting,
 *    so a run that spawns something no case planned for reddens instead
 *    of passing quietly on an empty result.
 *  - The prompter every case gets by default throws when it is opened,
 *    so `asks nothing` is measured by the run completing rather than by
 *    an assertion that could have been left out.
 *
 * Every case varies one axis of `CLEAN` — a run on `main` with a
 * terminal, no flags, no `feat/rafa-49` anywhere and a clean tree — and
 * the refusals are asserted beside the clean run they were varied from,
 * so a runner that refused everything and one that refused nothing both
 * redden. The git fixtures are what git 2.50.1 (Apple Git-155) wrote
 * under `LC_ALL=C` in a clone of a bare remote on 2026-09-20.
 *
 * The active output is module state and bun runs every test file in one
 * process, so each case sets a sink and the last one sets it back.
 */
import type { BranchOutcome, BranchRequest, BranchSeams } from './branch.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { offerRunBranch } from './branch.js';

/** The plan every case runs. */
const STUB = 'rafa-49';

/** The branch that stub names. */
const BRANCH = `feat/${STUB}`;

/** The branch every case is started on. */
const BASE = 'main';

/** git exited 0, having written `stdout`. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** git exited nonzero, having written `stderr`. */
function failed(stderr = ''): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** What a stubbed git answers, keyed by the argv after `git`, joined by spaces. */
type GitReplies = Readonly<Record<string, GitResult>>;

/** The world every case varies: no branch anywhere, a clean tree, every step exiting 0. */
const CLEAN: GitReplies = {
  [`show-ref --verify --quiet refs/heads/${BRANCH}`]: failed(),
  [`show-ref --verify --quiet refs/remotes/origin/${BRANCH}`]: failed(),
  'status --porcelain': ok(),
  'fetch origin main': ok(),
  'rev-list --left-right --count main...origin/main': ok('0\t0\n'),
  'merge --ff-only origin/main': ok('Already up to date.\n'),
  [`switch -c ${BRANCH}`]: ok(),
  [`switch ${BRANCH}`]: ok(),
  [`switch --track origin/${BRANCH}`]: ok(),
};

/** The show-ref command that reads `feat/rafa-49` locally. */
const LOCAL_READ = `show-ref --verify --quiet refs/heads/${BRANCH}`;

/** The show-ref command that reads `feat/rafa-49` on the remote-tracking side. */
const REMOTE_READ = `show-ref --verify --quiet refs/remotes/origin/${BRANCH}`;

/** The four commands the create route spawns, in order. */
const CREATE_ROUTE: readonly string[] = [
  'fetch origin main',
  'rev-list --left-right --count main...origin/main',
  'merge --ff-only origin/main',
  `switch -c ${BRANCH}`,
];

/** A stubbed git and the commands it was given. */
interface World {
  readonly git: GitRunner;
  /** Every command run, as the argv after `git`, joined by spaces. */
  readonly ran: readonly string[];
}

/** {@link CLEAN} with `over` laid over it; an unplanned command throws. See the file note. */
function world(over: GitReplies = {}): World {
  const replies: GitReplies = { ...CLEAN, ...over };
  const ran: string[] = [];
  return {
    ran,
    git: (args) => {
      const key = args.join(' ');
      ran.push(key);
      const reply = replies[key];
      if (reply === undefined) throw new Error(`the stub has no reply for git ${key}`);
      return reply;
    },
  };
}

/** A prompter that writes nothing when it is told something. */
function saysNothing(): void {}

/** A stubbed prompter and what it was asked. */
interface StubPrompter {
  /** The `openPrompter` seam. */
  readonly open: () => Prompter;
  /** Every question asked, in order. */
  readonly asked: readonly string[];
  /** How many times it was opened and closed. */
  readonly counts: { opens: number; closes: number };
}

/** A prompter answering `answer` to every question; see the file note. */
function prompterAnswering(answer: string | null): StubPrompter {
  const asked: string[] = [];
  const counts = { opens: 0, closes: 0 };
  return {
    asked,
    counts,
    open: () => {
      counts.opens += 1;
      return {
        say: saysNothing,
        ask: (question: string) => {
          asked.push(question);
          return Promise.resolve(answer);
        },
        close: () => {
          counts.closes += 1;
        },
      };
    },
  };
}

/** The prompter a case gets unless it wants one: opening it is a failure. */
function neverOpened(): Prompter {
  throw new Error('the prompter was opened');
}

/** A run on the base with nothing in the way; `over` varies one axis. */
function request(over: Partial<BranchRequest> = {}): BranchRequest {
  return {
    repoRoot: '/nowhere',
    planStub: STUB,
    base: BASE,
    anyBranch: false,
    createBranch: false,
    ...over,
  };
}

/** A terminal, `git` over `world`, and a prompter nothing may open unless `over` gives one. */
function seamsOver(git: GitRunner, over: Partial<BranchSeams> = {}): BranchSeams {
  return { git: () => git, isTerminal: () => true, openPrompter: neverOpened, ...over };
}

/** The outcome as a move, throwing on any other reading; see `context/verification.md`. */
function moved(outcome: BranchOutcome): Extract<BranchOutcome, { kind: 'moved' }> {
  if (outcome.kind !== 'moved') throw new Error(`expected the run to have moved, got ${outcome.kind}`);
  return outcome;
}

/** The outcome as a declined offer, throwing on any other reading. */
function declined(outcome: BranchOutcome): Extract<BranchOutcome, { kind: 'declined' }> {
  if (outcome.kind !== 'declined') throw new Error(`expected a declined offer, got ${outcome.kind}`);
  return outcome;
}

/** Why the run was offered nothing, throwing on any other reading. */
function stoodAside(outcome: BranchOutcome): string {
  if (outcome.kind !== 'stood-aside') throw new Error(`expected no offer, got ${outcome.kind}`);
  return outcome.why;
}

/** What a run refused with, throwing when it did not refuse. */
async function refusalOf(run: Promise<BranchOutcome>): Promise<{ exitCode: number; message: string }> {
  try {
    const outcome = await run;
    throw new Error(`expected a refusal, got ${outcome.kind}`);
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
    warn: (message) => {
      lines.push(`warn:${message}`);
    },
    error: (message) => {
      lines.push(`error:${message}`);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

describe('a run that is offered nothing', () => {
  it('reads nothing at all off git under --any-branch', async () => {
    const git = world();
    const outcome = await offerRunBranch(request({ anyBranch: true }), seamsOver(git.git));

    expect(stoodAside(outcome)).toBe('any-branch');
    expect(git.ran).toEqual([]);
  });

  it('stands aside for --any-branch even when --create-branch is passed too', async () => {
    const git = world();
    const outcome = await offerRunBranch(
      request({ anyBranch: true, createBranch: true }),
      seamsOver(git.git),
    );

    expect(stoodAside(outcome)).toBe('any-branch');
    expect(git.ran).toEqual([]);
  });

  it('reads nothing off git when the plan gave no stub', async () => {
    const git = world();
    const missing = await offerRunBranch(request({ planStub: null }), seamsOver(git.git));
    const blank = await offerRunBranch(request({ planStub: '   ' }), seamsOver(git.git));

    expect(stoodAside(missing)).toBe('no-plan-stub');
    expect(stoodAside(blank)).toBe('no-plan-stub');
    expect(git.ran).toEqual([]);
  });

  it('stands aside with no terminal and no flag, having read the refs and asked nothing', async () => {
    const git = world();
    const outcome = await offerRunBranch(request(), seamsOver(git.git, { isTerminal: () => false }));

    expect(stoodAside(outcome)).toBe('no-terminal');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ]);
  });

  it('does ask the same run when there is a terminal', async () => {
    const git = world();
    const prompter = prompterAnswering('n');
    const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

    expect(declined(outcome).branch).toBe(BRANCH);
    expect(prompter.asked).toHaveLength(1);
  });
});

describe('the question', () => {
  it('offers to create the branch from the latest base, and creates it on yes', async () => {
    const git = world();
    const prompter = prompterAnswering('y');
    const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Create ${BRANCH} from the latest origin/${BASE} and run there? [y/N] `]);
    expect(moved(outcome).route).toBe('create');
    expect(moved(outcome).branch).toBe(BRANCH);
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain', ...CREATE_ROUTE]);
    expect(prompter.counts).toEqual({ opens: 1, closes: 1 });
  });

  it('offers to switch to a local branch, and fetches nothing on yes', async () => {
    const git = world({ [LOCAL_READ]: ok('') });
    const prompter = prompterAnswering('y');
    const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Switch to the existing ${BRANCH}? [y/N] `]);
    expect(moved(outcome).route).toBe('switch-local');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain', `switch ${BRANCH}`]);
  });

  it('checks out a remote-only branch tracking it, and fetches nothing', async () => {
    const git = world({ [REMOTE_READ]: ok('') });
    const prompter = prompterAnswering('y');
    const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Switch to the existing ${BRANCH}? [y/N] `]);
    expect(moved(outcome).route).toBe('switch-remote');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain', `switch --track origin/${BRANCH}`]);
  });

  it('takes the local branch when both refs are there', async () => {
    const git = world({ [LOCAL_READ]: ok(''), [REMOTE_READ]: ok('') });
    const prompter = prompterAnswering('y');
    const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

    expect(moved(outcome).route).toBe('switch-local');
    expect(git.ran).toContain(`switch ${BRANCH}`);
  });

  it('runs nothing and stays on the base when the answer is not yes', async () => {
    for (const answer of ['n', 'no', '', '  ', null]) {
      const git = world();
      const prompter = prompterAnswering(answer);
      const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

      expect(declined(outcome).route).toBe('create');
      expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ]);
      expect(prompter.counts).toEqual({ opens: 1, closes: 1 });
    }
    expect(lines).toContain(`Staying on ${BASE}.`);
  });

  it('reads a yes however it is typed', async () => {
    for (const answer of ['y', 'Y', ' yes ', 'YES']) {
      const git = world();
      const prompter = prompterAnswering(answer);
      const outcome = await offerRunBranch(request(), seamsOver(git.git, { openPrompter: prompter.open }));

      expect(moved(outcome).branch).toBe(BRANCH);
    }
  });
});

describe('--create-branch', () => {
  it('creates the branch with no terminal and opens no prompter', async () => {
    const git = world();
    const outcome = await offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git, { isTerminal: () => false }),
    );

    expect(moved(outcome).route).toBe('create');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain', ...CREATE_ROUTE]);
  });

  it('switches to an existing branch without asking', async () => {
    const git = world({ [LOCAL_READ]: ok('') });
    const outcome = await offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git, { isTerminal: () => false }),
    );

    expect(moved(outcome).route).toBe('switch-local');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain', `switch ${BRANCH}`]);
  });
});

describe('the working tree, read after the answer', () => {
  it('refuses a modified tracked file, naming it, before any step runs', async () => {
    const git = world({ 'status --porcelain': ok(' M a.txt\nA  "sp ace.txt"\n?? untracked.txt\n') });
    const refusal = await refusalOf(offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git),
    ));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(`Refusing to leave ${BASE} for ${BRANCH}`);
    expect(refusal.message).toContain('2 changes to tracked files');
    expect(refusal.message).toContain(' M a.txt');
    expect(refusal.message).not.toContain('untracked.txt');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain']);
  });

  it('moves over untracked files alone', async () => {
    const git = world({ 'status --porcelain': ok('?? untracked.txt\n') });
    const outcome = await offerRunBranch(request({ createBranch: true }), seamsOver(git.git));

    expect(moved(outcome).branch).toBe(BRANCH);
    expect(git.ran).toContain(`switch -c ${BRANCH}`);
  });

  it('refuses when the tree cannot be read at all, quoting git', async () => {
    const git = world({ 'status --porcelain': failed('fatal: not a git repository') });
    const refusal = await refusalOf(offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git),
    ));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain('Could not read the working tree');
    expect(refusal.message).toContain('fatal: not a git repository');
    expect(refusal.message).toContain(`The run is still on ${BASE}.`);
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain']);
  });
});

describe('the steps of the create route', () => {
  it('reports each one it ran and the branch it ended on', async () => {
    const git = world();
    await offerRunBranch(request({ createBranch: true }), seamsOver(git.git));

    expect(lines[0]).toContain(`Creating ${BRANCH} from the latest origin/${BASE}.`);
    expect(lines.join('\n')).toContain('fetch origin main: done');
    expect(lines.join('\n')).toContain(`create ${BRANCH} from ${BASE}: done`);
    expect(lines.at(-1)).toContain(`The run is on ${BRANCH}.`);
  });

  it('refuses a failed fetch before reading how the base stands', async () => {
    const git = world({
      'fetch origin main': failed('fatal: Could not read from remote repository.'),
    });
    const refusal = await refusalOf(offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git),
    ));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(`Refusing to create ${BRANCH} from a stale origin/${BASE}`);
    expect(refusal.message).toContain('fatal: Could not read from remote repository.');
    expect(git.ran).toEqual([LOCAL_READ, REMOTE_READ, 'status --porcelain', 'fetch origin main']);
  });

  it('refuses a diverged base before it tries to fast-forward it', async () => {
    const git = world({ 'rev-list --left-right --count main...origin/main': ok('1\t2\n') });
    const refusal = await refusalOf(offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git),
    ));

    expect(refusal.message).toContain(`${BASE} has diverged from origin/${BASE}`);
    expect(refusal.message).toContain('1 commit ahead of origin/main and 2 commits behind it');
    expect(git.ran).not.toContain('merge --ff-only origin/main');
    expect(git.ran).not.toContain(`switch -c ${BRANCH}`);
  });

  it('branches from a base that is only ahead of its remote', async () => {
    const git = world({ 'rev-list --left-right --count main...origin/main': ok('2\t0\n') });
    const outcome = await offerRunBranch(request({ createBranch: true }), seamsOver(git.git));

    expect(moved(outcome).branch).toBe(BRANCH);
    expect(git.ran).toContain('merge --ff-only origin/main');
  });

  it('refuses a fast-forward git would not do, creating nothing', async () => {
    const git = world({
      'merge --ff-only origin/main': failed('fatal: Not possible to fast-forward, aborting.'),
    });
    const refusal = await refusalOf(offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git),
    ));

    expect(refusal.message).toContain(`would not fast-forward to origin/${BASE}`);
    expect(refusal.message).toContain('fatal: Not possible to fast-forward, aborting.');
    expect(git.ran).not.toContain(`switch -c ${BRANCH}`);
  });

  it('refuses a checkout git would not do, naming the step', async () => {
    const git = world({
      [`switch -c ${BRANCH}`]: failed(`fatal: a branch named '${BRANCH}' already exists`),
    });
    const refusal = await refusalOf(offerRunBranch(
      request({ createBranch: true }),
      seamsOver(git.git),
    ));

    expect(refusal.message).toContain(`Could not create ${BRANCH} from ${BASE}.`);
    expect(refusal.message).toContain(`fatal: a branch named '${BRANCH}' already exists`);
    expect(refusal.message).toContain(`The run is still on ${BASE}.`);
  });

  it('answers the steps it ran, in order', async () => {
    const git = world();
    const outcome = await offerRunBranch(request({ createBranch: true }), seamsOver(git.git));

    expect(moved(outcome).steps.map((step) => step.id))
      .toEqual(['fetch', 'read-standing', 'fast-forward', 'create']);
    expect(moved(outcome).steps.map((step) => step.argv.join(' ')))
      .toEqual(CREATE_ROUTE.map((command) => `git ${command}`));
  });
});

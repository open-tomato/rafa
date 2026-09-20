/**
 * A scratch-repo integration suite for the branch offer
 * (`src/start/branch.ts` over `src/start/branch-decision.ts`), run end to
 * end against a REAL git.
 *
 * `src/start/branch-decision.test.ts` pins what each reading answers off
 * a literal, and `src/start/branch.test.ts` drives the runner over a
 * stubbed `GitRunner` that answers from a scripted table — neither
 * reaches a real repository, by design, so together they pin the ORDER
 * and the ARGV of every effect without ever proving git agrees with any
 * of it. This file is the complementary reading: a scratch repository
 * with a bare `origin` beside it, planted fresh per case under this
 * file's own temporary directory, run through the real `offerRunBranch`
 * with only the terminal and the prompter seamed — the two things a real
 * process would otherwise block on.
 *
 * Nothing here reaches a network or a real home; the remote is a bare
 * repository on disk, and `git config user.*` and `commit.gpgsign` are
 * set on every checkout this file makes so a commit never waits on an
 * operator's real identity or key.
 *
 * ## What a real git proves that a stub cannot
 *
 * The broken-`origin` cases (a failing fetch, and the two branches that
 * already exist) prove opposite things with the same lever: pointing
 * `origin` at a path that is not a repository makes ANY fetch of it
 * fail, so a case that still succeeds despite it is proof the route it
 * ran never fetched at all, and a case that refuses because of it is
 * proof the refusal really came from git's own fetch rather than from a
 * message this suite could have gotten right by accident without ever
 * running one. The diverged and behind-remote cases run the create route
 * over a base a SECOND checkout has pushed behind, which is the one
 * shape a hand-written `GitResult` table cannot fake: the two counts
 * `git rev-list --left-right --count` prints are read off commits this
 * suite never told git about directly, and the sha the new branch ends
 * on is read back off the real ref rather than asserted from a script.
 */
import type { GitRunner } from '../pr/index.js';
import type { Prompter } from '../project/root-choice.js';
import type { BranchOutcome, BranchRequest, BranchSeams } from '../start/branch.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { createGitRunner } from '../pr/index.js';
import { offerRunBranch } from '../start/branch.js';

import { sinkOutput } from './output-sinks.js';

/** The plan stub every case runs, and the branch it names. */
const STUB = 'rafa-49-scratch-branch';

/** The branch {@link STUB} names. */
const BRANCH = `feat/${STUB}`;

/** The branch every scratch repository is started on. */
const BASE = 'main';

/** A temporary directory this file's own scratch repositories sit under. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-branch-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A scratch repository, its bare remote, and a runner made for the checkout. */
interface Scratch {
  /** The checkout the offer is run over. */
  readonly repo: string;
  /** The bare repository standing in for `origin`. */
  readonly origin: string;
  /** A runner made for {@link Scratch.repo}. */
  readonly git: GitRunner;
}

/**
 * Plants a repository with one commit on `main`, a bare `origin` it is
 * pushed to and tracks, both under `tempBase`.
 */
function plantScratch(name: string): Scratch {
  const root = join(tempBase, name);
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');

  const outside = createGitRunner(tempBase);
  outside(['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  outside(['init', '--quiet', '--initial-branch=main', repo]);

  const git = createGitRunner(repo);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'kept.txt'), 'kept\n', 'utf8');
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', 'first']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '--quiet', '-u', 'origin', 'main']);
  return { repo, origin, git };
}

/** A second checkout of `scratch`'s `origin`, and the directory it sits in. */
interface OtherCheckout {
  readonly dir: string;
  readonly git: GitRunner;
}

/**
 * A second checkout of `scratch`'s `origin`, its own identity configured,
 * standing in for a collaborator whose pushes this suite's own checkout
 * never asked for.
 */
function cloneOther(scratch: Scratch, name: string): OtherCheckout {
  const dir = join(tempBase, name);
  createGitRunner(tempBase)(['clone', '--quiet', scratch.origin, dir]);
  const git = createGitRunner(dir);
  git(['config', 'user.email', 'other@example.test']);
  git(['config', 'user.name', 'other test']);
  git(['config', 'commit.gpgsign', 'false']);
  return { dir, git };
}

/** Commits one new file at `path` through `git`, answering the new commit's sha. */
function commitFile(git: GitRunner, path: string, content: string, message: string): string {
  writeFileSync(path, content, 'utf8');
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', message]);
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

/** Points `scratch`'s `origin` at a path that is not a repository, so any real fetch of it fails. */
function breakOrigin(scratch: Scratch): void {
  scratch.git(['remote', 'set-url', 'origin', join(tempBase, 'nowhere-does-not-exist.git')]);
}

/** True when `ref` names a branch git can see in `scratch`. */
function refExists(scratch: Scratch, ref: string): boolean {
  return scratch.git(['show-ref', '--verify', '--quiet', ref]).ok;
}

/** The branch checked out in `scratch` right now. */
function currentBranch(scratch: Scratch): string {
  return scratch.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

/** The commit `ref` names, read through `git`. */
function shaAt(git: GitRunner, ref: string): string {
  return git(['rev-parse', ref]).stdout.trim();
}

/** The commit `ref` names in `scratch`'s checkout. */
function shaOf(scratch: Scratch, ref: string): string {
  return shaAt(scratch.git, ref);
}

/** The commit `ref` names on `scratch`'s bare `origin`, read without going through the checkout. */
function originSha(scratch: Scratch, ref: string): string {
  return shaAt(createGitRunner(scratch.origin), ref);
}

/** A run on {@link BASE} over `scratch`, with nothing in the way; `over` varies one axis. */
function request(scratch: Scratch, over: Partial<BranchRequest> = {}): BranchRequest {
  return {
    repoRoot: scratch.repo,
    planStub: STUB,
    base: BASE,
    anyBranch: false,
    createBranch: false,
    ...over,
  };
}

/** The prompter a case gets unless it wants one: opening it is a failure. */
function neverOpened(): Prompter {
  throw new Error('the prompter was opened');
}

/** A stubbed prompter answering `answer` to every question, and recording what it was asked. */
interface StubPrompter {
  readonly open: () => Prompter;
  readonly asked: readonly string[];
}

/** A prompter answering `answer` to every question it is asked. */
function prompterAnswering(answer: string | null): StubPrompter {
  const asked: string[] = [];
  return {
    asked,
    open: () => ({
      say: () => {},
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(answer);
      },
      close: () => {},
    }),
  };
}

/** A terminal by default, over the real git; `over` supplies the prompter or the terminal reading. */
function seamsOver(over: Partial<BranchSeams> = {}): BranchSeams {
  return { isTerminal: () => true, openPrompter: neverOpened, ...over };
}

/** The outcome as a move, throwing on any other reading. */
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

beforeEach(() => {
  setActiveOutput(sinkOutput({}));
});

afterEach(() => {
  setActiveOutput(null);
});

describe('the question, over a base already level with its remote', () => {
  it('asks, and a no leaves the base untouched with nothing created', async () => {
    const scratch = plantScratch('question-no');
    const prompter = prompterAnswering('n');

    const outcome = await offerRunBranch(request(scratch), seamsOver({ openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Create ${BRANCH} from the latest origin/${BASE} and run there? [y/N] `]);
    expect(declined(outcome).route).toBe('create');
    expect(currentBranch(scratch)).toBe(BASE);
    expect(refExists(scratch, `refs/heads/${BRANCH}`)).toBe(false);
  });

  it('asks, and a yes creates the branch from the latest origin', async () => {
    const scratch = plantScratch('question-yes');
    const prompter = prompterAnswering('y');
    const originTip = shaOf(scratch, 'origin/main');

    const outcome = await offerRunBranch(request(scratch), seamsOver({ openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Create ${BRANCH} from the latest origin/${BASE} and run there? [y/N] `]);
    expect(moved(outcome).branch).toBe(BRANCH);
    expect(currentBranch(scratch)).toBe(BRANCH);
    expect(shaOf(scratch, 'HEAD')).toBe(originTip);
  });
});

describe('--create-branch', () => {
  it('creates the branch straight from origin with no terminal and no prompter opened', async () => {
    const scratch = plantScratch('create-flag');
    const originTip = shaOf(scratch, 'origin/main');

    const outcome = await offerRunBranch(
      request(scratch, { createBranch: true }),
      seamsOver({ isTerminal: () => false }),
    );

    expect(moved(outcome).route).toBe('create');
    expect(currentBranch(scratch)).toBe(BRANCH);
    expect(shaOf(scratch, 'HEAD')).toBe(originTip);
  });
});

describe('no terminal, and no --create-branch', () => {
  it('stands aside, asking nothing and creating nothing', async () => {
    const scratch = plantScratch('no-terminal');

    const outcome = await offerRunBranch(request(scratch), seamsOver({ isTerminal: () => false }));

    expect(stoodAside(outcome)).toBe('no-terminal');
    expect(currentBranch(scratch)).toBe(BASE);
    expect(refExists(scratch, `refs/heads/${BRANCH}`)).toBe(false);
  });
});

describe('a modified tracked file', () => {
  it('refuses before any step runs, and leaves the modification in place', async () => {
    const scratch = plantScratch('modified-tracked');
    writeFileSync(join(scratch.repo, 'kept.txt'), 'changed\n', 'utf8');

    const refusal = await refusalOf(offerRunBranch(
      request(scratch, { createBranch: true }),
      seamsOver({ isTerminal: () => false }),
    ));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(`Refusing to leave ${BASE} for ${BRANCH}`);
    expect(refusal.message).toContain('kept.txt');
    expect(readFileSync(join(scratch.repo, 'kept.txt'), 'utf8')).toBe('changed\n');
    expect(refExists(scratch, `refs/heads/${BRANCH}`)).toBe(false);
  });
});

describe('a base one commit behind its remote', () => {
  it('fetches, fast-forwards the base, and the new branch holds the remote commit', async () => {
    const scratch = plantScratch('behind-remote');
    const other = cloneOther(scratch, 'behind-remote-other');
    const theirSha = commitFile(
      other.git,
      join(other.dir, 'from-remote.txt'),
      'theirs\n',
      'a commit only origin has',
    );
    other.git(['push', '--quiet', 'origin', 'main']);
    expect(shaOf(scratch, 'main')).not.toBe(theirSha);

    const outcome = await offerRunBranch(
      request(scratch, { createBranch: true }),
      seamsOver({ isTerminal: () => false }),
    );

    expect(moved(outcome).route).toBe('create');
    expect(shaOf(scratch, 'main')).toBe(theirSha);
    expect(shaOf(scratch, BRANCH)).toBe(theirSha);
  });
});

describe('a diverged base', () => {
  it('refuses before it fast-forwards or creates anything, leaving both sides where they were', async () => {
    const scratch = plantScratch('diverged');
    const ourSha = commitFile(
      scratch.git,
      join(scratch.repo, 'ours.txt'),
      'ours\n',
      'a commit only this checkout has',
    );
    const other = cloneOther(scratch, 'diverged-other');
    const theirSha = commitFile(
      other.git,
      join(other.dir, 'theirs.txt'),
      'theirs\n',
      'a commit only origin has',
    );
    other.git(['push', '--quiet', 'origin', 'main']);

    const refusal = await refusalOf(offerRunBranch(
      request(scratch, { createBranch: true }),
      seamsOver({ isTerminal: () => false }),
    ));

    expect(refusal.message).toContain(`${BASE} has diverged from origin/${BASE}`);
    expect(refusal.message).toContain('1 commit ahead of origin/main and 1 commit behind it');
    expect(shaOf(scratch, 'main')).toBe(ourSha);
    expect(originSha(scratch, 'main')).toBe(theirSha);
    expect(refExists(scratch, `refs/heads/${BRANCH}`)).toBe(false);
  });
});

describe('a failing fetch', () => {
  it('refuses naming what git said, and leaves the base exactly where it was', async () => {
    const scratch = plantScratch('failing-fetch');
    const before = shaOf(scratch, 'main');
    breakOrigin(scratch);

    const refusal = await refusalOf(offerRunBranch(
      request(scratch, { createBranch: true }),
      seamsOver({ isTerminal: () => false }),
    ));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(`Refusing to create ${BRANCH} from a stale origin/${BASE}`);
    expect(refusal.message.toLowerCase()).toContain('fatal');
    expect(shaOf(scratch, 'main')).toBe(before);
    expect(refExists(scratch, `refs/heads/${BRANCH}`)).toBe(false);
  });
});

describe('an existing local feat/<stub>', () => {
  it('switches to it without fetching, over a broken origin', async () => {
    const scratch = plantScratch('local-branch');
    scratch.git(['branch', BRANCH]);
    breakOrigin(scratch);
    const prompter = prompterAnswering('y');

    const outcome = await offerRunBranch(request(scratch), seamsOver({ openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Switch to the existing ${BRANCH}? [y/N] `]);
    expect(moved(outcome).route).toBe('switch-local');
    expect(currentBranch(scratch)).toBe(BRANCH);
  });
});

describe('a remote-only feat/<stub>', () => {
  it('checks it out tracking origin without fetching again, over a broken origin', async () => {
    const scratch = plantScratch('remote-only');
    const other = cloneOther(scratch, 'remote-only-other');
    other.git(['checkout', '--quiet', '-b', BRANCH]);
    const theirSha = commitFile(
      other.git,
      join(other.dir, 'remote-side.txt'),
      'theirs\n',
      'a branch only origin has',
    );
    other.git(['push', '--quiet', 'origin', BRANCH]);
    scratch.git(['fetch', '--quiet', 'origin']);
    expect(scratch.git(['rev-parse', '--verify', '--quiet', BRANCH]).ok).toBe(false);
    breakOrigin(scratch);
    const prompter = prompterAnswering('y');

    const outcome = await offerRunBranch(request(scratch), seamsOver({ openPrompter: prompter.open }));

    expect(prompter.asked).toEqual([`Switch to the existing ${BRANCH}? [y/N] `]);
    expect(moved(outcome).route).toBe('switch-remote');
    expect(currentBranch(scratch)).toBe(BRANCH);
    expect(shaOf(scratch, 'HEAD')).toBe(theirSha);
    expect(scratch.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).stdout.trim())
      .toBe(`origin/${BRANCH}`);
  });
});

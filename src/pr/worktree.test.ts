/**
 * Tests for the resolve worktree (`src/pr/worktree.ts`).
 *
 * The cases split the way the module does. The path, the
 * cross-repository refusal and the push guard are pure readings over
 * literals; everything about adding, removing and pushing runs the REAL
 * git over a scratch repository with a bare `origin` beside it, planted
 * under this file temporary directory. A fake git would measure nothing
 * here: every claim the module note makes about `git worktree` is a
 * claim about what git does, and the module exists to get those right.
 *
 * Nothing reaches a network or a real home. The remote is a bare
 * repository on disk, and the home every path is built under is a
 * directory of the case own.
 *
 * ## The three ways this can be wrong quietly, each with a control
 *
 *  - **A push that forces.** `git push origin <branch>` carries no force
 *    flag, so a check that only looked for one would pass on an argv
 *    that forces anyway through a `+`-leading branch name. The guard
 *    cases therefore drive every flag spelling AND the refspec one, and
 *    the diverged-remote case proves the remote really was unpushable by
 *    running `git push --force` by hand afterwards and watching the ref
 *    move. Without that control, a rejected push would be indistinguishable
 *    from a push that had nothing to send.
 *  - **A removal that deletes work.** `git worktree remove` refuses over
 *    untracked files and accepts over ignored ones, and the resolve
 *    plans leave `node_modules/` behind. Both are measured, and the
 *    refusal case asserts the directory is STILL THERE afterwards, which
 *    a `--force` slipped into the step would fail.
 *  - **A lookup that misses its own worktree.** Git prints resolved
 *    paths. The symlink case looks the worktree up through a symlinked
 *    parent, and its control is the same lookup for a path no worktree
 *    was ever added at, which must answer null.
 */
import type { GitRunner } from './git.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from './git.js';
import {
  addResolveWorktree,
  addWorktreeStep,
  crossRepositoryRefusal,
  forcedPushRefusal,
  forcesPush,
  pushResolved,
  pushResolvedStep,
  removeResolveWorktree,
  removeWorktreeStep,
  resolveWorktreePath,
  worktreeAt,
  worktreeCommandLine,
  WORKTREES_SUBDIR,
} from './worktree.js';

/** A temporary directory of this file own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-worktree-')));

/** The branch a resolve run is given a worktree for, in every case. */
const HEAD_BRANCH = 'feat/rafa-20-fix';

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A scratch repository, its bare remote, and a home to build paths under. */
interface Scratch {
  /** The home every `~/.rafa/worktrees` path in the case is built under. */
  readonly home: string;
  /** The bare repository standing in for `origin`. */
  readonly origin: string;
  /** The operator checkout, which the worktree is added from. */
  readonly repo: string;
  /** A runner made for {@link Scratch.repo}. */
  readonly git: GitRunner;
}

/**
 * Plants a repository with one commit on `main`, a bare `origin` it is
 * pushed to, and an empty home, all under `tempBase`.
 */
function plantScratch(name: string): Scratch {
  const root = join(tempBase, name);
  const home = join(root, 'home');
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });

  const outside = createGitRunner(tempBase);
  outside(['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  outside(['init', '--quiet', '--initial-branch=main', repo]);

  const git = createGitRunner(repo);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n', 'utf8');
  writeFileSync(join(repo, 'kept.txt'), 'kept\n', 'utf8');
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', 'first']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '--quiet', 'origin', 'main']);
  return { git, home, origin, repo };
}

/** Makes `branch` in `scratch` and pushes it to the bare remote. */
function plantHeadBranch(scratch: Scratch, branch: string = HEAD_BRANCH): void {
  scratch.git(['branch', branch]);
  scratch.git(['push', '--quiet', 'origin', branch]);
}

/** The commit `origin` holds for `branch`, as a bare repository answers it. */
function remoteTip(scratch: Scratch, branch: string = HEAD_BRANCH): string {
  return createGitRunner(scratch.origin)(['rev-parse', branch]).stdout.trim();
}

/** A runner that records what it was asked to run and spawns nothing. */
function recordingRunner(calls: string[][]): GitRunner {
  return (args) => {
    calls.push([...args]);
    return { ok: true, stdout: '', stderr: '' };
  };
}

describe('where a resolve worktree goes', () => {
  it('answers the pr-numbered directory under the home .rafa worktrees directory', () => {
    const home = join(tempBase, 'somebody-home');

    expect(resolveWorktreePath(home, 12)).toBe(join(home, '.rafa', 'worktrees', 'pr-12'));
    expect(WORKTREES_SUBDIR).toBe(join('.rafa', 'worktrees'));
  });

  it('gives two pull requests two directories under one parent', () => {
    const home = join(tempBase, 'shared-home');
    const first = resolveWorktreePath(home, 7);
    const second = resolveWorktreePath(home, 8);

    expect(first).not.toBe(second);
    expect([first, second].every((path) => path.startsWith(join(home, WORKTREES_SUBDIR))))
      .toBe(true);
  });
});

describe('the cross-repository refusal', () => {
  it('refuses a head on a fork, naming the number, the branch and what to run instead', () => {
    const refusal = crossRepositoryRefusal({
      number: 41,
      headRefName: 'patch-1',
      isCrossRepository: true,
    });

    expect(refusal).toContain('#41');
    expect(refusal).toContain('`patch-1`');
    expect(refusal).toContain('fork');
    expect(refusal).toContain('rafa pr triage 41');
  });

  it('refuses nothing when the head is a branch of this repository', () => {
    const allowed = crossRepositoryRefusal({
      number: 41,
      headRefName: 'patch-1',
      isCrossRepository: false,
    });

    expect(allowed).toBeNull();
  });
});

describe('the push that is never forced', () => {
  it('builds one argv naming the remote and the branch and no flag at all', () => {
    const step = pushResolvedStep(HEAD_BRANCH);

    expect(step.argv).toEqual(['git', 'push', 'origin', HEAD_BRANCH]);
    expect(forcesPush(step.argv)).toBe(false);
    expect(forcedPushRefusal(step.argv)).toBeNull();
  });

  it('reads every flag spelling git takes for a force as a forced push', () => {
    const forcing = [
      '--force',
      '-f',
      '--force-with-lease',
      '--force-with-lease=refs/heads/main',
      '--force-if-includes',
      '--mirror',
    ];

    for (const flag of forcing) {
      expect(forcesPush(['git', 'push', 'origin', HEAD_BRANCH, flag])).toBe(true);
    }
  });

  it('reads a leading plus on a word as the forced refspec it is', () => {
    const argv = ['git', 'push', 'origin', '+weird'];

    expect(forcesPush(argv)).toBe(true);
    expect(forcedPushRefusal(argv)).toContain('`+weird`');
  });

  it('spawns nothing for a branch whose own name makes the refspec a forced one', () => {
    const calls: string[][] = [];
    const outcome = pushResolved(recordingRunner(calls), '+weird');

    expect(calls).toEqual([]);
    expect(outcome.ok).toBe(false);
    expect(outcome.said).toContain('never overwrites what is on the remote');
  });

  it('spawns the argv it built for an ordinary branch name', () => {
    const calls: string[][] = [];
    const outcome = pushResolved(recordingRunner(calls), HEAD_BRANCH, 'upstream');

    expect(calls).toEqual([['push', 'upstream', HEAD_BRANCH]]);
    expect(outcome.ok).toBe(true);
  });
});

describe('the steps as lines the operator can paste', () => {
  it('quotes a path holding a space and leaves a plain word alone', () => {
    const line = worktreeCommandLine(addWorktreeStep('/tmp/a b/pr-3', HEAD_BRANCH));

    expect(line).toBe(`git worktree add '/tmp/a b/pr-3' ${HEAD_BRANCH}`);
  });

  it('names no force in the removal step', () => {
    const step = removeWorktreeStep('/tmp/pr-3');

    expect(step.argv).toEqual(['git', 'worktree', 'remove', '/tmp/pr-3']);
    expect(worktreeCommandLine(step)).not.toContain('--force');
  });
});

describe('adding the worktree over a scratch repository', () => {
  it('checks the branch out at the pr-numbered path and lists it there', () => {
    const scratch = plantScratch('added');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 20);

    const outcome = addResolveWorktree(scratch.git, path, HEAD_BRANCH);
    const listed = worktreeAt(scratch.git, path);

    expect([outcome.id, outcome.ok]).toEqual(['add', true]);
    expect(existsSync(join(path, 'kept.txt'))).toBe(true);
    expect(listed?.branch).toBe(HEAD_BRANCH);
    expect(createGitRunner(path)(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim())
      .toBe(HEAD_BRANCH);
  });

  it('makes the worktrees directory itself, which nothing here created first', () => {
    const scratch = plantScratch('leading-dirs');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 21);

    expect(existsSync(join(scratch.home, WORKTREES_SUBDIR))).toBe(false);
    const outcome = addResolveWorktree(scratch.git, path, HEAD_BRANCH);

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(scratch.home, WORKTREES_SUBDIR))).toBe(true);
  });

  it('takes a branch that exists only on the remote, tracking it', () => {
    const scratch = plantScratch('remote-only');
    plantHeadBranch(scratch);
    scratch.git(['branch', '--delete', '--force', HEAD_BRANCH]);
    scratch.git(['fetch', '--quiet', 'origin']);
    const path = resolveWorktreePath(scratch.home, 22);

    expect(scratch.git(['rev-parse', '--verify', '--quiet', HEAD_BRANCH]).ok).toBe(false);
    const outcome = addResolveWorktree(scratch.git, path, HEAD_BRANCH);

    expect(outcome.ok).toBe(true);
    expect(createGitRunner(path)(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      .stdout.trim()).toBe(`origin/${HEAD_BRANCH}`);
  });

  it('answers what git said for a path a previous attempt left behind', () => {
    const scratch = plantScratch('already-there');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 23);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);

    const again = addResolveWorktree(scratch.git, path, HEAD_BRANCH);

    expect(again.ok).toBe(false);
    expect(again.said).toContain('already exists');
    expect(again.command).toContain('worktree add');
  });

  it('answers what git said for a branch checked out somewhere else', () => {
    const scratch = plantScratch('branch-taken');
    plantHeadBranch(scratch);
    addResolveWorktree(scratch.git, resolveWorktreePath(scratch.home, 24), HEAD_BRANCH);

    const elsewhere = addResolveWorktree(
      scratch.git,
      resolveWorktreePath(scratch.home, 25),
      HEAD_BRANCH,
    );

    expect(elsewhere.ok).toBe(false);
    expect(elsewhere.said).toContain('already used by worktree');
  });
});

describe('removing the worktree on success', () => {
  it('takes the directory and the listing away', () => {
    const scratch = plantScratch('removed');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 30);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);

    const outcome = removeResolveWorktree(scratch.git, path);

    expect([outcome.id, outcome.ok]).toEqual(['remove', true]);
    expect(existsSync(path)).toBe(false);
    expect(worktreeAt(scratch.git, path)).toBeNull();
  });

  it('removes a worktree the resolve run left an ignored node_modules in', () => {
    const scratch = plantScratch('ignored-left');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 31);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);
    mkdirSync(join(path, 'node_modules'), { recursive: true });
    writeFileSync(join(path, 'node_modules', 'dep.js'), 'module.exports = 1;\n', 'utf8');

    const outcome = removeResolveWorktree(scratch.git, path);

    expect(outcome.ok).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('leaves a worktree holding uncommitted work alone and says why', () => {
    const scratch = plantScratch('dirty-left');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 32);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);
    writeFileSync(join(path, 'stray.txt'), 'not committed\n', 'utf8');

    const outcome = removeResolveWorktree(scratch.git, path);

    expect(outcome.ok).toBe(false);
    expect(outcome.said).toContain('contains modified or untracked files');
    expect(existsSync(join(path, 'stray.txt'))).toBe(true);
    expect(worktreeAt(scratch.git, path)).not.toBeNull();
  });
});

describe('pushing the resolution back', () => {
  it('sends the worktree commit to the remote branch', () => {
    const scratch = plantScratch('pushed');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 40);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);
    const inside = createGitRunner(path);
    writeFileSync(join(path, 'kept.txt'), 'resolved\n', 'utf8');
    inside(['add', '--all']);
    inside(['commit', '--quiet', '--message', 'resolve the conflict']);
    const local = inside(['rev-parse', 'HEAD']).stdout.trim();

    const outcome = pushResolved(inside, HEAD_BRANCH);

    expect([outcome.id, outcome.ok]).toEqual(['push', true]);
    expect(remoteTip(scratch)).toBe(local);
  });

  it('is rejected by a remote that moved, and leaves it where it was', () => {
    const scratch = plantScratch('diverged');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 41);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);
    const inside = createGitRunner(path);

    // The remote branch moves under the run, from a second checkout.
    const other = join(tempBase, 'diverged-other');
    createGitRunner(tempBase)(['clone', '--quiet', scratch.origin, other]);
    const otherGit = createGitRunner(other);
    otherGit(['config', 'user.email', 'other@example.test']);
    otherGit(['config', 'user.name', 'other test']);
    otherGit(['config', 'commit.gpgsign', 'false']);
    otherGit(['checkout', '--quiet', HEAD_BRANCH]);
    writeFileSync(join(other, 'remote-side.txt'), 'theirs\n', 'utf8');
    otherGit(['add', '--all']);
    otherGit(['commit', '--quiet', '--message', 'remote side']);
    otherGit(['push', '--quiet', 'origin', HEAD_BRANCH]);
    const theirs = remoteTip(scratch);

    writeFileSync(join(path, 'local-side.txt'), 'ours\n', 'utf8');
    inside(['add', '--all']);
    inside(['commit', '--quiet', '--message', 'local side']);
    const ours = inside(['rev-parse', 'HEAD']).stdout.trim();
    const outcome = pushResolved(inside, HEAD_BRANCH);

    expect(outcome.ok).toBe(false);
    expect(outcome.said).toContain('rejected');
    expect(remoteTip(scratch)).toBe(theirs);

    // The control: the same push WITH a force does move the remote, so
    // the rejection above was a force-only push and not an empty one.
    expect(inside(['push', '--force', 'origin', HEAD_BRANCH]).ok).toBe(true);
    expect(remoteTip(scratch)).toBe(ours);
  });
});

describe('finding the worktree git listed', () => {
  it('matches a path reached through a symlinked parent, which git resolves away', () => {
    const scratch = plantScratch('symlinked');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 50);
    addResolveWorktree(scratch.git, path, HEAD_BRANCH);

    const link = join(tempBase, 'symlinked-home');
    symlinkSync(scratch.home, link);
    const throughLink = resolveWorktreePath(link, 50);

    expect(throughLink).not.toBe(realpathSync(throughLink));
    expect(worktreeAt(scratch.git, throughLink)?.branch).toBe(HEAD_BRANCH);
    expect(worktreeAt(scratch.git, resolveWorktreePath(link, 51))).toBeNull();
  });

  it('answers null when git refuses to list at all', () => {
    const outside = join(tempBase, 'not-a-repository');
    mkdirSync(outside, { recursive: true });

    expect(worktreeAt(createGitRunner(outside), join(outside, 'pr-1'))).toBeNull();
  });
});

describe('what the module writes into the scratch repository', () => {
  it('leaves the operator checkout on its own branch with its own files', () => {
    const scratch = plantScratch('untouched');
    plantHeadBranch(scratch);
    const path = resolveWorktreePath(scratch.home, 60);
    const before = scratch.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    writeFileSync(join(scratch.repo, 'uncommitted.txt'), 'operator work\n', 'utf8');

    addResolveWorktree(scratch.git, path, HEAD_BRANCH);
    removeResolveWorktree(scratch.git, path);

    expect(scratch.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe(before);
    expect(readFileSync(join(scratch.repo, 'uncommitted.txt'), 'utf8')).toBe('operator work\n');
  });
});

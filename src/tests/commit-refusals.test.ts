/**
 * The commit helper's refusal paths, read the way the loop reads them.
 *
 * `utils/commit.test.ts` beside the module already drives every
 * function it exports, mostly through an injected runner. What no
 * case there can do — and what a refusal case needs more than any
 * other shape — is say that a refusal is a REFUSAL rather than a
 * module refusing everything. `nothing-to-commit` is satisfied by a
 * helper that never commits, `failed` by one that never succeeds, and
 * `truncated` by one that always cuts. So every case below carries
 * its own POSITIVE CONTROL, in the same body, varied along the one
 * axis the case is named for and holding everything else fixed:
 *
 *   - the clean tree, against a TRACKED write in the same repository;
 *   - the rejecting hook, against the same staged work under a hook
 *     that exits 0;
 *   - the truncated subject, against a short task text whose subject
 *     carries the whole sentence.
 *
 * Every case drives a REAL repository under `mkdtemp` through the
 * DEFAULT runner, which is the other half the colocated suite is thin
 * on: its refusal cases are mostly stubbed, and a stub is evidence
 * about the stub rather than about `git`. Each repository sets its
 * own `core.hooksPath`, so this clone's `.githooks` — and the
 * control-byte gate inside it — never runs against an index it knows
 * nothing about.
 *
 * ## What the loop's next task needs from here
 *
 * `start.ts` is about to branch on the outcome, marking a tracker
 * line `[BLOCKED]` when the commit failed and ticking it otherwise.
 * That makes the discrimination between the two refusals — the clean
 * tree, which is a SUCCESS, and the rejected hook, which is not — the
 * property the loop actually rests on, so it is asserted as a pair in
 * one case rather than left implied by two separate ones.
 *
 * ## Two characterizations, both measured before they were written
 *
 * These pin what git does rather than what the module chose, and both
 * were taken against git 2.50.1 in a throwaway repository first.
 *
 *   - A pre-commit hook's own exit code DOES NOT survive. git answers
 *     1 whatever the hook exited with, so `exitCode` cannot tell a
 *     gate that refused (1) from a gate that could not run (2), and
 *     only `message` separates them. A loop reporting the reason has
 *     to report the message.
 *   - `--cleanup=whitespace` is not defending against git's default.
 *     For a `-m` message the default already IS whitespace, so the
 *     flag is defending against a `commit.cleanup=strip` setting —
 *     which the case here configures explicitly, because without it
 *     the branch is unreachable and the case would assert nothing.
 *
 * ## The mutation grid
 *
 * Twelve module mutations were driven against this file and ELEVEN
 * reddened at least one case, with the module restored
 * bytes-identical and all 11 cases green either side. Every case
 * below is in the reddened union, so none of them rests on nothing,
 * and two full passes named the identical red set for every leg.
 *
 * The splits that ISOLATE are what the file is shaped for.
 * Committing under `--cleanup=strip`, and dropping the flag
 * altogether, each redden the body case ALONE. Raising the subject
 * cap to 120 reddens the truncation round-trip alone, which is why
 * 72 is spelled as a literal here rather than imported. Answering an
 * empty description for a first word past the budget reddens the
 * hard-cut case alone, and always writing a body reddens the
 * round-trip alone. Cutting with no word boundary reddens the two
 * boundary cases; refusing to cut at all reddens all four truncation
 * cases. Accepting a commit git refused, and answering an empty
 * failure message, redden the SAME four — the three hook cases plus
 * the discrimination one — which is the pair saying those two claims
 * are read together. Inverting the nothing-to-commit branch, and
 * inspecting without `--cached`, each redden 9 of 11.
 *
 * The one leg that reddened NOTHING is recorded rather than dropped,
 * because it is dead by construction rather than unguarded: swapping
 * the module's stderr-before-stdout order cannot be observed through
 * a REAL hook, git putting a hook's stdout onto its own stderr, so
 * `result.stdout` is empty for every fixture here. The colocated
 * stub suite owns that claim and can redden it.
 */
import type { CommitAttempt } from '../utils/commit.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  buildCommitMessage,
  commitTaskWork,
  deriveCommitSubject,
  normaliseTaskText,
} from '../utils/commit.js';

/**
 * A plan task sentence of the length this loop's plans really carry.
 *
 * It is this file's own scoped task, at 181 characters, which is what
 * makes the truncation cases about a real input rather than about a
 * string built to be long. Its length is asserted against the cap as
 * a LITERAL below, so a fixture that stopped reaching the branch is a
 * red case rather than a silently passing one.
 */
const LONG_TASK = [
  'Add unit tests to `tools/ralph/tests/` for the commit helper\'s',
  'refusal paths: a clean tree, a rejected pre-commit hook, and a task',
  'text long enough to need truncation in the subject',
].join(' ');

/** The control for every truncation case. Fits with room to spare. */
const SHORT_TASK = 'Add a refusal case';

/**
 * A task text whose BODY opens on a hash.
 *
 * `buildCommitMessage` collapses the task text to ONE line, so a hash
 * can only begin a body line when the task text itself opens on one.
 * That is the whole reachable surface of the cleanup mode, and it is
 * why this fixture is shaped the way it is rather than quoting a hash
 * somewhere in the middle.
 */
const HASH_TASK = [
  '# Capture the three gates into per-run files, each with its own',
  'exit file, so a later reading cannot take one run for another',
].join(' ');

/** git's own subject cap, spelled as a literal rather than imported. */
const GIT_SUBJECT_CAP = 72;

/** A hook that refuses, printing the reason the way a gate does. */
const REJECTING_HOOK = '#!/bin/sh\necho "gate says no" >&2\nexit 1\n';

/** The same hook, passing. The control for every hook case. */
const PASSING_HOOK = '#!/bin/sh\nexit 0\n';

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-refusal-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Runs git in a repository, reading back rather than through the module. */
function inRepo(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/**
 * A repository with its own hooks directory and one commit in it.
 *
 * `core.hooksPath` points at a directory of the repository's own, so
 * a hook case plants the hook it is about and inherits none.
 */
function plantRepo(config: ReadonlyArray<[string, string]> = []): string {
  planted += 1;
  const dir = join(tempRoot, `repo-${planted}`);
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  inRepo(dir, 'init', '-q', '.');
  inRepo(dir, 'config', 'user.email', 'loop@example.test');
  inRepo(dir, 'config', 'user.name', 'Ralph Loop');
  inRepo(dir, 'config', 'commit.gpgsign', 'false');
  inRepo(dir, 'config', 'core.hooksPath', 'hooks');
  for (const [key, value] of config) {
    inRepo(dir, 'config', key, value);
  }
  writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8');
  inRepo(dir, 'add', '-A');
  inRepo(dir, 'commit', '-q', '-m', 'seed');
  return dir;
}

/** Writes a file into a repository, creating its directory first. */
function write(dir: string, name: string, body: string): void {
  const target = join(dir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/** Installs an executable pre-commit hook. */
function plantHook(dir: string, script: string): void {
  const hook = join(dir, 'hooks', 'pre-commit');
  writeFileSync(hook, script, 'utf8');
  chmodSync(hook, 0o755);
}

/** How many commits the repository holds. */
function commitCount(dir: string): string {
  return inRepo(dir, 'rev-list', '--count', 'HEAD');
}

/** The subject of the newest commit. */
function lastSubject(dir: string): string {
  return inRepo(dir, 'log', '-1', '--format=%s');
}

/** The body of the newest commit. */
function lastBody(dir: string): string {
  return inRepo(dir, 'log', '-1', '--format=%b');
}

/** Paths currently in the index, one per line. */
function stagedPaths(dir: string): string {
  return inRepo(dir, 'diff', '--cached', '--name-only');
}

/** Everything in the INDEX, one path per line. */
function trackedPaths(dir: string): string {
  return inRepo(dir, 'ls-files');
}

/**
 * Everything in the newest COMMIT, one path per line.
 *
 * Distinct from {@link trackedPaths} in exactly the state a refused
 * commit leaves behind: `git ls-files` reads the INDEX, so a staged
 * file is listed there whether or not any commit carries it, and only
 * the committed tree can say the refusal kept it out of the history.
 */
function committedPaths(dir: string): string {
  return inRepo(dir, 'ls-tree', '-r', '--name-only', 'HEAD');
}

/** The description a subject carries, with its `type: ` prefix cut. */
function descriptionOf(subject: string): string {
  return subject.slice(subject.indexOf(': ') + 2);
}

/** One attempt against a repository, through the default runner. */
function attempt(dir: string, taskText: string): CommitAttempt {
  return commitTaskWork({ taskText, cwd: dir });
}

describe('the clean-tree refusal', () => {
  /**
   * A repository ignoring exactly what this repo's loop ignores, so
   * the fixture reaches the branch by the route the module's own
   * docblock names as its reason for existing.
   */
  function plantIgnoringRepo(): string {
    const dir = plantRepo();
    write(dir, '.gitignore', 'progress.txt\n.plans/\n.specs/\n');
    inRepo(dir, 'add', '-A');
    inRepo(dir, 'commit', '-q', '-m', 'ignore the loop trees');
    return dir;
  }

  it('refuses an ignored write and takes a tracked one', () => {
    const dir = plantIgnoringRepo();
    write(dir, 'progress.txt', 'a finding\n');
    write(dir, '.plans/PLAN-q19.md', '- [x] a task\n');

    const refused = attempt(dir, LONG_TASK);

    expect(refused.outcome).toBe('nothing-to-commit');
    expect(refused.sha).toBeNull();
    expect(refused.failedStep).toBeNull();
    expect(refused.message).toBe('');

    // The control, along the one axis: the same repository, the same
    // helper, a change git can see. Without it every assertion above
    // is satisfied by a module that never commits anything.
    write(dir, 'tracked.txt', 'work\n');
    const taken = attempt(dir, LONG_TASK);

    expect(taken.outcome).toBe('committed');
    expect(taken.sha).not.toBeNull();
    expect(trackedPaths(dir)).toContain('tracked.txt');
    expect(trackedPaths(dir)).not.toContain('progress.txt');
  });

  it('moves no history and leaves nothing staged', () => {
    const dir = plantIgnoringRepo();
    const before = inRepo(dir, 'rev-parse', 'HEAD');
    write(dir, 'progress.txt', 'a finding\n');

    attempt(dir, LONG_TASK);

    expect(inRepo(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(commitCount(dir)).toBe('2');
    expect(stagedPaths(dir)).toBe('');

    // The control: the same repository moves by exactly one commit
    // once something tracked changes, which is what says the zero
    // above is a refusal and not a repository that cannot commit.
    write(dir, 'tracked.txt', 'work\n');
    attempt(dir, LONG_TASK);

    expect(commitCount(dir)).toBe('3');
    expect(inRepo(dir, 'rev-parse', 'HEAD')).not.toBe(before);
    expect(stagedPaths(dir)).toBe('');
  });

  it('is a success a hook refusal is not', () => {
    // The discrimination `start.ts` is about to branch on. Both are
    // refusals and only one blocks, so they are read side by side:
    // any record shape that cannot separate them either blocks a
    // correct task or reports a commit nobody made.
    const clean = plantRepo();
    const refused = attempt(clean, LONG_TASK);

    const rejecting = plantRepo();
    plantHook(rejecting, REJECTING_HOOK);
    write(rejecting, 'work.txt', 'done\n');
    const failed = attempt(rejecting, LONG_TASK);

    expect(refused.outcome).toBe('nothing-to-commit');
    expect(failed.outcome).toBe('failed');
    expect(refused.failedStep).toBeNull();
    expect(failed.failedStep).toBe('commit');
    expect(refused.message).toBe('');
    expect(failed.message).not.toBe('');
    expect(commitCount(clean)).toBe(commitCount(rejecting));
  });
});

describe('the rejected pre-commit hook', () => {
  it('refuses on exit 1 and commits on exit 0', () => {
    const dir = plantRepo();
    plantHook(dir, REJECTING_HOOK);
    write(dir, 'work.txt', 'done\n');

    const refused = attempt(dir, LONG_TASK);

    expect(refused.outcome).toBe('failed');
    expect(refused.failedStep).toBe('commit');
    expect(refused.sha).toBeNull();
    expect(refused.message).toContain('gate says no');
    expect(commitCount(dir)).toBe('1');

    // The control, varied along the hook's exit code alone: the same
    // repository, the same staged work, the same task text. Without
    // it the case passes against a module that never commits.
    plantHook(dir, PASSING_HOOK);
    const taken = attempt(dir, LONG_TASK);

    expect(taken.outcome).toBe('committed');
    expect(taken.message).toBe('');
    expect(commitCount(dir)).toBe('2');
  });

  it('leaves the staged work for the next reader', () => {
    const dir = plantRepo();
    plantHook(dir, REJECTING_HOOK);
    write(dir, 'brand-new.txt', 'done\n');

    attempt(dir, LONG_TASK);

    // The file was UNTRACKED before the attempt, so finding it in the
    // index is also what says `git add -A` ran at all: the refusal
    // happened at the commit and not before the staging.
    expect(stagedPaths(dir)).toContain('brand-new.txt');
    expect(committedPaths(dir)).not.toContain('brand-new.txt');
    expect(commitCount(dir)).toBe('1');

    // The control: the same index, now accepted, reaches the history.
    plantHook(dir, PASSING_HOOK);
    attempt(dir, LONG_TASK);

    expect(stagedPaths(dir)).toBe('');
    expect(committedPaths(dir)).toContain('brand-new.txt');
  });

  it('flattens a hook exit of 2 onto git\'s own 1', () => {
    // A characterization, not a guard. `gate:control-bytes` exits 2
    // when it cannot run at all, and that 2 never reaches the caller.
    const cannotRun = plantRepo();
    plantHook(cannotRun, '#!/bin/sh\necho "cannot run" >&2\nexit 2\n');
    write(cannotRun, 'work.txt', 'done\n');
    const two = attempt(cannotRun, LONG_TASK);

    const refuses = plantRepo();
    plantHook(refuses, REJECTING_HOOK);
    write(refuses, 'work.txt', 'done\n');
    const one = attempt(refuses, LONG_TASK);

    expect(two.exitCode).toBe(1);
    expect(one.exitCode).toBe(1);

    // Which is why the message is the only thing that separates them.
    // A record carrying a constant reason would pass the two lines
    // above and fail here.
    expect(two.message).toContain('cannot run');
    expect(one.message).toContain('gate says no');
    expect(two.message).not.toBe(one.message);
  });

  it('carries a finding from either stream', () => {
    const dir = plantRepo();
    const noisy = [
      '#!/bin/sh',
      'echo "first finding" >&2',
      'echo "second finding" >&2',
      'echo "a note on stdout"',
      'exit 1',
      '',
    ].join('\n');
    plantHook(dir, noisy);
    write(dir, 'work.txt', 'done\n');

    const result = attempt(dir, LONG_TASK);

    // Both lines reach the message, and the one the hook wrote to
    // stdout reaches it through git's STDERR: git funnels a hook's
    // output onto its own error stream, measured, so a real hook
    // cannot put anything on `result.stdout` at all. That is why the
    // module's stderr-before-stdout ORDER is not asserted here — no
    // module mutation can move it through this fixture, and the
    // colocated stub case, which can, is where that claim lives.
    expect(result.message).toContain('first finding');
    expect(result.message).toContain('second finding');
    expect(result.message).toContain('a note on stdout');
    expect(result.message).not.toContain('[truncated]');

    // The near miss: a hook that refuses in silence. A module
    // attaching any constant reason passes every line above and
    // fails this one.
    const quiet = plantRepo();
    plantHook(quiet, '#!/bin/sh\nexit 1\n');
    write(quiet, 'work.txt', 'done\n');

    expect(attempt(quiet, LONG_TASK).message).toBe('');
  });
});

describe('a task text long enough to truncate', () => {
  it('cuts the subject and keeps the whole text', () => {
    // The fixture is asserted to REACH the branch. A task text that
    // quietly shrank under the cap would leave every line below
    // passing against a module with the truncation removed.
    expect(LONG_TASK.length).toBeGreaterThan(GIT_SUBJECT_CAP);

    const dir = plantRepo();
    write(dir, 'work.txt', 'done\n');
    const result = attempt(dir, LONG_TASK);

    expect(result.outcome).toBe('committed');
    expect(lastSubject(dir)).toBe(result.subject);
    expect(lastSubject(dir).length).toBeLessThanOrEqual(GIT_SUBJECT_CAP);
    expect(lastBody(dir)).toBe(normaliseTaskText(LONG_TASK));
    expect(lastBody(dir)).toContain('truncation in the subject');

    // The control, along the length axis: a short text in the same
    // repository keeps its whole sentence in the subject and writes
    // no body at all.
    write(dir, 'more.txt', 'done\n');
    attempt(dir, SHORT_TASK);

    expect(lastSubject(dir)).toBe('feat: add a refusal case');
    expect(lastBody(dir)).toBe('');
  });

  it('cuts at a word the source really contains', () => {
    const message = buildCommitMessage(LONG_TASK);
    const description = descriptionOf(message.subject);
    const tail = description.split(' ').pop() ?? '';

    expect(message.truncated).toBe(true);
    const whole = normaliseTaskText(LONG_TASK).toLowerCase();

    expect(whole.startsWith(description.toLowerCase())).toBe(true);
    expect(LONG_TASK.split(/\s+/)).toContain(tail);
    expect(description).not.toMatch(/[\s,;:-]$/);

    // The control: nothing is cut off a text that fits, so the whole
    // sentence survives as its own description.
    const short = buildCommitMessage(SHORT_TASK);

    expect(short.truncated).toBe(false);
    expect(descriptionOf(short.subject)).toBe('add a refusal case');
  });

  it('hard-cuts a first word longer than the budget', () => {
    // The one branch the colocated suite's fixtures never reach:
    // with no space inside the budget there is no word boundary to
    // cut at, and the module cuts mid-word rather than answering an
    // empty description.
    const unbreakable = 'Supercalifragilisticexpialidocious and a thing';
    const derived = deriveCommitSubject(unbreakable, { maxLength: 20 });

    expect(derived.subject).toBe('chore: supercalifrag');
    expect(derived.subject.length).toBe(20);
    expect(derived.truncated).toBe(true);

    // The control, along the one axis: the same budget over a text
    // that DOES carry a space inside it cuts at the boundary.
    const breakable = deriveCommitSubject('Add a thing that goes on', {
      maxLength: 20,
    });

    expect(breakable.subject).toBe('feat: add a thing');
    expect(breakable.truncated).toBe(true);
  });

  it('keeps a body line git would otherwise strip', () => {
    // `commit.cleanup=strip` is set explicitly because without it the
    // branch is unreachable: for a `-m` message git's default already
    // behaves as `whitespace`, so the flag defends against a
    // configuration rather than against the default.
    const dir = plantRepo([['commit.cleanup', 'strip']]);
    write(dir, 'work.txt', 'done\n');
    const result = attempt(dir, HASH_TASK);
    const expected = normaliseTaskText(HASH_TASK);

    expect(result.outcome).toBe('committed');
    expect(expected.startsWith('#')).toBe(true);
    expect(lastBody(dir)).toBe(expected);

    // The control: the same repository, the same body, committed
    // without the module's flag. git strips the line, which is what
    // says the assertion above is about `--cleanup=whitespace` and
    // not about git leaving every body alone.
    write(dir, 'more.txt', 'done\n');
    inRepo(dir, 'add', '-A');
    inRepo(dir, 'commit', '-q', '-m', 'chore: the same body', '-m', expected);

    expect(lastBody(dir)).toBe('');
    expect(lastSubject(dir)).toBe('chore: the same body');
  });
});

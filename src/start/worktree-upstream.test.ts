/**
 * Tests for `start/worktree-upstream.ts`: setting a branch's upstream
 * as a step of its own, tried again only while git says its config file
 * is locked.
 *
 * Most cases drive the step over a stubbed `GitRunner` that answers its
 * replies in turn and a stubbed pause, both writing to ONE log, so a
 * case reads the tries and the pauses in the order they happened. A try
 * past the planned replies THROWS, so a step that tried once more than a
 * case planned for reddens rather than reading an empty answer. Each
 * case sits beside the one it was varied from: the failure that is no
 * lock refusal beside the lock held past the last try, and that beside
 * the lock released after two pauses, so a step that always tried again
 * and one that never did both redden.
 *
 * The stubbed replies are what git 2.53.0 wrote under Linux with
 * `LC_ALL=C` on 2026-10-12, copied whole. The last block runs the same
 * functions against a real repository under the temporary directory, a
 * bare remote and a project pushed to it, with `.git/config.lock`
 * created by hand, so the lines the predicate matches are proven to be
 * the lines this machine's git writes and the argv is proven to be argv
 * git accepts. Nothing here waits: the pause is the stub in every case.
 * The planted project turns git's wait off (`core.configLockTimeout` 0, read
 * back by the first case of that block), since git 2.56 retries a held
 * config lock for a second per try on its own, past bun's test timeout.
 */
import type { Sleep } from './worktree-upstream.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa-pr/pr/index';

import {
  isConfigLockRefusal,
  setUpstream,
  UPSTREAM_PAUSE_MS,
  UPSTREAM_TRIES,
  upstreamArgv,
  upstreamRefusal,
} from './worktree-upstream.js';

/** The branch every stubbed case sets the upstream of. */
const BRANCH = 'feat/rafa-960';

/** The upstream line for that branch, as the plan spells it. */
const LINE = `git branch --set-upstream-to=origin/${BRANCH} ${BRANCH}`;

/** Chmod cannot deny a write to root; see the case of a git directory that may not be written. */
const IS_ROOT = process.getuid?.() === 0;

/** What the log holds for one pause. */
const PAUSE = `sleep ${UPSTREAM_PAUSE_MS}`;

/** git's hint beneath a failed upstream write; its last line names a ref that does not exist. */
const WRITE_HINT = [
  'hint:',
  'hint: After fixing the error cause you may try to fix up',
  'hint: the remote tracking information by invoking:',
  `hint:   git branch --set-upstream-to=origin/refs/heads/${BRANCH}`,
].join('\n');

/** git exited 1 with `first` as the line naming why the config file could not be locked. */
function writeRefused(first: string): GitResult {
  return {
    ok: false,
    stdout: '',
    stderr: `${first}\nerror: unable to write upstream branch configuration\n${WRITE_HINT}\n`,
  };
}

/** The lock refusal, run in the main checkout: git names the config file relative to it. */
const LOCKED = writeRefused('error: could not lock config file .git/config: File exists');

/** The same refusal run in a linked worktree: git names the shared config file in full. */
const LOCKED_FROM_WORKTREE = writeRefused('error: could not lock config file /srv/project/.git/config: File exists');

/** A git directory that cannot be written: the same line with another reason, which no pause clears. */
const NOT_WRITABLE = writeRefused('error: could not lock config file .git/config: Permission denied');

/** The remote has no such branch: exit 128, nothing about a lock. */
const NO_UPSTREAM: GitResult = {
  ok: false,
  stdout: '',
  stderr: [
    `fatal: the requested upstream branch 'origin/${BRANCH}' does not exist`,
    'hint:',
    'hint: If you are planning on basing your work on an upstream',
    'hint: branch that already exists at the remote, you may need to',
    'hint: run "git fetch" to retrieve it.',
    '',
  ].join('\n'),
};

/** git set the upstream, and said so on its standard output. */
const SET: GitResult = {
  ok: true,
  stdout: `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.\n`,
  stderr: '',
};

/** A stubbed git and a stubbed pause, with the one log both write to. */
interface World {
  readonly git: GitRunner;
  readonly sleep: Sleep;
  /** Every try as `git <args>` and every pause as `sleep <ms>`, in order. */
  readonly log: readonly string[];
}

/** A world whose git answers `replies` in turn and throws once they run out. */
function world(replies: readonly GitResult[]): World {
  const log: string[] = [];
  const pending = [...replies];
  return {
    git: (args) => {
      const command = `git ${args.join(' ')}`;
      const reply = pending.shift();
      if (reply === undefined) throw new Error(`no reply planned for: ${command} (after ${log.join(', ')})`);
      log.push(command);
      return reply;
    },
    sleep: (ms) => {
      log.push(`sleep ${ms}`);
    },
    log,
  };
}

describe('the names the plan fixes', () => {
  it('tries five times with 200 ms between tries', () => {
    expect(UPSTREAM_TRIES).toBe(5);
    expect(UPSTREAM_PAUSE_MS).toBe(200);
  });

  it('spells the upstream line with the branch on both sides', () => {
    expect(upstreamArgv(BRANCH)).toEqual(['git', 'branch', `--set-upstream-to=origin/${BRANCH}`, BRANCH]);
    expect(upstreamArgv(BRANCH).join(' ')).toBe(LINE);
    expect(Object.isFrozen(upstreamArgv(BRANCH))).toBe(true);
  });
});

describe('setUpstream over a stubbed git', () => {
  it('ends after one try on a failure that is no lock refusal', () => {
    const { git, sleep, log } = world([NO_UPSTREAM]);

    expect(setUpstream(git, BRANCH, sleep)).toBe(NO_UPSTREAM);
    expect(log).toEqual([LINE]);
  });

  it('gives up on a lock held past the last try, having paused between every two tries', () => {
    const { git, sleep, log } = world(Array.from({ length: UPSTREAM_TRIES }, () => LOCKED));

    expect(setUpstream(git, BRANCH, sleep)).toBe(LOCKED);
    expect(log).toEqual([LINE, PAUSE, LINE, PAUSE, LINE, PAUSE, LINE, PAUSE, LINE]);
    expect(log.filter((entry) => entry === LINE)).toHaveLength(UPSTREAM_TRIES);
    expect(log.filter((entry) => entry === PAUSE)).toHaveLength(UPSTREAM_TRIES - 1);
  });

  it('sets the upstream once a lock is released after two pauses', () => {
    const { git, sleep, log } = world([LOCKED, LOCKED, SET]);

    expect(setUpstream(git, BRANCH, sleep)).toBe(SET);
    expect(log).toEqual([LINE, PAUSE, LINE, PAUSE, LINE]);
  });

  it('never pauses when the first try sets the upstream', () => {
    const { git, sleep, log } = world([SET]);

    expect(setUpstream(git, BRANCH, sleep)).toBe(SET);
    expect(log).toEqual([LINE]);
  });

  it('ends at once on another failure that follows a lock refusal', () => {
    const { git, sleep, log } = world([LOCKED, NO_UPSTREAM]);

    expect(setUpstream(git, BRANCH, sleep)).toBe(NO_UPSTREAM);
    expect(log).toEqual([LINE, PAUSE, LINE]);
  });

  it('ends after one try on a config file it may not write, which no pause clears', () => {
    const { git, sleep, log } = world([NOT_WRITABLE]);

    expect(setUpstream(git, BRANCH, sleep)).toBe(NOT_WRITABLE);
    expect(log).toEqual([LINE]);
  });
});

describe('isConfigLockRefusal', () => {
  it('reads the refusal whichever way git names the config file', () => {
    expect(isConfigLockRefusal(LOCKED)).toBe(true);
    expect(isConfigLockRefusal(LOCKED_FROM_WORKTREE)).toBe(true);
  });

  it('reads the line of git 2.50.1 in issue #960, whose second line has no error prefix', () => {
    const asFiled = 'error: could not lock config file .git/config: File exists\nunable to write upstream branch configuration\n';

    expect(isConfigLockRefusal({ ok: false, stdout: '', stderr: asFiled })).toBe(true);
  });

  it('does not read a config file that could not be locked for another reason', () => {
    expect(isConfigLockRefusal(NOT_WRITABLE)).toBe(false);
  });

  it('does not read a failure that names no lock, nor a git that could not run', () => {
    expect(isConfigLockRefusal(NO_UPSTREAM)).toBe(false);
    expect(isConfigLockRefusal({ ok: false, stdout: '', stderr: '' })).toBe(false);
    expect(isConfigLockRefusal({
      ok: false,
      stdout: '',
      stderr: 'could not run git in /nonesuch: ENOENT: no such file or directory, posix_spawn \'git\'',
    })).toBe(false);
  });

  it('does not read a command that succeeded, whatever it wrote', () => {
    expect(isConfigLockRefusal(SET)).toBe(false);
    expect(isConfigLockRefusal({ ...LOCKED, ok: true })).toBe(false);
  });
});

describe('upstreamRefusal', () => {
  it('names the branch, the tries and the upstream line after a lock held past the last try', () => {
    expect(upstreamRefusal(BRANCH, LOCKED)).toBe([
      `❌ Could not set the upstream of ${BRANCH}: git's config file was still locked after ${UPSTREAM_TRIES} tries.`,
      '   error: could not lock config file .git/config: File exists',
      '   error: unable to write upstream branch configuration',
      '   Once that lock is gone, set the upstream with:',
      `     ${LINE}`,
    ].join('\n'));
  });

  it('leaves git\'s hint out of a lock refusal, since the line it names does not work', () => {
    const refusal = upstreamRefusal(BRANCH, LOCKED);

    expect(LOCKED.stderr).toContain(`origin/refs/heads/${BRANCH}`);
    expect(refusal).not.toContain('hint:');
    expect(refusal).not.toContain('refs/heads');
  });

  it('quotes git whole on a failure that is no lock refusal, and names the line that failed', () => {
    expect(upstreamRefusal(BRANCH, NO_UPSTREAM)).toBe([
      `❌ Could not set the upstream of ${BRANCH}.`,
      `   fatal: the requested upstream branch 'origin/${BRANCH}' does not exist`,
      '   hint:',
      '   hint: If you are planning on basing your work on an upstream',
      '   hint: branch that already exists at the remote, you may need to',
      '   hint: run "git fetch" to retrieve it.',
      '   The command that failed:',
      `     ${LINE}`,
    ].join('\n'));
  });

  it('quotes nothing when git said nothing', () => {
    expect(upstreamRefusal(BRANCH, { ok: false, stdout: '', stderr: '' })).toBe([
      `❌ Could not set the upstream of ${BRANCH}.`,
      '   The command that failed:',
      `     ${LINE}`,
    ].join('\n'));
  });
});

describe('setUpstream against a real repository', () => {
  let scratch = '';
  let project = '';
  let lock = '';

  /** Runs git in `cwd` with a fixed identity, under `LC_ALL=C`, and answers its trimmed stdout. */
  const run = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();

  /** A branch the remote holds and the project holds locally with no upstream, as `--no-track` leaves it. */
  const plant = (branch: string): void => {
    run(project, ['push', '-q', 'origin', `main:refs/heads/${branch}`]);
    run(project, ['fetch', '-q', 'origin']);
    run(project, ['branch', '--no-track', branch, `origin/${branch}`]);
  };

  /** What `branch.<branch>.merge` holds, or null when git has no such key. */
  const upstreamOf = (branch: string): string | null => {
    const read = createGitRunner(project)(['config', `branch.${branch}.merge`]);
    return read.ok
      ? read.stdout.trim()
      : null;
  };

  /** A pause that counts its calls and deletes the held lock on call `releaseOn`. */
  const pauses = (releaseOn: number | null): { readonly sleep: Sleep; readonly slept: number[] } => {
    const slept: number[] = [];
    return {
      sleep: (ms) => {
        slept.push(ms);
        if (slept.length === releaseOn) rmSync(lock);
      },
      slept,
    };
  };

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-upstream-')));
    const remote = join(scratch, 'remote.git');
    project = join(scratch, 'project');
    lock = join(project, '.git', 'config.lock');
    run(scratch, ['init', '-q', '--bare', remote]);
    run(scratch, ['init', '-q', '-b', 'main', project]);
    // git 2.56.0 added core.configLockTimeout (default 1000 ms, read from the
    // configuration on disk before the lock is taken), so git itself retries a
    // held .git/config.lock for about a second per try (#1371). Earlier git
    // ignores the key, so the cases read the same on every version and the
    // pauses they count are rafa's alone.
    run(project, ['config', 'core.configLockTimeout', '0']);
    run(project, ['commit', '-q', '--allow-empty', '-m', 'one']);
    run(project, ['remote', 'add', 'origin', remote]);
    run(project, ['push', '-q', 'origin', 'main']);
  });

  afterEach(() => {
    rmSync(lock, { force: true });
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('plants the project with git\'s config lock wait turned off', () => {
    expect(run(project, ['config', 'core.configLockTimeout'])).toBe('0');
  });

  it('sets the upstream at the first try with no lock held', () => {
    plant('feat/free');
    const { sleep, slept } = pauses(null);
    expect(upstreamOf('feat/free')).toBeNull();

    const result = setUpstream(createGitRunner(project), 'feat/free', sleep);

    expect(result.ok).toBe(true);
    expect(slept).toEqual([]);
    expect(upstreamOf('feat/free')).toBe('refs/heads/feat/free');
    expect(run(project, ['config', 'branch.feat/free.remote'])).toBe('origin');
  });

  it('gives up on a lock held past the last try, leaving the branch with no upstream', () => {
    plant('feat/held');
    writeFileSync(lock, '');
    const { sleep, slept } = pauses(null);

    const result = setUpstream(createGitRunner(project), 'feat/held', sleep);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('could not lock config file');
    expect(isConfigLockRefusal(result)).toBe(true);
    expect(slept).toEqual(Array.from({ length: UPSTREAM_TRIES - 1 }, () => UPSTREAM_PAUSE_MS));
    expect(upstreamOf('feat/held')).toBeNull();
    expect(upstreamRefusal('feat/held', result)).toContain('git branch --set-upstream-to=origin/feat/held feat/held');
  });

  it('sets the upstream once the lock is released on the second pause', () => {
    plant('feat/released');
    writeFileSync(lock, '');
    const { sleep, slept } = pauses(2);

    const result = setUpstream(createGitRunner(project), 'feat/released', sleep);

    expect(result.ok).toBe(true);
    expect(slept).toEqual([UPSTREAM_PAUSE_MS, UPSTREAM_PAUSE_MS]);
    expect(existsSync(lock)).toBe(false);
    expect(upstreamOf('feat/released')).toBe('refs/heads/feat/released');
  });

  it('ends after one try on a branch the remote has not got', () => {
    run(project, ['branch', '--no-track', 'feat/local-only', 'main']);
    const { sleep, slept } = pauses(null);

    const result = setUpstream(createGitRunner(project), 'feat/local-only', sleep);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('fatal: the requested upstream branch \'origin/feat/local-only\' does not exist');
    expect(isConfigLockRefusal(result)).toBe(false);
    expect(slept).toEqual([]);
  });

  it.skipIf(IS_ROOT)('reads a git directory it may not write as no lock refusal', () => {
    plant('feat/read-only');
    const gitDir = join(project, '.git');
    const mode = statSync(gitDir).mode;
    const { sleep, slept } = pauses(null);

    chmodSync(gitDir, 0o555);
    const result = (() => {
      try {
        return setUpstream(createGitRunner(project), 'feat/read-only', sleep);
      } finally {
        chmodSync(gitDir, mode);
      }
    })();

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('could not lock config file');
    expect(result.stderr).toContain('Permission denied');
    expect(isConfigLockRefusal(result)).toBe(false);
    expect(slept).toEqual([]);
  });
});

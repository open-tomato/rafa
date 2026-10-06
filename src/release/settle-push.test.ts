/**
 * Tests for `settleByPush` (`settle-push.ts`): the `push` delivery and
 * its refused-push rule, over real repositories — a bare origin, a
 * clone that lands commits on `main` as merges and other settles would,
 * and the caller's clone on a feature branch with work in flight, which
 * settles in the scratch worktree `withSettleWorktree` makes.
 *
 * A race is planted, not simulated: the worktree's runner is wrapped so
 * that just before a chosen push the other clone pushes to `main`, and
 * the push settle then makes is refused by git itself. The protected
 * branch is a `pre-receive` hook in the bare origin printing GitHub's
 * GH006 line, paired with a hook that declines in other words, so the
 * `protected` reading is shown to depend on the wording. A repository
 * rule is the same hook printing GitHub's GH013 text (#765), read as
 * `rule` beside GH006 still `protected` and `fetch first` still the
 * race; a raw `git push --porcelain` to that origin is the control that
 * git itself ends a refusal's stdout on `Done`, which no sentence may.
 */
import type { Fragment } from './fragment.js';
import type { SettlePushOutcome } from './settle-push.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { SettleSettings } from './settle.js';
import type { GitRunner } from '../pr/git.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { serializeFragment } from './fragment.js';
import { pushSaid, ruleText, SETTLE_PR_SETTING, settleByPush } from './settle-push.js';
import { withSettleWorktree } from './settle-worktree.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-settle-push-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The settings every case settles under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The manifest on `main`. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main`. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** GitHub's protected-branch line, as a pre-receive hook plants it. */
const GH006 = 'error: GH006: Protected branch update failed for refs/heads/main.';

/** GitHub's GH013 refusal on stderr, as #765 quotes it, one line per `echo`. */
const GH013 = [
  'error: GH013: Repository rule violations found for refs/heads/main.',
  'Review all repository rules at https://github.com/open-tomato/rafa/rules?ref=refs%2Fheads%2Fmain',
  '',
  '- Required status check \\"verify\\" is expected.',
  '',
];

/** A `pre-receive` hook printing `lines` to stderr and refusing. */
function refusingHook(lines: readonly string[]): string {
  return `#!/bin/sh\n${lines.map((line) => `echo "${line}" >&2`).join('\n')}\nexit 1\n`;
}

/** True when `sentence` has a line reading `Done`, git's porcelain success marker. */
function endsOnDone(sentence: string): boolean {
  return sentence.split('\n').some((line) => line.trim() === 'Done');
}

/** The environment every setup git runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: SETUP_DATE,
    GIT_COMMITTER_DATE: SETUP_DATE,
    LC_ALL: 'C',
  };
}

/** A fragment's text. */
function fragmentText(plan: string, level: Fragment['level'], notes: readonly string[]): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes });
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone. */
interface World {
  readonly origin: string;
  readonly caller: string;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes (text) or deletes (null) each path in the other clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string | null>>, message: string) => string;
  /** Plants `script` as the origin's `pre-receive` hook. */
  readonly refuseWith: (script: string) => void;
}

/** Builds a {@link World}; the caller is on `feat` with an uncommitted edit. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string | null>>, message: string): string => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) {
        git(other, ['rm', '-q', '--', path]);
        continue;
      }
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
    return git(other, ['rev-parse', 'HEAD']);
  };
  const refuseWith = (script: string): void => {
    const hook = join(origin, 'hooks', 'pre-receive');
    writeFileSync(hook, script);
    chmodSync(hook, 0o755);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(origin, ['config', 'core.hooksPath', join(origin, 'hooks')]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), MANIFEST);
  writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  git(dir, ['clone', '-q', origin, caller]);
  for (const [key, value] of [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]]) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'package.json'), `${MANIFEST}work in flight\n`);
  return { origin, caller, scratchRoot, git, land, refuseWith };
}

/** Lands `rafa-9` (minor) and then `rafa-1` (patch). */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor', ['- Walk: one hop']) }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', ['- Loop: a fix']) }, 'merge rafa-1');
}

/** What a settle answered, with every argv its worktree ran. */
interface Settled {
  readonly outcome: SettlePushOutcome;
  readonly argv: readonly (readonly string[])[];
}

/**
 * Runs `settleByPush` in a settle worktree of the caller's `origin/main`.
 * `beforePush[n]` runs just before the n-th push reaches git.
 */
async function settleIn(w: World, beforePush: readonly (() => void)[] = []): Promise<Settled> {
  const argv: string[][] = [];
  let pushes = 0;
  const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (made: SettleWorktree) => {
    const git: GitRunner = (args) => {
      argv.push([...args]);
      if (args[0] === 'push') {
        beforePush[pushes]?.();
        pushes += 1;
      }
      return made.git(args);
    };
    return settleByPush({ ...made, git }, SETTINGS);
  });
  if (!outcome.ok) throw new Error(outcome.problem);
  return { outcome: outcome.value, argv };
}

/** Origin's `main`, read from the bare repository. */
function originMain(w: World): string {
  return w.git(w.origin, ['rev-parse', 'refs/heads/main']);
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']);
  return listed === ''
    ? []
    : listed.split('\n');
}

/** The pushes a settle made. */
function pushesOf(settled: Settled): readonly (readonly string[])[] {
  return settled.argv.filter((args) => args[0] === 'push');
}

describe('settleByPush, a push nobody raced', () => {
  it('pushes the release commit to main and exits 0, leaving the caller\'s checkout as it was', async () => {
    const w = world();
    landTwo(w);
    const callerStatus = w.git(w.caller, ['status', '--porcelain']);

    const settled = await settleIn(w);

    expect(settled.outcome.outcome).toBe('pushed');
    if (settled.outcome.outcome !== 'pushed') return;
    expect(settled.outcome.exitCode).toBe(0);
    expect(settled.outcome.attempts).toBe(1);
    expect(settled.outcome.build.strategy).toBe('semver-by-level');
    expect(originMain(w)).toBe(settled.outcome.build.release);
    expect(w.git(w.origin, ['log', '-1', '--format=%s', 'main'])).toBe('chore: release 0.5.0');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.caller, ['branch', '--show-current'])).toBe('feat');
    expect(w.git(w.caller, ['status', '--porcelain'])).toBe(callerStatus);
    // The control: the same probe sees the caller's own work in flight.
    expect(callerStatus).toBe('M package.json');
  });

  it('never forces: every push names the release commit and main, with no force flag', async () => {
    const w = world();
    landTwo(w);

    const settled = await settleIn(w, [() => w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'patch', ['- Loop: late']) }, 'merge rafa-4')]);

    const pushes = pushesOf(settled);
    expect(pushes).toHaveLength(2);
    for (const push of pushes) {
      expect(push.slice(0, 3)).toEqual(['push', '--porcelain', 'origin']);
      expect(push[3]).toMatch(/^[0-9a-f]{40}:refs\/heads\/main$/);
      expect(push.some((arg) => arg.includes('force') || arg.startsWith('+') || arg === '-f')).toBe(false);
    }
  });

  it('pushes nothing and exits 0 when only none fragments wait', async () => {
    const w = world();
    const before = w.land({ '.changes/rafa-3.md': fragmentText('rafa-3', 'none', []) }, 'merge rafa-3');

    const settled = await settleIn(w);

    expect(settled.outcome.outcome).toBe('unsettled');
    expect(settled.outcome.exitCode).toBe(0);
    if (settled.outcome.outcome !== 'unsettled') return;
    expect(settled.outcome.build.outcome).toBe('nothing');
    expect(pushesOf(settled)).toEqual([]);
    expect(originMain(w)).toBe(before);
  });

  it('pushes nothing and exits 1 when the strategy throws', async () => {
    const w = world();
    w.land({ 'package.json': '{ "version": "not-a-version" }\n' }, 'break the version');
    landTwo(w);
    const before = originMain(w);

    const settled = await settleIn(w);

    expect(settled.outcome.outcome).toBe('unsettled');
    expect(settled.outcome.exitCode).toBe(1);
    if (settled.outcome.outcome !== 'unsettled') return;
    expect(settled.outcome.build.outcome).toBe('failed');
    expect(pushesOf(settled)).toEqual([]);
    expect(originMain(w)).toBe(before);
  });
});

describe('settleByPush, the refused-push rule', () => {
  it('exits 0 naming the settle that won when every folded fragment is gone', async () => {
    const w = world();
    landTwo(w);
    let winner = '';
    const race = (): void => {
      winner = w.land({ '.changes/rafa-9.md': null, '.changes/rafa-1.md': null }, 'chore: release 0.5.0');
    };

    const settled = await settleIn(w, [race]);

    expect(settled.outcome.outcome).toBe('superseded');
    if (settled.outcome.outcome !== 'superseded') return;
    expect(settled.outcome.exitCode).toBe(0);
    expect(settled.outcome.attempts).toBe(1);
    expect(settled.outcome.base).toBe(winner);
    expect(settled.outcome.winner).toEqual({ commit: winner, subject: 'chore: release 0.5.0' });
    expect(settled.outcome.sentence).toBe(`every fragment this settle folded is gone from origin/main: ${winner.slice(0, 12)} "chore: release 0.5.0" released them first`);
    expect(pushesOf(settled)).toHaveLength(1);
    expect(originMain(w)).toBe(winner);
  });

  it('rebuilds once over the new base and pushes again when a fragment arrived', async () => {
    const w = world();
    landTwo(w);
    let arrived = '';
    const race = (): void => {
      arrived = w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'major', ['- Store: new shape']) }, 'merge rafa-4');
    };

    const settled = await settleIn(w, [race]);

    expect(settled.outcome.outcome).toBe('pushed');
    if (settled.outcome.outcome !== 'pushed') return;
    expect(settled.outcome.attempts).toBe(2);
    expect(settled.outcome.build.commit).toBe(arrived);
    expect(settled.outcome.build.version).toBe('1.0.0');
    expect(settled.outcome.build.deleted).toEqual(['.changes/rafa-9.md', '.changes/rafa-1.md', '.changes/rafa-4.md']);
    expect(originMain(w)).toBe(settled.outcome.build.release);
    expect(w.git(w.origin, ['log', '-1', '--format=%s%n%P', 'main'])).toBe(`chore: release 1.0.0\n${arrived}`);
    expect(originFragments(w)).toEqual([]);
  });

  it('rebuilds with what is left when another settle released part of the batch', async () => {
    const w = world();
    landTwo(w);
    const race = (): void => {
      w.land({ '.changes/rafa-9.md': null, 'package.json': MANIFEST.replace('0.4.0', '0.5.0') }, 'chore: release 0.5.0');
    };

    const settled = await settleIn(w, [race]);

    expect(settled.outcome.outcome).toBe('pushed');
    if (settled.outcome.outcome !== 'pushed') return;
    expect(settled.outcome.attempts).toBe(2);
    expect(settled.outcome.build.baseVersion).toBe('0.5.0');
    expect(settled.outcome.build.version).toBe('0.5.1');
    expect(settled.outcome.build.deleted).toEqual(['.changes/rafa-1.md']);
    expect(originMain(w)).toBe(settled.outcome.build.release);
  });

  it('exits 1 when the retried push is refused too, pushing only twice', async () => {
    const w = world();
    landTwo(w);
    const arrive = (id: string) => (): void => {
      w.land({ [`.changes/${id}.md`]: fragmentText(id, 'patch', [`- Loop: ${id}`]) }, `merge ${id}`);
    };

    const settled = await settleIn(w, [arrive('rafa-4'), arrive('rafa-5')]);

    expect(settled.outcome.outcome).toBe('refused');
    if (settled.outcome.outcome !== 'refused') return;
    expect(settled.outcome.exitCode).toBe(1);
    expect(settled.outcome.attempts).toBe(2);
    expect(settled.outcome.sentence).toStartWith('origin main moved again while settle rebuilt, and the retried push of chore: release 0.5.0 was refused too');
    expect(settled.outcome.sentence).toContain('[rejected]');
    expect(settled.outcome.sentence).toContain('(fetch first)');
    expect(endsOnDone(settled.outcome.sentence)).toBe(false);
    expect(pushesOf(settled)).toHaveLength(2);
    expect(w.git(w.origin, ['log', '-1', '--format=%s', 'main'])).toBe('merge rafa-5');
    expect(originFragments(w)).toEqual(['.changes/rafa-1.md', '.changes/rafa-4.md', '.changes/rafa-5.md', '.changes/rafa-9.md']);
  });

  it('answers unpushed, exit 1, when the base cannot be fetched after the refusal', async () => {
    const w = world();
    landTwo(w);
    const argv: string[][] = [];
    const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (made) => {
      let raced = false;
      const git: GitRunner = (args) => {
        argv.push([...args]);
        if (args[0] === 'push' && !raced) {
          raced = true;
          w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'patch', ['- Loop: late']) }, 'merge rafa-4');
        }
        if (args[0] === 'fetch') return { ok: false, stdout: '', stderr: 'planted fetch failure' };
        return made.git(args);
      };
      return settleByPush({ ...made, git }, SETTINGS);
    });

    if (!outcome.ok) throw new Error(outcome.problem);
    expect(outcome.value.outcome).toBe('unpushed');
    expect(outcome.value.exitCode).toBe(1);
    if (outcome.value.outcome !== 'unpushed') return;
    expect(outcome.value.sentence).toBe('main could not be fetched from origin after the refused push: planted fetch failure');
    expect(argv.filter((args) => args[0] === 'push')).toHaveLength(1);
  });
});

describe('settleByPush, a protected base', () => {
  it('exits 1 naming release.settle: pr when the forge refuses a protected branch, without retrying', async () => {
    const w = world();
    landTwo(w);
    const before = originMain(w);
    w.refuseWith(`#!/bin/sh\necho "${GH006}" >&2\nexit 1\n`);

    const settled = await settleIn(w);

    expect(settled.outcome.outcome).toBe('protected');
    if (settled.outcome.outcome !== 'protected') return;
    expect(settled.outcome.exitCode).toBe(1);
    expect(settled.outcome.attempts).toBe(1);
    expect(settled.outcome.sentence).toContain(`set ${SETTLE_PR_SETTING} to deliver it through a pull request`);
    expect(SETTLE_PR_SETTING).toBe('release.settle: pr');
    expect(settled.outcome.sentence).toContain('GH006');
    expect(endsOnDone(settled.outcome.sentence)).toBe(false);
    expect(pushesOf(settled)).toHaveLength(1);
    expect(originMain(w)).toBe(before);
  });

  it('answers a hook refusal in other words as unpushed, naming no setting (the control)', async () => {
    const w = world();
    landTwo(w);
    w.refuseWith('#!/bin/sh\necho "planted: commit messages must carry a ticket" >&2\nexit 1\n');

    const settled = await settleIn(w);

    expect(settled.outcome.outcome).toBe('unpushed');
    if (settled.outcome.outcome !== 'unpushed') return;
    expect(settled.outcome.exitCode).toBe(1);
    expect(settled.outcome.sentence).toStartWith('chore: release 0.5.0 could not be pushed to origin main: ');
    expect(settled.outcome.sentence).toContain('[remote rejected] (pre-receive hook declined)');
    expect(settled.outcome.sentence).not.toContain(SETTLE_PR_SETTING);
    expect(pushesOf(settled)).toHaveLength(1);
  });

  it('answers protected on the retried push too', async () => {
    const w = world();
    landTwo(w);
    const race = (): void => {
      w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'patch', ['- Loop: late']) }, 'merge rafa-4');
      w.refuseWith(`#!/bin/sh\necho "${GH006}" >&2\nexit 1\n`);
    };

    const settled = await settleIn(w, [race]);

    expect(settled.outcome.outcome).toBe('protected');
    expect(settled.outcome.attempts).toBe(2);
    expect(pushesOf(settled)).toHaveLength(2);
  });
});

describe('settleByPush, a repository rule', () => {
  it('exits 1 not delivered, in one line naming the rule GitHub gave and release.settle: pr, without retrying', async () => {
    const w = world();
    landTwo(w);
    const before = originMain(w);
    w.refuseWith(refusingHook(GH013));

    const settled = await settleIn(w);

    expect(settled.outcome.outcome).toBe('rule');
    if (settled.outcome.outcome !== 'rule') return;
    expect(settled.outcome.exitCode).toBe(1);
    expect(settled.outcome.attempts).toBe(1);
    expect(settled.outcome.sentence).toBe('origin main refused chore: release 0.5.0 under a repository rule: Required status check "verify" is expected.'
      + ' No retry can push it, so it is not delivered; set release.settle: pr in .rafa/config.yaml to deliver it through a pull request.');
    expect(settled.outcome.sentence).not.toContain('\n');
    expect(pushesOf(settled)).toHaveLength(1);
    expect(originMain(w)).toBe(before);
    expect(originFragments(w)).toEqual(['.changes/rafa-1.md', '.changes/rafa-9.md']);
  });

  it('is the control: git itself ends the refused push\'s porcelain stdout on Done, exiting 1', () => {
    const w = world();
    w.refuseWith(refusingHook(GH013));
    w.git(w.caller, ['commit', '-q', '-am', 'probe']);

    let stdout = '';
    let status = 0;
    try {
      w.git(w.caller, ['push', '--porcelain', 'origin', 'HEAD:refs/heads/main']);
    } catch (error) {
      const failure = error as { stdout: string; status: number };
      stdout = failure.stdout;
      status = failure.status;
    }

    expect(status).toBe(1);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe('Done');
    expect(stdout).toContain('[remote rejected] (pre-receive hook declined)');
  });

  it('reads GH006 as protected and a moved base as the race beside the same GH013 reading', async () => {
    const guarded = world();
    landTwo(guarded);
    guarded.refuseWith(refusingHook([GH006]));
    const raced = world();
    landTwo(raced);
    const race = (): void => {
      raced.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'patch', ['- Loop: late']) }, 'merge rafa-4');
      raced.refuseWith(refusingHook(GH013));
    };

    const protectedOne = await settleIn(guarded);
    const racedOne = await settleIn(raced, [race]);

    expect(protectedOne.outcome.outcome).toBe('protected');
    expect(racedOne.outcome.outcome).toBe('rule');
    expect(racedOne.outcome.attempts).toBe(2);
    expect(pushesOf(racedOne)).toHaveLength(2);
  });
});

describe('ruleText', () => {
  it('joins every rule GitHub lists after the GH013 line, remote prefixes and padding dropped', () => {
    const stderr = [
      'remote: error: GH013: Repository rule violations found for refs/heads/main.        ',
      'remote: Review all repository rules at https://github.com/o/r/rules        ',
      'remote: ',
      'remote: - Changes must be made through a pull request.        ',
      'remote: - Required status check "verify" is expected.        ',
      'remote: ',
    ].join('\n');

    expect(ruleText(stderr, 'push declined')).toBe('Changes must be made through a pull request. Required status check "verify" is expected.');
  });

  it('answers the GH013 line when no rule is listed, and the reason when the remote said nothing of a rule', () => {
    expect(ruleText('remote: error: GH013: Repository rule violations found for refs/heads/main.', 'x')).toBe('error: GH013: Repository rule violations found for refs/heads/main.');
    expect(ruleText('', 'push declined due to repository rule violations')).toBe('push declined due to repository rule violations');
  });
});

describe('pushSaid', () => {
  it('drops the To and Done lines of a porcelain refusal and keeps stderr and the status line', () => {
    const said = pushSaid({
      ok: false,
      stdout: 'To /tmp/origin.git\n!\tHEAD:refs/heads/main\t[remote rejected] (pre-receive hook declined)\nDone\n',
      stderr: 'remote: planted\nerror: failed to push some refs to \'/tmp/origin.git\'\n',
    });

    expect(said).toBe('remote: planted\nerror: failed to push some refs to \'/tmp/origin.git\'\n!\tHEAD:refs/heads/main\t[remote rejected] (pre-receive hook declined)');
    expect(endsOnDone(said)).toBe(false);
  });
});

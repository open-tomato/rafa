/**
 * The 0.25.0 incident (`src/release/guard.ts`'s own module note), replayed
 * end to end over two REAL spawns of `bun src/rafa.ts`: two clones of one
 * bare origin, a stand-in `gh` on the operator clone's `PATH`, and the
 * three commands an operator would actually type, in order.
 *
 * `merge-guard.test.ts` already proves the release guard's `collision`
 * refusal, and `triage-convert.test.ts` already proves the
 * `conflict-version` conversion — both in process, over functions handed a
 * reading or a stub provider directly. This file's own question is
 * narrower: whether the REGISTERED commands, spawned the way an operator's
 * shell would, reach the same answers over a real `gh` on the `PATH` and a
 * real git history — `rafa pr merge` refusing with both sides named,
 * `rafa pr triage` printing `conflict-version`, and `rafa pr triage
 * --resolve` pushing the conversion — with nothing stubbed but the one
 * process nothing here can reach: GitHub itself.
 *
 * ## The two clones
 *
 * `other` is the clone that BUILDS the incident and is never spawned into:
 * it forks at 0.24.0, releases 0.25.0 on `main`, and only then — from the
 * ORIGINAL 0.24.0 commit, not from the new tip — stamps a branch with
 * 0.25.0 of its own and pushes it, so the branch's stamp lands on `origin`
 * chronologically AFTER the base's release, exactly as the module note
 * tells the incident. `caller` is a second, independent clone of the same
 * bare origin: the operator's own checkout, where every `rafa` invocation
 * below is spawned, and which starts out knowing nothing the `other` clone
 * did until its own commands fetch it.
 *
 * ## The stand-in `gh`
 *
 * Both branches read as `mergeable: MERGEABLE` — the version NUMBER
 * collides; the text does not, so GitHub reports no conflict, the same
 * reading `merge-guard.test.ts`'s own collision case takes. The checks
 * read empty (verdict `none`), which keeps `rafa pr triage`'s re-run
 * reading from short-circuiting to "green, nothing to triage" before the
 * release guard is ever asked (`src/pr/triage/rerun.ts`: a verdict of
 * `green` answers that regardless of what the guard would say), and `rafa
 * pr merge` is run with `--skip-checks` so the ordinary "no checks"
 * refusal never masks the guard's own. `--no-hint` is on every line so the
 * ending's own reading of what follows spawns nothing the stand-in was not
 * built to answer.
 *
 * ## Why the first `pr triage` is run with `--no-comment`
 *
 * The stored triage comment pins a re-run to the head it was read at
 * (`already-assessed`), and an unmoved head between the plain print and
 * `--resolve` would make the SECOND call read its own first comment back
 * and assess nothing at all. `--no-comment` on the first keeps the second
 * call's read of the comments endpoint empty, so `--resolve` still finds a
 * fresh pull request to classify.
 */
import type { ScratchRepo } from '../../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseFragment } from '../../release/fragment.js';
import { plantProjectConfig, runRafa } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-version-collision-incident-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned run may take before this file gives up waiting on it. */
const SPAWN_TIMEOUT_MS = 30_000;

/** The base branch, released 0.25.0 before the incident branch stamps it too. */
const BASE = 'main';

/** The incident branch: forked at 0.24.0, stamped 0.25.0 after `main` already had. */
const BRANCH = 'feat/rafa-999-parallel-thing';

/** Its pull request. */
const NUMBER = 999;

/** Its author, listed in `board.trustedAuthors` so `--resolve` spends no permission lookup. */
const AUTHOR = 'someone';

/** The fragment `--resolve` converts the stamp into, named off the branch's own last segment. */
const FRAGMENT = '.changes/rafa-999-parallel-thing.md';

/** The project config: `gh` named outright, and the author trusted without a lookup. */
const CONFIG_TEXT = [
  'pr:',
  '  provider: gh',
  'board:',
  '  trustedAuthors:',
  `    - ${AUTHOR}`,
  '',
].join('\n');

/** The environment every setup git command runs under, isolated from the operator's own config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    LC_ALL: 'C',
  };
}

/** A manifest declaring `version`. */
function manifest(version: string): string {
  return `{\n  "name": "demo",\n  "version": "${version}"\n}\n`;
}

/** A changelog with one section per `[version, note]`, newest first, one heading text shared by both sides. */
function changelog(...sections: readonly (readonly [string, string])[]): string {
  return ['# Changelog', '', ...sections.flatMap(([version, note]) => [`## ${version} — 2026-09-28, a plan`, '', note, ''])]
    .join('\n');
}

/** A bare origin, and the clone (`other`) that builds the incident on it without ever being spawned into. */
interface World {
  readonly origin: string;
  readonly dir: string;
  readonly other: string;
  /** Runs git in `cwd`, isolated under this world's own home. */
  readonly git: (cwd: string, args: readonly string[]) => string;
}

/** What building the incident on `other` leaves behind. */
interface Incident {
  /** The branch's head commit, right after it stamped 0.25.0 and was pushed. */
  readonly branchHead: string;
}

/** A bare origin with `other` cloned from it, holding nothing yet. */
function world(): World {
  const dir = tempBase;
  const home = join(dir, 'setup-home');
  const origin = join(dir, 'origin.git');
  const other = join(dir, 'other');
  mkdirSync(home, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: isolatedEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(dir, ['init', '-q', '--bare', `--initial-branch=${BASE}`, origin]);
  git(dir, ['clone', '-q', origin, other]);
  for (const [key, value] of [
    ['user.name', 'rafa incident'],
    ['user.email', 'incident@example.invalid'],
    ['commit.gpgsign', 'false'],
  ] as const) git(other, ['config', key, value]);
  return { origin, dir, other, git };
}

/** Writes `files` under `dir`, creating directories as it goes. */
function writeFiles(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text, 'utf8');
  }
}

/**
 * Builds the incident on `w.other` and pushes both sides of it: `main`
 * forks at 0.24.0, releases 0.25.0 with its own note, and only then does
 * the branch — created from the ORIGINAL 0.24.0 commit — stamp 0.25.0
 * with a different note and get pushed. See the module note.
 */
function plantIncident(w: World): Incident {
  const { other, git } = w;
  writeFiles(other, {
    '.gitignore': '.rafa/\n',
    'package.json': manifest('0.24.0'),
    'CHANGELOG.md': changelog(['0.24.0', '- loop: the first note']),
    'src/a.ts': 'a\n',
  });
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'fork']);
  git(other, ['push', '-q', 'origin', BASE]);
  const forkSha = git(other, ['rev-parse', 'HEAD']);

  writeFiles(other, {
    'package.json': manifest('0.25.0'),
    'CHANGELOG.md': changelog(['0.25.0', '- loop: the base note'], ['0.24.0', '- loop: the first note']),
  });
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'chore: release 0.25.0']);
  git(other, ['push', '-q', 'origin', BASE]);

  git(other, ['switch', '-q', '-c', BRANCH, forkSha]);
  writeFiles(other, {
    'src/a.ts': 'a, changed\n',
    'package.json': manifest('0.25.0'),
    'CHANGELOG.md': changelog(['0.25.0', '- loop: the branch note'], ['0.24.0', '- loop: the first note']),
  });
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'feat: stamped 0.25.0']);
  git(other, ['push', '-q', '-u', 'origin', BRANCH]);
  const branchHead = git(other, ['rev-parse', 'HEAD']);
  git(other, ['switch', '-q', BASE]);

  return { branchHead };
}

/**
 * Clones `w`'s origin into a second, independent directory: the
 * operator's own checkout, configured as its own project and given a git
 * identity of its own so a commit it makes is never mistaken for one
 * `other` made.
 */
function caller(w: World): ScratchRepo {
  const dir = join(w.dir, 'caller');
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const repo = join(dir, 'repo');
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  w.git(w.dir, ['clone', '-q', w.origin, repo]);
  for (const [key, value] of [
    ['user.name', 'rafa operator'],
    ['user.email', 'operator@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', join(w.dir, 'no-hooks')],
  ] as const) w.git(repo, ['config', key, value]);
  plantProjectConfig(repo, CONFIG_TEXT);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, bin, callLog: join(dir, 'gh.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** The pull request `gh pr view --json ...` answers with, both sides read as mergeable; see the module note. */
function detailJson(branchHead: string): string {
  return JSON.stringify({
    number: NUMBER,
    title: 'A parallel thing',
    url: `https://github.com/open-tomato/demo/pull/${String(NUMBER)}`,
    state: 'OPEN',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: AUTHOR, is_bot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-29T12:00:00Z',
    body: '',
    headRefOid: branchHead,
    labels: [],
    closingIssuesReferences: [],
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
  });
}

/** What a posted or edited triage comment is answered as. */
const COMMENT_JSON = JSON.stringify({
  id: 1,
  user: { login: 'rafa-bot', type: 'User' },
  body: 'a triage comment',
  updated_at: '2026-09-29T12:00:00Z',
  html_url: `https://github.com/open-tomato/demo/pull/${String(NUMBER)}#issuecomment-1`,
});

/**
 * Writes the stand-in `gh` into `scratch.bin`, logging every call to
 * `scratch.callLog`. Answers `pr view`, `pr checks` (always no rows), the
 * comments endpoint (empty read, a canned write) and the workflow count;
 * anything else exits 1 naming the call, so a shape this file did not
 * plan for reddens loud rather than answering something that happens to
 * parse.
 */
function plantStandInGh(scratch: ScratchRepo, branchHead: string): void {
  const gh = join(scratch.bin, 'gh');
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${scratch.callLog}'`,
    'case "$1 $2" in',
    '  "pr view")',
    `    printf '%s' '${detailJson(branchHead)}'`,
    '    ;;',
    '  "pr checks")',
    '    printf \'%s\' \'[]\'',
    '    ;;',
    '  "api "*)',
    '    case "$*" in',
    '      *"-X POST"*)',
    `        printf '%s' '${COMMENT_JSON}'`,
    '        ;;',
    '      *"actions/workflows")',
    '        printf \'%s\' \'{"total_count":0}\'',
    '        ;;',
    '      *"/comments")',
    '        printf \'%s\' \'[]\'',
    '        ;;',
    '      *)',
    '        echo "rafa-version-collision-incident-test: stand-in gh got an unplanned api call: $*" >&2',
    '        exit 1',
    '        ;;',
    '    esac',
    '    ;;',
    '  *)',
    '    echo "rafa-version-collision-incident-test: stand-in gh got an unplanned call: $*" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(gh, script, 'utf8');
  chmodSync(gh, 0o755);
}

describe('the 0.25.0 incident, replayed over two spawned clones of one bare origin', () => {
  it(
    'rafa pr merge refuses with both sides named, rafa pr triage prints conflict-version,'
      + ' and --resolve leaves the branch with a fragment and the merge base\'s version',
    () => {
      const w = world();
      const incident = plantIncident(w);
      const scratch = caller(w);
      plantStandInGh(scratch, incident.branchHead);

      const merge = runRafa(scratch, scratch.repo, ['pr', 'merge', String(NUMBER), '--skip-checks', '--no-hint']);

      expect(merge.exitCode).toBe(1);
      expect(merge.stdout).toBe('');
      expect(merge.stderr).toContain(
        `❌ rafa pr merge refuses #${String(NUMBER)}: its release guard reads collision,`
          + ' which only dangerous.acceptVersionCollision lets through.',
      );
      expect(merge.stderr).toContain(
        `Release guard: collision — ${BRANCH} stamps 0.25.0, which origin/${BASE} already names with different notes`,
      );
      const mergeLines = merge.stderr.split('\n').filter((line) => line.trim() !== '');
      expect(mergeLines.some((line) => line.trim().startsWith(`branch: ${BRANCH} (pull request #${String(NUMBER)}): package.json 0.25.0`))).toBe(true);
      expect(mergeLines.some((line) => line.trim().startsWith(`base:   origin/${BASE}: package.json 0.25.0`))).toBe(true);
      expect(mergeLines.at(-1)?.trim()).toBe(`fix:    rafa pr triage ${String(NUMBER)} --resolve`);

      const triage = runRafa(scratch, scratch.repo, ['pr', 'triage', String(NUMBER), '--no-comment', '--no-hint']);

      expect(triage.exitCode).toBe(0);
      expect(triage.stdout).toContain('conflict-version');
      expect(triage.stdout).toContain(
        'Why: the release guard reads collision: the branch stamped 0.25.0, which the base already names with different notes;'
          + ` to turn the stamp into a fragment, run rafa pr triage ${String(NUMBER)} --resolve`,
      );
      // `--no-comment` wrote nothing, so the second call below still finds a fresh pull request to classify.
      expect(triage.stdout).toContain('No comment was written.');

      const resolve = runRafa(scratch, scratch.repo, ['pr', 'triage', String(NUMBER), '--resolve', '--no-hint']);

      expect(resolve.exitCode).toBe(0);
      expect(resolve.stdout).toContain(
        `✅ #${String(NUMBER)}: Converted the stamped 0.25.0 into ${FRAGMENT} (level minor): package.json back to 0.24.0`,
      );
      expect(resolve.stdout).toContain(`Pushed ${BRANCH}; run rafa pr triage ${String(NUMBER)} once its checks have run on the new head.`);

      // The push landed on the ORIGIN, not merely in the caller's own worktree.
      const onOrigin = (args: readonly string[]): string => w.git(w.origin, args);
      const convertedHead = onOrigin(['rev-parse', BRANCH]);
      expect(convertedHead).not.toBe(incident.branchHead);
      expect(onOrigin(['rev-parse', `${BRANCH}^`])).toBe(incident.branchHead);
      expect(onOrigin(['show', `${BRANCH}:package.json`])).toBe(manifest('0.24.0').trim());
      const fragment = parseFragment(`${onOrigin(['show', `${BRANCH}:${FRAGMENT}`])}\n`);
      expect(fragment).toMatchObject({
        ok: true,
        fragment: { plan: 'rafa-999-parallel-thing', level: 'minor', notes: ['- loop: the branch note'] },
      });
      // The worktree `--resolve` added is gone, and the caller's own checkout untouched.
      expect(w.git(scratch.repo, ['status', '--porcelain'])).toBe('');
      expect(w.git(scratch.repo, ['worktree', 'list', '--porcelain'])).not.toContain('pr-999');
    },
    SPAWN_TIMEOUT_MS,
  );
});

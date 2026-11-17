/**
 * Tests for the ending each `rafa release settle` outcome prints (spec
 * part 1, `settle-endings.ts`), over real repositories: a bare origin,
 * a clone landing fragments on `main`, and the caller's clone on a
 * feature branch, which holds no `main`, so the merge and tag steps
 * follow a `git switch main` step.
 *
 * Each outcome is read in text and in JSON mode: a push delivery ends on
 * the merge and tag steps, a pull request delivery on `rafa pr wait`
 * then the same two, nothing to settle on its sentence, and a dry run
 * that would fold on `rafa release settle`. JSON carries the steps as
 * the result's `next` list, `skill` null while `hints.skills` is off.
 */
import type { PlantedProject } from '../../../cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';
import type { PullRequestDraft, PullRequestSummary } from '@open-tomato/rafa/pr/types';
import type { ReleaseSettleSeams } from '@open-tomato/rafa-release/commands/release/settle';
import type { ReleaseStepEntry } from '@open-tomato/rafa-release/commands/release/step-cases';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { serializeFragment } from '@open-tomato/rafa/release/fragment';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { createReleaseSettleCommand } from '@open-tomato/rafa-release/commands/release/settle';

import { projectConfigText } from '../../../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../../cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The one subject the dispatch cases register. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The manifest on `main`. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main`. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** A remote `resolvePrProvider` reads as GitHub. */
const GITHUB_REMOTE = 'https://github.com/open-tomato/demo.git';

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
function fragmentText(plan: string, level: 'patch' | 'minor' | 'major', notes: readonly string[] = ['- Loop: a line']): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, package: null, notes });
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone as a project. */
interface World {
  readonly origin: string;
  readonly project: PlantedProject;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes each path in the other clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string) => void;
}

/**
 * Builds a {@link World} whose caller holds `.rafa/config.yaml` with
 * `extra` appended; `main` holds no changelog when `changelog` is false.
 */
function world(extra = '', changelog = true): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string>>, message: string): void => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), MANIFEST);
  if (changelog) writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  git(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]];
  for (const [key, value] of settings) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'package.json'), `${MANIFEST}work in flight\n`);
  plantProjectConfig(caller, `${projectConfigText()}${extra}`);
  return { origin, project: { root: caller, home }, scratchRoot, git, land };
}

/** Lands `rafa-9` (minor) and then `rafa-1` (patch). */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch') }, 'merge rafa-1');
}

/** Dispatches `rafa release settle` with `words` in the world's caller. */
async function settle(
  w: World,
  words: readonly string[] = [],
  seams: ReleaseSettleSeams = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const command: RafaCommand = createReleaseSettleCommand({ scratchRoot: w.scratchRoot, ...seams });
  return dispatchInProject(['release', 'settle', ...words], SUBJECTS, [command], w.project);
}

/** A double with no release pull request open, opening #12. */
function opening(): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({
    findOpen: () => Promise.resolve(null),
    create: (draft: PullRequestDraft) => Promise.resolve({
      number: 12,
      title: draft.title,
      url: 'https://github.com/open-tomato/demo/pull/12',
      state: 'open',
      headRefName: draft.head,
      baseRefName: draft.base,
      author: { login: 'rafa', isBot: false },
      isCrossRepository: false,
      updatedAt: SETUP_DATE,
    } satisfies PullRequestSummary),
  });
}

/** The `Next:` block of `text`: its step lines, trimmed, up to the end. */
function nextBlock(text: string): string[] {
  const lines = text.split('\n');
  const at = lines.lastIndexOf('Next:');
  return at < 0
    ? []
    : lines.slice(at + 1).map((line) => line.trim())
      .filter((line) => line !== '');
}

/** The commands of a text `Next:` block, each step cut at its why. */
function commandsOf(text: string): string[] {
  return nextBlock(text).map((line) => line.split(' — ')[0] ?? line);
}

/** The result event's `next` list in json mode. */
function nextOf(stdout: string): readonly ReleaseStepEntry[] {
  const data = (eventsOf(stdout).at(-1) as { data?: { next?: readonly ReleaseStepEntry[] } }).data;
  return data?.next ?? [];
}

const SWITCH = 'git switch main';
const MERGE = 'git merge --ff-only origin/main';
const TAG = 'rafa release tag --push';

/** The commands of the steps, any `cd <root> &&` placing left off. */
function bare(commands: readonly string[]): string[] {
  return commands.map((command) => command.replace(/^cd \S+ && /, ''));
}

/** The `{ command, case, skill }` of each entry, with any placing left off the command. */
function entries(next: readonly ReleaseStepEntry[]): { command: string; case: string | null; skill: string | null }[] {
  return next.map((step) => ({ command: bare([step.command])[0] ?? '', case: step.case, skill: step.skill }));
}

describe('the ending of rafa release settle, text and json', () => {
  it('ends a push delivery on a switch to main, the merge and the tag, as text', async () => {
    const w = world();
    landTwo(w);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(bare(commandsOf(run.stdout))).toEqual([SWITCH, MERGE, TAG]);
  });

  it('carries the push steps in json with their case and a null skill', async () => {
    const w = world();
    landTwo(w);

    const run = await settle(w, ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(entries(nextOf(run.stdout))).toEqual([
      { command: SWITCH, case: 'settle-push', skill: null },
      { command: MERGE, case: 'settle-push', skill: null },
      { command: TAG, case: 'settle-push', skill: null },
    ]);
  });

  it('ends a pull request delivery on rafa pr wait, then the switch, merge and tag', async () => {
    const w = world('release:\n  settle: pr\n');
    landTwo(w);
    const double = opening();

    const run = await settle(w, [], { pullRequests: () => double.pulls, readRemote: () => GITHUB_REMOTE });

    expect(run.exitCode).toBe(0);
    expect(bare(commandsOf(run.stdout))).toEqual(['rafa pr wait 12', SWITCH, MERGE, TAG]);
    expect(nextBlock(run.stdout)[0]).toContain('release pull request #12');
  });

  it('carries the pull request steps in json', async () => {
    const w = world('release:\n  settle: pr\n');
    landTwo(w);
    const double = opening();

    const run = await settle(w, ['--output=json'], { pullRequests: () => double.pulls, readRemote: () => GITHUB_REMOTE });

    expect(run.exitCode).toBe(0);
    expect(entries(nextOf(run.stdout)).map((step) => [step.command, step.case])).toEqual([
      ['rafa pr wait 12', 'settle-pr'],
      [SWITCH, 'settle-pr'],
      [MERGE, 'settle-pr'],
      [TAG, 'settle-pr'],
    ]);
  });

  it('ends nothing to settle on the nothing sentence and no step, as text and with an empty next in json', async () => {
    const w = world();

    const run = await settle(w);
    const json = await settle(w, ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Nothing to settle');
    expect(run.stdout).toContain('Nothing to tag either: every unit keeps its version.');
    expect(run.stdout).not.toContain('Next:');
    expect(json.exitCode).toBe(0);
    expect(nextOf(json.stdout)).toEqual([]);
  });

  it('ends a dry run that would fold on rafa release settle, without --dry-run, and writes nothing', async () => {
    const w = world();
    landTwo(w);
    const before = w.git(w.origin, ['rev-parse', 'main']);

    const run = await settle(w, ['--dry-run']);
    const json = await settle(w, ['--dry-run', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(commandsOf(run.stdout)).toEqual(['rafa release settle']);
    expect(commandsOf(run.stdout)[0]).not.toContain('--dry-run');
    expect(entries(nextOf(json.stdout))).toEqual([{ command: 'rafa release settle', case: null, skill: null }]);
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
  });

  it('ends a dry run with nothing to settle on the nothing sentence, with no step', async () => {
    const w = world();

    const run = await settle(w, ['--dry-run']);
    const json = await settle(w, ['--dry-run', '--output=json']);

    expect(run.stdout).toContain('Nothing to tag either: every unit keeps its version.');
    expect(run.stdout).not.toContain('Next:');
    expect(nextOf(json.stdout)).toEqual([]);
  });
});

/**
 * Spawned `bun src/rafa.ts` proof for the last task of
 * `.rafa/specs/rafa-246-epic-lifecycle.md`'s "The end of an epic, and
 * the merge tick": `rafa next --dry-run` over a fixture whose current
 * epic ran dry, `rafa pr merge` ticking a fixture member's line on its
 * epic's checklist beside the roadmap's own, and the hard rule that a
 * project with no epic prints `rafa next` and `rafa pr merge` output
 * byte-identical to what they always wrote.
 *
 * ## The end of an epic (`src/next/epic-end.ts`)
 *
 * One fixture, read twice: a roadmap naming one epic whose only member
 * is closed, so the walk descends into it and finds nothing left. The
 * first run reads a `CHANGELOG.md` naming a version no tag holds, so
 * `rafa next --dry-run` ends with all three lines; the second reads the
 * same fixture with that version tagged, so the release line is left
 * off. Every earlier line is read off the real state table
 * (`src/next/state.ts`), which this stage never touches, so only the
 * SUFFIX naming the epic is asserted, byte for byte, built from
 * {@link epicEndLines} itself rather than duplicated by hand.
 *
 * ## The merge tick (`src/commands/pr/merge-tick.ts`)
 *
 * A real git repository, merged for real: `merge-driven.test.ts`'s own
 * shape, spawned here instead of dispatched in-process, with a stand-in
 * `gh` answering the pull request, its checks, the merge itself and the
 * board reads and writes the tick sends. #20 is a closed member of epic
 * #252 AND named on the roadmap's own checklist directly, so one merge
 * proves both halves of the fix at once: the epic's line ticked, and
 * the roadmap's still ticked exactly as it always was.
 *
 * ## The hard rule
 *
 * The last suite runs the same merge over a repository with no epic
 * issue at all, closing an issue the roadmap lists directly, and checks
 * the WHOLE of stdout against a string built from the same renderers
 * `merge-driven.test.ts` already proves this command uses —
 * `summaryLine`, `tickSentence` and the clean-up's own step labels — so
 * a byte the epic tick's new code adds anywhere in that run fails this
 * comparison loudly.
 *
 * Every stand-in `gh` here fails loudly, naming the call, on anything
 * it was not planted to answer.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { DryEpic } from '../next/readings.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { tickSentence } from '../board/roadmap-tick.js';
import { epicTickSentence } from '../commands/pr/merge-tick.js';
import { summaryLine } from '../commands/pr/merge.js';
import { BARE_YES_ACTIONS, YES_FLAG } from '../next/ceiling.js';
import { epicEndLines } from '../next/epic-end.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-end-merge-tick-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: several sequential local `gh` and `git` reads, none of them network. */
const SPAWN_TIMEOUT = 30_000;

/** The environment every git run here uses: `scratch`'s own HOME, global and system config off. */
function gitEnv(scratch: ScratchRepo): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/** Runs one git command for real, in `scratch.repo`, isolated the way {@link gitEnv} names. */
function git(scratch: ScratchRepo, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd: scratch.repo, stdio: 'pipe', env: gitEnv(scratch) });
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function readFileCommand(path: string): string {
  return `IFS= read -r line < '${path}' || true; printf '%s' "$line"`;
}

/** Prints the file named by shell variable `name` (e.g. `$f`), double-quoted so it expands. */
function readVarCommand(name: string): string {
  return `IFS= read -r line < "${name}" || true; printf '%s' "$line"`;
}

/**
 * The multi-line, JSON-safe read every checklist body answer takes: one
 * escaped `\n` between lines, and after the last one only when the file
 * itself ended in a real line break; see `epic-cancel-spawn.test.ts`'s
 * own copy, which this is.
 */
const JSON_ESCAPE_FN = [
  'json_escape() {',
  '  first=1',
  '  trailing=0',
  '  line=""',
  '  while IFS= read -r line; do',
  '    if [ "$first" -eq 1 ]; then first=0; else printf \'\\\\n\'; fi',
  '    printf \'%s\' "$line"',
  '    trailing=1',
  '  done',
  '  if [ -n "$line" ]; then',
  '    if [ "$first" -eq 1 ]; then first=0; else printf \'\\\\n\'; fi',
  '    printf \'%s\' "$line"',
  '    trailing=0',
  '  fi',
  '  if [ "$trailing" -eq 1 ]; then printf \'\\\\n\'; fi',
  '}',
].join('\n');

describe('rafa next --dry-run on a fixture whose current epic ran dry, spawned', () => {
  const ROADMAP_ISSUE = 1;
  const EPIC: DryEpic = { number: 50, title: 'Sunset the legacy exporter' };
  const MEMBER = 51;
  const CHANGELOG = [
    '# Changelog',
    '',
    '## 0.9.0',
    '',
    '- Something shipped.',
    '',
  ].join('\n');

  /** One `gh issue list` / `gh issue view` row, labels named plainly. */
  function issueRow(number: number, title: string, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
    const stateReason = state === 'CLOSED'
      ? 'COMPLETED'
      : '';
    return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })), author: { login: 'octocat' } };
  }

  const ISSUES = [
    issueRow(ROADMAP_ISSUE, 'Board', `- [ ] #${String(EPIC.number)}\n`, []),
    issueRow(EPIC.number, EPIC.title, `- [ ] #${String(MEMBER)}\n`, ['type:epic', 'epic:sunset', 'horizon:now']),
    issueRow(MEMBER, 'Old exporter cleanup', '', [], 'CLOSED'),
  ];

  /**
   * Writes the stand-in `gh`: the labelled-board listing empty, one
   * `issue view` per fixture issue, the `--state all` listing every
   * epic descent reads once, and `pr list` empty. Anything unplanned
   * fails loudly, naming the call.
   */
  function writeGhStub(scratch: ScratchRepo): void {
    const data = join(dirname(scratch.repo), 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'all.json'), JSON.stringify(ISSUES), 'utf8');
    for (const issue of ISSUES) {
      const { number } = issue as { readonly number: number };
      writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
    }
    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      'case "$*" in *"--label type:roadmap"*) printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$1 $2" in',
      '  "issue view")',
      `    f='${data}'"/view-$3.json"`,
      '    if [ -f "$f" ]; then',
      `      ${readVarCommand('$f')}`,
      '    else',
      '      echo "unplanned issue view: $3" >&2; exit 1',
      '    fi',
      '    ;;',
      '  "pr list") printf \'%s\' \'[]\';;',
      `  "issue list") ${readFileCommand(join(data, 'all.json'))};;`,
      '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
      'esac',
      '',
    ].join('\n'), 'utf8');
    chmodSync(gh, 0o755);
  }

  /** Plants the repository, its bare `origin`, the config and the stand-in `gh`; `CHANGELOG.md` written from `changelog`. */
  function plantRepo(changelog: string): ScratchRepo {
    const scratch = plantScratchRepo(tempBase, { project: false });
    git(scratch, ['checkout', '-q', '-B', 'main']);
    writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
    writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
    writeFileSync(join(scratch.repo, 'CHANGELOG.md'), changelog, 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.invalid', 'commit', '-q', '-m', 'initial']);
    const bare = join(dirname(scratch.repo), 'origin.git');
    git(scratch, ['init', '-q', '--bare', bare]);
    git(scratch, ['remote', 'add', 'origin', bare]);
    git(scratch, ['push', '-q', '-u', 'origin', 'main']);
    plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\nroadmap:\n  issue: ${String(ROADMAP_ISSUE)}\n`);
    writeGhStub(scratch);
    return scratch;
  }

  /** The tail of `stdout`, past the state and proposal lines row 13 always writes, joined back into one string. */
  function tailOf(stdout: string, count: number): string {
    const lines = stdout.split('\n');
    return lines.slice(lines.length - 1 - count, lines.length - 1).join('\n');
  }

  it('names the closing gate, the roadmap and the untagged release, where the changelog names one no tag holds', () => {
    const scratch = plantRepo(CHANGELOG);

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('⏹ --dry-run: nothing ran.');
    const expected = epicEndLines(EPIC, { changelog: 'CHANGELOG.md', versions: ['0.9.0'], problem: null });
    expect(tailOf(run.stdout, expected.length)).toBe(expected.join('\n'));
    expect(run.stdout).toContain('rafa release tag');
  }, SPAWN_TIMEOUT);

  it('leaves the release line off once the changelog\'s version is tagged', () => {
    const scratch = plantRepo(CHANGELOG);
    git(scratch, ['tag', 'v0.9.0']);

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expect(run.exitCode).toBe(0);
    const expected = epicEndLines(EPIC, { changelog: 'CHANGELOG.md', versions: [], problem: null });
    expect(tailOf(run.stdout, expected.length)).toBe(expected.join('\n'));
    expect(run.stdout).not.toContain('rafa release tag');
    expect(run.stdout).toContain(`rafa epic close ${String(EPIC.number)}`);
  }, SPAWN_TIMEOUT);
});

/** A pull request detail as the stand-in `gh` answers one, filled from `over`. */
function detailOf(over: Readonly<Record<string, unknown>>): object {
  return {
    number: over.number,
    title: over.title,
    url: `https://github.com/o/r/pull/${String(over.number)}`,
    state: 'OPEN',
    headRefName: over.headRefName,
    baseRefName: 'main',
    author: { login: 'octocat', is_bot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-27T00:00:00Z',
    body: over.body,
    headRefOid: 'deadbeef',
    labels: [],
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    ...over,
  };
}

/** One row of the board listing, as `gh` writes it. */
function boardRow(number: number, title: string, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  return { number, title, body, state, stateReason: '', labels: labels.map((name) => ({ name })) };
}

/**
 * Plants a work tree on `main` with one commit, pushed to a bare
 * `origin.git` beside it, then `branch` off it with one more commit,
 * pushed too and left checked out — `merge-driven.test.ts`'s own shape,
 * spawned instead of dispatched in-process. `branch` carries no `/`, so
 * `recordPlanCi`'s branch read resolves no plan stub and writes nothing,
 * which keeps this run's stdout free of anything that module could add.
 */
function plantMergeRepo(branch: string): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  git(scratch, ['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(scratch.repo, 'README.md'), 'first\n', 'utf8');
  git(scratch, ['add', '.gitignore', 'README.md']);
  git(scratch, ['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.invalid', 'commit', '-q', '-m', 'first']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(scratch, ['init', '-q', '--bare', bare]);
  git(scratch, ['remote', 'add', 'origin', bare]);
  git(scratch, ['push', '-q', '-u', 'origin', 'main']);
  git(scratch, ['switch', '-q', '-c', branch]);
  writeFileSync(join(scratch.repo, 'feature.txt'), 'a feature\n', 'utf8');
  git(scratch, ['add', 'feature.txt']);
  git(scratch, ['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.invalid', 'commit', '-q', '-m', 'feature']);
  git(scratch, ['push', '-q', '-u', 'origin', branch]);
  return scratch;
}

/** What the stand-in `gh` for `rafa pr merge` is asked to answer. */
interface MergeGhFixture {
  readonly detail: object;
  /** `gh issue list --label type:roadmap ...`: the labelled boards, none by default. */
  readonly boardsListing?: readonly object[];
  /** `gh issue list --state all ...`: the epic tick's own listing, none by default. */
  readonly stateAllListing?: readonly object[];
  /** The checklist body every `gh api .../issues/<n>` read or write starts from, by issue number. */
  readonly bodies: Readonly<Record<number, string>>;
}

/**
 * Writes the stand-in `gh` for `rafa pr merge`: the pull request, its
 * one green check, the merge itself, the labelled-board and `--state
 * all` listings the tick sends, the `spec:blocked` listing the unblock
 * reading ends with, and the `gh api repos/{owner}/{repo}/issues/<n>`
 * pair a checklist edit reads and writes, kept in `data/body-<n>.txt`
 * across the read, write and re-read. Answers that directory, so a case
 * can read back what a run left in it. A call this file did not plan
 * for exits 1, naming it.
 */
function writeMergeGhStub(scratch: ScratchRepo, fixture: MergeGhFixture): string {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'detail.json'), JSON.stringify(fixture.detail), 'utf8');
  writeFileSync(join(data, 'checks.json'), JSON.stringify([{ name: 'build', state: 'SUCCESS', link: 'https://example.invalid/run/1' }]), 'utf8');
  writeFileSync(join(data, 'boards.json'), JSON.stringify(fixture.boardsListing ?? []), 'utf8');
  writeFileSync(join(data, 'all.json'), JSON.stringify(fixture.stateAllListing ?? []), 'utf8');
  writeFileSync(join(data, 'blocked.json'), '[]', 'utf8');
  for (const [issue, body] of Object.entries(fixture.bodies)) {
    writeFileSync(join(data, `body-${issue}.txt`), body, 'utf8');
  }

  const gh = join(scratch.bin, 'gh');
  const script = [
    '#!/bin/sh',
    `DATA='${data}'`,
    '',
    JSON_ESCAPE_FN,
    '',
    `case "$*" in *"--label type:roadmap"*) ${readFileCommand(join(data, 'boards.json'))}; exit 0;; esac`,
    `case "$*" in *"--label spec:blocked"*) ${readFileCommand(join(data, 'blocked.json'))}; exit 0;; esac`,
    'case "$1 $2" in',
    `  "pr view") ${readFileCommand(join(data, 'detail.json'))};;`,
    `  "pr checks") ${readFileCommand(join(data, 'checks.json'))};;`,
    '  "pr merge") printf \'\';;',
    `  "issue list") ${readFileCommand(join(data, 'all.json'))};;`,
    '  "api "*)',
    '    case "$4" in',
    '      PATCH)',
    '        val="$6"',
    '        val="${val#body=}"',
    '        num="${2##*/}"',
    '        printf \'%s\' "$val" > "$DATA/body-$num.txt"',
    '        json=$(printf \'%s\' "$val" | json_escape)',
    '        printf \'{"body": "%s"}\' "$json"',
    '        ;;',
    '      *)',
    '        num="${2##*/}"',
    '        json=$(json_escape < "$DATA/body-$num.txt")',
    '        printf \'{"body": "%s"}\' "$json"',
    '        ;;',
    '    esac',
    '    ;;',
    '  *)',
    '    echo "unplanned gh call: $*" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(gh, script, 'utf8');
  chmodSync(gh, 0o755);
  return data;
}

/** What a fixture file under `data` holds. */
function dataFile(data: string, name: string): string {
  return readFileSync(join(data, name), 'utf8');
}

describe('rafa pr merge ticks a fixture member\'s line on its epic beside the roadmap\'s own, spawned', () => {
  const PR_NUMBER = 41;
  const BRANCH = 'epicticker';
  const ROADMAP_ISSUE = 31;
  const EPIC = 252;
  const SPEC = 20;
  const EPIC_BODY = '## Specs\n\n- [ ] #20 plans from the board\n';
  const ROADMAP_BODY = '- [ ] #20 plans from the board\n- [ ] #33 the board setup\n';

  it('ticks #20 on epic #252 before the roadmap it is also named on directly, #31', () => {
    const scratch = plantMergeRepo(BRANCH);
    plantProjectConfig(scratch.repo, `pr:\n  provider: gh\n  base: main\nroadmap:\n  issue: ${String(ROADMAP_ISSUE)}\n`);
    const data = writeMergeGhStub(scratch, {
      detail: detailOf({ number: PR_NUMBER, title: 'Ship the board', headRefName: BRANCH, body: `Closes #${String(SPEC)}` }),
      stateAllListing: [
        boardRow(EPIC, 'Board epic', EPIC_BODY, 'OPEN', ['type:epic', 'epic:boards']),
        boardRow(SPEC, 'Plans from the board', '', 'CLOSED', ['type:spec', 'epic:boards']),
      ],
      bodies: { [EPIC]: EPIC_BODY, [ROADMAP_ISSUE]: ROADMAP_BODY },
    });

    const run = runRafa(scratch, scratch.repo, ['pr', 'merge', String(PR_NUMBER), '--yes', '--no-hint']);

    expect(run.exitCode).toBe(0);
    const lines = run.stdout.split('\n').filter((line) => line !== '');
    const epicLine = epicTickSentence({ issue: EPIC, status: 'edited', attempts: 1, problem: '', members: [SPEC] });
    const roadmapLine = tickSentence({ roadmap: ROADMAP_ISSUE, status: 'ticked', ticked: [SPEC], already: [], absent: [], attempts: 1, problem: '' });
    expect(lines).toContain(epicLine);
    expect(lines).toContain(roadmapLine);
    expect(lines.indexOf(epicLine)).toBeLessThan(lines.indexOf(roadmapLine));

    // The epic's own body, ticked — the claim this task exists for.
    expect(dataFile(data, `body-${String(EPIC)}.txt`)).toBe('## Specs\n\n- [x] #20 plans from the board\n');
    // The roadmap, which names #20 directly, ticked exactly as it always was.
    expect(dataFile(data, `body-${String(ROADMAP_ISSUE)}.txt`)).toBe('- [x] #20 plans from the board\n- [ ] #33 the board setup\n');
  }, SPAWN_TIMEOUT);
});

describe('a project with no epic: rafa next and rafa pr merge print byte-identical output, spawned', () => {
  const ISSUE = 20;
  const ROADMAP_BODY = `- [ ] #${String(ISSUE)}\n`;

  /** One `gh issue list` / `gh issue view` row, labels named plainly. */
  function issueRow(number: number, title: string, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
    const stateReason = state === 'CLOSED'
      ? 'COMPLETED'
      : '';
    return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })), author: { login: 'octocat' } };
  }

  it('rafa next prints the roadmap exhausted, byte for byte, as it did before epics existed', () => {
    const ROADMAP = 1;
    const ISSUES = [
      issueRow(ROADMAP, 'Roadmap', ROADMAP_BODY, []),
      issueRow(ISSUE, 'An old, closed thing', '', [], 'CLOSED'),
    ];
    const scratch = plantScratchRepo(tempBase, { project: false });
    git(scratch, ['checkout', '-q', '-B', 'main']);
    writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
    writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.invalid', 'commit', '-q', '-m', 'initial']);
    const bare = join(dirname(scratch.repo), 'origin.git');
    git(scratch, ['init', '-q', '--bare', bare]);
    git(scratch, ['remote', 'add', 'origin', bare]);
    git(scratch, ['push', '-q', '-u', 'origin', 'main']);
    plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\nroadmap:\n  issue: ${String(ROADMAP)}\n`);
    const data = join(dirname(scratch.repo), 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'all.json'), JSON.stringify(ISSUES), 'utf8');
    for (const issue of ISSUES) {
      const { number } = issue as { readonly number: number };
      writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
    }
    const gh = join(scratch.bin, 'gh');
    writeFileSync(gh, [
      '#!/bin/sh',
      'case "$*" in *"--label type:roadmap"*) printf \'%s\' \'[]\'; exit 0;; esac',
      'case "$1 $2" in',
      '  "issue view")',
      `    f='${data}'"/view-$3.json"`,
      '    if [ -f "$f" ]; then',
      `      ${readVarCommand('$f')}`,
      '    else',
      '      echo "unplanned issue view: $3" >&2; exit 1',
      '    fi',
      '    ;;',
      '  "pr list") printf \'%s\' \'[]\';;',
      `  "issue list") ${readFileCommand(join(data, 'all.json'))};;`,
      '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
      'esac',
      '',
    ].join('\n'), 'utf8');
    chmodSync(gh, 0o755);

    const run = runRafa(scratch, scratch.repo, ['next']);

    // Spawned with no terminal to answer on and no --yes, `rafa next`
    // stops the same way `--dry-run` would (`dryRunOf`), one more line
    // than a run with a terminal gets; row 13's own reading and
    // proposal, unrelated to epics, are untouched by this stage.
    const expected = [
      `📍 the roadmap, issue #${String(ROADMAP)}, has no line left that is not done or taken (1 line passed).`,
      '👉 open the next spec issue and add it to the roadmap',
      '⏹ There is no terminal to answer on, so nothing ran; run rafa next where you can answer,'
        + ` or type --${YES_FLAG}=${BARE_YES_ACTIONS.join(',')} to allow those steps unasked.`,
    ].join('\n') + '\n';

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
  }, SPAWN_TIMEOUT);

  it('rafa pr merge prints its known lines, byte for byte, with no line the epic tick could have added', () => {
    const PR_NUMBER = 41;
    const BRANCH = 'mergeparity';
    const ROADMAP_ISSUE = 7;
    const scratch = plantMergeRepo(BRANCH);
    plantProjectConfig(scratch.repo, `pr:\n  provider: gh\n  base: main\nroadmap:\n  issue: ${String(ROADMAP_ISSUE)}\n`);
    const detail = detailOf({ number: PR_NUMBER, title: 'Ship the fix', headRefName: BRANCH, body: `Closes #${String(ISSUE)}` });
    writeMergeGhStub(scratch, {
      detail,
      // No open `type:epic` issue anywhere: the epic tick's own listing
      // answers empty, pays its one call and adds nothing to the run —
      // the claim this suite exists to prove.
      stateAllListing: [],
      bodies: { [ROADMAP_ISSUE]: ROADMAP_BODY },
    });

    const run = runRafa(scratch, scratch.repo, ['pr', 'merge', String(PR_NUMBER), '--yes', '--no-hint']);

    const expected = [
      summaryLine(detail as never, 'squash'),
      `Merged #${String(PR_NUMBER)} into main (squash).`,
      tickSentence({ roadmap: ROADMAP_ISSUE, status: 'ticked', ticked: [ISSUE], already: [], absent: [], attempts: 1, problem: '' }),
      'switch to main: done',
      'pull main, fast-forward only: done',
      `delete the local branch ${BRANCH}: done`,
      `delete origin/${BRANCH}: done`,
      'prune deleted remote branches: done',
      `main is checked out and pulled, and ${BRANCH} is gone locally and on origin.`,
    ].join('\n') + '\n';

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
  }, SPAWN_TIMEOUT);
});

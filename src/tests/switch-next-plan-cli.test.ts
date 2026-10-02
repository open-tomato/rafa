/**
 * Spawned `bun src/rafa.ts` runs proving the last two claims of
 * `.rafa/specs/rafa-245-boards-several-roadmaps-per.md`, "Switching and
 * reading the current place", that no earlier spawned suite covers:
 *
 *  - `rafa next --dry-run` and `rafa plan create --next --dry-run`
 *    propose from the EPIC a switch moved to, not the default board's
 *    own — the first suite below, over a fixture of two `type:roadmap`
 *    boards, each naming its own `horizon:now` epic, the same shape
 *    `board-switch-status-cli.test.ts` plants for `rafa switch` itself.
 *  - the hard rule: "a project with no `type:roadmap` label and no
 *    position file behaves exactly as before: `rafa roadmap`,
 *    `rafa next`, `rafa epics`, `plan create --next` and `rafa status`
 *    print byte-identical output." `roadmap-default-board-cli.test.ts`
 *    already proves it for `rafa roadmap`; the second suite below proves
 *    it for `rafa next`, `rafa epics` and `rafa status`, over ONE shared
 *    fixture: an unlabelled issue titled "Roadmap", found by the title
 *    rule alone, naming one already-closed issue and no epic at all —
 *    the roadmap read every command here reads exhausted, so `rafa
 *    next` proposes nothing and neither `--dry-run` nor `--yes` is
 *    needed to keep the run from acting. Every line printed is hand
 *    derived from the source each command's row is read off
 *    (`src/next/state.ts`'s row 13, `src/commands/epic/show.ts`'s
 *    `noNowEpicLine`, `src/status/render.ts`'s six section lines), the
 *    same way `epic-descent-cli.test.ts`'s own byte-for-byte case is.
 *
 * Both suites push `main` to a bare `origin`, so the branch scan's
 * remote half never warns onto stdout and breaks a byte-identical
 * comparison, and every stand-in `gh` tells its `gh issue list` calls
 * apart by their own flags — `--label type:roadmap`, `--search `,
 * `--label spec:blocked`, never by position alone — failing loudly,
 * naming the call, on anything it was not planted to answer.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { noNowEpicLine } from '../commands/epic/show.js';
import { YES_FLAG } from '../next/ceiling.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-switch-next-plan-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: several sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The login every planted issue is authored by, and the one `board.trustedAuthors` names. */
const AUTHOR_LOGIN = 'octocat';

/** One `gh issue list` or `gh issue view` row, labels already named. */
function issueRow(number: number, title: string, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : '';
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })), author: { login: AUTHOR_LOGIN } };
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository, so
 * the branch scan's remote half (`git ls-remote --heads origin`) never
 * fails and warns onto stdout, which would break a byte-identical
 * comparison.
 */
function gitSetup(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: the labelled-board
 * listing, the title search and `spec:blocked` listing told apart from
 * the general listing by their own flags, ahead of the plain `issue
 * list` fallback, one `issue view` answer per fixture issue, and `pr
 * list` empty. Anything unplanned fails loudly, naming the call.
 */
function writeGhStub(scratch: ScratchRepo, issues: readonly object[], labelled: readonly object[], search: readonly object[]): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'labelled.json'), JSON.stringify(labelled), 'utf8');
  writeFileSync(join(data, 'search.json'), JSON.stringify(search), 'utf8');
  writeFileSync(join(data, 'all.json'), JSON.stringify(issues), 'utf8');
  for (const issue of issues) {
    const { number } = issue as { readonly number: number };
    writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
  }
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(join(data, 'labelled.json'))}; exit 0;; esac`,
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
    `case "$*" in *"--search "*) ${printFile(join(data, 'search.json'))}; exit 0;; esac`,
    'case "$1 $2" in',
    '  "issue view")',
    `    f='${data}'"/view-$3.json"`,
    '    if [ -f "$f" ]; then',
    '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$f"',
    '    else',
    '      echo "unplanned issue view: $3" >&2; exit 1',
    '    fi',
    '    ;;',
    '  "pr list") printf \'%s\' \'[]\';;',
    `  "issue list") ${printFile(join(data, 'all.json'))};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

describe('rafa next --dry-run and rafa plan create --next --dry-run propose from the switched-to epic, spawned', () => {
  const BOARD_A = 10;
  const EPIC_A = 100;
  const DONE_A = 101;
  const READY_A = 102;
  const BOARD_B = 20;
  const EPIC_B = 200;
  const DONE_B = 201;
  const READY_B = 202;

  const EPIC_A_BODY = `- [ ] #${String(DONE_A)}\n- [ ] #${String(READY_A)}\n`;
  const EPIC_B_BODY = `- [ ] #${String(DONE_B)}\n- [ ] #${String(READY_B)}\n`;

  const ISSUES = [
    issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
    issueRow(EPIC_A, 'Alpha work', EPIC_A_BODY, ['type:epic', 'epic:alpha', 'horizon:now']),
    issueRow(DONE_A, 'Alpha done thing', '', [], 'CLOSED'),
    issueRow(READY_A, 'Alpha ready thing', completeSpecBody('Alpha ready thing'), [SPEC_LABEL, SPEC_READY_LABEL]),
    issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
    issueRow(EPIC_B, 'Beta work', EPIC_B_BODY, ['type:epic', 'epic:beta', 'horizon:now']),
    issueRow(DONE_B, 'Beta done thing', '', [], 'CLOSED'),
    issueRow(READY_B, 'Beta ready thing', completeSpecBody('Beta ready thing'), [SPEC_LABEL, SPEC_READY_LABEL]),
  ];
  const LABELLED = ISSUES.filter((issue) => (issue as { readonly labels: readonly { readonly name: string }[] }).labels
    .some((label) => label.name === 'type:roadmap'));

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\nboard:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\n`);
    gitSetup(scratch);
    writeGhStub(scratch, ISSUES, LABELLED, []);
  });

  it('before any switch, rafa next --dry-run proposes #102, the default board\'s epic\'s member', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`#${String(READY_A)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
  });

  it('rafa switch 200 moves to it, then rafa next --dry-run proposes #202, naming neither #100 nor #102', RUN_TIMEOUT, () => {
    const moved = runRafa(scratch, scratch.repo, ['switch', String(EPIC_B)]);
    expect(moved.exitCode).toBe(0);

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`#${String(READY_B)} is next on the roadmap and carries \`${SPEC_READY_LABEL}\``);
    expect(run.stdout).toContain(`create the plan for #${String(READY_B)}`);
    expect(run.stdout).not.toContain(`#${String(EPIC_A)}`);
    expect(run.stdout).not.toContain(`#${String(READY_A)}`);
  });

  it('rafa plan create --next --dry-run proposes from the same switched-to epic, #202, naming neither #100 nor #102', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['plan', 'create', '--next', '--dry-run', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`walking into epic #${String(EPIC_B)}`);
    expect(run.stdout).toContain(`Next on the roadmap: issue #${String(READY_B)}`);
    expect(run.stdout).toContain(`would plan from issue #${String(READY_B)}`);
    expect(run.stdout).not.toContain(`#${String(EPIC_A)}`);
    expect(run.stdout).not.toContain(`#${String(READY_A)}`);
  });
});

describe('rafa next, rafa epics and rafa status over a project with no position and no label, spawned', () => {
  const ROADMAP = 1;
  const ISSUE = 20;
  const ROADMAP_BODY = `- [ ] #${String(ISSUE)}\n`;

  const ISSUES = [
    issueRow(ROADMAP, 'Roadmap', ROADMAP_BODY, []),
    issueRow(ISSUE, 'An old, closed thing', '', [], 'CLOSED'),
  ];

  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    // No `roadmap.issue` and no `type:roadmap` label anywhere: the
    // default board is found by the title rule alone, exactly as it was
    // before positions existed, and no position file is ever written.
    plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\n`);
    gitSetup(scratch);
    writeGhStub(scratch, ISSUES, [], [{ number: ROADMAP, title: 'Roadmap' }]);
  });

  it('rafa next prints the roadmap exhausted, byte for byte, as it always did', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['next']);

    // Spawned with no terminal to answer on and no --yes, `rafa next`
    // stops the same way `--dry-run` would (`dryRunOf`, `src/commands/next.ts`),
    // one more line than a run with a terminal gets; the reading and
    // proposal above it are row 13's own, unrelated to boards.
    const expected = [
      `📍 the roadmap, issue #${String(ROADMAP)}, has no line left that is not done or taken (1 line passed).`,
      '👉 open the next spec issue and add it to the roadmap',
      '⏹ There is no terminal to answer on, so nothing ran; run rafa next where you can answer,'
        + ` or type --${YES_FLAG}=sync,wait,unblock,plan to allow those steps unasked.`,
    ].join('\n') + '\n';

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
  });

  it('rafa epics prints no now epic, byte for byte, as it always did', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['epics']);

    const expected = `${noNowEpicLine(ROADMAP)}\n`;

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
  });

  it('rafa status prints its six section lines, byte for byte, with no place line under Board', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['status']);

    const expected = [
      'Branch: `main`, no plan',
      'Loops: 0 running, 0 tasks blocked',
      'Pull request: none open',
      `Board: roadmap #${String(ROADMAP)} has no line left; 0 issues labelled spec:blocked`,
      'Claims: none on origin as last fetched',
      'Housekeeping: 0 merged, 0 stale, 0 not pushed, 0 worktrees (0 idle)',
    ].join('\n') + '\n';

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
  });
});

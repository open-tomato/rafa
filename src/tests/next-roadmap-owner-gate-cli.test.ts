/**
 * Three spawned probes of `rafa next --roadmap --yes=merge` over ONE
 * shape of fixture: board Alpha (#10, home), its `horizon:now` epic
 * (#100, already dry — its one line closed), and board Beta (#20), which
 * owns the folder `other/` (an `Owns:` line, no CODEOWERS file) and
 * names an `Owner:` handle of its own. The open pull request on
 * `feat/owner-gate`, green and mergeable, changes `other/file.ts` alone,
 * so every case reaches `pr-owner-review` (`src/next/hop-rows.ts`) with
 * exactly the same pull request and the same foreign board, and differs
 * only in what the owner gate reads once it asks about Beta's owner:
 *
 *  - **an owner that does not resolve.** Beta's `Owner: @ghost-owner`;
 *    `gh api users/ghost-owner` answers 404. The gate reads `unresolved`,
 *    never asks for a review, and the row proposes no merge.
 *  - **a permission read that fails.** Beta's `Owner: @acme/reviewers`,
 *    a team; the team itself resolves, and a reviewer's `APPROVED`
 *    review is on the pull request, but the one team-membership lookup
 *    that review sends fails with something other than 404. The gate
 *    reads `unknown`, and the row proposes no merge either.
 *  - **a team member's approval.** The same team, the same approved
 *    review, and the membership lookup answers `active`: the gate reads
 *    `approved`, `pr-owner-review` answers null, and the ordinary
 *    `pr-green` row beneath it proposes the merge, which `--yes=merge`
 *    then runs for real.
 *
 * Every case is driven the way `next-chain-integration.test.ts` drives
 * its own merge chain: a small program of its own, spawned as a probe,
 * composing the real `next` and `pr merge` commands over a
 * {@link createPullRequestsDouble} for the pull request itself (so
 * `changedFiles`, `reviews` and `merge` are answered and recorded
 * in-process, never through a real `gh`) and an in-process fake
 * `GhRunner`, handed through `openGh`, for the three things the owner
 * gate and the board listing actually send to `gh`: the one
 * `issue list` the board and the gate share, one owner lookup
 * (`gh api users/<login>` or `gh api orgs/<org>/teams/<slug>`), and, for
 * the two team cases, one membership lookup
 * (`gh api orgs/<org>/teams/<slug>/memberships/<login>`). Real git still
 * runs for the base checkout, the branch scan and (in the third case)
 * the pull and the branch clean-up a real merge performs, over a bare
 * `origin` beside the work tree, exactly as that suite's own
 * `plantScratch` sets one up.
 *
 * Every case asserts off the double's own recorded calls whether `merge`
 * was ever sent — the in-process proof this plan's other spawned
 * suites already read a `gh pr merge` refusal or a completion by — and
 * off the probe's captured stdout for the sentence the gate's `reason`
 * and the row's `proposal` print.
 */
import type { Scratch } from './next-chain-fixtures.js';
import type { Place, Position } from '../project/position.js';

import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { positionFilePath, writePositionFile } from '../project/position.js';

import { plantProjectConfig } from './cli-capture.js';
import {
  BASE, OLD_BRANCH, PR_NUMBER, SRC_DIR, git, makeTempBase, runProbe,
} from './next-chain-fixtures.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = makeTempBase('rafa-next-roadmap-owner-gate-cli-');

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: a handful of sequential local git reads, and for the third, a real merge and clean-up. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** Board Alpha, the home board, and its `horizon:now` epic, already dry. */
const BOARD_A = 10;
const EPIC_A = 100;
const DONE = 101;

/** Board Beta: it owns `other/`, and the pull request's one changed path sits there. */
const BOARD_B = 20;

/** The one file the fixture's pull request changes, owned by Beta and never by home. */
const CHANGED_FILE = 'other/file.ts';

/** The position every case starts from: home already at Alpha's epic. */
const HOME_PLACE: Place = { board: BOARD_A, epic: EPIC_A };
const HOME_POSITION: Position = { current: HOME_PLACE, previous: HOME_PLACE, home: HOME_PLACE };

/** One `gh issue list`/`issue view` row, labels and author already named. */
function issueRow(number: number, title: string, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return {
    number,
    title,
    body,
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : '',
    labels: labels.map((name) => ({ name })),
    author: { login: 'octocat' },
  };
}

/** Board Beta's issues, its `Owner:` line the one thing that varies across the three cases. */
function issuesFor(ownerLine: string): readonly object[] {
  return [
    issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
    issueRow(EPIC_A, 'Alpha epic', `- [ ] #${String(DONE)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
    issueRow(DONE, 'already done', '', [], 'CLOSED'),
    issueRow(BOARD_B, 'Board Beta', `${ownerLine}\nOwns: other\n`, ['type:roadmap']),
  ];
}

/** The `gh` path that resolves `handle`: `users/<login>` or `orgs/<org>/teams/<slug>`. */
function ownerLookupPath(handle: string): string {
  const body = handle.slice(1);
  const slash = body.indexOf('/');
  return slash === -1
    ? `users/${body}`
    : `orgs/${body.slice(0, slash)}/teams/${body.slice(slash + 1)}`;
}

/** The `gh` path that asks whether `login` is a member of the `@org/slug` team `handle`. */
function membershipPath(handle: string, login: string): string {
  const [org = '', slug = ''] = handle.slice(1).split('/');
  return `orgs/${org}/teams/${slug}/memberships/${login}`;
}

/** One answer a fake `gh` command gives back. */
interface GhAnswer {
  readonly ok: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** What one case's probe is built with. */
interface ProbeOptions {
  readonly issues: readonly object[];
  readonly ownerLookupPath: string;
  readonly ownerResolve: GhAnswer;
  readonly membershipPath: string | null;
  readonly membership: GhAnswer | null;
  readonly reviews: readonly { readonly login: string; readonly state: string; readonly submittedAt: string }[];
}

/** A pull request summary open on `OLD_BRANCH`, green and mergeable into `BASE`. */
const PR_SUMMARY = Object.freeze({
  number: PR_NUMBER,
  title: 'a change owned by another board',
  url: `https://example.invalid/pull/${String(PR_NUMBER)}`,
  state: 'open',
  headRefName: OLD_BRANCH,
  baseRefName: BASE,
  author: { login: 'octocat', isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-28T11:00:00Z',
});

/** The detail the double answers `get` with: green, mergeable, and closing nothing. */
const PR_DETAIL = Object.freeze({
  ...PR_SUMMARY,
  body: '',
  headRefOid: 'abc1234',
  mergeable: 'mergeable',
  mergeStateStatus: 'CLEAN',
  labels: [],
});

/**
 * The probe: composes the real `next` and `pr merge` commands over a
 * pull request double and a fake `GhRunner`; see the module note.
 */
function buildProbe(options: ProbeOptions): string {
  return [
    'import { writeFileSync } from "node:fs";',
    `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
    `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
    `import { createNextCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'next.ts'))};`,
    `import { createPrMergeCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'pr', 'merge.ts'))};`,
    `import { createGitRunner } from ${JSON.stringify(join(SRC_DIR, 'pr', 'index.ts'))};`,
    `import { createPullRequestsDouble } from ${JSON.stringify(join(SRC_DIR, 'pr', 'pull-requests-double.ts'))};`,
    '',
    'const [recordPath, ...nextArgv] = process.argv.slice(2);',
    'const events = [];',
    '',
    `const ISSUES = ${JSON.stringify(options.issues)};`,
    `const OWNER_LOOKUP_PATH = ${JSON.stringify(options.ownerLookupPath)};`,
    `const OWNER_RESOLVE = ${JSON.stringify(options.ownerResolve)};`,
    `const MEMBERSHIP_PATH = ${JSON.stringify(options.membershipPath)};`,
    `const MEMBERSHIP = ${JSON.stringify(options.membership)};`,
    '',
    '/** The fake GhRunner: the one listing, the one owner lookup, and, for a team, one membership lookup. */',
    'function fakeGh(args) {',
    '  const command = "gh " + args.join(" ");',
    '  events.push(command);',
    '  if (args[0] === "issue" && args[1] === "list") {',
    '    return Promise.resolve({ ok: true, stdout: JSON.stringify(ISSUES), stderr: "" });',
    '  }',
    '  if (args[0] === "issue" && args[1] === "view") {',
    '    const found = ISSUES.find((issue) => String(issue.number) === args[2]);',
    '    return found === undefined',
    '      ? Promise.resolve({ ok: false, stdout: "", stderr: "unplanned issue view: " + args[2] })',
    '      : Promise.resolve({ ok: true, stdout: JSON.stringify(found), stderr: "" });',
    '  }',
    '  if (args[0] === "api" && args[1] === OWNER_LOOKUP_PATH) {',
    '    return Promise.resolve({ stdout: "", stderr: "", ...OWNER_RESOLVE });',
    '  }',
    '  if (MEMBERSHIP_PATH !== null && args[0] === "api" && args[1] === MEMBERSHIP_PATH) {',
    '    return Promise.resolve({ stdout: "", stderr: "", ...MEMBERSHIP });',
    '  }',
    '  return Promise.resolve({ ok: false, stdout: "", stderr: "unplanned gh call: " + command });',
    '}',
    '',
    `const BASE = ${JSON.stringify(BASE)};`,
    `const OLD_BRANCH = ${JSON.stringify(OLD_BRANCH)};`,
    '',
    '/** The real git runner, wrapped to push every call onto the shared log before running it. */',
    'function wrapGit(root) {',
    '  const real = createGitRunner(root);',
    '  return (args) => {',
    '    events.push("git " + args.join(" "));',
    '    return real(args);',
    '  };',
    '}',
    '',
    `const summary = ${JSON.stringify(PR_SUMMARY)};`,
    `const detail = ${JSON.stringify(PR_DETAIL)};`,
    `const changedFiles = ${JSON.stringify([CHANGED_FILE])};`,
    `const reviews = ${JSON.stringify(options.reviews)};`,
    '',
    'const prDouble = createPullRequestsDouble({',
    '  findOpen: (branch) => Promise.resolve(branch === OLD_BRANCH ? summary : null),',
    '  get: () => Promise.resolve(detail),',
    '  checks: () => Promise.resolve({ rows: [], verdict: "green" }),',
    '  changedFiles: () => Promise.resolve(changedFiles),',
    '  reviews: () => Promise.resolve(reviews),',
    '  merge: () => {',
    '    events.push("merge");',
    '    return Promise.resolve({ merged: true, detail: "Squashed and merged pull request" });',
    '  },',
    '});',
    '',
    'const nextCommand = createNextCommand({',
    '  isTerminal: () => false,',
    '  openGit: wrapGit,',
    '  openGh: () => fakeGh,',
    '  pullRequests: () => prDouble.pulls,',
    '  openPrompter: () => {',
    '    throw new Error("rafa next opened a prompter: this suite always runs unasked");',
    '  },',
    '});',
    '',
    'const mergeCommand = createPrMergeCommand({',
    '  git: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  isTerminal: () => true,',
    '  openPrompter: () => {',
    '    throw new Error("pr merge should not ask: rafa next always passes --yes");',
    '  },',
    '});',
    '',
    'const commands = createCommandRegistry({',
    '  subjects: [{ name: "pr", summary: "pull requests" }],',
    '  commands: [nextCommand, mergeCommand],',
    '});',
    '',
    'let outcome = { ok: false };',
    'try {',
    '  const result = await dispatch(["next", ...nextArgv], { registry: commands });',
    '  outcome = { ok: result.exitCode === 0, exitCode: result.exitCode, result: result.result };',
    '} catch (error) {',
    '  outcome = { ok: false, error: String((error && error.message) || error) };',
    '} finally {',
    '  writeFileSync(recordPath, JSON.stringify({ events, outcome }));',
    '}',
    '',
  ].join('\n');
}

/**
 * A commit on `main`, pushed to a bare `origin` beside it, then
 * `OLD_BRANCH` off it touching {@link CHANGED_FILE}, pushed too and left
 * checked out — the same shape `next-chain-integration.test.ts`'s own
 * `plantScratch` builds.
 */
function plantScratch(options: ProbeOptions): Scratch {
  const root = mkdtempSync(join(tempBase, 'repo-'));
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(work, 'other'), { recursive: true });

  expect(git(root, home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare).ok).toBe(true);
  expect(git(root, home, 'init', '-q', `--initial-branch=${BASE}`, work).ok).toBe(true);
  writeFileSync(join(work, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(work, 'README.md'), 'a scratch repository for the owner-gate suite\n', 'utf8');
  expect(git(work, home, 'add', '.gitignore', 'README.md').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'first').ok).toBe(true);
  expect(git(work, home, 'remote', 'add', 'origin', bare).ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', BASE).ok).toBe(true);
  expect(git(work, home, 'switch', '-q', '-c', OLD_BRANCH).ok).toBe(true);
  writeFileSync(join(work, CHANGED_FILE), '// a change owned by another board\n', 'utf8');
  expect(git(work, home, 'add', CHANGED_FILE).ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'feature').ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', OLD_BRANCH).ok).toBe(true);

  const configText = ['pr:', '  provider: gh', `  base: ${BASE}`, 'roadmap:', `  issue: ${String(BOARD_A)}`, ''].join('\n');
  plantProjectConfig(work, configText);
  writePositionFile(work, HOME_POSITION);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(gitBinary)].join(delimiter);

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, buildProbe(options), 'utf8');

  return { root, work, home, probe, path };
}

/** Reads `.rafa/position.json` straight off disk. */
function readPositionOf(root: string): Position {
  return JSON.parse(readFileSync(positionFilePath(root), 'utf8')) as Position;
}

describe('rafa next --roadmap --yes=merge, an owner that does not resolve, spawned', () => {
  const OWNER_HANDLE = '@ghost-owner';
  const options: ProbeOptions = {
    issues: issuesFor(`Owner: ${OWNER_HANDLE}`),
    ownerLookupPath: ownerLookupPath(OWNER_HANDLE),
    ownerResolve: { ok: false, stderr: 'gh: Not Found (HTTP 404)' },
    membershipPath: null,
    membership: null,
    reviews: [],
  };

  it('proposes no merge and sends no gh pr merge', RUN_TIMEOUT, () => {
    const scratch = plantScratch(options);
    const before = readPositionOf(scratch.work);

    const { record, stdout } = runProbe(scratch, ['--roadmap', '--yes=merge']);
    if (!record.outcome.ok) {
      throw new Error(`the probe did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }

    expect(record.events.includes('merge')).toBe(false);
    expect(stdout).toContain(`waiting on #${String(PR_NUMBER)} (owner review)`);
    expect(stdout).toContain(`owner ${OWNER_HANDLE} of board #${String(BOARD_B)}`);
    expect(stdout).toContain('does not resolve to an account or team GitHub knows');

    expect(readPositionOf(scratch.work)).toEqual(before);
  });
});

describe('rafa next --roadmap --yes=merge, a team membership read that fails, spawned', () => {
  const OWNER_HANDLE = '@acme/reviewers';
  const APPROVER = 'reviewer1';
  const options: ProbeOptions = {
    issues: issuesFor(`Owner: ${OWNER_HANDLE}`),
    ownerLookupPath: ownerLookupPath(OWNER_HANDLE),
    ownerResolve: { ok: true, stdout: '{}' },
    membershipPath: membershipPath(OWNER_HANDLE, APPROVER),
    membership: { ok: false, stderr: 'gh: Internal Server Error (HTTP 500)' },
    reviews: [{ login: APPROVER, state: 'APPROVED', submittedAt: '2026-09-28T12:00:00Z' }],
  };

  it('proposes no merge and sends no gh pr merge', RUN_TIMEOUT, () => {
    const scratch = plantScratch(options);
    const before = readPositionOf(scratch.work);

    const { record, stdout } = runProbe(scratch, ['--roadmap', '--yes=merge']);
    if (!record.outcome.ok) {
      throw new Error(`the probe did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }

    expect(record.events.includes('merge')).toBe(false);
    expect(stdout).toContain(`waiting on #${String(PR_NUMBER)} (owner review)`);
    expect(stdout).toContain(`could not tell whether owner ${OWNER_HANDLE} of board #${String(BOARD_B)} approved #${String(PR_NUMBER)}`);

    expect(readPositionOf(scratch.work)).toEqual(before);
  });
});

describe('rafa next --roadmap --yes=merge, a team member\'s approval, spawned', () => {
  const OWNER_HANDLE = '@acme/reviewers';
  const APPROVER = 'reviewer1';
  const options: ProbeOptions = {
    issues: issuesFor(`Owner: ${OWNER_HANDLE}`),
    ownerLookupPath: ownerLookupPath(OWNER_HANDLE),
    ownerResolve: { ok: true, stdout: '{}' },
    membershipPath: membershipPath(OWNER_HANDLE, APPROVER),
    membership: { ok: true, stdout: '{"state":"active"}' },
    reviews: [{ login: APPROVER, state: 'APPROVED', submittedAt: '2026-09-28T12:00:00Z' }],
  };

  it('proposes the merge, which --yes=merge then runs', RUN_TIMEOUT, () => {
    const scratch = plantScratch(options);

    const { record, stdout } = runProbe(scratch, ['--roadmap', '--yes=merge']);
    if (!record.outcome.ok) {
      throw new Error(`the probe did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }

    expect(stdout).toContain(`👉 merge #${String(PR_NUMBER)} into \`${BASE}\``);
    expect(stdout).not.toContain('owner review');
    expect(record.events.includes('merge')).toBe(true);
  });
});

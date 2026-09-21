/**
 * Tests for the board side of `plan create` (`src/board/plan-spec.ts`):
 * the seams it builds, the four checks it runs on an issue as read in
 * the order it runs them, and the gate issue it answers beside the
 * spec.
 *
 * `./spec-source.test.ts` drives the routes themselves over planted
 * readers, and this file drives none of that again. It exists for the
 * WIRING, which nothing else can see: that the issue arrives through
 * `gh issue view` with the field list `./issue.ts` declares, that the
 * roadmap walk reaches `gh pr list` and `git`, that the author's trust
 * is read through `gh api` at the collaborators path, that the checks
 * run BEFORE a snapshot is written and in the order that decides which
 * sentence an issue failing several of them is refused with, and that
 * the spec route asks `gh` nothing at all.
 *
 * Every case plants a `gh` runner and a `git` runner of its own, so
 * nothing spawns and no case reaches GitHub or reads the configuration
 * `gh` keeps under the home. Each writes under a temporary directory of
 * its own, with `specs.dir` relative as a project configures it, so a
 * resolution that reached a real `.rafa/specs` would find nothing and
 * redden.
 *
 * Every planted issue carries {@link completeBody}, the shared filled
 * body of `../tests/spec-bodies.ts`, because `requireCompleteSpec` is
 * wired into `inspectSpecIssue` and an issue carrying less is refused
 * before the wiring a case is about is ever reached. Every planted
 * issue is opened by `octocat`, whom {@link PERMISSIONS} gives `admin`,
 * for the same reason: check 0 runs first, so an issue whose author the
 * planted board says nothing about is refused before anything else can
 * be seen. A case that means to break one thing says which body or
 * which author it plants instead.
 *
 * ## The trust check, which is the one that can pass while wrong twice
 *
 * A check that answered "trusted" to everything satisfies every case
 * that expects a pass, and one that answered "refused" to everything
 * satisfies every case that expects a refusal. So the trust cases are
 * written in pairs over the same seam: the outsider beside a
 * write-holder through the same route, the failed lookup beside the
 * planted 404 it is distinguished from, and the allow-list pass over a
 * lookup planted to FAIL, which no other answer could get through.
 *
 * ## What passes while wrong
 *
 * A check that ran AFTER the write would refuse with the same exit code
 * and the same sentence, and only the disk can tell the two apart. So
 * each refusal case asserts the snapshot is absent, beside a control in
 * which the same call writes it.
 *
 * Two mutations were driven on 2026-09-20, the module restored from a
 * scratch copy and verified with `shasum -c` each time, against 12 pass
 * and 0 fail either side:
 *
 *  - the `inspect` seam left unfilled in `resolvePlanSpec`, so no check
 *    runs on a resolution at all: 7 pass and 5 fail, every case that
 *    reaches a refusal THROUGH a route — the label one, the leak one
 *    and all three completeness ones. The two cases that call
 *    `inspectSpecIssue` directly stay green, which is the point of
 *    having both kinds.
 *  - the `requireCompleteSpec` call alone dropped from
 *    `inspectSpecIssue`: 8 pass and 4 fail, the completeness group and
 *    the ordering case whose control reaches the completeness sentence,
 *    and nothing else — which is what says the other eight do not lean
 *    on the new check.
 *
 * Check 0 brings this file to 21, and five more mutations were driven
 * the same way on 2026-09-21, one at a time, against 21 pass and 0 fail
 * either side:
 *
 *  - the `requireTrustedBoardAuthor` call dropped from
 *    `inspectSpecIssue`: 14 pass and 7 fail — the four trust cases, and
 *    the three that count the commands a route sends, which no longer
 *    see the lookup.
 *  - the same call moved to the END of `inspectSpecIssue`, after the
 *    completeness refusal: 20 pass and 1 fail, the ordering case alone.
 *    That is the only case that can see it — an issue whose body is
 *    complete reaches the trust check wherever it sits, and the
 *    snapshot is written after `inspect` either way — which is why that
 *    case plants an issue failing all four checks at once.
 *  - the trust built EAGERLY in `resolvePlanSpec` rather than inside
 *    the `inspect` seam: 19 pass and 2 fail, the `--spec` route case
 *    that asks for no `git` command at all, and the `--next` case whose
 *    recorded order puts the label read last.
 *  - `options.trustedAuthors` replaced with `[]` on the way to
 *    `ghBoardTrust`: 20 pass and 1 fail, the allow-list case, whose
 *    planted board answers no permission for that login.
 *  - `boardRepoLabel`'s fallback dropped, so a checkout with no origin
 *    answers the empty string: 20 pass and 1 fail, the fallback case.
 */
import type { SpecIssue } from './issue.js';
import type { BoardTrust } from './trust.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitRunner } from '../pr/git.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { completeSpecBody } from '../tests/spec-bodies.js';

import { ISSUE_VIEW_FIELDS, SPEC_LABEL } from './issue.js';
import { LEAK_REFUSAL_EXIT } from './leak.js';
import { specPath } from './naming.js';
import { boardRepoLabel, BOARD_REFUSAL_EXIT, inspectSpecIssue, resolvePlanSpec, UNNAMED_REPO } from './plan-spec.js';
import { SPEC_READY_LABEL, specReadyRefusalMessage, TEMPLATE_HEADINGS } from './readiness.js';
import { PR_LIST_FIELDS } from './roadmap.js';
import { TRUST_REFUSAL_EXIT } from './trust.js';

/** Where snapshots go, as a project configures it. */
const SPECS_DIR = '.rafa/specs';

/** The roadmap issue every `--next` case here is configured with. */
const ROADMAP = 31;

/** A roadmap body whose first undone line is issue 20. */
const ROADMAP_BODY = ['## Next, in order', '', '- [x] #17 — done', '- [ ] #20 — the pull request commands', ''].join('\n');

/** Where one case writes. */
let root = '';

/** Every root this file made, removed at the end. */
const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-plan-spec-'));
  roots.push(root);
});

afterAll(() => {
  for (const made of roots) rmSync(made, { recursive: true, force: true });
});

/** The filled body a planted issue carries; `../tests/spec-bodies.ts` holds why it is shared. */
function completeBody(number: number): string {
  return completeSpecBody(`Issue ${String(number)}`);
}

/** The body an issue opened before `src/board/templates/spec.md` carries: no heading the template names. */
function templatelessBody(number: number): string {
  return `# Issue ${String(number)}\n\nThe body.\n`;
}

/** A planted issue: the five fields, labelled ready and complete unless a case says otherwise. */
function issueOf(number: number, fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeBody(number),
    state: 'OPEN',
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
    author: 'octocat',
    ...fields,
  };
}

/** What a `gh` answer holds. */
function said(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** The permission the collaborators endpoint answers for a login nobody planted otherwise. */
const PERMISSIONS: Readonly<Record<string, string>> = Object.freeze({ octocat: 'admin' });

/** The `gh api` path one login's permission is read at, with the placeholders `gh` expands. */
function permissionPath(login: string): string {
  return `repos/{owner}/{repo}/collaborators/${login}/permission`;
}

/** The command a permission lookup for `login` is sent as, as {@link plantedGh} records it. */
function permissionCommand(login: string): string {
  return `api ${permissionPath(login)}`;
}

/**
 * A `gh` runner over planted issues and planted permissions, keeping
 * every command it was sent.
 *
 * The permission route is what check 0 spends: a login `permissions`
 * names is answered with that permission in both fields, and any other
 * login gets the 404 GitHub answers for an account the repository does
 * not know, which `./trust.ts` reads as a failed lookup.
 */
function plantedGh(
  issues: readonly SpecIssue[],
  permissions: Readonly<Record<string, string>> = PERMISSIONS,
): { gh: GhRunner; sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  const gh: GhRunner = (args) => {
    sent = [...sent, args.join(' ')];
    if (args[0] === 'pr' && args[1] === 'list') return Promise.resolve(said('[]'));
    if (args[0] === 'issue' && args[1] === 'list') {
      return Promise.resolve(said(JSON.stringify([{ number: ROADMAP, title: 'Roadmap' }])));
    }
    if (args[0] === 'api') {
      const login = Object.keys(permissions).find((name) => args[1] === permissionPath(name));
      if (login === undefined) {
        return Promise.resolve({ ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
      }
      return Promise.resolve(said(JSON.stringify({ permission: permissions[login], role_name: permissions[login] })));
    }
    const found = issues.find((issue) => String(issue.number) === args[2]);
    if (args[0] !== 'issue' || args[1] !== 'view' || found === undefined) {
      return Promise.resolve({ ok: false, stdout: '', stderr: `no planted answer for ${args.join(' ')}` });
    }
    return Promise.resolve(said(JSON.stringify({
      number: found.number,
      title: found.title,
      body: found.body,
      state: found.state,
      labels: found.labels.map((name) => ({ name })),
      author: { login: found.author },
    })));
  };
  return { gh, sent: () => sent };
}

/** The `origin` every planted `git` answers, and the command that reads it. */
const ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The one command the repository label is read with. */
const ORIGIN_COMMAND = 'remote get-url origin';

/** What a trust refusal calls the repository, given {@link ORIGIN}. */
const REPO = 'github.com/open-tomato/rafa';

/** A `git` runner answering no branch and one `origin`, keeping every command it was sent. */
function plantedGit(): { git: GitRunner; sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  const git: GitRunner = (args) => {
    sent = [...sent, args.join(' ')];
    return args.join(' ') === ORIGIN_COMMAND
      ? { ok: true, stdout: `${ORIGIN}\n`, stderr: '' }
      : { ok: true, stdout: '', stderr: '' };
  };
  return { git, sent: () => sent };
}

/** A board trust over one planted permission answer, for a direct {@link inspectSpecIssue} call. */
function trustOf(permission: string | null, trustedAuthors: readonly string[] = []): BoardTrust {
  return {
    permissions: (login) => Promise.resolve(permission === null
      ? { login, permission: null, roleName: null, detail: 'the lookup was planted to fail' }
      : { login, permission, roleName: permission, detail: '' }),
    trustedAuthors,
    repo: REPO,
  };
}

/** The trust every case that is not about check 0 runs with: the author holds write access. */
const TRUSTED = trustOf('admin');

/** An output that keeps nothing; the lines are `./spec-source.test.ts`'s subject. */
const OUTPUT = sinkOutput({});

/** What a case varies about one resolution. */
interface PlanSpecFields {
  readonly refresh?: boolean;
  readonly dryRun?: boolean;
  readonly roadmapIssue?: number | null;
  readonly trustedAuthors?: readonly string[];
}

/** What {@link resolvePlanSpec} is asked for one planted board. */
function ask(
  request: Parameters<typeof resolvePlanSpec>[0]['request'],
  gh: GhRunner,
  git: GitRunner,
  fields: PlanSpecFields = {},
): ReturnType<typeof resolvePlanSpec> {
  return resolvePlanSpec({
    request,
    refresh: fields.refresh ?? false,
    dryRun: fields.dryRun ?? false,
    repoRoot: root,
    specsDir: SPECS_DIR,
    roadmapIssue: fields.roadmapIssue ?? null,
    trustedAuthors: fields.trustedAuthors ?? [],
    findSpec: (spec) => spec,
    gh,
    git,
    output: OUTPUT,
  });
}

/** What a thrown `CommandExit` carried. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

/** The snapshot path for a planted issue. */
function snapshotAt(issue: number): string {
  return specPath(SPECS_DIR, issue, `Issue ${String(issue)}`);
}

describe('the spec an issue is planned from', () => {
  it('is read with the field list the read declares, snapshotted, and answered with its gate issue', async () => {
    const board = plantedGh([issueOf(20)]);
    const git = plantedGit();

    const resolved = await ask({ kind: 'issue', issue: 20 }, board.gh, git.git);

    expect(board.sent()).toEqual([`issue view 20 --json ${ISSUE_VIEW_FIELDS}`, permissionCommand('octocat')]);
    expect(git.sent()).toEqual([ORIGIN_COMMAND]);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'issue', issue: 20, path: snapshotAt(20), source: 'issue #20' });
    expect(resolved.gate?.number).toBe(20);
    expect(readFileSync(join(root, snapshotAt(20)), 'utf8')).toBe(completeBody(20));
  });

  it('asks gh nothing on the spec route, and answers no gate issue for it', async () => {
    const board = plantedGh([issueOf(20)]);
    const git = plantedGit();
    mkdirSync(join(root, SPECS_DIR), { recursive: true });

    const resolved = await ask({ kind: 'spec', spec: 'spec.md' }, board.gh, git.git);

    expect(board.sent()).toEqual([]);
    expect(git.sent()).toEqual([]);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'spec', issue: null, path: 'spec.md' });
    expect(resolved.gate).toBeNull();
  });

  it('refuses an issue nobody marked ready, before anything is written', async () => {
    const board = plantedGh([issueOf(20, { labels: [SPEC_LABEL] })]);
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toBe(specReadyRefusalMessage(20));
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
    // The control: the same call writes the snapshot once the label is there.
    await ask({ kind: 'issue', issue: 20 }, plantedGh([issueOf(20)]).gh, git.git);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(true);
  });

  it('refuses an issue an outsider opened, before anything is written', async () => {
    const board = plantedGh([issueOf(20, { author: 'outsider' })], { outsider: 'read' });
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refused.message).toBe(`issue #20 was opened by outsider, who has no write access to ${REPO}; a member must open the spec`);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
    // The control: the same call for an issue a write-holder opened
    // writes the snapshot, so the refusal above is the author and not a
    // resolution that writes nothing whoever asks.
    await ask({ kind: 'issue', issue: 20 }, plantedGh([issueOf(20)]).gh, git.git);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(true);
  });

  it('refuses an issue whose author the lookup could not be made for, and writes nothing either', async () => {
    const board = plantedGh([issueOf(20, { author: 'ghost' })], {});
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refused.message).toContain(`whose write access to ${REPO} could not be read`);
    expect(refused.message).toContain('gh: Not Found (HTTP 404)');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });

  it('spends no permission lookup on a login board.trustedAuthors names', async () => {
    const board = plantedGh([issueOf(20, { author: 'rafa-bot' })], {});
    const git = plantedGit();

    const resolved = await ask({ kind: 'issue', issue: 20 }, board.gh, git.git, { trustedAuthors: ['rafa-bot'] });

    expect(board.sent()).toEqual([`issue view 20 --json ${ISSUE_VIEW_FIELDS}`]);
    expect(resolved.outcome).toBe('spec');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(true);
  });

  it('refuses a body carrying a home path, leaving no copy of it on disk', async () => {
    const leaking = issueOf(20, { body: `${completeBody(20)}\nRun it in /Users/ada/checkouts/rafa.\n` });
    const board = plantedGh([leaking]);
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 names a machine path or a credential');
    expect(refused.message).not.toContain('/Users/ada');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });
});

describe('the spec the roadmap picks', () => {
  it('walks the configured roadmap through gh and git, and snapshots the line it picks', async () => {
    const board = plantedGh([issueOf(ROADMAP, { body: ROADMAP_BODY, labels: [] }), issueOf(17, { state: 'CLOSED' }), issueOf(20)]);
    const git = plantedGit();

    const resolved = await ask({ kind: 'next', roadmap: null }, board.gh, git.git, { roadmapIssue: ROADMAP });

    // The order is the measured one: the roadmap body, the line it picks,
    // and the open pull requests last, asked only once a line needs the reading.
    expect(board.sent()).toEqual([
      `issue view ${String(ROADMAP)} --json ${ISSUE_VIEW_FIELDS}`,
      `issue view 20 --json ${ISSUE_VIEW_FIELDS}`,
      `pr list --state open --json ${PR_LIST_FIELDS} --limit 100`,
      permissionCommand('octocat'),
    ]);
    // The label is read ONCE for the walk, however many issues it reads.
    expect(git.sent()).toEqual([
      'for-each-ref --format=%(refname) refs/heads refs/remotes',
      'ls-remote --heads origin',
      ORIGIN_COMMAND,
    ]);
    if (resolved.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolved.reason}`);
    expect(resolved.spec).toMatchObject({ kind: 'next', issue: 20, path: snapshotAt(20) });
    expect(resolved.gate?.number).toBe(20);
  });

  it('stops the walk at a line whose author is untrusted, rather than skipping ahead', async () => {
    const board = plantedGh([
      issueOf(ROADMAP, { body: ROADMAP_BODY, labels: [] }),
      issueOf(17, { state: 'CLOSED' }),
      issueOf(20, { author: 'outsider' }),
    ], { octocat: 'admin', outsider: 'read' });

    const refused = await refusal(() => ask({ kind: 'next', roadmap: null }, board.gh, plantedGit().git, { roadmapIssue: ROADMAP }));

    expect(refused.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 was opened by outsider');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });

  it('writes nothing under --dry-run, and answers the reason it stopped', async () => {
    const board = plantedGh([issueOf(20)]);
    const git = plantedGit();

    const resolved = await ask({ kind: 'issue', issue: 20 }, board.gh, git.git, { dryRun: true });

    expect(resolved).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });
});

describe('the checks one issue passes, in the order they run', () => {
  it('weighs the author first, so an issue failing all four is named for its author', async () => {
    const all = issueOf(20, { labels: [SPEC_LABEL], body: 'Run it in /Users/ada/checkouts/rafa.\n' });

    const refused = await refusal(() => inspectSpecIssue(all, trustOf('read')));

    expect(refused.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refused.message).toBe(`issue #20 was opened by octocat, who has no write access to ${REPO}; a member must open the spec`);
    // The control: the same issue, with the same three body faults and
    // an author who holds write access, is named unready instead.
    expect((await refusal(() => inspectSpecIssue(all, TRUSTED))).message).toBe(specReadyRefusalMessage(20));
  });

  it('refuses an author whose permission could not be read, without claiming they lack access', async () => {
    const refused = await refusal(() => inspectSpecIssue(issueOf(20), trustOf(null)));

    expect(refused.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refused.message).toBe(
      `issue #20 was opened by octocat, whose write access to ${REPO} could not be read`
      + ' (the lookup was planted to fail); a member must open the spec',
    );
  });

  it('lets an author the allow-list names through, over a lookup planted to fail', async () => {
    // The lookup refuses everything, so the pass is the list answering
    // first and nothing else; the case beside it is what it would say.
    const listed = trustOf(null, ['OctoCat']);

    await expect(inspectSpecIssue(issueOf(20), listed)).resolves.toBeUndefined();
  });

  it('weighs the label before the leak, so an unlabelled leaking body is named unready', async () => {
    const all = issueOf(20, { labels: [SPEC_LABEL], body: 'Run it in /Users/ada/checkouts/rafa.\n' });

    const refused = await refusal(() => inspectSpecIssue(all, TRUSTED));

    expect(refused.message).toBe(specReadyRefusalMessage(20));
  });

  it('weighs the leak before the completeness gaps, so a labelled leaking body is named for the leak', async () => {
    const leaking = issueOf(20, { body: 'Run it in /Users/ada/checkouts/rafa.\n' });

    const refused = await refusal(() => inspectSpecIssue(leaking, TRUSTED));

    expect(refused.exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 names a machine path or a credential');
    // The control: the same body with the path taken out reaches the
    // completeness check, which names the headings it does not carry.
    const clean = issueOf(20, { body: 'Run it in the checkout.\n' });
    expect((await refusal(() => inspectSpecIssue(clean, TRUSTED))).message)
      .toContain('issue #20 is not ready to plan from');
  });

  it('lets an issue that is labelled, leaks nothing and fills the template through', async () => {
    await expect(inspectSpecIssue(issueOf(20), TRUSTED)).resolves.toBeUndefined();
  });
});

describe('the completeness refusal', () => {
  it('refuses an issue the template predates, naming every heading, before anything is written', async () => {
    const board = plantedGh([issueOf(20, { body: templatelessBody(20) })]);
    const git = plantedGit();

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, git.git));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 is not ready to plan from');
    for (const heading of TEMPLATE_HEADINGS) expect(refused.message).toContain(`"${heading}" is missing`);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
    // The control: the same call over the filled body writes the snapshot.
    await ask({ kind: 'issue', issue: 20 }, plantedGh([issueOf(20)]).gh, git.git);
    expect(existsSync(join(root, snapshotAt(20)))).toBe(true);
  });

  it('refuses a body filling every heading whose "Definition of done" holds no list item', async () => {
    const filled = completeBody(20);
    const heading = '## Definition of done';
    const prose = `${filled.slice(0, filled.indexOf(heading))}${heading}\n\nThis is done once the tests pass.\n`;
    const board = plantedGh([issueOf(20, { body: prose })]);

    const refused = await refusal(() => ask({ kind: 'issue', issue: 20 }, board.gh, plantedGit().git));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toContain('"Definition of done" holds no list item');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });

  it('stops the --next walk at a line whose issue is incomplete, rather than skipping ahead', async () => {
    const board = plantedGh([
      issueOf(ROADMAP, { body: ROADMAP_BODY, labels: [] }),
      issueOf(17, { state: 'CLOSED' }),
      issueOf(20, { body: templatelessBody(20) }),
    ]);

    const refused = await refusal(() => ask({ kind: 'next', roadmap: null }, board.gh, plantedGit().git, { roadmapIssue: ROADMAP }));

    expect(refused.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refused.message).toContain('issue #20 is not ready to plan from');
    expect(existsSync(join(root, snapshotAt(20)))).toBe(false);
  });
});

describe('the repository a trust refusal names', () => {
  it('reads origin through the git seam, normalised as the label a sentence carries', () => {
    const git = plantedGit();

    const label = boardRepoLabel(git.git);

    expect(git.sent()).toEqual([ORIGIN_COMMAND]);
    expect(label).toBe(REPO);
  });

  it('falls back to a name for a checkout with no origin, rather than an empty one', () => {
    const noRemote: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: No such remote origin' });
    const empty: GitRunner = () => ({ ok: true, stdout: '\n', stderr: '' });

    expect(boardRepoLabel(noRemote)).toBe(UNNAMED_REPO);
    expect(boardRepoLabel(empty)).toBe(UNNAMED_REPO);
  });
});

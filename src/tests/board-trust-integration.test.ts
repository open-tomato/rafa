/**
 * An integration suite over four of the five call sites
 * `src/board/trust.ts` REFUSES through: `inspectSpecIssue` and
 * `inspectRoadmapIssue` (`src/board/plan-spec.ts`), and
 * `readTrustedTriageComment` and `requireTrustedResolveAuthor`
 * (`src/commands/pr/triage-trust.ts`). `./trust.ts`'s own module note
 * numbers them the THIRD, the FOURTH and the TWO already in
 * `triage-trust.ts`. The fifth refusing site is `rafa issue ready`
 * (`src/commands/issue/ready.ts`), which refuses through
 * `requireTrustedBoardAuthor` as the two plan sites do; no scenario
 * below drives it, and `src/commands/issue/ready.test.ts` holds its
 * cases. The caller that IGNORES rather than refuses — the
 * `rafa:spec-review` marker filter in `./review-comment.ts` — answers
 * none of the four scenarios below either, so it stays
 * `./review-comment.test.ts`'s alone.
 *
 * `./trust.test.ts` measures `readAuthorTrust` itself, and each
 * caller's own file measures what it does with a reading, but every
 * one of those readings arrives through a FAKE `Permissions` function
 * planted by hand (`plan-spec.test.ts`'s `trustOf`,
 * `triage-trust.test.ts`'s `permissionsFor`, `review-comment.test.ts`'s
 * own) — never through `createGhPermissions`'s real `gh api` parsing.
 * The one place that reading meets a caller for real is inside
 * `resolvePlanSpec`'s own route, and never a bare call to
 * `inspectRoadmapIssue`, and never either `triage-trust.ts` function at
 * all. So a caller that stopped reading `board.trustedAuthors`, or
 * whose refusal sentence drifted from another's, could leave every file
 * above green and still be wrong the moment a login's answer comes back
 * through the parsing this file drives for real.
 *
 * Four scenarios, each run across all four sites over ONE `gh` fake and
 * one trust object built through {@link ghBoardTrust} — the shape
 * `TriageTrust` matches field for field, so both `triage-trust.ts`
 * functions take it as it stands, with no fake of its own:
 *
 *  - a write-holder PLANS: `resolvePlanSpec` snapshots the issue to
 *    disk, and the other three sites answer trusted over the same login.
 *  - an outsider EXITS 2 WITH NO SNAPSHOT ON DISK: the disk is the one
 *    control no bare call to `inspectSpecIssue` could offer, since it
 *    writes nothing whichever way its check answers.
 *  - a failed lookup EXITS 2 WITH ITS OWN SENTENCE: a login `gh`
 *    answers a 404 for, refused with "could not be read" rather than
 *    "has no write access" — the clause `trustRefusalClause` and
 *    `ignoredCommentMessage` share, so a caller that ever merged the
 *    two reasons would be caught here at every site at once.
 *  - a login in `board.trustedAuthors` PASSES WITH NO PERMISSION LOOKUP
 *    SPENT: `gh` is planted with no permission answer for it at all, so
 *    a site that asked anyway would hit the very 404 the failed-lookup
 *    scenario reads on purpose, and the one assertion at the end reads
 *    every command sent across all four calls.
 *
 * No case spawns `gh` or reaches GitHub: the `GhRunner` below answers
 * `gh issue view` and the collaborators permission path from a table
 * planted per case, recording every command it is asked.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { SpecIssue } from '../board/issue.js';
import type { GitRunner } from '../pr/git.js';
import type { PullRequestComment } from '../pr/index.js';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { specPath } from '../board/naming.js';
import { inspectRoadmapIssue, resolvePlanSpec } from '../board/plan-spec.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { ghBoardTrust } from '../board/trust.js';
import { CommandExit } from '../cli/command.js';
import { requireTrustedResolveAuthor, readTrustedTriageComment } from '../commands/pr/triage-trust.js';
import { TRIAGE_MARKER } from '../pr/triage/comment.js';

import { sinkOutput } from './output-sinks.js';
import { completeSpecBody } from './spec-bodies.js';

/** Where `resolvePlanSpec` writes snapshots; a project's own default. */
const SPECS_DIR = '.rafa/specs';

/** What a trust refusal calls the repository for the two sites called directly. */
const DIRECT_REPO = 'open-tomato/rafa';

/** One scratch root every case in this file writes snapshots under, issues kept apart by number. */
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-board-trust-integration-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A planted issue: `SPEC_LABEL` and `SPEC_READY_LABEL` so `resolvePlanSpec`'s later checks clear too. */
function issueOf(number: number, title: string, author: string): SpecIssue {
  return {
    number,
    title,
    body: completeSpecBody(title),
    state: 'OPEN',
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
    author,
  };
}

/** The ROADMAP issue `inspectRoadmapIssue` reads: check 0 alone, so nothing else about it matters. */
function roadmapOf(author: string): SpecIssue {
  return { number: 31, title: 'Roadmap', body: '', state: 'OPEN', labels: [], author };
}

/** One marker comment `readTrustedTriageComment` may read, written by `author`. */
function commentOf(author: string): PullRequestComment {
  return {
    id: `c-${author}`,
    author: { login: author, isBot: false },
    url: `https://github.com/${DIRECT_REPO}/pull/41#issuecomment-${author}`,
    body: `${TRIAGE_MARKER}\n**rafa triage**: \`ci-lint\`, simple, not resolved`,
    updatedAt: '2026-09-21T09:00:00Z',
  };
}

/** What `requireTrustedResolveAuthor` reads a pull request as: its author and its number. */
function pullOf(author: string): { author: { login: string; isBot: boolean }; number: number } {
  return { author: { login: author, isBot: false }, number: 41 };
}

/**
 * A `gh` runner answering `gh issue view` over `issues` and the
 * collaborators permission path over `permissions`, with a login this
 * table names nothing for read as GitHub's own 404 on an account it
 * does not know — a failed lookup, never a pass. Records every command
 * sent, across every call a case makes it answer.
 */
function ghFor(
  permissions: Readonly<Record<string, string>>,
  issues: readonly SpecIssue[],
): { readonly gh: GhRunner; readonly sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  const gh: GhRunner = (args) => {
    sent = [...sent, args.join(' ')];
    if (args[0] === 'api') {
      const login = /^repos\/\{owner\}\/\{repo\}\/collaborators\/([^/]+)\/permission$/u.exec(String(args[1]))?.[1];
      const permission = login === undefined
        ? undefined
        : permissions[login];
      if (permission === undefined) {
        return Promise.resolve({ ok: false, stdout: '', stderr: `gh: ${String(login)} is not a user (HTTP 404)` });
      }
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ permission, role_name: permission }), stderr: '' });
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      const found = issues.find((issue) => String(issue.number) === args[2]);
      if (found === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no planted issue ${String(args[2])}` });
      return Promise.resolve({
        ok: true,
        stdout: JSON.stringify({
          number: found.number,
          title: found.title,
          body: found.body,
          state: found.state,
          labels: found.labels.map((name) => ({ name })),
          author: { login: found.author },
        }),
        stderr: '',
      });
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no planted answer for ${args.join(' ')}` });
  };
  return { gh, sent: () => sent };
}

/** A `git` runner answering one `origin`, for the label `resolvePlanSpec`'s own refusal names. */
function originGit(): GitRunner {
  return (args) => args.join(' ') === 'remote get-url origin'
    ? { ok: true, stdout: 'git@github.com:open-tomato/rafa.git\n', stderr: '' }
    : { ok: true, stdout: '', stderr: '' };
}

/** Drives one `--issue` resolution over `gh`, with no `--refresh` and no `--dry-run`. */
function resolveIssue(issue: number, gh: GhRunner, trustedAuthors: readonly string[] = []): ReturnType<typeof resolvePlanSpec> {
  return resolvePlanSpec({
    request: { kind: 'issue', issue },
    refresh: false,
    dryRun: false,
    repoRoot: root,
    specsDir: SPECS_DIR,
    roadmapIssue: null,
    trustedAuthors,
    findSpec: (spec) => spec,
    gh,
    git: originGit(),
    output: sinkOutput({}),
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

describe('the trust check, across every site it refuses through', () => {
  it('lets a write-holder plan: resolvePlanSpec snapshots the issue, and the other three sites pass the same login', async () => {
    const author = 'octocat';
    const table = ghFor({ [author]: 'admin' }, [issueOf(20, 'Write holder', author)]);

    const resolved = await resolveIssue(20, table.gh);
    expect(resolved.outcome).toBe('spec');
    expect(existsSync(join(root, specPath(SPECS_DIR, 20, 'Write holder')))).toBe(true);

    const trust = ghBoardTrust({ gh: table.gh, trustedAuthors: [], repo: DIRECT_REPO });
    await expect(inspectRoadmapIssue(roadmapOf(author), trust)).resolves.toBeUndefined();
    const triage = await readTrustedTriageComment([commentOf(author)], trust);
    expect(triage).toEqual({ comment: expect.objectContaining({ author: { login: author, isBot: false } }), ignored: [] });
    const resolveReading = await requireTrustedResolveAuthor(pullOf(author), trust);
    expect(resolveReading).toMatchObject({ trusted: true, source: 'permission' });

    // The lookup DID run, once per site over the same login, which is
    // what tells this case apart from the allow-list one below.
    expect(table.sent().filter((command) => command.startsWith('api '))).toHaveLength(4);
  });

  it('refuses an outsider with exit 2 and no snapshot on disk, at every site', async () => {
    const author = 'outsider';
    const table = ghFor({ [author]: 'read' }, [issueOf(21, 'Outsider', author)]);
    const trust = ghBoardTrust({ gh: table.gh, trustedAuthors: [], repo: DIRECT_REPO });

    const planRefusal = await refusal(() => resolveIssue(21, table.gh));
    expect(planRefusal.exitCode).toBe(2);
    expect(planRefusal.message).toContain('has no write access to');
    expect(existsSync(join(root, specPath(SPECS_DIR, 21, 'Outsider')))).toBe(false);

    const roadmapRefusal = await refusal(() => inspectRoadmapIssue(roadmapOf(author), trust));
    expect(roadmapRefusal.exitCode).toBe(2);
    expect(roadmapRefusal.message).toContain('has no write access to');

    const triage = await readTrustedTriageComment([commentOf(author)], trust);
    expect(triage.comment).toBeNull();
    expect(triage.ignored).toHaveLength(1);
    expect(triage.ignored[0]?.reason).toContain('has no write access to');
    expect(triage.ignored[0]?.reason).toContain('it was ignored and nothing in it was read');

    const resolveRefusal = await refusal(() => requireTrustedResolveAuthor(pullOf(author), trust));
    expect(resolveRefusal.exitCode).toBe(2);
    expect(resolveRefusal.message).toContain('has no write access to');
  });

  it('refuses a failed lookup with exit 2 and its own sentence, distinct from the outsider one, at every site', async () => {
    const author = 'ghost';
    // Planted with NO permission answer, so gh reads the account as a
    // 404 rather than a `read` — a lookup that could not be made,
    // which `./trust.ts` refuses as `lookup-failed` and never a pass.
    const table = ghFor({}, [issueOf(22, 'Ghost lookup', author)]);
    const trust = ghBoardTrust({ gh: table.gh, trustedAuthors: [], repo: DIRECT_REPO });

    const planRefusal = await refusal(() => resolveIssue(22, table.gh));
    expect(planRefusal.exitCode).toBe(2);
    expect(planRefusal.message).toContain('could not be read');
    expect(planRefusal.message).not.toContain('has no write access to');
    expect(existsSync(join(root, specPath(SPECS_DIR, 22, 'Ghost lookup')))).toBe(false);

    const roadmapRefusal = await refusal(() => inspectRoadmapIssue(roadmapOf(author), trust));
    expect(roadmapRefusal.exitCode).toBe(2);
    expect(roadmapRefusal.message).toContain('could not be read');
    expect(roadmapRefusal.message).not.toContain('has no write access to');

    const triage = await readTrustedTriageComment([commentOf(author)], trust);
    expect(triage.comment).toBeNull();
    expect(triage.ignored[0]?.reason).toContain('could not be read');
    expect(triage.ignored[0]?.reason).not.toContain('has no write access to');

    const resolveRefusal = await refusal(() => requireTrustedResolveAuthor(pullOf(author), trust));
    expect(resolveRefusal.exitCode).toBe(2);
    expect(resolveRefusal.message).toContain('could not be read');
    expect(resolveRefusal.message).not.toContain('has no write access to');
  });

  it('passes a login in board.trustedAuthors at every site, spending no permission lookup anywhere', async () => {
    const author = 'rafa-bot';
    // No permission planted for it at all: a site that asked anyway
    // would read the 404 the case above reads on purpose, and refuse.
    const table = ghFor({}, [issueOf(23, 'Trusted author', author)]);
    const trustedAuthors: readonly string[] = [author];

    const resolved = await resolveIssue(23, table.gh, trustedAuthors);
    expect(resolved.outcome).toBe('spec');
    expect(existsSync(join(root, specPath(SPECS_DIR, 23, 'Trusted author')))).toBe(true);

    const trust = ghBoardTrust({ gh: table.gh, trustedAuthors, repo: DIRECT_REPO });
    await expect(inspectRoadmapIssue(roadmapOf(author), trust)).resolves.toBeUndefined();
    const triage = await readTrustedTriageComment([commentOf(author)], trust);
    expect(triage.ignored).toEqual([]);
    expect(triage.comment?.author.login).toBe(author);
    const resolveReading = await requireTrustedResolveAuthor(pullOf(author), trust);
    expect(resolveReading).toMatchObject({ trusted: true, source: 'allow-list' });

    // The one assertion this whole scenario is about: not one of the
    // four calls above sent a permission lookup for `rafa-bot`.
    expect(table.sent().some((command) => command.startsWith('api '))).toBe(false);
  });
});

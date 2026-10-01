/**
 * Tests for `rafa epic cancel` (`cancel.ts`) in `native` mode: the
 * listing read with the native fields, the dependents read through the
 * relationships port as the open issues outside the epic with a
 * `blockedBy` link to an open sub-issue, and an unblock answer that
 * CLEARS NOTHING: it writes the note and the comment, takes no label off
 * and removes no blocked-by link. The `labels` cases stay in
 * `./cancel.test.ts`.
 *
 * The board, planted as `gh` writes a native listing: epic #40 holds
 * #12 and #14 open and #13 closed as sub-issues. #57 carries
 * `spec:blocked` and a `Blocked by: #12` line, and `blockedBy` links to
 * #12, the open #51, the foreign `acme/other#3` and the closed #13. #59
 * has a `blockedBy` link to #14 and no line. #58 carries `spec:blocked`
 * and a `Blocked by: #14` line and no link.
 *
 * ## The controls
 *
 *  - The rows carry the `labels` mode's marks too: #40 and #12 carry
 *    `epic:auth`, so the same listing read with no port finds #57 alone
 *    by its line, and #58 by none; `native` finds #57 and #59.
 *  - #57 carries `spec:blocked`, which a `labels` unblock of a line
 *    naming nothing else open takes off: the native run must not.
 *  - The run answering unblock records the note's body write and the
 *    comment, so the filters asserting no label write and no link write
 *    are shown able to find a write.
 */
import type { EpicCancelSeams } from './cancel.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitRunner } from '../../pr/git.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderCancelComment, renderDependentComment, renderUnblockNote } from '../../board/epic-trail.js';
import { createNativeRelations } from '../../board/relations/native.js';
import { nativeBoardListFields, parseBoardListing } from '../../board/roadmap-board.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { keptLinksLine } from './cancel-unblock.js';
import { createEpicCancelCommand, readEpicToCancel, unaskedCancelMessage } from './cancel.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-cancel-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** Another repository. */
const FOREIGN = 'acme/other';

/** The day the planted clock reads. */
const DAY = '2026-09-28';

/** A `gh` every call to which fails the case: the port's reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link REPOSITORY}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** A link node naming issue `number` on `repository`, as `gh` writes it. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository: string = REPOSITORY): object {
  return { number, title: `Issue ${String(number)}`, state, url: `https://github.com/${repository}/issues/${String(number)}` };
}

/** A list of link nodes, as `gh` writes one. */
function links(nodes: readonly object[]): object {
  return { nodes, totalCount: nodes.length };
}

/** The fields a row may set. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly parent?: number;
  readonly blockedBy?: readonly object[];
  readonly subIssues?: readonly object[];
}

/** One issue as `gh issue list --json <nativeBoardListFields>` writes it. */
function row(number: number, fields: RowFields = {}): object {
  const state = fields.state ?? 'OPEN';
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: (fields.labels ?? []).map((name) => ({ name })),
    parent: fields.parent === undefined
      ? null
      : node(fields.parent),
    blockedBy: links(fields.blockedBy ?? []),
    blocking: links([]),
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: links(subIssues),
  };
}

/** #57's body: a line naming #12. */
const BODY_57 = 'Pay at checkout.\n\nBlocked by: #12\n';

/** #58's body: a line naming #14. */
const BODY_58 = 'Invoice runs.\n\nBlocked by: #14\n';

/** #59's body: no line. */
const BODY_59 = 'Refunds.\n';

/** The board; the module note holds what each row is for. */
const LISTING: readonly object[] = [
  row(40, { labels: ['type:epic', 'epic:auth', 'horizon:now'], subIssues: [node(12), node(14), node(13, 'CLOSED')] }),
  row(12, { labels: ['epic:auth'], parent: 40 }),
  row(13, { state: 'CLOSED', parent: 40 }),
  row(14, { parent: 40 }),
  row(51),
  row(57, {
    labels: ['spec:blocked'],
    body: BODY_57,
    blockedBy: [node(12), node(51), node(3, 'OPEN', FOREIGN), node(13, 'CLOSED')],
  }),
  row(58, { labels: ['spec:blocked'], body: BODY_58 }),
  row(59, { body: BODY_59, blockedBy: [node(14)] }),
];

/** The listing as the native command reads it. */
const ISSUES = parseBoardListing(JSON.stringify(LISTING), 'the planted listing', 'native');

/** The issue number an `api repos/{owner}/{repo}/issues/<n>` path names, or NaN. */
function issueOfPath(path: string): number {
  return Number(/^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/u.exec(path)?.[1] ?? Number.NaN);
}

/** A `gh` answering the listing, the pull requests, the bodies and every write, recording each call. */
function plantedGh(): { gh: GhRunner; calls: (readonly string[])[] } {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const bodies = new Map<number, string>(ISSUES.map((issue) => [issue.number, issue.body]));
  const calls: (readonly string[])[] = [];
  const answer = (args: readonly string[]): GhResult => {
    const [noun, verb = ''] = args;
    if (noun === 'issue' && verb === 'list') return ok(JSON.stringify(LISTING));
    if (noun === 'pr' && verb === 'list') return ok('[]');
    if (noun === 'issue' && (verb === 'edit' || verb === 'close')) return ok('');
    const bodyArg = args.find((arg) => arg.startsWith('body='))?.slice('body='.length) ?? '';
    if (noun === 'api' && args.includes('POST')) return ok(JSON.stringify({ id: 1, body: bodyArg, user: { login: 'rafa-bot' } }));
    const issue = issueOfPath(verb);
    if (noun === 'api' && args.includes('PATCH') && bodies.has(issue)) {
      bodies.set(issue, bodyArg);
      return ok(JSON.stringify({ body: bodyArg }));
    }
    if (noun === 'api' && args.length === 2 && bodies.has(issue)) return ok(JSON.stringify({ body: bodies.get(issue) }));
    return { ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` };
  };
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(answer(args));
  };
  return { gh, calls };
}

/** A prompter answering `answers` in turn, null once they run out. */
function scriptedPrompter(answers: readonly string[]): () => Prompter {
  let asked = 0;
  const prompter: Prompter = {
    say: () => undefined,
    ask: () => {
      asked += 1;
      return Promise.resolve(answers[asked - 1] ?? null);
    },
    close: () => undefined,
  };
  return () => prompter;
}

/** A `git` that fails the case: no move is answered here. */
const NO_GIT: GitRunner = (args) => {
  throw new Error(`git ${args.join(' ')} was run`);
};

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** Dispatches `rafa epic cancel 40` in native mode, answering `answers`, or with no terminal when null. */
async function run(answers: readonly string[] | null) {
  const planted = plantedGh();
  const seams: EpicCancelSeams = {
    gh: planted.gh,
    git: NO_GIT,
    isTerminal: () => answers !== null,
    openPrompter: scriptedPrompter(answers ?? []),
    now: () => new Date(2026, 8, 28, 12),
    relations: NATIVE,
  };
  const commands: RafaCommand[] = [createEpicCancelCommand(seams)];
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
  const outcome = await dispatchInProject(['epic', 'cancel', '40'], [EPIC_SUBJECT], commands, project);
  return { ...outcome, calls: planted.calls };
}

/** The calls that change something on GitHub. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'edit' || call[1] === 'close' || call.includes('POST') || call.includes('PATCH'));
}

describe('readEpicToCancel in native mode', () => {
  it('reads the dependents from blockedBy links to open sub-issues, where labels reads the lines (control)', () => {
    const native = readEpicToCancel(ISSUES, 40, NATIVE);
    const labels = readEpicToCancel(ISSUES, 40);

    expect(native.dependents.map(({ issue, waitsOn }) => [issue.number, waitsOn])).toEqual([[57, [12]], [59, [14]]]);
    expect(native.problems).toEqual([]);
    expect(labels.dependents.map(({ issue, waitsOn }) => [issue.number, waitsOn])).toEqual([[57, [12]]]);
  });
});

describe('rafa epic cancel in native mode', () => {
  it('lists the board once with the native fields and, with no terminal, names the native dependents and writes nothing', async () => {
    const outcome = await run(null);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.calls.filter((call) => call[1] === 'list')).toEqual([expect.arrayContaining([nativeBoardListFields])]);
    expect(writesOf(outcome.calls)).toEqual([]);
    expect(outcome.stdout).toBe([
      'Epic #40: 2 issues outside it wait on its open members:',
      '- #57 Issue 57, waiting on #12',
      '- #59 Issue 59, waiting on #14',
      unaskedCancelMessage(40),
      '',
    ].join('\n'));
  });

  it('unblocks by note and comment alone: no label is taken off and no blocked-by link removed', async () => {
    const outcome = await run(['u', 'u']);
    const note57 = renderUnblockNote(DAY, 40, [12], ['#51', `${FOREIGN}#3`]);
    const note59 = renderUnblockNote(DAY, 40, [14], []);
    const writes = writesOf(outcome.calls);

    expect(outcome.exitCode).toBe(0);
    expect(writes).toEqual([
      ['api', 'repos/{owner}/{repo}/issues/57', '-X', 'PATCH', '-f', `body=${BODY_57}\n${note57}\n`],
      ['api', 'repos/{owner}/{repo}/issues/57/comments', '-X', 'POST', '-f', `body=${renderDependentComment('unblocked', 40, [12])}`],
      ['api', 'repos/{owner}/{repo}/issues/59', '-X', 'PATCH', '-f', `body=${BODY_59}\n${note59}\n`],
      ['api', 'repos/{owner}/{repo}/issues/59/comments', '-X', 'POST', '-f', `body=${renderDependentComment('unblocked', 40, [14])}`],
      ['issue', 'close', '40', '--reason=not planned', `--comment=${renderCancelComment(null, [
        { issue: 57, answer: { kind: 'unblocked' } },
        { issue: 59, answer: { kind: 'unblocked' } },
      ])}`],
    ]);
    expect(writes.filter((call) => call.some((arg) => arg.includes('label') || arg.includes('blocked-by')))).toEqual([]);
    expect(outcome.stdout).toContain(`${keptLinksLine(57, [12])}\n`);
    expect(outcome.stdout).toContain(`${keptLinksLine(59, [14])}\n`);
    expect(outcome.stdout).not.toContain('spec:blocked');
  });
});

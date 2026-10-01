/**
 * Tests for `rafa epic move` (`move.ts`) in `native` mode, and for
 * `./move-native.ts`: the listing read with the native fields, the epic
 * the issue leaves read as its sub-issue parent through the port, the
 * move sent as one `gh issue edit <n> --parent <epic>` and nothing else
 * but the trail's comment, and the mode read off the project's config.
 * The `labels` cases stay in `./move.test.ts`.
 *
 * The board, planted as `gh` writes a native listing: epic #40 holds the
 * open #12 and #14 and the closed #13 as sub-issues; epic #50 holds #51
 * and lists it on its checklist; epic #60 is closed; epic #70 is open and
 * carries no `epic:` label. #61 has no parent, #63's parent is #99, which
 * the listing does not hold, and #64's is an issue of another repository.
 * `git` holds `feat/rafa-12-login`, and the open pull request #7 closes
 * #12.
 *
 * ## The controls
 *
 *  - The rows carry the `labels` mode's marks too: #40 and #12 carry
 *    `epic:auth` and #50 `epic:billing`, and #50's body lists #51, so a
 *    run that swapped labels or edited a checklist would send a write the
 *    filters below find; the labels move of the same line does, in
 *    `./move.test.ts`.
 *  - #70 carries no `epic:` label, which `labels` refuses as a target;
 *    the native move to it goes through.
 *  - The move that lands sends a write, so the filters asserting none
 *    are shown able to find one.
 */
import type { EpicMoveSeams } from './move.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { MembershipChange, OpenWork } from '../../board/epic-trail.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { RafaCommand } from '../../cli/command.js';
import type { GitResult, GitRunner } from '../../pr/git.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { reasonQuestion, renderMoveComment, unaskedReasonMessage } from '../../board/epic-trail.js';
import { createLabelsRelations } from '../../board/relations/labels.js';
import { createNativeRelations } from '../../board/relations/native.js';
import { nativeBoardListFields, parseBoardListing } from '../../board/roadmap-board.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { NATIVE_MODE, NATIVE_RETRY_HINT, nativeEpicLeft, nativeParentLine, readBoardRepository } from './move-native.js';
import { applyEpicMove, createEpicMoveCommand, readEpicMove } from './move.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-move-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** Another repository. */
const FOREIGN = 'acme/other';

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** A config naming the native mode. */
const NATIVE_CONFIG = 'tracker:\n  default: local\nboard:\n  relationships: native\n';

/** A config naming no mode: `labels`. */
const LABELS_CONFIG = 'tracker:\n  default: local\n';

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
  readonly parent?: object;
  readonly subIssues?: readonly object[];
}

/** One issue as `gh issue list --json <nativeBoardListFields>` writes it. */
function row(number: number, fields: RowFields = {}): object {
  const state = fields.state ?? 'OPEN';
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: (fields.labels ?? []).map((name) => ({ name })),
    parent: fields.parent ?? null,
    blockedBy: links([]),
    blocking: links([]),
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: links(subIssues),
  };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  row(40, { labels: ['type:epic', 'epic:auth'], subIssues: [node(12), node(13, 'CLOSED'), node(14)] }),
  row(12, { labels: ['epic:auth', 'type:feature'], parent: node(40) }),
  row(13, { state: 'CLOSED', parent: node(40) }),
  row(14, { parent: node(40) }),
  row(50, { labels: ['type:epic', 'epic:billing'], body: '## Specs\n\n- [ ] #51 invoices\n', subIssues: [node(51)] }),
  row(51, { parent: node(50) }),
  row(60, { labels: ['type:epic'], state: 'CLOSED' }),
  row(70, { labels: ['type:epic'] }),
  row(61),
  row(63, { parent: node(99) }),
  row(64, { parent: node(40, 'OPEN', FOREIGN) }),
];

/** The listing as the native command reads it. */
const ISSUES = parseBoardListing(JSON.stringify(LISTING), 'the planted listing', 'native');

/** The open pull requests. */
const PULLS: readonly object[] = [{ number: 7, headRefName: 'fix-login', body: 'Closes #12' }];

/** #12's open work on the board. */
const WORK_12: OpenWork = { branches: ['feat/rafa-12-login'], pullRequests: [7] };

/** The move of #12 from epic #40 to #50 the cases make. */
const MOVE_12: MembershipChange = { kind: 'move', issue: 12, from: 40, to: 50 };

/** A `gh` every call to which fails the case: the port's reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`gh ${args.join(' ')} was run`);
};

/** How the planted `gh` answers. */
interface Planted {
  readonly failEdit?: boolean;
  readonly failComment?: boolean;
  readonly failRepo?: boolean;
}

/** A `gh` answering the native listing, the repository, the pull requests and every write, recording each call. */
function plantedGh(planted: Planted = {}): { gh: GhRunner; calls: (readonly string[])[] } {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const calls: (readonly string[])[] = [];
  const answer = (args: readonly string[]): GhResult => {
    const [noun, verb = ''] = args;
    if (noun === 'issue' && verb === 'list') return ok(JSON.stringify(LISTING));
    if (noun === 'repo' && verb === 'view') {
      return planted.failRepo === true
        ? failed('no git remotes found')
        : ok(JSON.stringify({ nameWithOwner: REPOSITORY }));
    }
    if (noun === 'pr' && verb === 'list') return ok(JSON.stringify(PULLS));
    if (noun === 'issue' && verb === 'edit') {
      return planted.failEdit === true
        ? failed('HTTP 422: sub-issue refused')
        : ok('');
    }
    if (noun === 'api' && args.includes('POST')) {
      return planted.failComment === true
        ? failed('HTTP 502: Bad Gateway')
        : ok(JSON.stringify({ id: 1, body: 'x', user: { login: 'rafa-bot' } }));
    }
    return failed(`unplanted: gh ${args.join(' ')}`);
  };
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(answer(args));
  };
  return { gh, calls };
}

/** A `git` holding `feat/rafa-12-login` locally and on the remote, recording every call. */
function plantedGit(): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const ok = (lines: readonly string[]): GitResult => ({ ok: true, stdout: lines.join('\n'), stderr: '' });
  const git: GitRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'for-each-ref') return ok(['refs/heads/feat/rafa-12-login', 'refs/heads/main']);
    if (args[0] === 'ls-remote') return ok(['abc123\trefs/heads/feat/rafa-12-login']);
    return { ok: false, stdout: '', stderr: `unplanted: git ${args.join(' ')}` };
  };
  return { git, calls };
}

/** What one case runs with. */
interface CaseSetup {
  readonly planted?: Planted;
  /** The project's config; {@link NATIVE_CONFIG} when left out. */
  readonly config?: string;
  /** True to hand the native relationships in as a seam rather than read the mode off the config. */
  readonly seam?: boolean;
}

/** Dispatches `rafa epic move <words>` over a planted `gh` and `git`, with no terminal. */
async function run(words: readonly string[], setup: CaseSetup = {}) {
  const planted = plantedGh(setup.planted);
  const git = plantedGit();
  const seams: EpicMoveSeams = {
    gh: planted.gh,
    git: git.git,
    isTerminal: () => false,
    ...setup.seam === true
      ? { relations: createNativeRelations({ gh: planted.gh, repository: REPOSITORY }) }
      : {},
  };
  const commands: RafaCommand[] = [createEpicMoveCommand(seams)];
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), setup.config ?? NATIVE_CONFIG);
  const outcome = await dispatchInProject(['epic', 'move', ...words], [EPIC_SUBJECT], commands, project);
  return { ...outcome, calls: planted.calls, gitCalls: git.calls };
}

/** The calls that change something on GitHub. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'edit' || call[1] === 'create' || call[1] === 'close'
    || call.includes('POST') || call.includes('PATCH'));
}

/** The comment a move posts on its issue. */
function commentCall(issue: number, body: string): readonly string[] {
  return ['api', `repos/{owner}/{repo}/issues/${String(issue)}/comments`, '-X', 'POST', '-f', `body=${body}`];
}

/** The listing call the native mode sends. */
const NATIVE_LISTING = ['issue', 'list', '--state', 'all', '--limit', '1000', '--json', nativeBoardListFields];

/** The native relationships over {@link NO_GH}, for reads. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** A `git` and a pull request lister that fail the case when read. */
const UNREAD = {
  git: (): GitResult => {
    throw new Error('git was read');
  },
  pullRequests: (): Promise<never> => Promise.reject(new Error('the pull requests were read')),
};

describe('nativeEpicLeft', () => {
  it('answers the epic of one in an epic, and a sentence naming the mode for none and for an unresolved parent', () => {
    const reading = NATIVE.read(ISSUES);
    const on = (number: number) => ISSUES.find((issue) => issue.number === number)!;

    expect(nativeEpicLeft(reading.epicOf(on(12)))).toBe(40);
    expect(nativeEpicLeft(reading.epicOf(on(61)))).toBe(`${NATIVE_MODE}: #61 has no parent epic, so it is in no epic to move from`);
    expect(nativeEpicLeft(reading.epicOf(on(63)))).toBe(`${NATIVE_MODE}: #63's parent #99 is not an issue typed epic on the board listing,`
      + ' so the epic it leaves cannot be read');
    expect(nativeEpicLeft(reading.epicOf(on(64)))).toContain(`#64's parent ${FOREIGN}#40 is not an issue typed epic`);
  });
});

describe('readBoardRepository', () => {
  it('reads owner/name off one gh repo view', async () => {
    const planted = plantedGh();

    expect(await readBoardRepository(planted.gh)).toBe(REPOSITORY);
    expect(planted.calls).toEqual([['repo', 'view', '--json', 'nameWithOwner']]);
  });

  it('rejects a failed call, output that is not JSON and a name that is not owner/name', async () => {
    const answering = (result: GhResult): GhRunner => () => Promise.resolve(result);

    await expect(readBoardRepository(answering({ ok: false, stdout: '', stderr: 'no remotes' }))).rejects
      .toThrow('gh repo view --json nameWithOwner failed: no remotes');
    await expect(readBoardRepository(answering({ ok: true, stdout: 'nope', stderr: '' }))).rejects.toThrow('is not JSON');
    await expect(readBoardRepository(answering({ ok: true, stdout: '{"nameWithOwner":"board"}', stderr: '' }))).rejects
      .toThrow('expected owner/name');
  });
});

describe('readEpicMove in native mode', () => {
  it('reads the epic left off the parent, no label and no line, and an open issue\'s work', async () => {
    const git = plantedGit();
    const reading = await readEpicMove({
      issues: ISSUES,
      issue: 12,
      to: 50,
      git: git.git,
      pullRequests: () => Promise.resolve(PULLS as never),
      relations: NATIVE,
    });

    expect(reading).toEqual({ change: MOVE_12, relationships: 'native', work: WORK_12, problems: [] });
    expect(Object.keys(reading)).toEqual(['change', 'relationships', 'work', 'problems']);
  });

  it('takes a target with no epic: label, which labels mode refuses (control)', async () => {
    const native = await readEpicMove({ issues: ISSUES, issue: 13, to: 70, ...UNREAD, relations: NATIVE });

    expect(native.change).toEqual({ kind: 'move', issue: 13, from: 40, to: 70 });
    expect(native.work).toBeNull();
    await expect(readEpicMove({ issues: ISSUES, issue: 12, to: 70, ...UNREAD })).rejects.toThrow('Epic #70 carries no epic: label');
  });

  it('refuses each issue and target that cannot move with exit code 2, naming the mode where it is the reason', async () => {
    const cases: readonly (readonly [number, number, string])[] = [
      [61, 50, `${NATIVE_MODE}: #61 has no parent epic`],
      [63, 50, `${NATIVE_MODE}: #63's parent #99 is not an issue typed epic`],
      [64, 50, `${NATIVE_MODE}: #64's parent ${FOREIGN}#40`],
      [12, 40, `${NATIVE_MODE}: #12 is in epic #40 already: its parent is #40`],
      [99, 50, '#99 is not on the board listing'],
      [40, 50, '#40 is an epic, and an epic belongs to no epic'],
      [12, 51, '#51 is not an epic: it carries no type:epic label'],
      [12, 60, 'Epic #60 is closed, and an issue moves only to an open epic'],
    ];
    for (const [issue, to, message] of cases) {
      let caught: unknown = null;
      try {
        await readEpicMove({ issues: ISSUES, issue, to, ...UNREAD, relations: NATIVE });
      } catch (error) {
        caught = error;
      }
      expect((caught as { exitCode?: unknown } | null)?.exitCode).toBe(2);
      expect((caught as Error).message).toContain(message);
      expect((caught as Error).message).toEndWith('; nothing was changed');
    }
  });
});

describe('applyEpicMove', () => {
  it('refuses relationships of another mode than the reading\'s with a TypeError, sending nothing', async () => {
    const planted = plantedGh();
    const comments: number[] = [];
    const board = { comment: (issue: number) => {
      comments.push(issue);
      return Promise.resolve({ id: '1', body: '', login: null });
    } } as unknown as IssueBoard;
    const reading = await readEpicMove({ issues: ISSUES, issue: 13, to: 50, ...UNREAD, relations: NATIVE });

    await expect(applyEpicMove({ board, relations: createLabelsRelations({ gh: planted.gh }), issues: ISSUES }, reading, 'x'))
      .rejects.toThrow(TypeError);
    expect(planted.calls).toEqual([]);
    expect(comments).toEqual([]);
  });
});

describe('rafa epic move in native mode', () => {
  it('reads the mode off the config, sets the parent in one edit and comments the move, writing no label and no body', async () => {
    const result = await run(['12', '--to=50', '--reason=belongs with billing']);

    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([
      ['repo', 'view', '--json', 'nameWithOwner'],
      NATIVE_LISTING,
      ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,body', '--limit', '100'],
      ['issue', 'edit', '12', '--parent', '50'],
      commentCall(12, renderMoveComment(MOVE_12, 'belongs with billing', WORK_12)),
    ]);
    expect(writesOf(result.calls).filter((call) => call.some((arg) => arg.includes('label') || arg === 'PATCH'))).toEqual([]);
    expect(result.gitCalls.map((call) => call[0])).toEqual(['for-each-ref', 'ls-remote']);
    expect(result.stdout).toBe([
      'Moved #12 from epic #40 to #50: belongs with billing',
      nativeParentLine(50),
      'Its open work stays as it is: branch feat/rafa-12-login, pull request #7.',
      '',
    ].join('\n'));
  });

  it('sends the same writes with the relationships handed in, and reads no repository then', async () => {
    const result = await run(['12', '--to=50', '--reason=belongs with billing'], { seam: true });

    expect(result.exitCode).toBe(0);
    expect(result.calls.filter((call) => call[0] === 'repo')).toEqual([]);
    expect(writesOf(result.calls)).toEqual([
      ['issue', 'edit', '12', '--parent', '50'],
      commentCall(12, renderMoveComment(MOVE_12, 'belongs with billing', WORK_12)),
    ]);
  });

  it('with no mode in the config, reads no repository and moves by label (control)', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { config: LABELS_CONFIG });

    expect(result.calls.filter((call) => call[0] === 'repo')).toEqual([]);
    expect(result.calls[0]).toEqual(['issue', 'list', '--state', 'all', '--limit', '1000', '--json', 'number,title,body,state,stateReason,labels']);
    expect(writesOf(result.calls)[0]).toEqual(['issue', 'edit', '12', '--remove-label', 'epic:auth', '--add-label', 'epic:billing']);
  });

  it('moves a closed issue to an epic with no epic: label, reading no work', async () => {
    const result = await run(['13', '--to=70', '--reason=done there']);
    const change: MembershipChange = { kind: 'move', issue: 13, from: 40, to: 70 };

    expect(result.exitCode).toBe(0);
    expect(result.gitCalls).toEqual([]);
    expect(writesOf(result.calls)).toEqual([['issue', 'edit', '13', '--parent', '70'], commentCall(13, renderMoveComment(change, 'done there'))]);
  });

  it('refuses an issue with no parent and a move to its own parent with exit code 2, naming the mode and writing nothing', async () => {
    const orphan = await run(['61', '--to=50', '--reason=x']);
    const own = await run(['12', '--to=40', '--reason=x']);

    expect(orphan.stderr).toContain(`${NATIVE_MODE}: #61 has no parent epic`);
    expect(own.stderr).toContain(`${NATIVE_MODE}: #12 is in epic #40 already`);
    for (const result of [orphan, own]) {
      expect(result.exitCode).toBe(2);
      expect(writesOf(result.calls)).toEqual([]);
      expect(result.gitCalls).toEqual([]);
    }
  });

  it('with no terminal and no --reason, writes nothing and prints the question, exit 0', async () => {
    const result = await run(['12', '--to=50']);

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([]);
    expect(result.stdout).toBe(`${unaskedReasonMessage(reasonQuestion(MOVE_12))}\n`);
  });

  it('refuses a repository that cannot be read with exit code 2, before the listing', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failRepo: true } });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Could not read the board\'s repository, so nothing was changed: gh repo view --json nameWithOwner failed');
    expect(result.calls).toEqual([['repo', 'view', '--json', 'nameWithOwner']]);
  });

  it('refuses a parent edit gh refuses with exit code 1, posting no comment', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failEdit: true } });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not move #12 to epic #50: board relations native: move #12 into epic #50 was refused');
    expect(result.stderr).toContain(NATIVE_RETRY_HINT);
    expect(writesOf(result.calls)).toEqual([['issue', 'edit', '12', '--parent', '50']]);
  });

  it('ends with exit code 1 naming the parent when the comment could not be posted', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failComment: true } });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('warn: Could not comment on #12: ');
    expect(result.stderr).toContain(`❌ #12 moved to epic #50 (its parent is #50; ${NATIVE_MODE}), but the rest did not land;`
      + ' by hand: comment the move on #12.');
  });

  it('gives the move as the json result with relationships native, leaving the labels and checklist edits out', async () => {
    const result = await run(['12', '--to=50', '--reason=belongs with billing', '--output=json']);
    const data = (eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: Record<string, unknown> } | undefined)?.data;

    expect(result.exitCode).toBe(0);
    expect(data).toEqual({
      issue: 12,
      from: 40,
      to: 50,
      relationships: 'native',
      work: WORK_12,
      problems: [],
      status: 'moved',
      reason: 'belongs with billing',
      question: null,
      outcome: { commentProblem: '' },
    });
    expect(Object.keys(data ?? {})).toEqual(['issue', 'from', 'to', 'relationships', 'work', 'problems', 'status', 'reason', 'question', 'outcome']);
    expect(Object.keys(data?.['outcome'] ?? {})).toEqual(['commentProblem']);
  });
});

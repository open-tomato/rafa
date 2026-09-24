/**
 * Tests for the `github` Tracker adapter (`src/adapters/tracker/github.ts`).
 *
 * The adapter contract runs first, over a fresh recorded fake
 * (`github-fake.ts`) for each case, narrowed to the three states GitHub
 * holds without a board; a case below holds that narrowing to the states
 * that answer no warning. The source's own cases follow, from
 * `packages/shared/issue-tracker/src/adapters/github.test.ts` in
 * open-tomato at commit `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0`,
 * ported to `bun:test` with the Projects v2, org issue type, OPT stamp
 * and module routing cases left out, as the adapter leaves those out.
 * The rest hold each change the module note lists.
 *
 * No case reaches GitHub or spawns the real `gh`. The adapter cases run
 * over the fake or over a scripted runner written here, and the runner
 * cases spawn a stand-in script written under a temporary directory this
 * file creates and removes. So the default command, `gh` looked up on
 * `PATH`, is never run by a case.
 *
 * Each refusal sits beside a control that what it refused would
 * otherwise have been sent: a refused ref beside the same number read as
 * a github ref, a refused draft beside the fixture filed, a refused
 * repository beside the one the fake holds. Where a case holds that
 * nothing was sent, it reads the fake's record of every command.
 *
 * Twenty-two mutations of `github.ts` were driven on 2026-09-14, one run
 * each over this file and `registry.test.ts`, with 168 pass before and
 * after and the module restored byte-identical (sha256), and every one
 * reddened at least one case:
 *
 *   - `capabilities` claiming projects reddened the contract's projects
 *     case, the capabilities case and the registry case reading them.
 *     `preflight` skipping `gh repo view` reddened the ok and no-remote
 *     preflight cases, and `preflight` rethrowing a rejecting runner the
 *     reason case.
 *   - `needs-triage` sent beside every priority reddened four label cases
 *     and the registry runner case. The label cache never filled reddened
 *     the once-per-life case alone. No label made before filing reddened
 *     51 of the 168, the contract's create cases among them, because the
 *     fake fails a create on a label the repository lacks.
 *   - The not-planned reason read on an open issue reddened the open
 *     not-planned case alone, and the url check dropped the pull request
 *     case alone. A cancel closed as completed reddened the contract's
 *     transition case and three more. `transition` never warning
 *     reddened the four warning rows, and `find` listing open issues
 *     alone the three listing cases.
 *   - Any non-empty external id accepted reddened seven of the nine id
 *     refusals, all but the empty id and the number. `.` and `..`
 *     accepted in a repository reddened the three refusals naming one, a
 *     foreign kind accepted the kind refusal, a comma accepted in a
 *     module the draft and query comma refusals, the draft never checked
 *     the six draft refusals, and the find state refusal dropped its five
 *     cases.
 *   - The URL read off the first line reddened the last-line case, and
 *     `get` dropping `--repo` the repository case, through the fake
 *     refusing another repository. The tracker unfrozen reddened the
 *     frozen case.
 *   - The runner rethrowing a spawn failure reddened the spawn case. The
 *     runner inheriting stdin reddened the stdin case only because the
 *     grid ran the suite with a line on its stdin: under a suite whose
 *     stdin is already empty, `inherit` and `ignore` read the same, so
 *     that case cannot redden for it in every run.
 *
 * The `env` option's cases were driven on 2026-09-24, restored
 * byte-identical (sha256) after each. Spawning without `env` reddened
 * the bare-name and absolute-command cases. Dropping the `Bun.which`
 * lookup reddened the two not-found cases alone: bun 1.3.14 looks a bare
 * name up on `env.PATH` itself, so the bare-name case passes either way
 * and the lookup is held by the message a missing command answers.
 */
import type { FakeGh, FakeGhOptions } from './github-fake.js';
import type { GhResult, GhRunner } from './github.js';
import type { IssueRef, IssueState, Tracker } from '../../ports/index.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { draftFixture, runTrackerContract } from './contract.js';
import { createFakeGh } from './github-fake.js';
import { createGhRunner, createGithubTracker } from './github.js';

/** The URL of issue 1 in the fake's default repository. */
const ISSUE_1_URL = 'https://github.com/open-tomato/rafa/issues/1';

/** The fields `get` asks for. */
const VIEW_FIELDS = 'number,title,body,state,stateReason,labels,url';

/** What `gh` wrote with no hosts configured, as recorded. */
const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';

/** What an external id that is not an issue number is refused with, after the id. */
const NUMBER_REFUSAL = 'is not a GitHub issue number, expected a positive whole number with no leading zero';

/** What `gh issue view 1 --repo cli/cli --json <fields>` wrote on 2026-09-14: a pull request. */
const RECORDED_PULL_REQUEST = {
  body: 'this PR implements the interactive PR list',
  labels: [],
  number: 1,
  state: 'MERGED',
  stateReason: '',
  title: 'interactive pr list',
  url: 'https://github.com/cli/cli/pull/1',
};

/** Each state, what `get` reads back once an issue is moved there, and the warning answered, if any. */
const READ_BACK: readonly (readonly [IssueState, IssueState, string | null])[] = [
  ['backlog', 'todo', 'issue #1 is now open, but GitHub Issues without a board holds no backlog state, so get reads it back as todo'],
  ['todo', 'todo', null],
  [
    'in-progress',
    'todo',
    'issue #1 is now open, but GitHub Issues without a board holds no in-progress state, so get reads it back as todo',
  ],
  [
    'in-review',
    'todo',
    'issue #1 is now open, but GitHub Issues without a board holds no in-review state, so get reads it back as todo',
  ],
  ['done', 'done', null],
  ['released', 'done', 'issue #1 is now closed, but GitHub Issues without a board holds no released state, so get reads it back as done'],
  ['cancelled', 'cancelled', null],
];

/** The states the contract round-trips. */
const TRANSITIONABLE: readonly IssueState[] = ['todo', 'done', 'cancelled'];

/** A github tracker over a fresh fake, and the fake. */
function overFake(options: FakeGhOptions = {}): { tracker: Tracker; fake: FakeGh } {
  const fake = createFakeGh(options);
  return { tracker: createGithubTracker({ gh: fake.run }), fake };
}

/** A runner answering each command with `answer`, and every command it was handed. */
function scripted(answer: (args: readonly string[]) => GhResult): { run: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    run: async (args) => {
      calls.push([...args]);
      return answer(args);
    },
    calls,
  };
}

/** A successful answer writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A github ref to issue `externalId`, with any field replaced. */
function githubRef(externalId: string, overrides: Partial<IssueRef> = {}): IssueRef {
  return { opt: 0, kind: 'github', externalId, url: null, ...overrides };
}

let contractFake = createFakeGh();

runTrackerContract({
  name: 'github',
  expectsProjects: false,
  expectedKind: 'github',
  create: async () => {
    contractFake = createFakeGh();
    return createGithubTracker({ gh: contractFake.run });
  },
  readComments: async (ref) => contractFake.issue(ref.externalId)?.comments ?? [],
  transitionableStates: TRANSITIONABLE,
});

describe('creating an issue', () => {
  it('sends the title and body as the draft holds them, with no OPT stamp', async () => {
    const { tracker, fake } = overFake();

    const ref = await tracker.create(draftFixture({ opt: 260, title: 'Fix the thing' }));

    expect(fake.issue(ref.externalId)).toMatchObject({
      title: 'Fix the thing',
      body: draftFixture().body,
    });
    expect((await tracker.get(ref)).title).toBe('Fix the thing');
  });

  it('answers the issue number, the url gh printed and the draft module and opt', async () => {
    const { tracker } = overFake();

    const ref = await tracker.create(draftFixture({ opt: 260 }));

    expect(ref).toStrictEqual({ opt: 260, kind: 'github', externalId: '1', url: ISSUE_1_URL, module: 'auth' });
  });

  it('labels the module and the type, and sends a set priority as its label', async () => {
    const { tracker, fake } = overFake();

    const ref = await tracker.create(draftFixture({ module: 'billing', type: 'spike', priority: 'high' }));

    expect(fake.issue(ref.externalId)?.labels).toEqual(['module:billing', 'type:spike', 'priority:high']);
  });

  it('sends needs-triage for a null priority, and no priority label', async () => {
    const { tracker, fake } = overFake();

    const ref = await tracker.create(draftFixture({ priority: null }));

    expect(fake.issue(ref.externalId)?.labels).toEqual(['module:auth', 'type:bug', 'needs-triage']);
    expect((await tracker.get(ref)).priority).toBeNull();
  });

  it('projects blockedBy as blocked-by labels that get reads back', async () => {
    const { tracker, fake } = overFake();

    const ref = await tracker.create(draftFixture({ blockedBy: [259, 258] }));

    expect(fake.issue(ref.externalId)?.labels).toContain('blocked-by:OPT-259');
    expect(fake.issue(ref.externalId)?.labels).toContain('blocked-by:OPT-258');
    expect((await tracker.get(ref)).blockedBy).toEqual([259, 258]);
  });

  it('makes every label before filing, each once', async () => {
    const { tracker, fake } = overFake();

    await tracker.create(draftFixture({ blockedBy: [259] }));

    expect(fake.calls().map((call) => call.slice(0, 3))).toEqual([
      ['label', 'create', 'module:auth'],
      ['label', 'create', 'type:bug'],
      ['label', 'create', 'blocked-by:OPT-259'],
      ['label', 'create', 'priority:urgent'],
      ['issue', 'create', '--title'],
    ]);
    expect(fake.calls()[0]).toEqual(['label', 'create', 'module:auth', '--force']);
  });

  it('makes a label once for the life of the tracker', async () => {
    const { tracker, fake } = overFake();
    const labelCreates = (): number => fake.calls().filter((call) => call[0] === 'label').length;

    await tracker.create(draftFixture());
    const afterFirst = labelCreates();
    await tracker.create(draftFixture());
    const afterSecond = labelCreates();
    await tracker.create(draftFixture({ module: 'billing' }));

    expect(afterFirst).toBe(3);
    expect(afterSecond).toBe(3);
    expect(labelCreates()).toBe(4);
    expect(fake.hasLabel('module:billing')).toBe(true);
  });

  it('rejects before filing when a label cannot be made, so nothing is orphaned', async () => {
    const { tracker, fake } = overFake({ labelCreateOk: false });

    await expect(tracker.create(draftFixture())).rejects.toThrow(
      'github tracker: gh label create "module:auth" failed:'
        + ' HTTP 403: Resource not accessible by integration (label create)',
    );
    expect(fake.issueCount()).toBe(0);
    expect(fake.calls().some((call) => call[0] === 'issue')).toBe(false);
  });

  it('never sends an org issue type, a project or a Projects v2 command', async () => {
    const { tracker, fake } = overFake();

    await tracker.preflight();
    const ref = await tracker.create(draftFixture({ project: 'Auth Hardening' }));
    await tracker.transition(ref, 'released');
    await tracker.get(ref);

    const sent = fake.calls().flat();
    expect(fake.calls().length).toBeGreaterThan(5);
    expect(sent).not.toContain('--type');
    expect(sent).not.toContain('--project');
    expect(sent).not.toContain('project');
    expect(sent).not.toContain('graphql');
    expect(sent).not.toContain('Auth Hardening');
  });

  it.each([
    ['type', { type: 'feature' }, 'type is "feature", expected one of: code, bug, spike, adr, chore, package-api'],
    ['priority', { priority: 'critical' }, 'priority is "critical", expected null or one of: urgent, high, medium, low'],
    ['module', { module: 'auth,billing' }, 'module is "auth,billing", expected a string holding no comma'],
    ['blockedBy', { blockedBy: [1.5] }, 'blockedBy is a list, expected a list of positive whole numbers'],
    ['title', { title: 42 }, 'title is 42, expected a string'],
    ['opt', { opt: '260' }, 'opt is "260", expected a number'],
  ])('refuses a draft whose %s no get could answer, sending nothing', async (_field, overrides, problem) => {
    const { tracker, fake } = overFake();
    const draft = { ...draftFixture(), ...overrides } as unknown as ReturnType<typeof draftFixture>;

    const attempt = tracker.create(draft);

    await expect(attempt).rejects.toThrow(TypeError);
    await expect(tracker.create(draft)).rejects.toThrow(`github tracker: refused to file an invalid draft: ${problem}`);
    expect(fake.calls()).toEqual([]);
  });

  it('reads the issue URL off the last line gh printed, and rejects when it printed none', async () => {
    const answering = (created: string): GhRunner => scripted((args) => (args[1] === 'create' && args[0] === 'issue'
      ? wrote(created)
      : wrote(''))).run;

    const lastLine = await createGithubTracker({ gh: answering(`Creating issue\n${ISSUE_1_URL}\n`) })
      .create(draftFixture());

    expect(lastLine.externalId).toBe('1');
    await expect(createGithubTracker({ gh: answering('Created\n') }).create(draftFixture())).rejects.toThrow(
      'github tracker: gh issue create exited 0 and printed no issue URL, so the issue may exist unrecorded;'
        + ' it wrote "Created\\n"',
    );
  });
});

describe('preflight', () => {
  it('answers ok when gh is logged in and resolves a repository, probing nothing else', async () => {
    const { tracker, fake } = overFake();

    expect(await tracker.preflight()).toEqual({ ok: true });
    expect(fake.calls()).toEqual([['auth', 'status'], ['repo', 'view', '--json', 'nameWithOwner']]);
  });

  it('answers what gh wrote when it is not logged in, asking nothing more', async () => {
    const { tracker, fake } = overFake({ authOk: false });

    expect(await tracker.preflight()).toEqual({ ok: false, reason: `gh auth status: ${NOT_LOGGED_IN}` });
    expect(fake.calls()).toEqual([['auth', 'status']]);
  });

  it('answers not ok for a checkout gh resolves no repository for', async () => {
    const { tracker } = overFake({ repo: null });

    expect(await tracker.preflight()).toEqual({ ok: false, reason: 'gh repo view: no git remotes found' });
  });

  it('answers a reason for a runner that rejects and for a failure that wrote nothing', async () => {
    const rejecting = createGithubTracker({
      gh: async () => {
        throw new Error('spawn failed');
      },
    });
    const silent = createGithubTracker({ gh: scripted(() => ({ ok: false, stdout: '', stderr: ' \n' })).run });

    expect(await rejecting.preflight()).toEqual({ ok: false, reason: 'gh could not be run: spawn failed' });
    expect(await silent.preflight()).toEqual({
      ok: false,
      reason: 'gh auth status: it exited non-zero and wrote nothing',
    });
  });

  it('reports no project, custom field or issue type support', () => {
    expect(overFake().tracker.capabilities()).toEqual({ projects: false, customFields: false, issueTypes: false });
  });
});

describe('reading an issue', () => {
  it('reads every field back, taking the url gh wrote and the opt of the ref', async () => {
    const { tracker } = overFake();
    const created = await tracker.create(draftFixture({ opt: 260, blockedBy: [12] }));

    const issue = await tracker.get({ ...created, opt: 7, url: null });

    expect(issue).toStrictEqual({
      ...draftFixture({ opt: 7, blockedBy: [12] }),
      project: null,
      ref: { ...created, opt: 7, url: ISSUE_1_URL },
      state: 'todo',
    });
  });

  it('answers code, null and unassigned for a foreign type, a foreign priority and no module label', async () => {
    const { tracker, fake } = overFake();
    const ref = await tracker.create(draftFixture());
    fake.update(ref.externalId, (issue) => ({ ...issue, labels: ['type:wontfix', 'priority:critical', 'bug'] }));

    expect(await tracker.get(ref)).toMatchObject({ type: 'code', priority: null, module: 'unassigned' });
  });

  it.each([
    ['OPEN', '', 'todo'],
    ['OPEN', 'NOT_PLANNED', 'todo'],
    ['CLOSED', 'NOT_PLANNED', 'cancelled'],
    ['CLOSED', 'COMPLETED', 'done'],
  ] as const)('reads an issue in state %s with close reason %p as %s', async (state, stateReason, expected) => {
    const { tracker, fake } = overFake();
    const ref = await tracker.create(draftFixture());
    fake.update(ref.externalId, (issue) => ({ ...issue, state, stateReason }));

    expect((await tracker.get(ref)).state).toBe(expected);
  });

  it('reads done after cancelled, the close replacing the reason on a closed issue', async () => {
    const { tracker, fake } = overFake();
    const ref = await tracker.create(draftFixture());

    await tracker.transition(ref, 'cancelled');
    expect(fake.issue('1')?.stateReason).toBe('NOT_PLANNED');
    await tracker.transition(ref, 'done');

    expect(fake.issue('1')?.stateReason).toBe('COMPLETED');
    expect((await tracker.get(ref)).state).toBe('done');
  });

  it('refuses the pull request gh issue view answers for its number, beside an issue it reads', async () => {
    const answering = (payload: object): Tracker => createGithubTracker({
      gh: scripted(() => wrote(JSON.stringify(payload))).run,
    });
    const asIssue = { ...RECORDED_PULL_REQUEST, state: 'OPEN', url: 'https://github.com/cli/cli/issues/1' };

    await expect(answering(RECORDED_PULL_REQUEST).get(githubRef('1'))).rejects.toThrow(
      'github tracker: gh issue view 1 answered url "https://github.com/cli/cli/pull/1",'
        + ' expected an issue URL ending /issues/1, where a pull request URL ends /pull/1',
    );
    expect((await answering(asIssue).get(githubRef('1'))).title).toBe('interactive pr list');
  });

  it.each([
    ['output that is not JSON', 'Not Found', 'wrote output that is not JSON: '],
    ['a list', '[]', 'answered a list, expected a mapping'],
    [
      'a merged state on an issue url',
      JSON.stringify({ ...RECORDED_PULL_REQUEST, url: 'https://github.com/cli/cli/issues/1' }),
      'answered state "MERGED", expected "OPEN" or "CLOSED"',
    ],
    [
      'labels that are names alone',
      JSON.stringify({ ...RECORDED_PULL_REQUEST, state: 'OPEN', labels: ['bug'], url: 'https://github.com/cli/cli/issues/1' }),
      'answered labels that are not a list of named labels',
    ],
    [
      'a title that is not a string',
      JSON.stringify({ ...RECORDED_PULL_REQUEST, state: 'OPEN', title: null, url: 'https://github.com/cli/cli/issues/1' }),
      'answered title null, expected a string',
    ],
  ])('refuses %s from gh issue view', async (_label, stdout, problem) => {
    const tracker = createGithubTracker({ gh: scripted(() => wrote(stdout)).run });

    await expect(tracker.get(githubRef('1'))).rejects.toThrow(`github tracker: gh issue view 1 ${problem}`);
  });

  it('rejects with what gh wrote for an issue that does not exist', async () => {
    const { tracker, fake } = overFake();

    await expect(tracker.get(githubRef('999'))).rejects.toThrow(
      'github tracker: gh issue view 999 failed: GraphQL: Could not resolve to an issue or pull request'
        + ' with the number of 999. (repository.issue)',
    );
    expect(fake.calls()).toEqual([['issue', 'view', '999', '--json', VIEW_FIELDS]]);
  });

  it('reads a ref carrying a repository in that repository, refused by a fake holding another', async () => {
    const { tracker, fake } = overFake({ repo: 'open-tomato/grow-box' });
    const created = await tracker.create(draftFixture());

    const issue = await tracker.get({ ...created, repo: 'open-tomato/grow-box' });

    expect(issue.ref.url).toBe('https://github.com/open-tomato/grow-box/issues/1');
    expect(fake.calls().at(-1)).toEqual(['issue', 'view', '1', '--repo', 'open-tomato/grow-box', '--json', VIEW_FIELDS]);
    await expect(tracker.get({ ...created, repo: 'open-tomato/other' })).rejects.toThrow(
      'github tracker: gh issue view 1 failed: fake gh: models one repository, open-tomato/grow-box,'
        + ' and was handed --repo open-tomato/other',
    );
  });
});

describe('refusing a ref', () => {
  it('refuses a ref of another kind in every call taking one, beside the same number read as github', async () => {
    const { tracker, fake } = overFake();
    await tracker.create(draftFixture());
    const sentBefore = fake.calls().length;
    const local = githubRef('1', { kind: 'local' });
    const refusal = 'github tracker: refused a ref of kind "local"; this tracker reads github refs only';

    await expect(tracker.get(local)).rejects.toThrow(refusal);
    await expect(tracker.comment(local, 'hello')).rejects.toThrow(refusal);
    await expect(tracker.transition(local, 'done')).rejects.toThrow(refusal);
    expect(fake.calls()).toHaveLength(sentBefore);
    expect((await tracker.get(githubRef('1'))).title).toBe(draftFixture().title);
  });

  it.each([
    ['--web', '"--web"'],
    ['01', '"01"'],
    ['0', '"0"'],
    ['1.5', '"1.5"'],
    ['', '""'],
    [' 1', '" 1"'],
    ['1 --repo x', '"1 --repo x"'],
    ['9007199254740993', '"9007199254740993"'],
    [42, '42'],
  ])('refuses the external id %p before sending anything', async (externalId, quoted) => {
    const { tracker, fake } = overFake();
    const ref = githubRef(externalId as string);

    await expect(tracker.get(ref)).rejects.toThrow(`github tracker: externalId ${quoted} ${NUMBER_REFUSAL}`);
    await expect(tracker.comment(ref, 'hello')).rejects.toThrow(NUMBER_REFUSAL);
    await expect(tracker.transition(ref, 'done')).rejects.toThrow(NUMBER_REFUSAL);
    expect(fake.calls()).toEqual([]);
  });

  it.each(['../..', 'a/b/c', 'owner', 'owner/..', './name', 'own er/name', ''])(
    'refuses the repository %p before sending anything',
    async (repo) => {
      const { tracker, fake } = overFake();
      const ref = githubRef('1', { repo });

      await expect(tracker.transition(ref, 'done')).rejects.toThrow(
        `github tracker: repo ${JSON.stringify(repo)} is not a repository, expected owner/name`,
      );
      await expect(tracker.get(ref)).rejects.toThrow('is not a repository, expected owner/name');
      expect(fake.calls()).toEqual([]);
    },
  );
});

describe('finding issues', () => {
  it('lists every state, narrowed by module label and search text, 30 issues by default', async () => {
    const { tracker, fake } = overFake();
    const replay = await tracker.create(draftFixture({ title: 'Fix TOTP replay window' }));
    await tracker.create(draftFixture({ title: 'Fix session cookie flags' }));

    const found = await tracker.find({ module: 'auth', text: 'replay' });

    expect(found.map((ref) => ref.externalId)).toEqual([replay.externalId]);
    expect(fake.calls().at(-1)).toEqual([
      'issue', 'list', '--state', 'all', '--json', 'number,url,labels', '--limit', '30',
      '--label', 'module:auth', '--search', 'replay',
    ]);
  });

  it('narrows by type label and passes the query limit', async () => {
    const { tracker, fake } = overFake();
    await tracker.create(draftFixture({ type: 'spike' }));
    await tracker.create(draftFixture({ type: 'bug' }));

    const found = await tracker.find({ type: 'spike', limit: 5 });

    expect(found.map((ref) => ref.externalId)).toEqual(['1']);
    expect(fake.calls().at(-1)).toEqual([
      'issue', 'list', '--state', 'all', '--json', 'number,url,labels', '--limit', '5', '--label', 'type:spike',
    ]);
  });

  it('answers refs in the order gh lists them, with opt 0, the url and the module label', async () => {
    const { tracker, fake } = overFake();
    await tracker.create(draftFixture({ opt: 260 }));
    await tracker.create(draftFixture({ opt: 261, module: 'billing' }));
    const closed = await tracker.create(draftFixture({ opt: 262 }));
    await tracker.transition(closed, 'done');
    fake.update('1', (issue) => ({ ...issue, labels: ['bug'] }));

    const found = await tracker.find({});

    expect(found).toStrictEqual([
      { opt: 0, kind: 'github', externalId: '3', url: 'https://github.com/open-tomato/rafa/issues/3', module: 'auth' },
      { opt: 0, kind: 'github', externalId: '2', url: 'https://github.com/open-tomato/rafa/issues/2', module: 'billing' },
      { opt: 0, kind: 'github', externalId: '1', url: ISSUE_1_URL },
    ]);
  });

  it.each([
    ['todo', 'open', 'backlog, in-progress, in-review'],
    ['backlog', 'open', 'todo, in-progress, in-review'],
    ['done', 'closed', 'released, cancelled'],
    ['released', 'closed', 'done, cancelled'],
    ['cancelled', 'closed', 'done, released'],
  ] as const)('refuses to narrow by %s, naming the states it shares %s with, sending nothing', async (state, bucket, siblings) => {
    const { tracker, fake } = overFake();

    await expect(tracker.find({ state })).rejects.toThrow(
      `github tracker: find cannot narrow by state "${state}": GitHub holds an issue open or closed,`
        + ` and ${state} shares ${bucket} with ${siblings}, so a result would include those too.`
        + ' Search without a state, then read each issue with get.',
    );
    expect(fake.calls()).toEqual([]);
  });

  it('refuses a module holding a comma, sending nothing, beside one without', async () => {
    const { tracker, fake } = overFake();

    await expect(tracker.find({ module: 'auth,billing' })).rejects.toThrow(
      'github tracker: find refused module "auth,billing", expected a string holding no comma',
    );
    expect(fake.calls()).toEqual([]);
    expect(await tracker.find({ module: 'auth' })).toEqual([]);
    expect(fake.calls()).toHaveLength(1);
  });

  it.each([
    ['a mapping', '{}', 'answered a mapping, expected a list'],
    ['a row numbered by a string', '[{"number":"1","url":"u","labels":[]}]', 'answered row 0 with number "1", expected an issue number'],
    ['a row with no labels', '[{"number":1,"url":"u"}]', 'answered row 0 with labels that are not a list of named labels'],
    ['a row with no url', '[{"number":1,"labels":[]}]', 'answered row 0 with url undefined, expected a string'],
    ['output that is not JSON', 'HTTP 502', 'wrote output that is not JSON: '],
  ])('refuses %s from gh issue list', async (_label, stdout, problem) => {
    const tracker = createGithubTracker({ gh: scripted(() => wrote(stdout)).run });

    await expect(tracker.find({})).rejects.toThrow(`github tracker: gh issue list ${problem}`);
  });

  it('rejects with what gh wrote when the listing fails', async () => {
    const { tracker } = overFake({ repo: null });

    await expect(tracker.find({})).rejects.toThrow('github tracker: gh issue list failed: no git remotes found');
  });
});

describe('commenting', () => {
  it('posts the body as written, one opening with a dash included', async () => {
    const { tracker, fake } = overFake();
    const ref = await tracker.create(draftFixture());

    await tracker.comment(ref, '--help is not a flag here');

    expect(fake.issue('1')?.comments).toEqual(['--help is not a flag here']);
    expect(fake.calls().at(-1)).toEqual(['issue', 'comment', '1', '--body', '--help is not a flag here']);
  });

  it('rejects with what gh wrote for an issue that does not exist', async () => {
    const { tracker } = overFake();

    await expect(tracker.comment(githubRef('999'), 'hello')).rejects.toThrow(
      'github tracker: gh issue comment 999 failed: GraphQL: Could not resolve to an issue or pull request',
    );
  });

  it('refuses a body that is not a string, sending nothing', async () => {
    const { tracker, fake } = overFake();

    await expect(tracker.comment(githubRef('1'), 42 as unknown as string)).rejects.toThrow(
      'github tracker: refused a comment body 42, expected a string',
    );
    expect(fake.calls()).toEqual([]);
  });
});

describe('moving an issue', () => {
  it.each(READ_BACK)('moves an issue to %s, reading it back as %s, with the warning that difference answers', async (state, readBack, warning) => {
    const { tracker } = overFake();
    const ref = await tracker.create(draftFixture());

    const result = await tracker.transition(ref, state);

    expect((await tracker.get(ref)).state).toBe(readBack);
    expect(result).toStrictEqual(warning === null
      ? {}
      : { warning });
  });

  it('narrows the contract to exactly the states that answer no warning', () => {
    expect(READ_BACK.filter(([, , warning]) => warning === null).map(([state]) => state)).toEqual([...TRANSITIONABLE]);
  });

  it.each([
    ['done', 'completed'],
    ['released', 'completed'],
    ['cancelled', 'not_planned'],
  ] as const)('closes for %s through gh api PATCH with state_reason %s, and sends no reopen', async (state, reason) => {
    const { tracker, fake } = overFake();
    const ref = await tracker.create(draftFixture());
    const sentBefore = fake.calls().length;

    await tracker.transition(ref, state);

    expect(fake.calls().slice(sentBefore)).toEqual([
      ['api', 'repos/{owner}/{repo}/issues/1', '-X', 'PATCH', '-f', 'state=closed', '-f', `state_reason=${reason}`],
    ]);
  });

  it.each(['backlog', 'todo', 'in-progress', 'in-review'] as const)(
    'reopens for %s through gh issue reopen, and sends no close',
    async (state) => {
      const { tracker, fake } = overFake();
      const ref = await tracker.create(draftFixture());
      await tracker.transition(ref, 'cancelled');
      const sentBefore = fake.calls().length;

      await tracker.transition(ref, state);

      expect(fake.calls().slice(sentBefore)).toEqual([['issue', 'reopen', '1']]);
      expect(fake.issue('1')).toMatchObject({ state: 'OPEN', stateReason: '' });
    },
  );

  it('moves a ref carrying a repository in that repository', async () => {
    const { tracker, fake } = overFake({ repo: 'open-tomato/grow-box' });
    const ref = { ...(await tracker.create(draftFixture())), repo: 'open-tomato/grow-box' };

    await tracker.transition(ref, 'done');
    await tracker.transition(ref, 'todo');

    expect(fake.calls().slice(-2)).toEqual([
      ['api', 'repos/open-tomato/grow-box/issues/1', '-X', 'PATCH', '-f', 'state=closed', '-f', 'state_reason=completed'],
      ['issue', 'reopen', '1', '--repo', 'open-tomato/grow-box'],
    ]);
  });

  it('rejects with what gh wrote when the close fails', async () => {
    const tracker = createGithubTracker({
      gh: scripted(() => ({
        ok: false,
        stdout: '',
        stderr: 'unable to expand placeholder in path: no git remotes found\n',
      })).run,
    });

    await expect(tracker.transition(githubRef('1'), 'done')).rejects.toThrow(
      'github tracker: gh api PATCH repos/{owner}/{repo}/issues/1 failed:'
        + ' unable to expand placeholder in path: no git remotes found',
    );
  });

  it('refuses a state the port does not name, sending nothing, beside one it does', async () => {
    const { tracker, fake } = overFake();
    const ref = await tracker.create(draftFixture());
    const sentBefore = fake.calls().length;

    await expect(tracker.transition(ref, 'archived' as IssueState)).rejects.toThrow(
      'github tracker: refused state "archived",'
        + ' expected one of: backlog, todo, in-progress, in-review, done, released, cancelled',
    );
    expect(fake.calls()).toHaveLength(sentBefore);
    expect(await tracker.transition(ref, 'done')).toEqual({});
  });
});

describe('the github tracker', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(overFake().tracker)).toBe(true);
  });
});

describe('the gh runner', () => {
  let tempDir = '';
  let standIn = '';

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-gh-runner-')));
    standIn = join(tempDir, 'gh');
    writeFileSync(standIn, [
      '#!/bin/sh',
      'printf "cwd=%s\\n" "$(pwd -P)"',
      'for arg in "$@"; do printf "arg=%s\\n" "$arg"; done',
      'if read -r line; then printf "stdin=%s\\n" "$line"; else printf "stdin closed\\n"; fi',
      'printf "to stderr\\n" >&2',
      'if [ "$1" = fail ]; then exit 3; fi',
      '',
    ].join('\n'));
    chmodSync(standIn, 0o755);
  });

  afterAll(() => {
    if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
  });

  it('hands the arguments over verbatim, in the directory it was made with, with stdin closed', async () => {
    const run = createGhRunner({ cwd: tempDir, command: standIn });

    const result = await run(['issue', 'create', '--title', '--help', '--body', 'two words']);

    expect(tempDir.startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(result).toEqual({
      ok: true,
      stdout: [
        `cwd=${tempDir}`,
        'arg=issue',
        'arg=create',
        'arg=--title',
        'arg=--help',
        'arg=--body',
        'arg=two words',
        'stdin closed',
        '',
      ].join('\n'),
      stderr: 'to stderr\n',
    });
  });

  it('answers ok false with what the command wrote when it exits non-zero', async () => {
    const result = await createGhRunner({ cwd: tempDir, command: standIn })(['fail']);

    expect(result).toEqual({ ok: false, stdout: `cwd=${tempDir}\narg=fail\nstdin closed\n`, stderr: 'to stderr\n' });
  });

  it('answers ok false naming the command and the directory when nothing can be spawned', async () => {
    const missingCommand = join(tempDir, 'no-such-gh');
    const missingDir = join(tempDir, 'no-such-dir');

    const noCommand = await createGhRunner({ cwd: tempDir, command: missingCommand })(['auth', 'status']);
    const noDir = await createGhRunner({ cwd: missingDir, command: standIn })(['auth', 'status']);

    expect(noCommand.ok).toBe(false);
    expect(noCommand.stderr).toStartWith(`could not run ${missingCommand} in ${tempDir}: `);
    expect(noCommand.stderr).toContain('ENOENT');
    expect(noDir.ok).toBe(false);
    expect(noDir.stderr).toStartWith(`could not run ${standIn} in ${missingDir}: `);
  });
});

describe('the gh runner with an env', () => {
  /** A name no `PATH` of this machine holds, so only a planted directory finds it. */
  const STAND_IN_NAME = 'rafa-gh-env-stand-in';
  let tempDir = '';
  let binDir = '';
  let emptyDir = '';

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-gh-env-')));
    binDir = join(tempDir, 'bin');
    emptyDir = join(tempDir, 'empty');
    mkdirSync(binDir);
    mkdirSync(emptyDir);
    const standIn = join(binDir, STAND_IN_NAME);
    writeFileSync(standIn, [
      '#!/bin/sh',
      'printf "probe=%s\\n" "$RAFA_GH_PROBE"',
      'printf "home=%s\\n" "$HOME"',
      'printf "path=%s\\n" "$PATH"',
      'for arg in "$@"; do printf "arg=%s\\n" "$arg"; done',
      '',
    ].join('\n'));
    chmodSync(standIn, 0o755);
  });

  afterAll(() => {
    if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves a bare command on the env PATH and spawns it with that env alone', async () => {
    const env = { PATH: binDir, RAFA_GH_PROBE: 'session' };

    const result = await createGhRunner({ cwd: tempDir, command: STAND_IN_NAME, env })(['auth', 'status']);

    // Control: the process has a HOME, so an empty one below was not inherited.
    expect(process.env.HOME ?? '').not.toBe('');
    expect(result).toEqual({
      ok: true,
      stdout: `probe=session\nhome=\npath=${binDir}\narg=auth\narg=status\n`,
      stderr: '',
    });
  });

  it('finds nothing the env PATH lacks, where the process PATH holds the command', async () => {
    // Control: `sh` runs through the same runner under the process's own PATH.
    const inherited = await createGhRunner({ cwd: tempDir, command: 'sh' })(['-c', 'printf ran']);

    const narrowed = await createGhRunner({ cwd: tempDir, command: 'sh', env: { PATH: emptyDir } })(['-c', 'printf ran']);

    expect(inherited).toEqual({ ok: true, stdout: 'ran', stderr: '' });
    expect(narrowed).toEqual({
      ok: false,
      stdout: '',
      stderr: `could not run sh in ${tempDir}: not found on PATH ${JSON.stringify(emptyDir)} (ENOENT)`,
    });
  });

  it('finds a bare command nowhere under an env with no PATH', async () => {
    const result = await createGhRunner({ cwd: tempDir, command: 'sh', env: { HOME: tempDir } })(['-c', 'printf ran']);

    expect(result).toEqual({
      ok: false,
      stdout: '',
      stderr: `could not run sh in ${tempDir}: not found on an environment with no PATH (ENOENT)`,
    });
  });

  it('spawns an absolute command under the env whatever its PATH holds', async () => {
    const command = join(binDir, STAND_IN_NAME);

    const result = await createGhRunner({ cwd: tempDir, command, env: { PATH: emptyDir } })([]);

    expect(result).toEqual({ ok: true, stdout: `probe=\nhome=\npath=${emptyDir}\n`, stderr: '' });
  });

  it('inherits the process env when no env is given, and so misses a command only a planted PATH holds', async () => {
    const inherited = await createGhRunner({ cwd: tempDir, command: join(binDir, STAND_IN_NAME) })([]);
    const bare = await createGhRunner({ cwd: tempDir, command: STAND_IN_NAME })([]);

    expect(inherited.ok).toBe(true);
    expect(inherited.stdout).toContain(`home=${process.env.HOME ?? ''}\n`);
    expect(inherited.stdout).toContain(`path=${process.env.PATH ?? ''}\n`);
    // Bun's own lookup answers a bare name with no `ENOENT` in its message.
    expect(bare.ok).toBe(false);
    expect(bare.stderr).toStartWith(`could not run ${STAND_IN_NAME} in ${tempDir}: `);
  });
});

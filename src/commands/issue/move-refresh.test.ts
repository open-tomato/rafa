/**
 * Tests for `rafa issue move`'s project refresh (`move-project.ts`, wired
 * in `move.ts`): a GitHub issue moved to a state refreshes exactly that
 * issue on the project, a token without the `project` scope prints the
 * scope line after the moved line and still exits 0, and a local issue
 * sends no call even with `board.project.number` set.
 *
 * The move runs through the dispatcher in a project of its own. A router
 * sends the repository read, the project and facts reads (both `gh api
 * graphql`) to their fakes, and every other command to the GitHub fake
 * that holds the issues the move acts on. The scope case refuses each
 * GraphQL call with GitHub's refusal, the one `add-issue.test.ts` plants.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { IssueDraft } from '../../ports/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { createFakeFactsGh } from '../../board/project/facts-fake.js';
import { createGhProjectPort } from '../../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, type FakeProjectGh } from '../../board/project/project-fake.js';
import { scopeWarning } from '../../board/project/refresh-warnings.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createIssueMoveCommand } from './move.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-move-refresh-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The owner of the repository and the project. */
const OWNER = 'open-tomato';

/** The project's number, as the config names it. */
const PROJECT_NUMBER = 6;

/** The config of a github tracker whose project is set. */
const GITHUB_WITH_PROJECT = `tracker:\n  default: github\n  fallback: [local]\nboard:\n  project:\n    number: ${String(PROJECT_NUMBER)}\n`;

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** GitHub's documented refusal for a token with no project scope, as `add-issue.test.ts` plants it. */
const SCOPE_STDERR = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.\n';

/** The issue each case files first, and the second one a case holds beside it. */
const DRAFT: IssueDraft = {
  opt: 0,
  title: 'Timeouts in plan show',
  body: 'Seen twice.',
  type: 'bug',
  module: 'cli',
  priority: null,
  project: null,
  blockedBy: [],
};

/** What one routed case holds: the project, the GitHub fake and what each saw. */
interface Rig {
  readonly project: PlantedProject;
  readonly github: ReturnType<typeof createFakeGh>;
  readonly projectGh: FakeProjectGh;
  /** Every argv the router was handed, in order. */
  readonly calls: () => readonly (readonly string[])[];
  /** The router itself, handed to the command as its `gh` seam. */
  readonly gh: GhRunner;
}

/** A successful `gh` answer holding `value` as its JSON. */
function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/**
 * A github project holding issue 1 (closed as the move closes it) and
 * issue 2 (open, with a Stage planted that its own facts would not give).
 * `scope` says whether the token holds the `project` scope.
 */
async function plantRig(scope: boolean): Promise<Rig> {
  const github = createFakeGh();
  const tracker = createGithubTracker({ gh: github.run });
  await tracker.create(DRAFT);
  await tracker.create({ ...DRAFT, title: 'Second issue' });
  // The roadmap the refresh reads its order off: issue 3, labelled type:roadmap, ranking issues 1 and 2.
  await github.run(['label', 'create', 'type:roadmap', '--force']);
  await github.run(['issue', 'create', '--title', 'Roadmap', '--body', '- [ ] #1 first\n- [ ] #2 second\n', '--label', 'type:roadmap']);
  const projectGh = createFakeProjectGh({
    owners: [OWNER],
    projects: [{
      owner: OWNER,
      number: PROJECT_NUMBER,
      items: [{ number: 1 }, { number: 2, values: { Stage: 'Ready' } }],
    }],
  });
  const facts = createFakeFactsGh({
    // Issue 1 as the move leaves it: closed as completed, which the refresh reads after the write.
    issues: [{ number: 1, state: 'CLOSED', stateReason: 'COMPLETED' }, { number: 2, state: 'OPEN' }],
    pulls: [],
    trees: {},
  });
  const recorded: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    recorded.push([...args]);
    if (args[0] === 'repo' && args[1] === 'view') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (args[0] === 'api' && args[1] === 'graphql') {
      if (!scope) return Promise.resolve({ ok: false, stdout: '', stderr: SCOPE_STDERR });
      return args.includes('owner={owner}')
        ? facts.gh(args)
        : projectGh.gh(args);
    }
    return github.run(args);
  };
  return {
    project: plantProject(mkdtempSync(join(tempBase, 'case-')), GITHUB_WITH_PROJECT),
    github,
    projectGh,
    calls: () => [...recorded],
    gh,
  };
}

/** The Stage each item of the project holds now, by issue number; null where it holds none. */
async function heldStages(projectGh: FakeProjectGh): Promise<Readonly<Record<number, string | null>>> {
  const port = createGhProjectPort(projectGh.gh);
  const found = await port.find({ owner: OWNER, number: PROJECT_NUMBER });
  if (found === null) throw new Error('the fake project was not found');
  const items = await port.items(found.id);
  return Object.fromEntries(items.flatMap((item) => {
    if (item.content.kind !== 'issue') return [];
    const stage = item.values.get('Stage');
    return [[item.content.number, stage?.kind === 'option'
      ? stage.name
      : null] as const];
  }));
}

describe('rafa issue move refreshes the issue it moved', () => {
  it('writes the Stage of the moved issue alone, leaving the other issue on the project as it was', async () => {
    const rig = await plantRig(true);

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done'], SUBJECTS, [createIssueMoveCommand({ gh: rig.gh })], rig.project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Moved github issue 1 to done.\n', stderr: '' });
    expect(await heldStages(rig.projectGh)).toEqual({ 1: 'Done', 2: 'Ready' });
  });

  it('prints the scope line after the moved line when the token has no project scope, and exits 0', async () => {
    const rig = await plantRig(false);

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done'], SUBJECTS, [createIssueMoveCommand({ gh: rig.gh })], rig.project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `Moved github issue 1 to done.\nwarn: ${scopeWarning()}\n`,
      stderr: '',
    });
    expect(rig.github.issue('1')).toMatchObject({ state: 'CLOSED', stateReason: 'COMPLETED' });
  });

  it('answers the scope line before the result in json mode, with the move still in its data', async () => {
    const rig = await plantRig(false);

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done', '--output=json'], SUBJECTS, [createIssueMoveCommand({ gh: rig.gh })], rig.project);
    const events = eventsOf(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(events[1]).toMatchObject({ level: 'warn', message: scopeWarning() });
    expect(events[2]).toMatchObject({ ok: true, data: { state: 'done', warning: null } });
  });

  it('control: with the project scope removed and no board.project.number, prints no scope line and sends no GraphQL call', async () => {
    const rig = await plantRig(false);
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: github\n  fallback: [local]\n');

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done'], SUBJECTS, [createIssueMoveCommand({ gh: rig.gh })], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Moved github issue 1 to done.\n', stderr: '' });
    expect(rig.calls().filter((args) => args[0] === 'api' && args[1] === 'graphql')).toEqual([]);
  });

  it('sends no call for a local issue, though board.project.number is set', async () => {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n  default: local\nboard:\n  project:\n    number: ${String(PROJECT_NUMBER)}\n`);
    await createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null }).create(DRAFT);
    const rig = await plantRig(true);

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done'], SUBJECTS, [createIssueMoveCommand({ gh: rig.gh })], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Moved local issue 1 to done.\n', stderr: '' });
    expect(rig.calls()).toEqual([]);
  });
});

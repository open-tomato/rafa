/**
 * Tests for the add of a new issue to the project (`add-issue.ts`,
 * `addAndRefreshIssue`), sent through one `GhRunner` that answers the
 * repository read itself and routes every `gh api` call to the strict
 * project fake (`project-fake.ts`). The refresh is planted: what it does
 * is `refresh.test.ts`'s subject, and here only whether it is asked, for
 * which issue, with which known item, and with the issue already on the
 * project when it is; then which lines its answer becomes.
 *
 * ## The controls
 *
 *  - The case with no `board.project.number` sits beside the same add
 *    with the number set, which opens the runner and sends calls, so
 *    sending nothing is the key's doing and not a runner never wired.
 *  - The scope refusal is read beside a refused find whose words name no
 *    scope, which answers the failed line instead, so the scope line is
 *    read off the refusal's words.
 *  - The `added but not filled` line is read beside the same refresh
 *    answering an empty `notFilled`, which answers its own lines alone,
 *    so the line is the `notFilled` entry's doing.
 */
import type { ProjectItem } from './port.js';
import type {
  AddedNotFilled,
  KnownItem,
  ProjectRefresh,
  ProjectRefreshed,
  RefreshConfig,
  RefreshOptions,
} from './refresh.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { addAndRefreshIssue } from './add-issue.js';
import { createGhProjectPort } from './gh.js';
import { refreshFailedWarning } from './issue-board-refresh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, fakeProjectId } from './project-fake.js';
import { addedNotFilledWarning, notFoundWarning, notRefreshedWarning, scopeWarning } from './refresh-warnings.js';
import { knownItem } from './refresh.js';

/** The owner of the repository and the project. */
const OWNER = 'open-tomato';

/** The project's number. */
const NUMBER = 6;

/** The issue `rafa issue create` has just filed. */
const NEW_ISSUE = 41;

/** The config every case reads but the one that unsets the number. */
const CONFIG: RefreshConfig = {
  boardProjectNumber: NUMBER,
  boardProjectRetries: false,
  boardProjectRetryWaitSeconds: 1,
  boardProjectWriteBatchSize: 5,
  boardProjectWritePauseMs: 0,
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** GitHub's documented refusal for a token with no project scope, as `refresh.test.ts` plants it; NOT a reading. */
const SCOPE_STDERR = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.\n';

/** The project's node id, as the fake makes it. */
const PROJECT_ID = fakeProjectId({ owner: OWNER, number: NUMBER });

function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** What one {@link addAndRefreshIssue} call sent, asked and answered. */
interface Run {
  readonly lines: readonly string[];
  readonly opened: number;
  readonly calls: readonly (readonly string[])[];
  /** Each issue list the refresh was asked for. */
  readonly refreshed: readonly (readonly number[])[];
  /** The known items each refresh was handed. */
  readonly known: readonly (readonly KnownItem[])[];
  /** The id of the item the project holds for {@link NEW_ISSUE} once the call has resolved, read through the port; null with none. */
  readonly itemId: string | null;
  /** The issues the project held as items when the refresh was asked, read through the port. */
  readonly heldAtRefresh: readonly number[];
  /** The issues the project holds as items once the call has resolved. */
  readonly heldAfter: readonly number[];
}

/** How a case sets the scene. */
interface Scene {
  readonly config?: RefreshConfig;
  /** The project's items already there, by issue number. */
  readonly items?: readonly number[];
  /** False for an owner holding no project of {@link NUMBER}. */
  readonly project?: boolean;
  /** Fails the first `gh api` call with this stderr. */
  readonly failFirst?: string;
  /** Fails the repository read. */
  readonly repoViewFails?: boolean;
  /** What the planted refresh answers. */
  readonly answer?: (options: RefreshOptions) => Promise<ProjectRefresh>;
}

/** The issue numbers among `items`. */
function issuesOf(items: readonly ProjectItem[]): readonly number[] {
  return items.flatMap((item) => (item.content.kind === 'issue'
    ? [item.content.number]
    : []));
}

/** The issue numbers among the items of the project, read through the port over `gh`. */
async function heldIssues(gh: GhRunner): Promise<readonly number[]> {
  return issuesOf(await createGhProjectPort(gh).items(PROJECT_ID));
}

/** A refresh that read the project and wrote nothing, answering `warnings` and `notFilled`. */
function refreshedWith(warnings: readonly string[], notFilled: readonly AddedNotFilled[]): ProjectRefreshed {
  return {
    kind: 'refreshed',
    project: { owner: OWNER, number: NUMBER },
    changes: [],
    writes: { written: 0, notUpdated: 0, rateLimited: false, detail: '' },
    missing: [],
    skipped: [],
    refused: [],
    notFilled,
    warnings,
  };
}

/** Adds {@link NEW_ISSUE} over the scene. */
async function addRun(scene: Scene = {}): Promise<Run> {
  const project = createFakeProjectGh({
    projects: scene.project === false
      ? []
      : [{ owner: OWNER, number: NUMBER, items: (scene.items ?? []).map((number) => ({ number })) }],
    owners: [OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [10, NEW_ISSUE] }],
  });
  if (scene.failFirst !== undefined) project.failNext(scene.failFirst);
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    if (args.join(' ') === 'repo view --json nameWithOwner') {
      return Promise.resolve(scene.repoViewFails === true
        ? { ok: false, stdout: '', stderr: 'gh: could not read the repository\n' }
        : answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    }
    return project.gh(args);
  };
  const refreshed: (readonly number[])[] = [];
  const known: (readonly KnownItem[])[] = [];
  let heldAtRefresh: readonly number[] = [];
  let opened = 0;
  const lines = await addAndRefreshIssue({
    config: scene.config ?? CONFIG,
    openGh: () => {
      opened += 1;
      return gh;
    },
    refresh: async (options, issues, _widening, items) => {
      refreshed.push(issues);
      known.push(items);
      heldAtRefresh = await heldIssues(options.gh);
      return (scene.answer ?? (() => Promise.resolve<ProjectRefresh>({ kind: 'skipped', reason: 'no-issues', warnings: [] })))(options);
    },
  }, NEW_ISSUE);
  const sent = [...calls];
  const itemsAfter = scene.project === false
    ? []
    : await createGhProjectPort(gh).items(PROJECT_ID);
  const itemId = itemsAfter.find((item) => item.content.kind === 'issue' && item.content.number === NEW_ISSUE)?.id ?? null;
  return { lines, opened, calls: sent, refreshed, known, itemId, heldAtRefresh, heldAfter: issuesOf(itemsAfter) };
}

describe('addAndRefreshIssue: nothing without board.project.number', () => {
  it('opens no runner, sends no call, asks no refresh and answers no line with the number unset', async () => {
    const run = await addRun({ config: { ...CONFIG, boardProjectNumber: null } });

    expect([run.lines, run.opened, run.calls, run.refreshed]).toEqual([[], 0, [], []]);
    expect(run.heldAfter).toEqual([]);
  });

  it('control: with the number set, opens the runner once and sends calls', async () => {
    const run = await addRun();

    expect(run.opened).toBe(1);
    expect(run.calls.length).toBeGreaterThan(0);
  });
});

describe('addAndRefreshIssue: the add, then the refresh', () => {
  it('adds the new issue to the project before the refresh is asked for it alone', async () => {
    const run = await addRun({ items: [10] });

    expect(run.refreshed).toEqual([[NEW_ISSUE]]);
    expect(run.heldAtRefresh).toEqual([10, NEW_ISSUE]);
    expect(run.heldAfter).toEqual([10, NEW_ISSUE]);
    expect(run.lines).toEqual([]);
  });

  it('adds nothing twice for an issue the project already holds, and still refreshes it', async () => {
    const run = await addRun({ items: [10, NEW_ISSUE] });

    expect(run.heldAfter).toEqual([10, NEW_ISSUE]);
    expect(run.refreshed).toEqual([[NEW_ISSUE]]);
  });

  it('answers the refresh\'s own warning lines as it answers them', async () => {
    const run = await addRun({
      answer: () => Promise.resolve({ kind: 'refused', reason: 'scope', project: { owner: OWNER, number: NUMBER }, warnings: [scopeWarning()] }),
    });

    expect(run.lines).toEqual([scopeWarning()]);
  });
});

describe('addAndRefreshIssue: the added item, handed to the refresh', () => {
  it('hands the refresh the item the add answered, as a known item of the new issue with no value', async () => {
    const run = await addRun({ items: [10] });

    expect(run.itemId).not.toBeNull();
    expect(run.known).toEqual([[knownItem(run.itemId ?? '', { repository: FAKE_PROJECT_REPOSITORY, number: NEW_ISSUE })]]);
    expect(run.known[0]?.[0]?.values.size).toBe(0);
  });

  it('hands the item already there for an issue the project already holds', async () => {
    const fresh = await addRun({ items: [10] });
    const held = await addRun({ items: [10, NEW_ISSUE] });

    expect(held.known.map((items) => items.map(({ id }) => id))).toEqual([[held.itemId ?? '']]);
    expect(held.itemId).toBe(fresh.itemId);
  });

  it('hands no known item to a refresh never asked, the number naming no project', async () => {
    const run = await addRun({ project: false });

    expect(run.known).toEqual([]);
  });
});

describe('addAndRefreshIssue: an issue added but not filled', () => {
  const REFUSAL = { number: NEW_ISSUE, reason: 'operation timed out' };

  it('answers the added but not filled line after the refresh\'s own lines', async () => {
    const run = await addRun({
      answer: () => Promise.resolve(refreshedWith([notRefreshedWarning(REFUSAL)], [REFUSAL])),
    });

    expect(run.lines).toEqual([
      `#${String(NEW_ISSUE)} not refreshed: operation timed out`,
      `#${String(NEW_ISSUE)} added but not filled: operation timed out`,
    ]);
    expect(run.lines[1]).toBe(addedNotFilledWarning(REFUSAL));
    expect(run.heldAfter).toEqual([NEW_ISSUE]);
  });

  it('control: answers the refresh\'s own lines alone when it filled the issue', async () => {
    const run = await addRun({
      answer: () => Promise.resolve(refreshedWith([notRefreshedWarning(REFUSAL)], [])),
    });

    expect(run.lines).toEqual([notRefreshedWarning(REFUSAL)]);
  });

  it('answers no line for an issue the refresh filled with nothing to warn of', async () => {
    const run = await addRun({ answer: () => Promise.resolve(refreshedWith([], [])) });

    expect(run.lines).toEqual([]);
  });
});

describe('addAndRefreshIssue: failures answered as warning lines, never rejections', () => {
  it('answers the not-found line and adds and refreshes nothing for a number naming no project', async () => {
    const run = await addRun({ project: false });

    expect(run.lines).toEqual([notFoundWarning({ owner: OWNER, number: NUMBER })]);
    expect(run.refreshed).toEqual([]);
    expect(run.calls.some((args) => args.join(' ').includes('addProjectV2ItemById'))).toBe(false);
  });

  it('answers the scope line, refreshing nothing, when the project read is refused for the project scope', async () => {
    const run = await addRun({ failFirst: SCOPE_STDERR });

    expect(run.lines).toEqual([scopeWarning()]);
    expect(run.refreshed).toEqual([]);
    expect(run.heldAfter).toEqual([]);
  });

  it('control: answers the failed line naming the issue for a refused read whose words name no scope', async () => {
    const run = await addRun({ failFirst: 'gh: HTTP 502: Bad Gateway\n' });

    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toStartWith(`The project was not updated for #${String(NEW_ISSUE)}: `);
    expect(run.lines[0]).toContain('rafa board sync');
    expect(run.lines[0]).not.toBe(scopeWarning());
  });

  it('answers the failed line for a repository gh cannot read', async () => {
    const run = await addRun({ repoViewFails: true });

    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toStartWith(`The project was not updated for #${String(NEW_ISSUE)}: `);
    expect(run.lines[0]).toContain('could not read the repository');
    expect(run.refreshed).toEqual([]);
  });

  it('answers the failed line for a refresh that rejects, the issue already added', async () => {
    const error = new Error('the board has no default');
    const run = await addRun({ answer: () => Promise.reject(error) });

    expect(run.lines).toEqual([refreshFailedWarning(NEW_ISSUE, error)]);
    expect(run.heldAfter).toEqual([NEW_ISSUE]);
  });
});

/**
 * Tests for the `rafa issue edit` command (`./edit.ts`): what it prints
 * in text and json mode, `--dry-run`'s readings, and the exit code and
 * message of a `conflict`. The run itself, its gates and its outcomes,
 * are held in `./edit-run.test.ts`.
 *
 * Every case dispatches the registered command's own factory over a
 * `local` project of this file's own (`tests/cli-capture.ts`), its
 * `gh` refusing every call so no case reaches GitHub. The conflict case
 * resolves the chain over a registry whose `local` tracker writes as the
 * core one does and then changes the body, standing for an edit landing
 * around the write; the case beside it, over the core tracker, is the
 * control that the same line otherwise appends.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { IssueDraft, IssueEdit, IssueRef, Tracker } from '@open-tomato/rafa/ports';

import '../../adapter-registry.js';

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { renderUpdateBlock } from '../../board/issue-edit-body.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { requireEditingTracker } from './edit-run.js';
import { createIssueEditCommand } from './edit.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-edit-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 6, 12, 0);
const REASON = 'scope narrowed';
const TEXT = 'Also covers the title.';
const BODY = 'Seen twice.\n';
const BLOCK = renderUpdateBlock(NOW, REASON, TEXT);

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** A `gh` refusing every call: the local tracker asks it nothing. */
const noGh: GhRunner = (args) => Promise.reject(new Error(`no gh in a local project: gh ${args.join(' ')}`));

/** The issue each case files first. */
const DRAFT: IssueDraft = {
  opt: 0,
  title: 'Faster plan show',
  body: BODY,
  type: 'code',
  module: 'cli',
  priority: null,
  project: null,
  blockedBy: [],
};

/** The ref of the one issue each case files. */
const REF: IssueRef = { opt: 0, kind: 'local', externalId: '1', url: null };

/** The line appending {@link TEXT} for {@link REASON} to issue 1. */
const APPEND = ['issue', 'edit', '1', `--append=${TEXT}`, `--reason=${REASON}`];

/** A fresh `local` project holding issue 1, and a reader of its body. */
async function plantLocalIssue(): Promise<{ project: PlantedProject; read: () => Promise<string> }> {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
  const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
  await tracker.create(DRAFT);
  const { editable } = requireEditingTracker(tracker);
  return { project, read: async () => (await editable(REF)).body };
}

/** A registry whose `local` tracker adds `extra` to the body right after each write lands. */
function changingRegistry(extra: string) {
  return createAdapterRegistry([{
    port: 'tracker',
    kind: 'local',
    portVersion: PORT_VERSIONS.tracker,
    create: ({ repoRoot }): Tracker => {
      const core = requireEditingTracker(createLocalTracker({ issuesDir: localIssuesDir(repoRoot), fallbackReason: null }));
      return {
        ...core,
        edit: async (ref: IssueRef, change: IssueEdit): Promise<void> => {
          await core.edit(ref, change);
          const now = await core.editable(ref);
          await core.edit(ref, { body: `${now.body}${extra}` });
        },
      };
    },
  }]);
}

describe('rafa issue edit, dispatched', () => {
  it('appends the dated block and prints the outcome on one line', async () => {
    const { project, read } = await plantLocalIssue();

    const outcome = await dispatchInProject(APPEND, SUBJECTS, [createIssueEditCommand({ gh: noGh, now: () => NOW })], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: 'Appended an update to local issue 1; the original part is unchanged.\n',
      stderr: '',
    });
    expect(await read()).toBe(`${BODY}\n${BLOCK}`);
  });

  it('gives the report and the tracker as the data of the one result event in json mode', async () => {
    const { project } = await plantLocalIssue();

    const outcome = await dispatchInProject(
      [...APPEND, '--output=json'],
      SUBJECTS,
      [createIssueEditCommand({ gh: noGh, now: () => NOW })],
      project,
    );
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      ok: true,
      data: {
        issue: 1,
        outcome: 'appended',
        exitCode: 0,
        dryRun: false,
        written: true,
        refresh: null,
        scratch: null,
        tracker: { kind: 'local', degraded: false, fallbackReason: null },
      },
    });
  });

  it('prints each gate\'s reading and the added block under --dry-run, and writes nothing', async () => {
    const { project, read } = await plantLocalIssue();

    const outcome = await dispatchInProject(
      [...APPEND, '--dry-run'],
      SUBJECTS,
      [createIssueEditCommand({ gh: noGh, now: () => NOW })],
      project,
    );
    const lines = outcome.stdout.split('\n');

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(lines.slice(0, 4).map((line) => line.split(':')[0])).toEqual(['editor', 'author', 'text', 'state']);
    expect(outcome.stdout).toContain(`added:\n${BLOCK}`);
    expect(outcome.stdout).toContain('--dry-run: nothing was written; the edit would answer appended.');
    expect(await read()).toBe(BODY);
  });

  it('exits 1 on a body changed around the write, naming both bodies saved under .rafa/scratch/', async () => {
    const { project, read } = await plantLocalIssue();

    const outcome = await dispatchInProject(
      APPEND,
      SUBJECTS,
      [createIssueEditCommand({ gh: noGh, now: () => NOW, registry: changingRegistry('\nEdited in the browser.\n') })],
      project,
    );
    const paths = [...outcome.stderr.matchAll(/(\.rafa\/scratch\/rafa-1-edit-(?:before|after)-[^ ;]+\.md)/gu)].map((match) => match[1] ?? '');

    expect([outcome.exitCode, outcome.stdout]).toEqual([1, '']);
    expect(outcome.stderr).toContain('read back otherwise');
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => existsSync(join(project.root, path)))).toEqual([true, true]);
    expect(readFileSync(join(project.root, paths[0] ?? ''), 'utf8')).toBe(BODY);
    expect(readFileSync(join(project.root, paths[1] ?? ''), 'utf8')).toBe(await read());
  });
});

describe('rafa issue edit --priority, dispatched', () => {
  const PRIORITY = ['issue', 'edit', '1', '--priority=high'];
  const command = () => [createIssueEditCommand({ gh: noGh, now: () => NOW })];

  /** A local project's tracker, to read the priority back through `get`. */
  async function plantTracker() {
    const { project, read } = await plantLocalIssue();
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
    return { project, read, tracker };
  }

  it.each([
    ['--append', [`--append=${TEXT}`, `--reason=${REASON}`], '--priority and --append cannot be used together'],
    ['--replace-file', ['--replace-file=body.md'], '--priority and --replace-file cannot be used together'],
  ])('refuses --priority beside %s with exit 1, writing nothing', async (_name, extra, message) => {
    const { project, read, tracker } = await plantTracker();

    const outcome = await dispatchInProject([...PRIORITY, ...extra], SUBJECTS, command(), project);

    expect([outcome.exitCode, outcome.stdout]).toEqual([1, '']);
    expect(outcome.stderr).toContain(message);
    expect(await read()).toBe(BODY);
    expect((await tracker.get(REF)).priority).toBeNull();
  });

  it('refuses a priority outside the four, naming it, with exit 1', async () => {
    const { project, tracker } = await plantTracker();

    const outcome = await dispatchInProject(['issue', 'edit', '1', '--priority=critical'], SUBJECTS, command(), project);

    expect([outcome.exitCode, outcome.stdout]).toEqual([1, '']);
    expect(outcome.stderr).toContain('critical');
    expect((await tracker.get(REF)).priority).toBeNull();
  });

  it('refuses a closed issue with exit 2, leaving its priority as it was', async () => {
    const { project, tracker } = await plantTracker();
    await tracker.transition(REF, 'done');

    const outcome = await dispatchInProject(PRIORITY, SUBJECTS, command(), project);

    expect([outcome.exitCode, outcome.stdout]).toEqual([2, '']);
    expect(outcome.stderr.toLowerCase()).toContain('closed');
    expect((await tracker.get(REF)).priority).toBeNull();
  });

  it('prints the swap under --dry-run and writes nothing', async () => {
    const { project, read, tracker } = await plantTracker();

    const outcome = await dispatchInProject([...PRIORITY, '--dry-run'], SUBJECTS, command(), project);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(outcome.stdout).toContain('priority: needs-triage → high');
    expect(outcome.stdout).toContain('--dry-run: nothing was written');
    expect(await read()).toBe(BODY);
    expect((await tracker.get(REF)).priority).toBeNull();
  });

  it('swaps the priority on the local tracker, read back through get', async () => {
    const { project, read, tracker } = await plantTracker();

    const outcome = await dispatchInProject(PRIORITY, SUBJECTS, command(), project);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect((await tracker.get(REF)).priority).toBe('high');
    expect(await read()).toBe(BODY);
  });

  it('swaps the priority and removes needs-triage in one gh issue edit on the GitHub fake', async () => {
    const fake = createFakeGh();
    const github = createGithubTracker({ gh: fake.run });
    const ref = await github.create({ ...DRAFT, priority: 'low' });
    fake.update(ref.externalId, (issue) => ({ ...issue, labels: [...issue.labels, 'needs-triage'] }));
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: github\n  fallback: [local]\n');
    const before = fake.calls().length;
    const gh: GhRunner = (args, input) => {
      if (args[0] === 'api' && args[1] === 'user') return Promise.resolve({ ok: true, stdout: '{"login":"rafa-fake","id":1}', stderr: '' });
      if (args[0] === 'api' && /collaborators\/[^/]+\/permission$/u.test(args[1] ?? '')) {
        return Promise.resolve({ ok: true, stdout: '{"permission":"write"}', stderr: '' });
      }
      return fake.run(args, input);
    };

    const outcome = await dispatchInProject(
      ['issue', 'edit', ref.externalId, '--priority=high'],
      SUBJECTS,
      [createIssueEditCommand({ gh, now: () => NOW })],
      project,
    );

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect((await github.get(ref)).priority).toBe('high');
    const labels = fake.issue(ref.externalId)?.labels ?? [];
    expect(labels).toContain('priority:high');
    expect(labels).not.toContain('priority:low');
    expect(labels).not.toContain('needs-triage');
    const edits = fake.calls().slice(before)
      .filter((call) => call[0] === 'issue' && call[1] === 'edit');
    expect(edits).toHaveLength(1);
  });

  it('sets a priority beside --title in one run, leaving the body alone', async () => {
    const { project, read, tracker } = await plantTracker();

    const outcome = await dispatchInProject([...PRIORITY, '--title=Faster plan list'], SUBJECTS, command(), project);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    const issue = await tracker.get(REF);
    expect([issue.priority, issue.title]).toEqual(['high', 'Faster plan list']);
    expect(await read()).toBe(BODY);
  });
});

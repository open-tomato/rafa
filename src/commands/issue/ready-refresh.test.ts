/**
 * Tests for `rafa issue ready`'s project refresh, reached through its
 * label swap (`ready.ts` builds the refreshing `IssueBoard` of
 * `src/board/project/issue-board-refresh.ts`): a marked issue refreshes
 * exactly that issue on the project, and an issue answered no refreshes
 * nothing.
 *
 * The command runs through the dispatcher in a project whose config sets
 * `board.project.number`. A router sends the issue, its edit and the
 * permission lookup to the planted issue, the repository read, the
 * project and facts reads (both `gh api graphql`) to their fakes, and the
 * board listing the refresh reads to a planted roadmap. The project holds
 * a second item, planted at Stage Triage, which the refresh must leave as
 * it is.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { FakeProjectGh } from '../../board/project/project-fake.js';
import type { GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../../board/issue.js';
import { createFakeFactsGh } from '../../board/project/facts-fake.js';
import { createGhProjectPort } from '../../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY } from '../../board/project/project-fake.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import { createIssueReadyCommand } from './ready.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-ready-refresh-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The owner of the repository and the project. */
const OWNER = 'open-tomato';

/** The project's number, as the config names it. */
const PROJECT_NUMBER = 6;

/** The config of a repository that opted into the project. */
const CONFIG = `board:\n  project:\n    number: ${String(PROJECT_NUMBER)}\n`;

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The flag that keeps the ending's hint out of a case's output. */
const NO_HINT = '--no-hint';

/** The issue the case marks. */
const MARKED = 57;

/** The issue the project holds beside it, at Stage Triage, which must not be refreshed. */
const BESIDE = 58;

/** The three lines a marked run prints. */
const MARKED_STDOUT = `#${String(MARKED)} was opened by maintainer, who has write access to github.com/open-tomato/rafa\n`
  + `#${String(MARKED)} fills every heading the spec template asks for, with no placeholder left\n`
  + `Marked #${String(MARKED)} spec:ready, and took spec:needs-work off it\n`;

/** A successful `gh` answer holding `value` as its JSON. */
function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** The shape the board listing reads an issue as. */
function listed(number: number, state: 'OPEN' | 'CLOSED', labels: readonly string[], title: string, body: string): object {
  return {
    number,
    title,
    body,
    state,
    stateReason: '',
    labels: labels.map((name) => ({ name })),
  };
}

/** What one routed case holds: the project, and every argv the router was handed. */
interface Rig {
  readonly gh: GhRunner;
  readonly projectGh: FakeProjectGh;
  readonly calls: () => readonly (readonly string[])[];
}

/** The router over one case; the project holds the marked issue unfilled and {@link BESIDE} at Triage. */
function routed(): Rig {
  const recorded: (readonly string[])[] = [];
  const projectGh = createFakeProjectGh({
    owners: [OWNER],
    projects: [{
      owner: OWNER,
      number: PROJECT_NUMBER,
      items: [{ number: MARKED }, { number: BESIDE, values: { Stage: 'Triage' } }],
    }],
  });
  const facts = createFakeFactsGh({
    issues: [
      { number: MARKED, state: 'OPEN', labels: [SPEC_LABEL, SPEC_READY_LABEL] },
      { number: BESIDE, state: 'OPEN', labels: [SPEC_LABEL] },
    ],
    pulls: [],
    trees: {},
  });
  const gh: GhRunner = (args) => {
    recorded.push([...args]);
    const line = args.join(' ');
    if (args[0] === 'issue' && args[1] === 'view') {
      return Promise.resolve(answered({
        number: MARKED,
        title: `Issue ${String(MARKED)}`,
        body: completeSpecBody(`Issue ${String(MARKED)}`),
        state: 'OPEN',
        labels: [{ name: SPEC_LABEL }],
        author: { login: 'maintainer' },
      }));
    }
    if (args[0] === 'issue' && args[1] === 'edit') return Promise.resolve({ ok: true, stdout: '', stderr: '' });
    if (args[0] === 'api' && args[1] === 'graphql') {
      return Promise.resolve(args.includes('owner={owner}')
        ? facts.gh(args)
        : projectGh.gh(args));
    }
    if (args[0] === 'api') return Promise.resolve(answered({ permission: 'admin', role_name: 'admin' }));
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (line.startsWith('issue list --label type:roadmap --state open')) {
      return Promise.resolve(answered([listed(1, 'OPEN', ['type:roadmap'], 'Roadmap', `- [ ] #${String(MARKED)} first\n- [ ] #${String(BESIDE)} second\n`)]));
    }
    if (line.startsWith('issue list --state all')) {
      return Promise.resolve(answered([
        listed(MARKED, 'OPEN', [SPEC_LABEL], `Issue ${String(MARKED)}`, completeSpecBody(`Issue ${String(MARKED)}`)),
        listed(BESIDE, 'OPEN', [SPEC_LABEL], `Issue ${String(BESIDE)}`, completeSpecBody(`Issue ${String(BESIDE)}`)),
      ]));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${line}\n` });
  };
  return { gh, projectGh, calls: () => [...recorded] };
}

/** A `git` answering `origin`, so the repository label is the one the marked run prints. */
const fakeGit: GitRunner = (args) => (args.join(' ') === 'remote get-url origin'
  ? { ok: true, stdout: 'git@github.com:open-tomato/rafa.git\n', stderr: '' }
  : { ok: false, stdout: '', stderr: `no route for ${args.join(' ')}\n` });

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

/** A command over `rig` that never opens a prompter, marking under `--yes`. */
function headless(rig: Rig): ReturnType<typeof createIssueReadyCommand> {
  return createIssueReadyCommand({
    openGh: () => rig.gh,
    openGit: () => fakeGit,
    isTerminal: () => false,
    openPrompter: () => {
      throw new Error('the run opened a prompter under --yes');
    },
  });
}

/** A fresh project under the case's directory, opted into the project. */
function plant(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), CONFIG);
}

describe('rafa issue ready refreshes the issue its label swap labelled', () => {
  it('refreshes the marked issue alone: its Stage is written and the issue beside it is left at Triage', async () => {
    const rig = routed();

    const outcome = await dispatchInProject(['issue', 'ready', String(MARKED), '--yes', NO_HINT], SUBJECTS, [headless(rig)], plant());

    expect(outcome).toEqual({ exitCode: 0, stdout: MARKED_STDOUT, stderr: '' });
    expect(await heldStages(rig.projectGh)).toEqual({ [MARKED]: 'Ready', [BESIDE]: 'Triage' });
  });

  it('control: an answer of no swaps nothing, sends no refresh and leaves the project as it was', async () => {
    const rig = routed();
    const command = createIssueReadyCommand({
      openGh: () => rig.gh,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: () => ({
        say: () => undefined,
        ask: () => Promise.resolve('n'),
        close: () => undefined,
      }),
    });

    const outcome = await dispatchInProject(['issue', 'ready', String(MARKED), NO_HINT], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(0);
    expect(rig.calls().some((args) => args[0] === 'issue' && args[1] === 'edit')).toBe(false);
    expect(rig.calls().some((args) => args[0] === 'api' && args[1] === 'graphql')).toBe(false);
    expect(await heldStages(rig.projectGh)).toEqual({ [MARKED]: null, [BESIDE]: 'Triage' });
  });
});

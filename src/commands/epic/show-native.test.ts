/**
 * Tests for `rafa epic show` (`show.ts`) in `native` mode: the listing
 * read with the native fields, the epic's members read as its
 * sub-issues through the relationships port, its head counted from
 * GitHub's `subIssuesSummary`, the `horizon:` problems alone written,
 * and no cancelled-epic notice. The `labels` cases stay in
 * `./show.test.ts`.
 *
 * Each case dispatches the command over one planted `gh` answering a
 * native listing, with the real `native` adapter made over a `gh` that
 * fails any call, so a read through the port that spawned fails the case.
 *
 * ## The controls
 *
 * The planted rows also carry the `labels` mode's marks, pointing
 * elsewhere, and every native case is paired with the same dispatch in
 * `labels` mode (no port handed), which must answer differently:
 *
 *  - epic #50 carries `epic:alpha`, which only #54 (no sub-issue) also
 *    carries, and its checklist names #51, so `labels` counts #54 alone
 *    and warns the unlisted and unlabelled lines;
 *  - GitHub counts one more sub-issue of #50 than the listing holds, so
 *    a head counted on the listing reads `1/3`, not the summary's `1/4`;
 *  - epic #70 is done by its summary and holds no labelled member, so a
 *    bare `rafa epics` lands on #50 natively and on #70 by labels;
 *  - epic #40 is closed as not planned and #43's `Blocked by:` line and
 *    `blockedBy` link both name its open member #41: `labels` writes the
 *    cancelled-epic notice, `native` does not.
 */
import type { EpicsResult } from './show.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderCancelledEpicNotice } from '../../board/epic-cancel-notice.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { createNativeRelations } from '../../board/relations/native.js';
import { BOARD_LIST_FIELDS, nativeBoardListFields } from '../../board/roadmap-board.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import { createEpicShowCommand } from './show.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epics-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue the config names. */
const ROADMAP = 1;

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The Roadmap's body: #70, done by its summary, then #50. */
const ROADMAP_BODY = '- [ ] #70 — finished\n- [ ] #50 — alpha\n';

/** A `gh` every call to which fails the case: the port's reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link REPOSITORY}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** A link node naming issue `number` on this board, as `gh` writes it. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return { number, title: `Issue ${String(number)}`, state, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
}

/** A list of link nodes, as `gh` writes one. */
function links(nodes: readonly object[]): object {
  return { nodes, totalCount: nodes.length };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly title?: string;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly labels?: readonly string[];
  readonly parent?: number;
  readonly blockedBy?: readonly object[];
  readonly subIssues?: readonly object[];
  readonly summary?: { readonly total: number; readonly completed: number };
}

/** One issue as `gh issue list --json <nativeBoardListFields>` writes it. */
function row(number: number, fields: RowFields = {}): object {
  const state = fields.state ?? 'OPEN';
  const summary = fields.summary ?? { total: 0, completed: 0 };
  return {
    number,
    title: fields.title ?? `Issue ${String(number)}`,
    body: fields.body ?? completeSpecBody(`Issue ${String(number)}`),
    state,
    stateReason: fields.stateReason ?? (state === 'CLOSED'
      ? 'COMPLETED'
      : null),
    labels: (fields.labels ?? []).map((name) => ({ name })),
    parent: fields.parent === undefined
      ? null
      : node(fields.parent),
    blockedBy: links(fields.blockedBy ?? []),
    blocking: links([]),
    subIssuesSummary: {
      ...summary,
      percentCompleted: summary.total === 0
        ? 0
        : Math.floor((summary.completed * 100) / summary.total),
    },
    subIssues: links(fields.subIssues ?? []),
  };
}

/** The epic body: its criteria, then a checklist naming `checklist`. */
function epicBody(checklist: readonly number[]): string {
  return `## Acceptance criteria\n\nIt works.\n\n${checklist.map((issue) => `- [ ] #${String(issue)}`).join('\n')}\n`;
}

/** The native board; the module note holds what each row is for. */
const BOARD = [
  row(50, {
    title: 'Epic alpha',
    body: epicBody([51]),
    labels: ['type:epic', 'epic:alpha', 'horizon:now'],
    subIssues: [node(53), node(51), node(52, 'CLOSED')],
    summary: { total: 4, completed: 1 },
  }),
  row(51, { labels: [SPEC_READY_LABEL], parent: 50 }),
  row(52, { state: 'CLOSED', parent: 50 }),
  row(53, { parent: 50 }),
  row(54, { labels: ['epic:alpha'] }),
  row(70, { title: 'Epic gamma', body: epicBody([]), labels: ['type:epic', 'horizon:now'], summary: { total: 2, completed: 2 } }),
  row(40, {
    title: 'Epic gone',
    body: epicBody([41]),
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    labels: ['type:epic', 'epic:gone', 'horizon:now'],
    subIssues: [node(41)],
    summary: { total: 1, completed: 0 },
  }),
  row(41, { labels: ['epic:gone'], parent: 40 }),
  row(43, { labels: ['spec:blocked'], body: 'Waits.\n\nBlocked by: #41\n', blockedBy: [node(41)] }),
];

/** A `gh` answering the Roadmap read, the board listing and the open pull requests, recording each call. */
function plantedGh(calls: string[][]): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const roadmap = JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } });
  return (args) => {
    calls.push([...args]);
    const [noun, verb] = args;
    if (noun === 'issue' && verb === 'view') return Promise.resolve(ok(roadmap));
    if (noun === 'issue' && verb === 'list' && args.includes('--label')) return Promise.resolve(ok('[]'));
    if (noun === 'issue' && verb === 'list') return Promise.resolve(ok(JSON.stringify(BOARD)));
    if (noun === 'pr' && verb === 'list') return Promise.resolve(ok('[]'));
    return Promise.resolve({ ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` });
  };
}

/** The subject the command is declared under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** A `git` holding no branch. */
const plantedGit: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** A fresh project whose config names the Roadmap. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n  default: local\nroadmap:\n  issue: ${String(ROADMAP)}\n`);
}

/** Dispatches `words` in `mode`, the port handed only for `native`, answering the outcome and the `gh` calls. */
async function run(words: readonly string[], mode: 'labels' | 'native') {
  const calls: string[][] = [];
  const base = { gh: plantedGh(calls), git: plantedGit, planNames: () => () => [], terminalWidth: () => undefined };
  const seams = mode === 'native'
    ? { ...base, relations: NATIVE }
    : base;
  const outcome = await dispatchInProject(words, [EPIC_SUBJECT], [createEpicShowCommand(seams)], plantCase());
  return { ...outcome, calls };
}

/** The board listing calls: an `issue list` with no label filter. */
function listingCalls(calls: readonly string[][]): readonly string[][] {
  return calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && !call.includes('--label'));
}

/** The issue each table row opens with, in order. */
function rowIssues(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .filter((text) => /^#\d+ /u.test(text))
    .map((text) => text.split(' ')[0] ?? '');
}

/** The notice `labels` mode writes for cancelled epic #40. */
const NOTICE = renderCancelledEpicNotice({ epic: 40, dependents: [43] });

describe('rafa epics <n> in native mode', () => {
  it('reads the listing once with the native fields, and labels mode with its own (control)', async () => {
    const native = await run(['epics', '50'], 'native');
    const labels = await run(['epics', '50'], 'labels');

    expect(native.exitCode).toBe(0);
    expect(listingCalls(native.calls)).toHaveLength(1);
    expect(listingCalls(native.calls)[0]).toContain(nativeBoardListFields);
    expect(listingCalls(labels.calls)).toHaveLength(1);
    expect(listingCalls(labels.calls)[0]).toContain(BOARD_LIST_FIELDS);
  });

  it('heads the epic by number and title with GitHub\'s count, where labels counts its one labelled member', async () => {
    const native = await run(['epics', '50'], 'native');
    const labels = await run(['epics', '50'], 'labels');

    expect(native.stdout).toContain('Epic #50 · Epic alpha · in-progress, 1/4 done\n');
    expect(native.stdout).not.toContain('epic:alpha');
    expect(labels.stdout).toContain('Epic #50 · Epic alpha · backlog, 0/1 done\n');
  });

  it('prints the open sub-issues in sub-issue order, where labels prints its checklist and labelled members', async () => {
    const native = await run(['epics', '50'], 'native');
    const labels = await run(['epics', '50'], 'labels');

    expect(rowIssues(native.stdout)).toEqual(['#53', '#51']);
    expect(rowIssues(labels.stdout)).toEqual(['#51', '#54']);
  });

  it('writes no label problem and no cancelled-epic notice, where labels writes both over the same listing', async () => {
    const native = await run(['epics', '50'], 'native');
    const labels = await run(['epics', '50'], 'labels');

    expect(native.stdout).not.toContain('warn:');
    expect(native.stderr).toBe('');
    expect(labels.stdout).toContain('warn: #54 carries epic:alpha but is not on epic #50\'s checklist');
    expect(labels.stdout).toContain(`warn: ${NOTICE}`);
  });

  it('answers the epic with no slug in json mode, its members the sub-issues on the listing', async () => {
    const outcome = await run(['epics', '50', '--output=json'], 'native');
    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as { data: EpicsResult } | undefined;
    const epic = result?.data.epic;

    expect(outcome.exitCode).toBe(0);
    expect(epic?.slug).toBeNull();
    expect(epic?.members.map((member) => member.number)).toEqual([53, 51, 52]);
    expect(epic?.progress).toEqual({ done: 1, total: 4, notPlanned: 0 });
    expect(result?.data.problems).toEqual([]);
  });
});

describe('rafa epics, bare, in native mode', () => {
  it('passes the epic done by its summary and lands on #50, where labels lands on the empty #70 (control)', async () => {
    const native = await run(['epics'], 'native');
    const labels = await run(['epics'], 'labels');

    expect(native.exitCode).toBe(0);
    expect(native.stdout.split('\n').find((text) => text.startsWith('Epic #'))).toBe('Epic #50 · Epic alpha · in-progress, 1/4 done');
    expect(labels.stdout.split('\n').find((text) => text.startsWith('Epic #'))).toBe('Epic #70 · Epic gamma · empty, 0/0 done');
  });
});

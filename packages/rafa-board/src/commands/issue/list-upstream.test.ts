/**
 * Tests for `rafa issue list --upstream=rafa` (`list-upstream.ts`, called
 * from `list.ts`): the gate's refusals before any tracker, each ending
 * `Nothing was read.`, the line's refusals beside the flag, then the
 * upstream board's issues listed and narrowed by `--search`, `--type`,
 * `--module` and `--limit`.
 *
 * Each case runs the command over a fixture project of its own under
 * this file's temporary directory, its `.rafa/config.yaml` planted by the
 * case. `gh` is a seam recording every call: it answers
 * `gh repo view --json nameWithOwner,visibility` as this board,
 * {@link OWN}, and hands every other call to the recorded fake
 * (`adapters/tracker/github-fake.ts`) holding the upstream,
 * {@link UPSTREAM}, with three issues planted, which refuses a `--repo`
 * naming another repository. The recorded calls are the control that a
 * refusal sent no `gh issue list`, and that a listing named the upstream
 * and never this board.
 *
 * Negative cases come first.
 */
import type { IssueSeams, LineFlags } from './issue-tracker.js';
import type { UpstreamIssueListResult } from './list-upstream.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { scopeAt } from '@open-tomato/rafa/core/config';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';

import { createIssueListCommand, renderUpstreamList } from './list.js';
import { registerUpstreamTestAdapters } from './upstream-test-adapters.js';

/** The logger and trackers this file reads, registered when the package's own preload ran (#1586). */
let restoreAdapters: () => void = () => undefined;
beforeAll(() => {
  restoreAdapters = registerUpstreamTestAdapters();
});
afterAll(() => {
  restoreAdapters();
});

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-list-upstream-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The upstream every config here names. */
const UPSTREAM = 'open-tomato/rafa';

/** This board, the listing repository. */
const OWN = 'open-tomato/components';

/** A config naming {@link UPSTREAM} under `collaborate.rafa`. */
const COLLABORATE_CONFIG = `collaborate:\n  rafa: ${UPSTREAM}\n`;

/** A config holding no `collaborate` section. */
const NO_COLLABORATE_CONFIG = 'tracker:\n  default: local\n';

/** The command the gate reads this board through. */
const REPO_VIEW = ['repo', 'view', '--json', 'nameWithOwner,visibility'];

/** The issues planted on the upstream, in the order filed: a title, a body and the labels set after. */
const PLANTED = [
  { title: 'resume finds no branch', body: 'Seen on a fresh worktree.', labels: ['type:bug', 'module:loop'] },
  { title: 'list prints no head', body: 'The table opens bare.', labels: ['type:bug', 'module:board'] },
  { title: 'add a stretch log', body: 'A worktree reading for each stretch.', labels: ['type:code', 'module:loop'] },
] as const;

/** A fixture project holding `config`, and an empty home. */
function plantProject(config: string): ProjectFound {
  const base = mkdtempSync(join(tempBase, 'case-'));
  const root = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), config);
  return { found: true, root, home, project: scopeAt(root), user: scopeAt(home) };
}

/** How this board answers `gh repo view`: a repository and its visibility, or a failure. */
type OwnAnswer = { readonly repository: string; readonly visibility: string } | { readonly fails: string };

/** The `gh` seam a case runs over: every call recorded. */
interface Boards {
  readonly gh: GhRunner;
  readonly calls: (readonly string[])[];
}

/** What `gh repo view` answers for `own`. */
function repoView(own: OwnAnswer): GhResult {
  if ('fails' in own) return { ok: false, stdout: '', stderr: `${own.fails}\n` };
  return { ok: true, stdout: `${JSON.stringify({ nameWithOwner: own.repository, visibility: own.visibility })}\n`, stderr: '' };
}

/** A `gh` answering this board as `own` and handing every other call to the fake holding `upstream` and {@link PLANTED}. */
async function boardsOf(own: OwnAnswer = { repository: OWN, visibility: 'PRIVATE' }): Promise<Boards> {
  const fake = createFakeGh({ repo: UPSTREAM });
  for (const [index, issue] of PLANTED.entries()) {
    const planted = await fake.run(['issue', 'create', '--title', issue.title, '--body', issue.body]);
    if (!planted.ok) throw new Error(`the fake refused a planted issue: ${planted.stderr}`);
    fake.update(String(index + 1), (held) => ({ ...held, labels: [...issue.labels] }));
  }
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args, stdin) => {
    calls.push(args);
    return args[0] === 'repo' && args[1] === 'view'
      ? Promise.resolve(repoView(own))
      : fake.run(args, stdin);
  };
  return { gh, calls };
}

/** What a run wrote: the `info` and `warn` lines, and each result. */
interface Written {
  readonly info: string[];
  readonly warn: string[];
  readonly results: unknown[];
}

/** A context over `project` with `args` and `flags`, in `mode`, writing into `written`. */
function contextOf(
  project: ProjectFound,
  line: { readonly args: readonly string[]; readonly flags: LineFlags },
  written: Written,
  mode: RafaContext['outputMode'],
): RafaContext {
  return Object.freeze({
    args: line.args,
    flags: line.flags,
    outputMode: mode,
    verbosity: 2,
    output: sinkOutput({
      info: (text: string) => written.info.push(text),
      warn: (text: string) => written.warn.push(text),
      result: (payload: unknown) => written.results.push(payload),
    }),
    signal: new AbortController().signal,
    env: {},
    argv: [],
    registry: createCommandRegistry({ subjects: [], commands: [] }),
    project,
  });
}

/** What a run ended with: its exit code and message, 0 and `''` when it resolved, and what it wrote. */
interface Outcome extends Written {
  readonly exitCode: number;
  readonly message: string;
}

/** How a case runs the command: its arguments and output mode, none and text when left out. */
interface RunOptions {
  readonly args?: readonly string[];
  readonly mode?: RafaContext['outputMode'];
}

/** Runs `issue list` with `flags` in `project` over `boards`. */
async function run(project: ProjectFound, flags: LineFlags, boards: Boards, options: RunOptions = {}): Promise<Outcome> {
  const written: Written = { info: [], warn: [], results: [] };
  const seams: IssueSeams = { gh: boards.gh, cwd: () => project.root };
  const context = contextOf(project, { args: options.args ?? [], flags }, written, options.mode ?? 'text');
  try {
    await createIssueListCommand(seams).run(context);
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    return { exitCode: error.exitCode, message: error.message, ...written };
  }
  return { exitCode: 0, message: '', ...written };
}

/** The calls `boards` sent past the gate's one read. */
function pastTheGate(boards: Boards): (readonly string[])[] {
  return boards.calls.filter((call) => call[0] !== 'repo');
}

/** True when `boards` sent a `gh issue list`. */
function sentIssueList(boards: Boards): boolean {
  return boards.calls.some((call) => call[0] === 'issue' && call[1] === 'list');
}

/** The repository a call names with `--repo`, or undefined for none. */
function repoOf(call: readonly string[]): string | undefined {
  const at = call.indexOf('--repo');
  return at < 0
    ? undefined
    : call[at + 1];
}

/** Asserts every call past the gate named `--repo <upstream>`, and none named this board. */
function expectOnUpstream(boards: Boards): void {
  const sent = pastTheGate(boards);
  expect(sent.length).toBeGreaterThan(0);
  for (const call of sent) {
    expect(repoOf(call)).toBe(UPSTREAM);
    expect(call.some((arg) => arg.toLowerCase() === OWN)).toBe(false);
  }
}

/** The value a flag takes on the one `gh issue list` sent, or undefined when it was not sent. */
function listFlag(boards: Boards, flag: string): string | undefined {
  const list = boards.calls.find((call) => call[0] === 'issue' && call[1] === 'list') ?? [];
  const at = list.indexOf(flag);
  return at < 0
    ? undefined
    : list[at + 1];
}

/** The ids of the issues a json-mode run gave, in order. */
function listedIds(outcome: Outcome): readonly string[] {
  const [result] = outcome.results as UpstreamIssueListResult[];
  return result?.issues.map((issue) => issue.ref.externalId) ?? [];
}

describe('issue list --upstream refuses at the gate, before any tracker', () => {
  it('refuses collaborate.rafa absent with Nothing was read., exit 1, sending no gh issue list', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(NO_COLLABORATE_CONFIG), { upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue list --upstream=rafa: collaborate.rafa is not set, so reporting upstream is off. Nothing was read.',
    ]);
    expect(sentIssueList(boards)).toBe(false);
    expect(boards.calls).toEqual([]);
  });

  it('refuses owners that differ with Nothing was read., exit 1, after the one read of this board', async () => {
    const boards = await boardsOf({ repository: 'someone-else/app', visibility: 'PUBLIC' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue list --upstream=rafa: collaborate.rafa names open-tomato/rafa (owner open-tomato), and this board is '
      + 'someone-else/app (owner someone-else). Reporting upstream is allowed only between repositories of one owner. '
      + 'Nothing was read.',
    ]);
    expect(sentIssueList(boards)).toBe(false);
    expect(boards.calls).toEqual([REPO_VIEW]);
  });

  it('refuses a tool it does not know, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'bun' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue list --upstream=bun: --upstream names "bun", expected one of: rafa. Nothing was read.',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses this board\'s owner unread, naming gh\'s reason, sending no gh issue list', async () => {
    const boards = await boardsOf({ fails: 'no git remotes found' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue list --upstream=rafa: could not read this board\'s owner '
      + '(gh repo view --json nameWithOwner,visibility failed: no git remotes found). Nothing was read.',
    ]);
    expect(boards.calls).toEqual([REPO_VIEW]);
  });
});

describe('issue list --upstream refuses the line before the gate', () => {
  it('refuses the flag typed blank, naming the usage, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: ' ' }, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith('❌ --upstream cannot be blank: --upstream=<value>\nUsage: rafa issue list');
    expect(boards.calls).toEqual([]);
  });

  it('refuses --roadmap beside it, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', roadmap: true }, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith('❌ --roadmap reads this board\'s Roadmap, so it cannot be typed with --upstream');
    expect(boards.calls).toEqual([]);
  });

  it('refuses --state beside it, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', state: 'todo' }, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith('❌ --state cannot narrow --upstream: the upstream board is GitHub\'s');
    expect(boards.calls).toEqual([]);
  });

  it('refuses an argument, sending no gh', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa' }, boards, { args: ['3'] });
    expect(outcome.exitCode).toBe(1);
    expect(boards.calls).toEqual([]);
  });
});

describe('issue list --upstream=rafa, listed', () => {
  it('lists the upstream\'s issues under a head naming it, every call past the gate on the upstream', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message, outcome.warn]).toEqual([0, '', []]);
    expect(outcome.info[0]).toBe(`Tracker: github on ${UPSTREAM}`);
    expect(outcome.info).toHaveLength(1 + PLANTED.length);
    for (const issue of PLANTED) expect(outcome.info.some((text) => text.endsWith(issue.title))).toBe(true);
    expect(boards.calls[0]).toEqual(REPO_VIEW);
    expectOnUpstream(boards);
    expect(pastTheGate(boards).map((call) => call.slice(0, 2))).toEqual([
      ['issue', 'list'],
      ...PLANTED.map(() => ['issue', 'view']),
    ]);
  });

  it('narrows by --search, sent as gh issue list --search', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', search: 'worktree' }, boards, { mode: 'json' });
    expect(listFlag(boards, '--search')).toBe('worktree');
    expect([...listedIds(outcome)].sort()).toEqual(['1', '3']);
    expectOnUpstream(boards);
  });

  it('narrows by --type and --module, each sent as a label', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', type: 'bug', module: 'loop' }, boards, { mode: 'json' });
    const list = pastTheGate(boards)[0] ?? [];
    expect(list.filter((_, at) => list[at - 1] === '--label')).toEqual(['module:loop', 'type:bug']);
    expect(listedIds(outcome)).toEqual(['1']);
    expectOnUpstream(boards);
  });

  it('lists a --type=bug narrowing in the bug columns under the upstream head', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', type: 'bug' }, boards);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.info[0]).toBe(`Tracker: github on ${UPSTREAM}`);
    expect(outcome.info[1]).toMatch(/#\s+state\s+module\s+action\s+summary/);
  });

  it('keeps at most --limit issues, sent as gh issue list --limit', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', limit: '2' }, boards, { mode: 'json' });
    expect(listFlag(boards, '--limit')).toBe('2');
    expect(listedIds(outcome)).toHaveLength(2);
  });

  it('passes owners differing only in case', async () => {
    const boards = await boardsOf({ repository: 'Open-Tomato/components', visibility: 'PRIVATE' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa' }, boards);
    expect(outcome.exitCode).toBe(0);
    expectOnUpstream(boards);
  });

  it('gives the github tracker, the query, the upstream and refs carrying it as the result in json mode', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { upstream: 'rafa', limit: '1' }, boards, { mode: 'json' });
    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0] as UpstreamIssueListResult;
    expect([result.tracker, result.query, result.upstream]).toEqual([
      { kind: 'github', degraded: false, fallbackReason: null },
      { limit: 1 },
      UPSTREAM,
    ]);
    expect(result.issues.map((issue) => issue.ref.repo)).toEqual([UPSTREAM]);
  });

  it('sends no --repo and no visibility read without --upstream: the control that both are the upstream path\'s', async () => {
    const boards = await boardsOf();
    const outcome = await run(plantProject('tracker:\n  default: github\n'), {}, boards);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.info[0]).toBe('Tracker: github');
    expect(sentIssueList(boards)).toBe(true);
    expect(pastTheGate(boards).some((call) => repoOf(call) !== undefined)).toBe(false);
    expect(boards.calls.some((call) => call.includes('nameWithOwner,visibility'))).toBe(false);
  });
});

describe('what the upstream list renders', () => {
  it('names the upstream on the head and keeps the rows', () => {
    expect(renderUpstreamList(['Tracker: github', '  1  open  bug  x'], UPSTREAM)).toEqual([
      `Tracker: github on ${UPSTREAM}`,
      '  1  open  bug  x',
    ]);
  });
});

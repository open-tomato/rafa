/**
 * Tests for `rafa issue create --upstream=rafa` (`create.ts`, with the
 * bug line of `create-bug.ts`): the type other than `bug` refused, the
 * gate's refusals before any tracker, the private-name rule over the
 * title, the body and its `Versions` section, the filing on the upstream
 * board with no project placement, and `--dry-run` printing the upstream
 * body and target.
 *
 * Each case runs the command over a fixture project of its own under
 * this file's temporary directory: its `.rafa/config.yaml` planted by
 * the case, a `package.json` naming the filing package
 * {@link PACKAGE} at {@link VERSION}, and an empty home. Git is a seam
 * answering a fixed commit from no checkout of its own, so the project
 * root stands in. `gh` is a seam recording every call: it answers
 * `gh repo view --json nameWithOwner,visibility` as this board,
 * {@link OWN}, and hands every other call to the recorded fake
 * (`adapters/tracker/github-fake.ts`) holding the upstream,
 * {@link UPSTREAM}, which refuses a `--repo` naming another repository.
 * The recorded calls are the control that a refusal sent no `gh issue`
 * or `gh label` call, and that a filing named the upstream on each and
 * this board on none.
 *
 * Negative cases come first.
 */
import type { IssueCreateResult, IssueDryRun } from './create.js';
import type { IssueSeams, LineFlags } from './issue-tracker.js';
import type { FakeGh } from '../../adapters/tracker/github-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { CommandExit, RAFA_VERSION } from '@open-tomato/rafa/core/command';
import { scopeAt } from '@open-tomato/rafa/core/config';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';

import { createIssueCreateCommand, packageNames, renderCreated, renderDryRun } from './create.js';
import { PRIVATE_SIBLING } from './upstream-text.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-create-upstream-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The upstream every config here names. */
const UPSTREAM = 'open-tomato/rafa';

/** This board, the filing repository. */
const OWN = 'open-tomato/components';

/** The filing package, as its `package.json` names it. */
const PACKAGE = 'components-workspace';

/** The filing package's version. */
const VERSION = '0.1.0';

/** A config naming {@link UPSTREAM} under `collaborate.rafa`, and a board project of this board's. */
const COLLABORATE_CONFIG = `collaborate:\n  rafa: ${UPSTREAM}\nboard:\n  project:\n    number: 7\n`;

/** A config holding no `collaborate` section. */
const NO_COLLABORATE_CONFIG = 'tracker:\n  default: local\n';

/** The command the gate reads this board through. */
const REPO_VIEW = ['repo', 'view', '--json', 'nameWithOwner,visibility'];

/** A complete bug line naming the filing package in its summary and this board in its reproduce. */
const BUG_LINE: LineFlags = Object.freeze({
  type: 'bug',
  module: 'loop',
  action: 'start',
  summary: `resume does not find the ${PACKAGE} branch`,
  reproduce: `rafa loop start --continue in a clone of ${OWN}`,
  cause: 'git:new-context',
  proposed: 'git:branch-not-found',
});

/** The bug line under `--upstream=rafa`. */
const UPSTREAM_LINE: LineFlags = Object.freeze({ ...BUG_LINE, upstream: 'rafa' });

/** The title {@link BUG_LINE} renders, its package name hidden. */
const HIDDEN_TITLE = `loop - start: resume does not find the ${PRIVATE_SIBLING} branch`;

/** True when `text` names this board or the filing package, ignoring case. */
function leaksName(text: string): boolean {
  return /components/i.test(text);
}

/** A fixture project holding `config`, the filing package's `package.json`, and an empty home. */
function plantProject(config: string): ProjectFound {
  const base = mkdtempSync(join(tempBase, 'case-'));
  const root = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), config);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: PACKAGE, version: VERSION })}\n`);
  return { found: true, root, home, project: scopeAt(root), user: scopeAt(home) };
}

/** A git on commit `2bdad97` with a clean tree, in no checkout of its own: the project root stands in. */
const cleanGit: GitRunner = (args) => {
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
    return { ok: false, stdout: '', stderr: 'fatal: not a git repository' };
  }
  return {
    ok: true,
    stdout: args[0] === 'rev-parse'
      ? '2bdad97\n'
      : '',
    stderr: '',
  };
};

/** How this board answers `gh repo view`: a repository and a visibility, `null` for none, or a failure. */
type OwnAnswer = { readonly repository: string; readonly visibility: string | null } | { readonly fails: string };

/** The `gh` seam a case runs over: every call recorded, and the upstream fake behind it. */
interface Boards {
  readonly gh: GhRunner;
  readonly calls: (readonly string[])[];
  readonly upstream: FakeGh;
}

/** What `gh repo view` answers for `own`. */
function repoView(own: OwnAnswer): GhResult {
  if ('fails' in own) return { ok: false, stdout: '', stderr: `${own.fails}\n` };
  const answer = own.visibility === null
    ? { nameWithOwner: own.repository }
    : { nameWithOwner: own.repository, visibility: own.visibility };
  return { ok: true, stdout: `${JSON.stringify(answer)}\n`, stderr: '' };
}

/** A `gh` answering this board as `own` and handing every other call to the fake holding `upstream`. */
function boardsOf(own: OwnAnswer = { repository: OWN, visibility: 'PRIVATE' }, upstream: string = UPSTREAM): Boards {
  const fake = createFakeGh({ repo: upstream });
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args, stdin) => {
    calls.push(args);
    return args[0] === 'repo' && args[1] === 'view'
      ? Promise.resolve(repoView(own))
      : fake.run(args, stdin);
  };
  return { gh, calls, upstream: fake };
}

/** What a run wrote: the `info` and `warn` lines, and each result. */
interface Written {
  readonly info: string[];
  readonly warn: string[];
  readonly results: unknown[];
}

/** A context over `project` with `flags`, in `mode`, writing into `written`. */
function contextOf(project: ProjectFound, flags: LineFlags, written: Written, mode: RafaContext['outputMode'] = 'text'): RafaContext {
  return Object.freeze({
    args: [],
    flags,
    outputMode: mode,
    verbosity: 2,
    output: sinkOutput({
      info: (line: string) => written.info.push(line),
      warn: (line: string) => written.warn.push(line),
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

/** Runs `issue create` with `flags` in `project` over `boards`, in `mode`. */
async function run(project: ProjectFound, flags: LineFlags, boards: Boards, mode: RafaContext['outputMode'] = 'text'): Promise<Outcome> {
  const written: Written = { info: [], warn: [], results: [] };
  const seams: IssueSeams = { gh: boards.gh, git: cleanGit, cwd: () => project.root };
  try {
    await createIssueCreateCommand(seams).run(contextOf(project, flags, written, mode));
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

/** Asserts every call past the gate named `--repo <upstream>` after its two words, and none named this board. */
function expectOnUpstream(boards: Boards, upstream: string = UPSTREAM): void {
  const sent = pastTheGate(boards);
  expect(sent.length).toBeGreaterThan(0);
  for (const call of sent) {
    expect(call.slice(2, 4)).toEqual(['--repo', upstream]);
    expect(call.some((arg) => arg.toLowerCase() === OWN)).toBe(false);
  }
}

describe('issue create --upstream refuses a type other than bug', () => {
  it('names the rule and sends no gh', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { title: 'Faster plan show', upstream: 'rafa' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue create --upstream=rafa: --type=code is not filed upstream: only a bug is, --type=bug with its fields. Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses a spec the same way, naming its type', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { title: 'A spec', type: 'spec', upstream: 'rafa' }, boards);
    expect(outcome.message).toContain('--type=spec is not filed upstream');
    expect(boards.calls).toEqual([]);
  });

  it('refuses the flag typed with no value, naming the usage', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { ...BUG_LINE, upstream: true }, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith('❌ --upstream needs a value: --upstream=<value>\nUsage: rafa issue create');
    expect(boards.calls).toEqual([]);
  });
});

describe('issue create --upstream refuses at the gate, before any tracker', () => {
  it('refuses a tool it does not know, sending no gh', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { ...BUG_LINE, upstream: 'bun' }, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue create --upstream=bun: --upstream names "bun", expected one of: rafa. Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses collaborate.rafa absent, sending no gh', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(NO_COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue create --upstream=rafa: collaborate.rafa is not set, so reporting upstream is off. Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([]);
  });

  it('refuses owners that differ, after the one read of this board and with nothing filed', async () => {
    const boards = boardsOf({ repository: 'someone-else/app', visibility: 'PUBLIC' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue create --upstream=rafa: collaborate.rafa names open-tomato/rafa (owner open-tomato), and this board is '
      + 'someone-else/app (owner someone-else). Reporting upstream is allowed only between repositories of one owner. '
      + 'Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([REPO_VIEW]);
    expect(boards.upstream.issueCount()).toBe(0);
  });

  it('refuses this board\'s owner unread, naming gh\'s reason, with nothing filed', async () => {
    const boards = boardsOf({ fails: 'no git remotes found' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect([outcome.exitCode, outcome.message]).toEqual([
      1,
      '❌ issue create --upstream=rafa: could not read this board\'s owner '
      + '(gh repo view --json nameWithOwner,visibility failed: no git remotes found). Nothing was filed.',
    ]);
    expect(boards.calls).toEqual([REPO_VIEW]);
  });

  it('refuses each of them under --dry-run too', async () => {
    const boards = boardsOf({ repository: 'someone-else/app', visibility: 'PUBLIC' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { ...UPSTREAM_LINE, 'dry-run': true }, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('Reporting upstream is allowed only between repositories of one owner.');
    expect(outcome.info).toEqual([]);
  });

  it('refuses a bug record that is not complete before the gate, sending no gh', async () => {
    const boards = boardsOf();
    const incomplete = Object.fromEntries(Object.entries(UPSTREAM_LINE).filter(([flag]) => flag !== 'reproduce'));
    const outcome = await run(plantProject(COLLABORATE_CONFIG), incomplete, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('the bug record is not complete:');
    expect(boards.calls).toEqual([]);
  });
});

describe('issue create --upstream with a key naming no repository', () => {
  it('fails at the filing step with the error gh gives, and files nothing', async () => {
    // The fake holds open-tomato/rafa, so a call naming the mistyped key's repository is refused as gh refuses it.
    const boards = boardsOf({ repository: OWN, visibility: 'PRIVATE' });
    const project = plantProject(COLLABORATE_CONFIG.replace(UPSTREAM, 'open-tomato/rafaa'));
    const outcome = await run(project, UPSTREAM_LINE, boards);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toStartWith('❌ Could not create the issue on open-tomato/rafaa on the github tracker: ');
    expect(outcome.message).toContain('--repo open-tomato/rafaa');
    expect(boards.upstream.issueCount()).toBe(0);
    expectOnUpstream(boards, 'open-tomato/rafaa');
  });
});

describe('issue create --upstream=rafa --dry-run', () => {
  it('prints the upstream target and the body it would file, with no private name, and files nothing', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { ...UPSTREAM_LINE, 'dry-run': true }, boards);

    expect([outcome.exitCode, outcome.message, outcome.warn]).toEqual([0, '', []]);
    expect(outcome.info.slice(0, 4)).toEqual([
      '--dry-run: nothing was filed.',
      `Upstream: ${UPSTREAM}`,
      `Title: ${HIDDEN_TITLE}`,
      'Type: bug · Module: loop · Priority: needs-triage · Cause: git:new-context',
    ]);
    const printed = outcome.info.join('\n');
    expect(printed).toContain(`## Versions\n\n\`\`\`\nrafa: ${RAFA_VERSION}\ncode: 2bdad97\npackage: ${PRIVATE_SIBLING}@${VERSION}\n\`\`\``);
    expect(printed).toContain(`rafa loop start --continue in a clone of ${PRIVATE_SIBLING}`);
    expect(leaksName(printed)).toBe(false);
    expect(boards.calls).toEqual([REPO_VIEW]);
    expect(boards.upstream.issueCount()).toBe(0);
  });

  it('gives the hidden draft and the upstream as the result in json mode', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { ...UPSTREAM_LINE, 'dry-run': true }, boards, 'json');
    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0] as IssueDryRun;
    expect(result).toMatchObject({ dryRun: true, upstream: UPSTREAM, draft: { title: HIDDEN_TITLE, type: 'bug', cause: 'git:new-context' } });
    expect(leaksName(result.draft.body)).toBe(false);
  });

  it('writes a config warning once, from the gate', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(`${COLLABORATE_CONFIG}nonsense: 1\n`), { ...UPSTREAM_LINE, 'dry-run': true }, boards);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.warn.filter((line) => line.includes('nonsense'))).toHaveLength(1);
  });

  it('prints the same line without --upstream as before: no Upstream line, no gh', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), { ...BUG_LINE, 'dry-run': true }, boards);
    expect(outcome.info[1]).toBe(`Title: loop - start: resume does not find the ${PACKAGE} branch`);
    expect(boards.calls).toEqual([]);
  });
});

describe('issue create --upstream=rafa, filed', () => {
  it('files a PRIVATE board\'s bug on the upstream, its names hidden, naming --repo <upstream> on every call', async () => {
    const boards = boardsOf({ repository: OWN, visibility: 'PRIVATE' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);

    expect([outcome.exitCode, outcome.message, outcome.warn]).toEqual([0, '', []]);
    expect(outcome.info).toEqual([`Created github issue 1 on ${UPSTREAM}.`, `URL: https://github.com/${UPSTREAM}/issues/1`]);
    const filed = boards.upstream.issue('1');
    expect(filed?.title).toBe(HIDDEN_TITLE);
    expect(filed?.body).toContain(`package: ${PRIVATE_SIBLING}@${VERSION}`);
    expect(leaksName(`${filed?.title ?? ''}\n${filed?.body ?? ''}`)).toBe(false);
    expect(filed?.labels).toEqual(expect.arrayContaining(['type:bug', 'module:loop', 'cause:git:new-context']));
    expect(boards.calls[0]).toEqual(REPO_VIEW);
    expectOnUpstream(boards);
  });

  it('adds the upstream issue to no project, board.project.number being this board\'s', async () => {
    const boards = boardsOf();
    await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect(boards.calls.filter((call) => call[0] === 'project' || call[0] === 'api')).toEqual([]);
  });

  it('hides the names of a board whose visibility gh did not answer', async () => {
    const boards = boardsOf({ repository: OWN, visibility: null });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect(outcome.exitCode).toBe(0);
    const filed = boards.upstream.issue('1');
    expect(leaksName(`${filed?.title ?? ''}\n${filed?.body ?? ''}`)).toBe(false);
  });

  it('passes owners differing only in case', async () => {
    const boards = boardsOf({ repository: 'Open-Tomato/components', visibility: 'PRIVATE' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect(outcome.exitCode).toBe(0);
    expect(leaksName(boards.upstream.issue('1')?.body ?? '')).toBe(false);
    expectOnUpstream(boards);
  });

  it('keeps a PUBLIC board\'s names: the control that the leak check reads the filed text', async () => {
    const boards = boardsOf({ repository: OWN, visibility: 'PUBLIC' });
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards);
    expect(outcome.exitCode).toBe(0);
    const filed = boards.upstream.issue('1');
    expect(filed?.title).toBe(`loop - start: resume does not find the ${PACKAGE} branch`);
    expect(filed?.body).toContain(`package: ${PACKAGE}@${VERSION}`);
    expect(leaksName(filed?.body ?? '')).toBe(true);
  });

  it('gives the github tracker, the ref and the upstream as the result in json mode', async () => {
    const boards = boardsOf();
    const outcome = await run(plantProject(COLLABORATE_CONFIG), UPSTREAM_LINE, boards, 'json');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0] as IssueCreateResult).toMatchObject({
      tracker: { kind: 'github', degraded: false, fallbackReason: null },
      ref: { kind: 'github', externalId: '1' },
      upstream: UPSTREAM,
    });
  });
});

describe('what the upstream path renders and reads', () => {
  it('names the upstream only when given', () => {
    const ref = { opt: 0, kind: 'github', externalId: '4', url: null } as const;
    expect(renderCreated(ref)).toEqual(['Created github issue 4.']);
    expect(renderCreated(ref, UPSTREAM)).toEqual([`Created github issue 4 on ${UPSTREAM}.`]);
    const draft = {
      opt: 0, title: 'T', body: '', type: 'bug', module: 'loop', priority: null, project: null, blockedBy: [],
    } as const;
    expect(renderDryRun(draft)[1]).toBe('Title: T');
    expect(renderDryRun(draft, UPSTREAM)[1]).toBe(`Upstream: ${UPSTREAM}`);
  });

  it('hides a scoped package by its whole name and the part after its scope', () => {
    expect(packageNames(null)).toEqual([]);
    expect(packageNames({ name: PACKAGE })).toEqual([PACKAGE]);
    expect(packageNames({ name: '@open-tomato/components' })).toEqual(['@open-tomato/components', 'components']);
    expect(packageNames({ name: '@odd' })).toEqual(['@odd']);
  });
});

/**
 * Tests for `packages/rafa-board/src/commands/issue/upstream.ts`: the
 * `--upstream` gate's four refusals, the case-only owner difference it
 * passes, and the `--repo` the upstream runner puts on every call.
 *
 * Each gate case runs over a fixture project of its own under this
 * file's temporary directory, its `.rafa/config.yaml` planted by the
 * case and its home empty, so the config read is the one planted. This
 * board's owner is read through a planted `gh` answering
 * `gh repo view --json nameWithOwner,visibility` alone and recording
 * every call, so no case runs `gh`. The recorded calls are the control
 * that a refusal sent nothing it should not have.
 *
 * The runner cases wrap the recorded fake (`adapters/tracker/github-fake.ts`),
 * which refuses a `--repo` naming another repository than its own: a
 * fake holding the upstream takes the wrapped calls, and a fake holding
 * this board refuses them, so a call falling through to this board
 * would fail a case.
 *
 * Negative cases come first.
 */
import type { UpstreamContext, UpstreamRequest } from './upstream.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { scopeAt } from '@open-tomato/rafa/core/config';
import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';

import { resolveUpstream, UPSTREAM_FLAG, UPSTREAM_TOOLS, upstreamGhRunner } from './upstream.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-upstream-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The upstream every config here names. */
const UPSTREAM = 'open-tomato/rafa';

/** A config naming {@link UPSTREAM} under `collaborate.rafa`. */
const COLLABORATE_CONFIG = `collaborate:\n  rafa: ${UPSTREAM}\n`;

/** A config holding no `collaborate` section. */
const NO_COLLABORATE_CONFIG = 'tracker:\n  default: local\n';

/** The command the gate reads this board through. */
const REPO_VIEW = ['repo', 'view', '--json', 'nameWithOwner,visibility'];

/** A fixture project holding `config` as its `.rafa/config.yaml`, beside an empty home. */
function plantProject(config: string): ProjectFound {
  const base = mkdtempSync(join(tempBase, 'case-'));
  const root = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), config);
  return { found: true, root, home, project: scopeAt(root), user: scopeAt(home) };
}

/** A context over `project`, recording every warning into `warnings`. */
function contextOf(project: ProjectFound, warnings: string[] = []): UpstreamContext {
  return {
    project,
    output: {
      warn: (message) => {
        warnings.push(message);
      },
    },
  };
}

/** A `gh` answering `result` to every call, recording each call into `calls`. */
function plantedGh(calls: (readonly string[])[], result: GhResult): GhRunner {
  return (args) => {
    calls.push(args);
    return Promise.resolve(result);
  };
}

/** A `gh` answering this board as `repository`, with `visibility`. */
function boardGh(calls: (readonly string[])[], repository: string, visibility = 'PUBLIC'): GhRunner {
  return plantedGh(calls, { ok: true, stdout: `${JSON.stringify({ nameWithOwner: repository, visibility })}\n`, stderr: '' });
}

/** What `run` rejected with, as its exit code and message for a `CommandExit`, or undefined when it resolved. */
async function exitOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

/** A refusal with exit code 1 and `line` after the subject's mark. */
function refusal(line: string): { exitCode: number; message: string } {
  return { exitCode: 1, message: `❌ ${line}` };
}

/** The gate asked for `action` with `--upstream=rafa`. */
function rafaFor(action: UpstreamRequest['action']): UpstreamRequest {
  return { action, tool: 'rafa' };
}

describe('the flag and its tools', () => {
  it('is spelled upstream, and accepts rafa alone', () => {
    expect(UPSTREAM_FLAG).toBe('upstream');
    expect(UPSTREAM_TOOLS).toEqual(['rafa']);
  });
});

describe('resolveUpstream refuses a tool it does not know', () => {
  it('names the accepted value, reading no config and sending no gh', async () => {
    const calls: (readonly string[])[] = [];
    // A config the loader refuses: reading it would answer another refusal.
    const project = plantProject('collaborate: [\n');
    const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh: boardGh(calls, UPSTREAM) }, { action: 'create', tool: 'bun' }));
    expect(exit).toEqual(refusal('issue create --upstream=bun: --upstream names "bun", expected one of: rafa. Nothing was filed.'));
    expect(calls).toEqual([]);
  });

  it('says Nothing was read. for list', async () => {
    const project = plantProject(COLLABORATE_CONFIG);
    const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh: boardGh([], UPSTREAM) }, { action: 'list', tool: 'Rafa' }));
    expect(exit).toEqual(refusal('issue list --upstream=Rafa: --upstream names "Rafa", expected one of: rafa. Nothing was read.'));
  });
});

describe('resolveUpstream refuses collaborate.rafa absent', () => {
  for (const [action, tail] of [['create', 'filed'], ['comment', 'filed'], ['list', 'read']] as const) {
    it(`for issue ${action}, sending no gh`, async () => {
      const calls: (readonly string[])[] = [];
      const project = plantProject(NO_COLLABORATE_CONFIG);
      const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh: boardGh(calls, UPSTREAM) }, rafaFor(action)));
      expect(exit).toEqual(refusal(
        `issue ${action} --upstream=rafa: collaborate.rafa is not set, so reporting upstream is off. Nothing was ${tail}.`,
      ));
      expect(calls).toEqual([]);
    });
  }
});

describe('resolveUpstream refuses owners that differ', () => {
  it('names both repositories and both owners, after the one read of this board', async () => {
    const calls: (readonly string[])[] = [];
    const project = plantProject(COLLABORATE_CONFIG);
    const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh: boardGh(calls, 'someone-else/app') }, rafaFor('comment')));
    expect(exit).toEqual(refusal(
      'issue comment --upstream=rafa: collaborate.rafa names open-tomato/rafa (owner open-tomato), and this board is '
      + 'someone-else/app (owner someone-else). Reporting upstream is allowed only between repositories of one owner. '
      + 'Nothing was filed.',
    ));
    expect(calls).toEqual([REPO_VIEW]);
  });

  it('refuses an owner that only begins the same', async () => {
    const project = plantProject(COLLABORATE_CONFIG);
    const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh: boardGh([], 'open-tomato-fork/rafa') }, rafaFor('list')));
    expect(exit).toEqual(refusal(
      'issue list --upstream=rafa: collaborate.rafa names open-tomato/rafa (owner open-tomato), and this board is '
      + 'open-tomato-fork/rafa (owner open-tomato-fork). Reporting upstream is allowed only between repositories of one owner. '
      + 'Nothing was read.',
    ));
  });
});

describe('resolveUpstream refuses this board\'s owner unread', () => {
  it('names gh\'s reason when the read fails', async () => {
    const calls: (readonly string[])[] = [];
    const project = plantProject(COLLABORATE_CONFIG);
    const gh = plantedGh(calls, { ok: false, stdout: '', stderr: 'no git remotes found\n' });
    const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh }, rafaFor('create')));
    expect(exit).toEqual(refusal(
      'issue create --upstream=rafa: could not read this board\'s owner '
      + '(gh repo view --json nameWithOwner,visibility failed: no git remotes found). Nothing was filed.',
    ));
    expect(calls).toEqual([REPO_VIEW]);
  });

  it('names the error when the runner itself throws, rather than letting it escape', async () => {
    const project = plantProject(COLLABORATE_CONFIG);
    const gh: GhRunner = () => Promise.reject(new Error('spawn gh ENOENT'));
    const exit = await exitOf(() => resolveUpstream(contextOf(project), { gh }, rafaFor('list')));
    expect(exit).toEqual(refusal('issue list --upstream=rafa: could not read this board\'s owner (spawn gh ENOENT). Nothing was read.'));
  });
});

describe('resolveUpstream passes one owner', () => {
  it('passes owners differing only in case, answering both boards', async () => {
    const calls: (readonly string[])[] = [];
    const project = plantProject(COLLABORATE_CONFIG);
    const target = await resolveUpstream(contextOf(project), { gh: boardGh(calls, 'Open-Tomato/app') }, rafaFor('create'));
    expect(target).toEqual({ upstream: UPSTREAM, own: 'Open-Tomato/app', ownIsPublic: true });
    expect(calls).toEqual([REPO_VIEW]);
  });

  it('answers ownIsPublic false for every visibility but PUBLIC', async () => {
    const project = plantProject(COLLABORATE_CONFIG);
    for (const visibility of ['PRIVATE', 'INTERNAL', 'SECRET']) {
      const target = await resolveUpstream(contextOf(project), { gh: boardGh([], 'open-tomato/app', visibility) }, rafaFor('comment'));
      expect(target.ownIsPublic).toBe(false);
    }
  });

  it('writes a config warning through the context\'s output', async () => {
    const warnings: string[] = [];
    const project = plantProject(`${COLLABORATE_CONFIG}nonsense: 1\n`);
    await resolveUpstream(contextOf(project, warnings), { gh: boardGh([], 'open-tomato/app') }, rafaFor('list'));
    expect(warnings.join('\n')).toContain('nonsense');
  });
});

describe('upstreamGhRunner refuses what is not an upstream call', () => {
  for (const args of [['auth', 'status'], ['repo', 'view', '--json', 'nameWithOwner'], ['api', 'repos/{owner}/{repo}/issues/1', '-X', 'PATCH'], []]) {
    it(`refuses gh ${args.join(' ') || '(nothing)'}, sending nothing`, async () => {
      const calls: (readonly string[])[] = [];
      const run = upstreamGhRunner(plantedGh(calls, { ok: true, stdout: '', stderr: '' }), UPSTREAM);
      const result = await run(args);
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain(`the runner reaching ${UPSTREAM} refuses gh`);
      expect(calls).toEqual([]);
    });
  }

  it('refuses an issue call naming another repository, in each spelling', async () => {
    const calls: (readonly string[])[] = [];
    const run = upstreamGhRunner(plantedGh(calls, { ok: true, stdout: '', stderr: '' }), UPSTREAM);
    for (const repo of [['--repo', 'open-tomato/app'], ['-R', 'open-tomato/app'], ['--repo=open-tomato/app']]) {
      const result = await run(['issue', 'view', '3', ...repo, '--json', 'title']);
      expect(result).toMatchObject({ ok: false, stderr: expect.stringContaining('it names --repo open-tomato/app') });
    }
    expect(calls).toEqual([]);
  });
});

describe('upstreamGhRunner puts --repo <upstream> on every issue and label call', () => {
  it('adds it after the command\'s two words, handing stdin on', async () => {
    const calls: (readonly string[])[] = [];
    const stdins: (string | undefined)[] = [];
    const run = upstreamGhRunner((args, stdin) => {
      calls.push(args);
      stdins.push(stdin);
      return Promise.resolve({ ok: true, stdout: '', stderr: '' });
    }, UPSTREAM);
    await run(['issue', 'edit', '4', '--body-file', '-'], 'the body');
    await run(['label', 'create', 'bug', '--force']);
    expect(calls).toEqual([
      ['issue', 'edit', '--repo', UPSTREAM, '4', '--body-file', '-'],
      ['label', 'create', '--repo', UPSTREAM, 'bug', '--force'],
    ]);
    expect(stdins).toEqual(['the body', undefined]);
  });

  it('hands on a call already naming the upstream, ignoring case, as it is', async () => {
    const calls: (readonly string[])[] = [];
    const run = upstreamGhRunner(plantedGh(calls, { ok: true, stdout: '', stderr: '' }), UPSTREAM);
    await run(['issue', 'comment', '7', '--repo', 'Open-Tomato/rafa', '--body', 'x']);
    expect(calls).toEqual([['issue', 'comment', '7', '--repo', 'Open-Tomato/rafa', '--body', 'x']]);
  });

  it('files through the github tracker on the upstream, and never on this board', async () => {
    // The control: this board's fake refuses every wrapped call, so a call reaching it fails.
    const own = createFakeGh({ repo: 'open-tomato/app' });
    const refused = createGithubTracker({ gh: upstreamGhRunner(own.run, UPSTREAM) });
    await expect(refused.create({
      opt: 0, title: 'A gap', body: 'Seen.\n', type: 'bug', module: 'cli', priority: null, project: null, blockedBy: [],
    })).rejects.toThrow('fake gh: models one repository, open-tomato/app, and was handed --repo open-tomato/rafa');
    expect(own.issueCount()).toBe(0);

    const upstream = createFakeGh({ repo: UPSTREAM });
    const tracker = createGithubTracker({ gh: upstreamGhRunner(upstream.run, UPSTREAM) });
    const ref = await tracker.create({
      opt: 0, title: 'A gap', body: 'Seen.\n', type: 'bug', module: 'cli', priority: null, project: null, blockedBy: [],
    });
    expect(upstream.issue(ref.externalId)?.title).toBe('A gap');
    const sent = upstream.calls();
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) expect(call.slice(2, 4)).toEqual(['--repo', UPSTREAM]);
  });
});

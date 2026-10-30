/**
 * Tests for `openNextSources` (`./sources.ts`) opened with and without
 * `roadmap`, as `rafa next --roadmap` and plain `rafa next` open them:
 * the `roadmap` key and the owner gate it holds, and the board built
 * with `roadmap` so its walk carries the hop reading. Kept apart from
 * `./sources.test.ts`, which is past the 800-line cap.
 *
 * The project is planted under a temporary root, `gh` is a stand-in
 * answering the roadmap and its one line by argv, git holds no branch,
 * and the provider is the pull request double. Nothing here spawns `gh`
 * or `git`.
 *
 * ## The controls
 *
 * Every assertion under the option is read beside the same project
 * opened without it: the keys are asserted with `Object.keys`, since
 * `toEqual` would pass a key set to undefined, and the walk without the
 * option must carry no `hop` key and send the same `gh` commands it
 * sent before the flag existed, which the recorded calls pin.
 */
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';
import type { GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { resolveScope } from '@open-tomato/rafa/project/scope';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterAll, describe, expect, it } from 'bun:test';

import { openNextSources } from './sources.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-sources-roadmap-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue `roadmap.issue` names, and its one line. */
const ROADMAP = 1;
const LINE = 5;

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A `gh` answering the roadmap and its line, recording each call's first three words. */
function fakeGh(): { readonly gh: GhRunner; readonly calls: string[] } {
  const calls: string[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args.slice(0, 3).join(' '));
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue list' || route === 'pr list') return wrote('[]');
    if (route === 'issue view') {
      const number = Number(args[2]);
      return wrote(JSON.stringify({
        number,
        title: `Issue ${String(number)}`,
        body: number === ROADMAP
          ? `- [ ] #${String(LINE)} the line\n`
          : '',
        state: 'OPEN',
        labels: [],
        author: { login: 'maintainer' },
      }));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}` });
  };
  return { gh, calls };
}

/** A git holding no branch. */
const git: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** How many projects a case has been handed. */
let projects = 0;

/** A context over a project of its own whose config names the roadmap. */
function context(): RafaContext {
  projects += 1;
  const root = join(tempBase, `project-${String(projects)}`);
  const home = join(tempBase, `home-${String(projects)}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `roadmap:\n  issue: ${String(ROADMAP)}\n`, 'utf8');
  const scope = resolveScope(root, { home });
  if (!scope.found) throw new Error(`the planted project did not resolve: ${scope.hint}`);
  return Object.freeze({
    args: [],
    flags: {},
    outputMode: 'text',
    verbosity: 2,
    output: sinkOutput({}),
    signal: new AbortController().signal,
    env: {},
    argv: [],
    registry: createCommandRegistry({ subjects: [], commands: [] }),
    project: scope,
  });
}

/** The sources opened over a fresh project and stand-in, `roadmap` as given. */
async function opened(roadmap: boolean | null): Promise<{ readonly sources: Awaited<ReturnType<typeof openNextSources>>; readonly calls: string[] }> {
  const { gh, calls } = fakeGh();
  const seams = {
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
    openGh: () => gh,
    openGit: () => git,
    pullRequests: () => createPullRequestsDouble({}).pulls,
  };
  const sources = roadmap === null
    ? await openNextSources(context(), seams)
    : await openNextSources(context(), seams, { roadmap });
  return { sources, calls };
}

describe('the sources rafa next --roadmap opens', () => {
  it('carry the roadmap key with the owner gate, on the sources and on every answer', async () => {
    const { sources } = await opened(true);

    expect(Object.keys(sources)).toContain('roadmap');
    expect(Object.keys(sources.answer())).toContain('roadmap');
    expect(typeof sources.roadmap?.ownerApproval).toBe('function');
  });

  it('leave the key out, not undefined, without the option or with it false', async () => {
    for (const roadmap of [null, false]) {
      const { sources } = await opened(roadmap);

      expect(Object.keys(sources)).not.toContain('roadmap');
      expect(Object.keys(sources.answer())).not.toContain('roadmap');
    }
  });

  it('build the board with roadmap, so the walk carries the hop reading', async () => {
    const reading = await (await opened(true)).sources.board.next();

    expect(Object.keys(reading)).toContain('hop');
    expect(reading.line?.issue).toBe(LINE);
    expect(reading.hop?.record).toBeNull();
  });

  it('build it without, the walk carrying no hop key and sending the commands it always sent', async () => {
    const { sources, calls } = await opened(null);

    const reading = await sources.board.next();

    expect(Object.keys(reading)).not.toContain('hop');
    expect(reading.line?.issue).toBe(LINE);
    expect(calls).toEqual(['issue list --label', 'issue view 1', 'issue view 5', 'pr list --state']);
  });
});

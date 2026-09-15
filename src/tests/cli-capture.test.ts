/**
 * Tests for `./cli-capture.js`, the helper the command suites run a line
 * through: an in-process dispatch runs inside a project of its own, and a
 * scratch repository is a project unless a case asks for none.
 *
 * The in-process case reads the project the dispatcher hands a command,
 * where reading only that the command ran would prove nothing on a
 * machine holding a `.rafa/config.yaml` in a directory above the
 * checkout: a dispatch from the suite's working directory finds that
 * project. Measured on 2026-09-15 on such a machine, `dispatchCaptured`
 * passing no working directory and no home left all 281 cases of the
 * eleven suites dispatching commands green. So the case holds the root
 * and the home under the temporary directory, and the root gone once the
 * dispatch answers.
 *
 * Driven against this file the same day, each restored sha256-identical:
 * that mutation reddened the in-process case alone, and the scratch
 * repository planting no config reddened the planting case alone.
 */
import type { RafaCommand } from '../cli/command.js';
import type { ProjectFound } from '../project/scope.js';

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { configFilePath } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import { dispatchCaptured, dispatchInProject, plantProject, plantScratchRepo } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cli-capture-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A command recording the project its context carries into `seen`. */
function recorder(seen: (ProjectFound | null)[]): RafaCommand {
  return {
    name: 'loop start',
    description: 'Records the project it runs in.',
    subject: 'loop',
    action: 'start',
    summary: 'records its project',
    args: [],
    flags: [],
    examples: [{ cmd: 'rafa loop start', note: 'records its project' }],
    outputs: ['text'],
    run: async (context) => {
      seen.push(context.project);
    },
  };
}

describe('dispatchCaptured', () => {
  it('dispatches inside a project of its own under the temporary directory, removed once it answers', async () => {
    const seen: (ProjectFound | null)[] = [];
    const temporary = `${realpathSync(tmpdir())}/`;

    const run = await dispatchCaptured(['loop', 'start'], [{ name: 'loop', summary: 'the loop' }], [recorder(seen)]);

    const project = seen[0] ?? null;
    expect(run.exitCode).toBe(0);
    expect([project?.root.startsWith(temporary), project?.home.startsWith(temporary)]).toEqual([true, true]);
    expect(existsSync(project?.root ?? tempBase)).toBe(false);
  });
});

describe('plantProject and dispatchInProject', () => {
  it('dispatch from the root of a project the case planted, leaving the project and its config in place', async () => {
    const seen: (ProjectFound | null)[] = [];
    const planted = plantProject(mkdtempSync(join(tempBase, 'planted-')), 'store: ndjson\n');

    const run = await dispatchInProject(['loop', 'start'], [{ name: 'loop', summary: 'the loop' }], [recorder(seen)], planted);

    expect(run.exitCode).toBe(0);
    expect([seen[0]?.root, seen[0]?.home]).toEqual([planted.root, planted.home]);
    expect(planted.root.startsWith(`${tempBase}/`)).toBe(true);
    expect([readFileSync(configFilePath(planted.root), 'utf8'), existsSync(planted.home)]).toEqual(['store: ndjson\n', true]);
  });
});

describe('plantScratchRepo', () => {
  it('plants the config rafa init writes, and none when a case asks for no project', () => {
    const project = plantScratchRepo(tempBase);
    const bare = plantScratchRepo(tempBase, { project: false });

    expect(readFileSync(configFilePath(project.repo), 'utf8')).toBe(projectConfigText());
    expect(existsSync(configFilePath(bare.repo))).toBe(false);
  });
});

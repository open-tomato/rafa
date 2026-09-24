/**
 * Tests for `rafa agent vendor` (`vendor.ts`): the header written into a
 * copy, the copy itself, the refusals, and that a vendored definition is
 * one the roster then resolves.
 *
 * Every case plants its `~/.claude/agents` under the home of a temporary
 * project of its own, never under this machine's, and the first case
 * asserts both roots resolve under this file's own directory: in the
 * loop the home is the real one, and a case that lost it would copy out
 * of a directory holding 60 definitions and write into a project that is
 * not a test's.
 *
 * ## What each reading is measured against
 *
 * The point of the command is the roster, so the copy is read back
 * through `resolveAgentRoster` under the config defaults, whose
 * `project,local` leaves the user tier out of reach, with a rafa tier of
 * the case's own that holds nothing: the same roster over the same roots
 * before the copy resolves the name under no tier, and after it resolves
 * it under `project`. That control is what says the
 * copy landed somewhere a session reaches, rather than merely somewhere.
 *
 * Every refusal sits beside a line differing in one thing only — the
 * name asked for, `--force`, or where `--force` was typed — and each
 * asserts the destination directory afterwards, so a refusal that copied
 * something anyway is red.
 *
 * The clock is a seam: the header carries a day, and the registered
 * command stamps the real one.
 */
import type { PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { resolveAgentRoster } from '../../agents/roster.js';
import { CONFIG_DEFAULTS } from '../../config.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createAgentVendorCommand, sourceHeader, withSourceHeader } from './vendor.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-agent-vendor-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'agent', summary: 'agents' }];

/** The day every dispatched case stamps its headers with. */
const DAY = new Date('2026-09-18T09:30:00.000Z');

/** A definition's text: its frontmatter, carrying `name`, and a body. */
function definitionText(name: string): string {
  return `---\nname: ${name}\ndescription: Does ${name} things.\n---\n\nThe ${name} body.\n`;
}

/** Writes `<root>/.claude/agents/<file>` with `text`, and answers its path. */
function plantDefinition(root: string, file: string, text: string): string {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, text, 'utf8');
  return path;
}

/** A fresh project of this file's own, its home holding a definition per name. */
function plantScope(names: readonly string[] = ['tdd-guide'], config?: string): PlantedProject {
  const scope = mkdtempSync(join(tempBase, 'scope-'));
  const project = config === undefined
    ? plantProject(scope)
    : plantProject(scope, config);
  for (const name of names) plantDefinition(project.home, `${name}.md`, definitionText(name));
  return project;
}

/** `<root>/.claude/agents`. */
function agentDir(root: string): string {
  return join(root, '.claude', 'agents');
}

/** The file names under `<root>/.claude/agents`, sorted, or none when it is absent. */
function agentFiles(root: string): readonly string[] {
  const dir = agentDir(root);
  return existsSync(dir)
    ? readdirSync(dir).sort((a, b) => a.localeCompare(b))
    : [];
}

/** Dispatches `agent vendor` in `project` with `words` after the action. */
async function vendorIn(
  project: PlantedProject,
  words: readonly string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(['agent', 'vendor', ...words], SUBJECTS, [createAgentVendorCommand(() => DAY)], project);
}

/** Where the roster resolves `name` under the config defaults and an empty rafa tier, or null. */
function scopeOf(project: PlantedProject, name: string): string | null {
  const roots = { repoRoot: project.root, home: project.home, entry: join(project.root, 'no-rafa-tier', 'cli.js') };
  const roster = resolveAgentRoster(roots, CONFIG_DEFAULTS);
  return roster.agents.find((agent) => agent.name === name)?.scope ?? null;
}

describe('the source header a copy carries', () => {
  it('names the file and the day', () => {
    expect(sourceHeader('/home/x/.claude/agents/tdd-guide.md', DAY))
      .toBe('<!-- vendored by rafa from /home/x/.claude/agents/tdd-guide.md on 2026-09-18 -->');
  });

  it('writes the header after the closing fence, never ahead of the frontmatter', () => {
    const written = withSourceHeader(definitionText('tdd-guide'), '/from.md', DAY);
    const lines = written.split('\n');

    expect(lines[0]).toBe('---');
    expect(lines[3]).toBe('---');
    expect(lines[4]).toBe(sourceHeader('/from.md', DAY));
    expect(written.startsWith('---\n')).toBe(true);
  });

  it('writes the header as the first line of a file that opens with no frontmatter', () => {
    const written = withSourceHeader('Just a body.\n', '/from.md', DAY);

    expect(written.split('\n')[0]).toBe(sourceHeader('/from.md', DAY));
  });
});

describe('what rafa agent vendor copies', () => {
  it('plants its home and its project under this file\'s own directory', () => {
    const project = plantScope();

    expect(project.root.startsWith(tempBase)).toBe(true);
    expect(project.home.startsWith(tempBase)).toBe(true);
    expect(agentFiles(project.home)).toEqual(['tdd-guide.md']);
  });

  it('copies the definition into the project, where the default sources then resolve it', async () => {
    const project = plantScope();
    const before = scopeOf(project, 'tdd-guide');

    const run = await vendorIn(project, ['tdd-guide']);

    expect(before).toBeNull();
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(run.stdout).toBe(`✅ tdd-guide: ${join(agentDir(project.root), 'tdd-guide.md')}\n`);
    expect(scopeOf(project, 'tdd-guide')).toBe('project');
  });

  it('writes the copy as the source plus one header line naming the source', async () => {
    const project = plantScope();
    const from = join(agentDir(project.home), 'tdd-guide.md');

    await vendorIn(project, ['tdd-guide']);
    const copy = readFileSync(join(agentDir(project.root), 'tdd-guide.md'), 'utf8');

    expect(copy).toBe(withSourceHeader(definitionText('tdd-guide'), from, DAY));
    expect(copy.split('\n').filter((line) => line.startsWith('<!-- vendored by rafa'))).toEqual([sourceHeader(from, DAY)]);
    expect(readFileSync(from, 'utf8')).toBe(definitionText('tdd-guide'));
  });

  it('keeps the source file name for a definition whose name is not its stem, and resolves it by that name', async () => {
    const project = plantScope([]);
    plantDefinition(project.home, 'weird-file.md', definitionText('renamed-agent'));

    const run = await vendorIn(project, ['renamed-agent']);

    expect(run.exitCode).toBe(0);
    expect(agentFiles(project.root)).toEqual(['weird-file.md']);
    expect(scopeOf(project, 'renamed-agent')).toBe('project');
    expect(scopeOf(project, 'weird-file')).toBeNull();
  });

  it('copies every name a line gives, in order', async () => {
    const project = plantScope(['tdd-guide', 'code-reviewer']);

    const run = await vendorIn(project, ['tdd-guide', 'code-reviewer']);

    expect(run.exitCode).toBe(0);
    const opened = run.stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split(':')[0]);

    expect(opened).toEqual(['✅ tdd-guide', '✅ code-reviewer']);
    expect(agentFiles(project.root)).toEqual(['code-reviewer.md', 'tdd-guide.md']);
  });

  it('gives the copies as the data of the one result event in json mode', async () => {
    const project = plantScope();

    const run = await vendorIn(project, ['tdd-guide', '--output=json']);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: {
        root: project.root,
        dir: agentDir(project.root),
        vendored: [
          {
            name: 'tdd-guide',
            from: join(agentDir(project.home), 'tdd-guide.md'),
            to: join(agentDir(project.root), 'tdd-guide.md'),
            replaced: false,
          },
        ],
      },
    });
  });
});

describe('how rafa agent vendor refuses', () => {
  it('refuses a name no home definition carries, and writes nothing, where the name it carries is copied', async () => {
    const missing = plantScope();
    const carried = plantScope();

    const refused = await vendorIn(missing, ['no-such-agent']);
    const copied = await vendorIn(carried, ['tdd-guide']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('agent "no-such-agent": no definition under');
    expect(refused.stderr).toContain('Nothing was written.');
    expect(agentFiles(missing.root)).toEqual([]);
    expect([copied.exitCode, agentFiles(carried.root)]).toEqual([0, ['tdd-guide.md']]);
  });

  it('copies none of the names when one of them cannot be vendored, where both good names are copied', async () => {
    const oneBad = plantScope(['tdd-guide']);
    const bothGood = plantScope(['tdd-guide', 'code-reviewer']);

    const refused = await vendorIn(oneBad, ['tdd-guide', 'no-such-agent']);
    const copied = await vendorIn(bothGood, ['tdd-guide', 'code-reviewer']);

    expect(refused.exitCode).toBe(1);
    expect(agentFiles(oneBad.root)).toEqual([]);
    expect([copied.exitCode, agentFiles(bothGood.root)]).toEqual([0, ['code-reviewer.md', 'tdd-guide.md']]);
  });

  it('refuses a destination already there, and replaces it whole under --force', async () => {
    const project = plantScope();
    const to = join(agentDir(project.root), 'tdd-guide.md');
    plantDefinition(project.root, 'tdd-guide.md', '---\nname: tdd-guide\n---\nThe project body.\n');

    const refused = await vendorIn(project, ['tdd-guide']);
    const held = readFileSync(to, 'utf8');
    const forced = await vendorIn(project, ['tdd-guide', '--force']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`agent "tdd-guide": ${to} is already there; pass --force to replace it`);
    expect(held).toBe('---\nname: tdd-guide\n---\nThe project body.\n');
    expect(forced.exitCode).toBe(0);
    expect(forced.stdout).toBe(`✅ tdd-guide: ${to} (replaced)\n`);
    expect(readFileSync(to, 'utf8')).toContain('The tdd-guide body.');
  });

  it('refuses a line naming no agent', async () => {
    const project = plantScope();

    const run = await vendorIn(project, []);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Expected at least one agent name, got none');
    expect(agentFiles(project.root)).toEqual([]);
  });

  it('refuses --force typed ahead of the names, which reads a name as its value', async () => {
    const ahead = plantScope();
    const after = plantScope();

    const refused = await vendorIn(ahead, ['--force', 'tdd-guide']);
    const accepted = await vendorIn(after, ['tdd-guide', '--force']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('--force takes no value, and read "tdd-guide" as one; type it after the names');
    expect(agentFiles(ahead.root)).toEqual([]);
    expect([accepted.exitCode, agentFiles(after.root)]).toEqual([0, ['tdd-guide.md']]);
  });
});

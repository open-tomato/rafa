/**
 * The bundled tier end to end over a scratch project: the rafa tier is the
 * real `src/bundled/` (the entry seam is `src/rafa.ts`, which it sits
 * beside), the project and the home are planted under a temporary directory.
 *
 * `rafa skill list` shows every bundled skill as `source: rafa` and
 * `visibleToLoop: true`; the control is a project skill that is not
 * bundled, listed as `project`. `rafa doctor` lists two collisions at once,
 * a project skill and a project agent that each differ from their bundled
 * namesake; the control is the same project without them, which lists none.
 */
import type { InventoryRecord } from '../inventory/record.js';

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';
import { SERVE_CLI_VERSION } from '../tiers/delivery.js';

import { createDoctorCommand } from './doctor.js';
import { createSkillListCommand } from './skill/list.js';

const ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));
const BUNDLED_SKILLS = join(dirname(ENTRY), 'bundled', 'skills');

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-tiers-scratch-')));
let count = 0;

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** A scratch project and empty home, with `extra` files planted under the project. */
function scratch(extra: Readonly<Record<string, string>> = {}) {
  count += 1;
  const scope = join(base, `case-${String(count)}`);
  mkdirSync(scope);
  const project = plantProject(scope);
  for (const [path, text] of Object.entries(extra)) write(join(project.root, path), text);
  return project;
}

const SUBJECTS = [{ name: 'skill', summary: 'list every skill' }];

describe('the bundled tier in a scratch project', () => {
  it('rafa skill list shows every bundled skill as source rafa, visible to the loop', async () => {
    const project = scratch({
      '.claude/skills/local-only/SKILL.md': '---\nname: local-only\ndescription: Held by the project\n---\nbody\n',
    });
    const bundled = readdirSync(BUNDLED_SKILLS).sort();

    const run = await dispatchInProject(
      ['skill', 'list', '--output=json'],
      SUBJECTS,
      [createSkillListCommand({ entry: () => ENTRY, modules: {} })],
      project,
      { PATH: '' },
    );

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result') as unknown as { data: { skills: InventoryRecord[] } };
    const rafa = result.data.skills.filter((row) => row.source === 'rafa');
    expect(rafa.map((row) => row.name).sort()).toEqual(bundled);
    expect(bundled.length).toBeGreaterThan(0);
    for (const row of rafa) expect(row.visibleToLoop).toBe(true);
    const control = result.data.skills.find((row) => row.name === 'local-only');
    expect(control?.source).toBe('project');
  });

  it('rafa doctor lists a skill collision and an agent collision at once, and none without them', async () => {
    const colliding = scratch({
      '.claude/skills/documentation/SKILL.md': '---\nname: documentation\ndescription: edited\n---\nedited body\n',
      '.claude/agents/tdd-guide.md': '---\nname: tdd-guide\ndescription: edited\n---\nedited body\n',
    });
    const clean = scratch();

    const doctor = async (project: ReturnType<typeof scratch>) => {
      const command = createDoctorCommand({
        checks: { now: () => 0 },
        readClaudeVersion: () => Promise.resolve(SERVE_CLI_VERSION),
        inventory: { entry: () => ENTRY },
      });
      const run = await dispatchInProject(
        ['doctor', '--output=json'],
        [],
        [command],
        project,
        { PATH: join(project.home, '.rafa', 'bin') },
      );
      const result = eventsOf(run.stdout).find((event) => event.type === 'result') as unknown as {
        data: { tiers: { rows: { kind: string; name: string }[] } };
      };
      return result.data.tiers.rows.filter((row) => row.kind === 'collision').map((row) => row.name)
        .sort();
    };

    expect(await doctor(colliding)).toEqual(['agent tdd-guide', 'skill documentation']);
    expect(await doctor(clean)).toEqual([]);
  });
});

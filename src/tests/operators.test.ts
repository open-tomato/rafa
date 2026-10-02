/**
 * The alpha operators under `src/bundled/operators/`: the stretch agent,
 * its watchtower, the three phase skills and the three reading skills. They ship in the package
 * (the build copies `src/bundled/` whole) and no tier serves them to a
 * loop session, because the rafa tier reads only `bundled/agents` and
 * `bundled/skills`. Each carries the alpha mark, and the skills pass the
 * same check `rafa skill check` runs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { BUNDLED_AGENTS_DIR } from '../inventory/trees.js';
import { BUNDLED_SKILLS_DIR } from '../schema/tiers.js';

/** The `src/` directory. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** Where the operators sit. */
const OPERATORS = join(SRC_DIR, 'bundled', 'operators');

/** Every operator file, agents and skills, by its path under {@link OPERATORS}. */
const FILES: readonly string[] = [
  'agents/rafa-stretch-engineer.md',
  'agents/rafa-stretch-watchtower.md',
  'skills/rafa-stretch-audit/SKILL.md',
  'skills/rafa-stretch-gap-log/SKILL.md',
  'skills/rafa-stretch-pit-stop/SKILL.md',
  'skills/rafa-stretch-readings/SKILL.md',
  'skills/rafa-stretch-scorecard/SKILL.md',
  'skills/rafa-stretch-sweep/SKILL.md',
];

/** The line every operator's body opens with. */
const ALPHA_LINE = 'Alpha: tested on rafa\'s own development, may become a feature.';

describe('the bundled operators', () => {
  it('ship two agents and six skills, every one named rafa-stretch-*', () => {
    expect(readdirSync(join(OPERATORS, 'agents')).sort()).toEqual(['rafa-stretch-engineer.md', 'rafa-stretch-watchtower.md']);
    expect(readdirSync(join(OPERATORS, 'skills')).sort()).toEqual([
      'rafa-stretch-audit',
      'rafa-stretch-gap-log',
      'rafa-stretch-pit-stop',
      'rafa-stretch-readings',
      'rafa-stretch-scorecard',
      'rafa-stretch-sweep',
    ]);
  });

  it('sit outside both directories the rafa tier serves to a loop', () => {
    expect(BUNDLED_AGENTS_DIR).toBe(join('bundled', 'agents'));
    expect(BUNDLED_SKILLS_DIR).toBe(join('bundled', 'skills'));
  });

  it.each(FILES)('mark %s alpha in its frontmatter and its first body line', (file) => {
    const text = readFileSync(join(OPERATORS, file), 'utf8');
    const [, frontmatter = '', body = ''] = text.split(/^---$/m);

    expect(frontmatter).toContain('\nstage: alpha\n');
    expect(frontmatter).toContain('\nsource: rafa\n');
    expect(body.trimStart().startsWith(ALPHA_LINE)).toBe(true);
  });

  it('pass the skill check', () => {
    const run = Bun.spawnSync([process.execPath, join(SRC_DIR, 'rafa.ts'), 'skill', 'check', join(OPERATORS, 'skills')], {
      env: { ...process.env, CLAUDECODE: '' },
    });

    expect(`${run.stdout.toString()}${run.stderr.toString()}`).not.toContain('error');
    expect(run.exitCode).toBe(0);
  });
});

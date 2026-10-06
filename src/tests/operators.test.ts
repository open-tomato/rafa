/**
 * The alpha operators under `src/bundled/operators/`: the stretch agent,
 * its watchtower and the three phase skills. They ship in the package
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

import { expectExit } from './cli-capture.js';

/** The `src/` directory. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** Where the operators sit. */
const OPERATORS = join(SRC_DIR, 'bundled', 'operators');

/** Every operator file, agents and skills, by its path under {@link OPERATORS}. */
const FILES: readonly string[] = [
  'agents/rafa-stretch-analyst.md',
  'agents/rafa-stretch-engineer.md',
  'agents/rafa-stretch-watchtower.md',
  'skills/rafa-stretch-gap-log/SKILL.md',
  'skills/rafa-stretch-pit-stop/SKILL.md',
  'skills/rafa-stretch-sweep/SKILL.md',
];

/** The line every operator's body opens with. */
const ALPHA_LINE = 'Alpha: tested on rafa\'s own development, may become a feature.';

describe('the bundled operators', () => {
  it('ship three agents and three skills, every one named rafa-stretch-*', () => {
    expect(readdirSync(join(OPERATORS, 'agents')).sort()).toEqual(['rafa-stretch-analyst.md', 'rafa-stretch-engineer.md', 'rafa-stretch-watchtower.md']);
    expect(readdirSync(join(OPERATORS, 'skills')).sort()).toEqual(['rafa-stretch-gap-log', 'rafa-stretch-pit-stop', 'rafa-stretch-sweep']);
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
    expectExit({ exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() }, 0);
  });

  describe('the plugin the launcher loads', () => {
    /** The plugin name in `.claude-plugin/plugin.json`. */
    const pluginName = (JSON.parse(readFileSync(join(OPERATORS, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string }).name;

    it('is the name the launcher passes to --agent', () => {
      const script = readFileSync(join(SRC_DIR, '..', 'scripts', 'stretch', 'stretch.sh'), 'utf8');

      expect(script.match(/^PLUGIN="([^"]+)"$/m)?.[1]).toBe(pluginName);
    });

    it('prefixes every skill the engineer loads, and gives the engineer the Skill tool', () => {
      const text = readFileSync(join(OPERATORS, 'agents/rafa-stretch-engineer.md'), 'utf8');
      const loads = [...text.matchAll(/load `([^`]+)`/gi)].map((match) => match[1]);

      expect(loads.sort()).toEqual(['rafa-stretch-gap-log', 'rafa-stretch-pit-stop', 'rafa-stretch-sweep'].map((skill) => `${pluginName}:${skill}`));
      expect(text).toMatch(/^tools: .*\bSkill\b/m);
    });
  });

  describe('the stretch text for verify', () => {
    /** A file's text with every run of whitespace folded to one space. */
    const flat = (file: string): string => readFileSync(join(OPERATORS, file), 'utf8').replace(/\s+/g, ' ');

    /** The numbered step of "Run one item" that opens with `n.`, up to the next step. */
    const runOneItemStep = (n: number): string => {
      const text = readFileSync(join(OPERATORS, 'agents/rafa-stretch-engineer.md'), 'utf8');
      const section = text.split(/^### 2\. Run one item$/m)[1]?.split(/^### 3\./m)[0] ?? '';
      const step = section.split(new RegExp(`^${n}\\. `, 'm'))[1]?.split(/^\d\. /m)[0] ?? '';

      return step.replace(/\s+/g, ' ');
    };

    it('puts the 60-second line inside step 3 of "Run one item"', () => {
      expect(runOneItemStep(3)).toContain('No foreground command waits longer than 60 seconds; longer waits run in the background.');
    });

    it('names the skip-checks merge for stretch/<n> and the wait for main in step 4', () => {
      const step = runOneItemStep(4);

      expect(step).toContain('Into `stretch/<n>`: `rafa pr merge <pr> --skip-checks`');
      expect(step).toContain('Into `main`: `rafa pr wait <pr>` then `rafa pr merge <pr>`');
    });

    it('names verify.yml in the pit stop CI row', () => {
      const row = flat('skills/rafa-stretch-pit-stop/SKILL.md').match(/\| CI \|[^|]*\|/)?.[0] ?? '';

      expect(row).toContain('gh run list --branch stretch/<n> --workflow verify.yml --limit 1');
    });
  });
});

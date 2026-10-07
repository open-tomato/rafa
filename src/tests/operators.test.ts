/**
 * The alpha operators under `src/bundled/operators/`: the stretch agent,
 * its watchtower and the three phase skills. They ship in the package
 * (the build copies `src/bundled/` whole) and no tier serves them to a
 * loop session, because the rafa tier reads only `bundled/agents` and
 * `bundled/skills`. Each carries the alpha mark, and the skills pass the
 * same check `rafa skill check` runs.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

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

/** The agent files, which carry the single-command rule. */
const AGENT_FILES: readonly string[] = FILES.filter((file) => file.startsWith('agents/'));

/** The opening of the rule, as it reads in every agent file once whitespace is folded. */
const RULE_OPENING = 'Run every `rafa` line as one command: no `cd … &&`, no `;`, no pipe, no redirect.';

/** The one compound line allowed: the engineer's detached loop start, matched by its own allow rule. */
const DETACHED_LOOP_START = /^setsid nohup env RAFA_OUTPUT=events rafa loop start\b(?:[^;&|>]|<[^<>\s]*>)* > \S+ 2>&1 &$/;

/** The lines inside ``` fences of a markdown text. */
const fencedLines = (text: string): string[] => {
  let inFence = false;
  const lines: string[] = [];

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    } else if (inFence) {
      lines.push(line.trim());
    }
  }

  return lines;
};

/**
 * The fenced lines of `text` that run `rafa` beside `;`, `&&`, `|` or `>`.
 * Quoted strings and `<placeholders>` are blanked first, `.rafa/` paths are
 * not the command (the word must stand alone), and the detached loop start
 * is the exception.
 */
const compoundRafaLines = (text: string): string[] => fencedLines(text).filter((line) => {
  if (DETACHED_LOOP_START.test(line)) {
    return false;
  }

  const bare = line.replace(/"[^"]*"|'[^']*'|<[^<>\s]*>/g, '');

  return /(^|\s)rafa(\s|$)/.test(bare) && /;|&&|\||>/.test(bare);
});

/** A markdown file with `body` in a fence when `fenced`, else as prose. */
const markdown = (body: string, fenced: boolean): string => (fenced
  ? `# T\n\n\`\`\`sh\n${body}\n\`\`\`\n`
  : `# T\n\nRun ${body} sometimes.\n`);

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

    // Read as text, not imported: nothing outside `src/commands/stretch/`
    // imports `src/stretch/`, so the subject can move whole.
    it('is the name the launcher passes to --agent', () => {
      const launch = readFileSync(join(SRC_DIR, 'stretch', 'launch.ts'), 'utf8');

      expect(launch.match(/^export const OPERATOR_PLUGIN = '([^']+)';$/m)?.[1]).toBe(pluginName);
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

    /** The "Run one item" section of the engineer file, whitespace folded. */
    const runOneItem = (): string => {
      const text = readFileSync(join(OPERATORS, 'agents/rafa-stretch-engineer.md'), 'utf8');

      return (text.split(/^### 2\. Run one item$/m)[1]?.split(/^### 3\./m)[0] ?? '').replace(/\s+/g, ' ');
    };

    it('runs the item, the wait and the merge through one rafa stretch item line', () => {
      const section = runOneItem();

      expect(section).toContain('`rafa stretch item <issue> --wait`');
      expect(section).toContain('merges its pull request into `stretch/<n>` with checks skipped');
    });

    it('keeps the hand merge and the hand loop start out of "Run one item"', () => {
      const section = runOneItem();

      expect(section).not.toContain('rafa pr merge');
      expect(section).not.toContain('setsid');
    });

    it('reads the CI row through rafa ci status', () => {
      const row = flat('skills/rafa-stretch-pit-stop/SKILL.md').match(/\| CI \|[^|]*\|/)?.[0] ?? '';

      expect(row).toContain('rafa ci status --branch=stretch/<n>');
    });
  });

  describe('the single-command rule', () => {
    it.each(AGENT_FILES)('opens %s with the rule', (file) => {
      const text = readFileSync(join(OPERATORS, file), 'utf8').replace(/\s+/g, ' ');

      expect(text).toContain(RULE_OPENING);
    });

    it.each(FILES)('keeps every fenced rafa line in %s to one command', (file) => {
      expect(compoundRafaLines(readFileSync(join(OPERATORS, file), 'utf8'))).toEqual([]);
    });

    describe('the compound-line check on planted files', () => {
      const dir = mkdtempSync(join(tmpdir(), 'operators-rule-'));

      afterAll(() => rmSync(dir, { recursive: true, force: true }));

      /** Plants `text` in the temp dir and runs the check on what is read back. */
      const check = (name: string, text: string): string[] => {
        writeFileSync(join(dir, name), text);

        return compoundRafaLines(readFileSync(join(dir, name), 'utf8'));
      };

      it('passes a compound line in prose', () => {
        expect(check('prose.md', markdown('`cd x && rafa plan list; rafa status | cat`', false))).toEqual([]);
      });

      it.each([
        ['&&', 'cd repo && rafa plan list'],
        [';', 'rafa plan list; echo done'],
        ['|', 'rafa plan list | head'],
        ['>', 'rafa plan list > out.txt'],
      ])('fails a fenced line with %s', (_op, line) => {
        expect(check('fence.md', markdown(line, true))).toEqual([line]);
      });

      it.each([
        'rafa issue create --body="a > b; c"',
        'rafa loop wait --until=blocked,quiet:<minutes>,exit',
        'rafa issue comment <n> --body=\'x | y\'',
      ])('passes a placeholder or quoted operator: %s', (line) => {
        expect(check('quoted.md', markdown(line, true))).toEqual([]);
      });

      it('passes a .rafa/ path beside a redirect', () => {
        expect(check('path.md', markdown('gh pr create --body-file .rafa/stretch/<n>/report.md > out.txt', true))).toEqual([]);
      });

      it('passes the detached loop start', () => {
        const line = 'setsid nohup env RAFA_OUTPUT=events rafa loop start --plan=<plan> --as-worktree > .rafa/stretch/<n>/loop.log 2>&1 &';

        expect(check('detached.md', markdown(line, true))).toEqual([]);
      });

      it('fails a detached-looking start that also chains another command', () => {
        const line = 'setsid nohup env RAFA_OUTPUT=events rafa loop start --plan=<plan> > a.log 2>&1 & rafa status | cat';

        expect(check('chained.md', markdown(line, true))).toEqual([line]);
      });
    });
  });
});

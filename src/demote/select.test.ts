/**
 * Tests for which directory the demotion pass may run over and which
 * of its files it looks at (`./select.ts`).
 *
 * Every case plants a tree under a temporary directory of this file's
 * own and reads it; nothing here touches the real home, and no case
 * writes into a tree it did not plant.
 *
 * ## The controls
 *
 * Three readings here would pass on a function that answered the same
 * thing whatever it was handed, so each is paired:
 *
 *   - **The refused directories.** Four paths answer null. Beside them,
 *     a `<base>/.claude/skills` under a base of the SAME temporary
 *     directory resolves, so a `resolveDemotionScope` that answered
 *     null for everything would be red.
 *   - **The user scope.** The same path is resolved twice, once with a
 *     home that is its base and once with a home that is not, and the
 *     two answers differ. A function ignoring the home would give one
 *     answer to both.
 *   - **The `learned/` origin rule.** The user-scope case plants three
 *     files and takes two. Beside it, the project-scope case plants the
 *     same three and takes all three, so a selection that read no
 *     frontmatter at all would be red on one of the two.
 *
 * The hash is held equal to {@link sourceHash} of the text that came
 * back, which is the one thing `--apply` compares a file against; the
 * report's own test measures that function against a published sha256.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sourceHash } from './report.js';
import {
  AUTO_EXTRACTED_ORIGIN,
  CLAUDE_DIRECTORY,
  DEMOTED_PATH,
  INSTINCTS_PATH,
  REPORT_FILE,
  resolveDemotionScope,
  selectsLearned,
  selectSources,
  SKILLS_DIRECTORY,
} from './select.js';

/** A temporary directory of this file's own. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-demote-select-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A body with one Problem and one Solution, which classifies as an observation. */
function body(title: string, origin: string | null): string {
  const front = origin === null
    ? ['---', `name: ${title}`, 'description: A single observation.', '---']
    : ['---', `name: ${title}`, 'description: A single observation.', `origin: ${origin}`, '---'];
  return [
    ...front,
    '',
    `# ${title}`,
    '',
    '## When to Use',
    '',
    'When the thing happens.',
    '',
    '## Problem',
    '',
    'The cause.',
    '',
    '## Solution',
    '',
    'The action.',
    '',
  ].join('\n');
}

/** Plants one case's tree under a base of its own and answers that base. */
function plant(files: Readonly<Record<string, string>>): string {
  planted += 1;
  const base = join(tempBase, `case-${String(planted)}`);
  mkdirSync(base, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(base, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return base;
}

/** The skills directory under a planted base. */
function skillsOf(base: string): string {
  return join(base, CLAUDE_DIRECTORY, SKILLS_DIRECTORY);
}

describe('which directory the pass may run over', () => {
  it('reads a skills directory under the home as the user scope, writing under the home', () => {
    const base = plant({ '.claude/skills/': '' });
    const scope = resolveDemotionScope(skillsOf(base), base);

    expect(scope?.scope).toBe('user');
    expect(scope?.base).toBe(base);
    expect(scope?.demotedDir).toBe(join(base, DEMOTED_PATH));
    expect(scope?.instinctsDir).toBe(join(base, INSTINCTS_PATH));
    expect(scope?.reportPath).toBe(join(base, DEMOTED_PATH, REPORT_FILE));
  });

  it('reads the same directory as a project scope when the home is somewhere else', () => {
    const base = plant({ '.claude/skills/': '' });
    const elsewhere = join(tempBase, 'a-home-that-is-not-this-base');

    expect(resolveDemotionScope(skillsOf(base), base)?.scope).toBe('user');
    expect(resolveDemotionScope(skillsOf(base), elsewhere)?.scope).toBe('project');
  });

  it('refuses a directory that is no <base>/.claude/skills, and resolves one that is', () => {
    const base = plant({ '.claude/skills/learned/': '', 'skills/': '' });

    expect(resolveDemotionScope(join(base, CLAUDE_DIRECTORY), base)).toBeNull();
    expect(resolveDemotionScope(join(base, SKILLS_DIRECTORY), base)).toBeNull();
    expect(resolveDemotionScope(join(base, CLAUDE_DIRECTORY, SKILLS_DIRECTORY, 'learned'), base)).toBeNull();
    expect(resolveDemotionScope(base, base)).toBeNull();
    expect(resolveDemotionScope(skillsOf(base), base)).not.toBeNull();
  });
});

describe('which files the pass looks at', () => {
  it('takes every <name>/SKILL.md and leaves every shape that registers nothing', () => {
    const base = plant({
      '.claude/skills/one/SKILL.md': body('one', null),
      '.claude/skills/two/SKILL.md': body('two', null),
      '.claude/skills/loose.md': body('loose', null),
      '.claude/skills/group/nested.md': body('nested', null),
      '.claude/skills/empty/': '',
      '.claude/skills/.hidden/SKILL.md': body('hidden', null),
    });
    const scope = resolveDemotionScope(skillsOf(base), base);

    expect(selectSources(scope!).map((file) => file.path)).toEqual(['one/SKILL.md', 'two/SKILL.md']);
  });

  it('carries each file its absolute path, the hash of its text and its mtime', () => {
    const base = plant({ '.claude/skills/one/SKILL.md': body('one', null), '.claude/skills/one/run.sh': 'echo\n' });
    const scope = resolveDemotionScope(skillsOf(base), base);
    const [file] = selectSources(scope!);

    expect(file?.absolute).toBe(join(skillsOf(base), 'one', 'SKILL.md'));
    expect(file?.hash).toBe(sourceHash(file?.text ?? ''));
    expect(file?.entries).toEqual(['SKILL.md', 'run.sh'].sort((a, b) => a.localeCompare(b)));
    expect(file?.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('takes the auto-extracted and the origin-less learned files in a user scope', () => {
    const base = plant({
      '.claude/skills/learned/auto.md': body('auto', AUTO_EXTRACTED_ORIGIN),
      '.claude/skills/learned/none.md': body('none', null),
      '.claude/skills/learned/by-hand.md': body('by-hand', 'written-by-hand'),
      '.claude/skills/learned/notes.txt': 'not markdown\n',
    });
    const scope = resolveDemotionScope(skillsOf(base), base);

    expect(selectSources(scope!).map((file) => file.path)).toEqual(['learned/auto.md', 'learned/none.md']);
  });

  it('takes every learned file in a project scope, whatever its origin says', () => {
    const base = plant({
      '.claude/skills/learned/auto.md': body('auto', AUTO_EXTRACTED_ORIGIN),
      '.claude/skills/learned/none.md': body('none', null),
      '.claude/skills/learned/by-hand.md': body('by-hand', 'written-by-hand'),
    });
    const scope = resolveDemotionScope(skillsOf(base), join(tempBase, 'another-home'));

    expect(selectSources(scope!).map((file) => file.path))
      .toEqual(['learned/auto.md', 'learned/by-hand.md', 'learned/none.md']);
  });

  it('reads the origin off one file the same way the selection does', () => {
    expect(selectsLearned(body('a', AUTO_EXTRACTED_ORIGIN), 'user')).toBe(true);
    expect(selectsLearned(body('a', null), 'user')).toBe(true);
    expect(selectsLearned(body('a', 'written-by-hand'), 'user')).toBe(false);
    expect(selectsLearned(body('a', 'written-by-hand'), 'project')).toBe(true);
  });

  it('lists the skill files ahead of the learned ones, each in name order', () => {
    const base = plant({
      '.claude/skills/zeta/SKILL.md': body('zeta', null),
      '.claude/skills/alpha/SKILL.md': body('alpha', null),
      '.claude/skills/learned/zulu.md': body('zulu', AUTO_EXTRACTED_ORIGIN),
      '.claude/skills/learned/alfa.md': body('alfa', AUTO_EXTRACTED_ORIGIN),
    });
    const scope = resolveDemotionScope(skillsOf(base), base);

    expect(selectSources(scope!).map((file) => file.path))
      .toEqual(['alpha/SKILL.md', 'zeta/SKILL.md', 'learned/alfa.md', 'learned/zulu.md']);
  });
});

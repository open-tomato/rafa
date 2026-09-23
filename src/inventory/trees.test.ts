/**
 * Tests for the project, rafa and user tree readers.
 *
 * Every case plants a home, a project root and a rafa entry of its own
 * under this file's temporary directory and hands all three as seams,
 * so nothing reads the real home. The first case asserts that every
 * path a reading returns sits under the planted base: a reader that
 * lost a seam would fall back on this machine's `~/.claude` and pass on
 * whatever it happens to hold.
 *
 * The absent-tier claims are negatives, and a reader that answered
 * `exists: false` for everything would satisfy them. So the absent
 * case reads one planted world twice — with and without the directory
 * — and the verdict case reads ONE skill body in two tiers, where the
 * project tier resolves its path and the user tier cannot, so a reader
 * that checked every tier the same way reddens one leg.
 */
import type { TreeSeams } from './trees.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { skillTierDirectory } from '../schema/tiers.js';

import {
  agentTreeDirectory,
  BUNDLED_AGENTS_DIR,
  bundledAgentsDirectory,
  readAgentTree,
  readSkillTree,
  readTrees,
} from './trees.js';

/**
 * Resolved once, because the rafa tier is measured from the entry with
 * its links resolved and macOS's temporary directory sits behind one
 * (`/var` is `/private/var`): an unresolved base would not prefix it.
 */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-trees-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh world: a home, a project root and a rafa entry, none of them written yet. */
function freshSeams(): TreeSeams {
  planted += 1;
  const base = join(tempBase, `case-${planted}`);
  return {
    home: join(base, 'home'),
    projectRoot: join(base, 'project'),
    entry: join(base, 'runtime', 'cli.js'),
    pathDirs: [],
  };
}

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A markdown file whose frontmatter holds `lines`, then `body`. */
function definition(lines: readonly string[], body = '\n# Body\n\nRead each exit code.\n'): string {
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** The four required skill fields, every value one the checker accepts. */
function cleanSkill(name: string, description = 'Run the gates in order and read each exit code'): string {
  return definition([
    `name: ${name}`,
    `description: ${description}`,
    'tags: [verification, gates]',
    'stack: [agnostic]',
  ]);
}

/** Plants the rafa entry, so the rafa tier resolves beside a real file. */
function plantEntry(seams: TreeSeams): void {
  write(seams.entry ?? '', '// cli\n');
}

describe('the trees stay under the planted seams', () => {
  it('reads every tier from the base it was handed and never the real home', () => {
    const seams = freshSeams();
    plantEntry(seams);
    const base = dirname(seams.home);
    write(join(seams.home, '.claude/skills/home-skill/SKILL.md'), cleanSkill('home-skill'));
    write(join(seams.projectRoot ?? '', '.claude/agents/reviewer.md'), definition(['name: reviewer']));

    const listings = readTrees(seams);

    expect(listings.map((listing) => `${listing.kind}/${listing.source}`)).toEqual([
      'skill/project',
      'skill/rafa',
      'skill/user',
      'agent/project',
      'agent/rafa',
      'agent/user',
    ]);
    for (const listing of listings) expect(listing.dir?.startsWith(base)).toBe(true);
    const paths = listings.flatMap((listing) => listing.items.map((item) => item.path));
    // Control: the planted items were read, so the loop above is not vacuous.
    expect(paths.length).toBe(2);
    for (const path of paths) expect(path.startsWith(base)).toBe(true);
  });
});

describe('where each tree sits', () => {
  it('puts the skills trees where tiers.ts puts them', () => {
    const seams = freshSeams();
    for (const tier of ['project', 'rafa', 'user'] as const) {
      expect(readSkillTree(tier, seams).dir).toBe(skillTierDirectory(tier, seams));
    }
  });

  it('puts the agents trees under .claude/agents and beside the entry', () => {
    const seams = freshSeams();
    const base = dirname(seams.home);

    expect(agentTreeDirectory('project', seams)).toBe(join(base, 'project/.claude/agents'));
    expect(agentTreeDirectory('user', seams)).toBe(join(base, 'home/.claude/agents'));
    expect(agentTreeDirectory('rafa', seams)).toBe(join(base, 'runtime', BUNDLED_AGENTS_DIR));
  });

  it('measures the rafa agents tree from the entry with its links resolved', () => {
    const seams = freshSeams();
    plantEntry(seams);
    const base = dirname(seams.home);
    const linked = join(base, 'bin', 'rafa');
    mkdirSync(dirname(linked), { recursive: true });
    symlinkSync(seams.entry ?? '', linked);

    expect(bundledAgentsDirectory(linked)).toBe(bundledAgentsDirectory(seams.entry));
    // Control: the link's own directory is a different answer.
    expect(bundledAgentsDirectory(linked)).not.toBe(join(base, 'bin', BUNDLED_AGENTS_DIR));
  });
});

describe('an absent tier', () => {
  it('reads as not there, with no items, and as there once the directory is planted', () => {
    const seams = freshSeams();
    plantEntry(seams);

    const before = readSkillTree('rafa', seams);
    expect(before.exists).toBe(false);
    expect(before.items).toEqual([]);
    expect(before.dir).toBe(join(dirname(seams.entry ?? ''), 'skills'));

    mkdirSync(before.dir ?? '', { recursive: true });
    const empty = readSkillTree('rafa', seams);
    expect(empty.exists).toBe(true);
    expect(empty.items).toEqual([]);

    write(join(before.dir ?? '', 'bundled/SKILL.md'), cleanSkill('bundled'));
    expect(readSkillTree('rafa', seams).items.map((item) => item.name)).toEqual(['bundled']);
  });

  it('reads an absent agents tree the same way', () => {
    const seams = freshSeams();

    const before = readAgentTree('user', seams);
    expect(before.exists).toBe(false);
    expect(before.items).toEqual([]);

    write(join(seams.home, '.claude/agents/helper.md'), definition(['name: helper']));
    const after = readAgentTree('user', seams);
    expect(after.exists).toBe(true);
    expect(after.items.map((item) => item.name)).toEqual(['helper']);
  });

  it('reads the project tier with no project root as no directory at all', () => {
    const seams: TreeSeams = { ...freshSeams(), projectRoot: null };

    for (const listing of [readSkillTree('project', seams), readAgentTree('project', seams)]) {
      expect(listing.dir).toBeNull();
      expect(listing.exists).toBe(false);
      expect(listing.items).toEqual([]);
    }
    // Control: the other tiers still resolve a directory in the same world.
    expect(readSkillTree('user', seams).dir).not.toBeNull();
  });
});

describe('skill rows', () => {
  it('fills a row from the frontmatter, with the checker\'s pass', () => {
    const seams = freshSeams();
    const path = join(seams.projectRoot ?? '', '.claude/skills/verification-loop/SKILL.md');
    write(path, definition([
      'name: verification-loop',
      'description: Run the gates in order and read each exit code',
      'when_to_use: before reporting a task done',
      'prevents: a green report over a red gate',
      'signal: silent',
      'tags: [verification, gates]',
      'stack: [agnostic]',
    ]));

    const [item] = readSkillTree('project', seams).items;

    expect(item).toEqual({
      kind: 'skill',
      name: 'verification-loop',
      source: 'project',
      path,
      summary: 'Run the gates in order and read each exit code',
      whenToUse: 'before reporting a task done',
      prevents: 'a green report over a red gate',
      stack: ['agnostic'],
      tags: ['verification', 'gates'],
      check: 'pass',
    });
  });

  it('keeps a failing skill as a row, with the checker\'s fail and its own summary', () => {
    const seams = freshSeams();
    write(
      join(seams.home, '.claude/skills/old-style/SKILL.md'),
      definition(['name: old-style', `description: ${'d'.repeat(140)}`]),
    );

    const [item] = readSkillTree('user', seams).items;

    expect(item?.name).toBe('old-style');
    expect(item?.check).toBe('fail');
    expect(item?.summary).toBe('d'.repeat(130));
    expect(item?.tags).toEqual([]);
    expect(item?.stack).toEqual([]);
  });

  it('checks the project tier against the project root and the user tier against none', () => {
    const seams = freshSeams();
    const body = '\nRead `src/there.ts` before editing.\n';
    const skill = definition([
      'name: reads-there',
      'description: Reads one project file',
      'tags: [probe]',
      'stack: [agnostic]',
    ], body);
    write(join(seams.projectRoot ?? '', 'src/there.ts'), 'export const there = 1;\n');
    write(join(seams.projectRoot ?? '', '.claude/skills/reads-there/SKILL.md'), skill);
    write(join(seams.home, '.claude/skills/reads-there/SKILL.md'), skill);

    expect(readSkillTree('project', seams).items[0]?.check).toBe('pass');
    expect(readSkillTree('user', seams).items[0]?.check).toBe('warn');
  });

  it('lists a loose file under its stem and passes over a directory with no SKILL.md', () => {
    const seams = freshSeams();
    const dir = join(seams.home, '.claude/skills');
    write(join(dir, 'loose.md'), cleanSkill('loose'));
    write(join(dir, 'empty-dir/notes.txt'), 'no skill here\n');
    write(join(dir, 'kept/SKILL.md'), cleanSkill('kept'));

    const items = readSkillTree('user', seams).items;

    expect(items.map((item) => [item.name, item.check])).toEqual([
      ['kept', 'pass'],
      ['loose', 'fail'],
    ]);
  });

  it('names a skill by its directory whatever its frontmatter says', () => {
    const seams = freshSeams();
    write(join(seams.home, '.claude/skills/by-place/SKILL.md'), cleanSkill('other-name'));

    const [item] = readSkillTree('user', seams).items;

    expect(item?.name).toBe('by-place');
    // The mismatch is the checker's finding, not a dropped row.
    expect(item?.check).toBe('fail');
  });

  it('sorts rows by name', () => {
    const seams = freshSeams();
    const dir = join(seams.home, '.claude/skills');
    for (const name of ['zeta', 'alpha', 'mid']) write(join(dir, name, 'SKILL.md'), cleanSkill(name));

    expect(readSkillTree('user', seams).items.map((item) => item.name)).toEqual(['alpha', 'mid', 'zeta']);
  });
});

describe('agent rows', () => {
  it('keys a definition by its frontmatter name, with no checker verdict', () => {
    const seams = freshSeams();
    const dir = join(seams.projectRoot ?? '', '.claude/agents');
    write(join(dir, 'weird-file.md'), definition([
      'name: renamed-agent',
      'description: Reviews a diff',
      'tags: review',
    ]));

    const [item] = readAgentTree('project', seams).items;

    expect(item).toEqual({
      kind: 'agent',
      name: 'renamed-agent',
      source: 'project',
      path: join(dir, 'weird-file.md'),
      summary: 'Reviews a diff',
      whenToUse: null,
      prevents: null,
      stack: [],
      tags: ['review'],
      check: null,
    });
  });

  it('passes over a file with no usable name, as the roster does', () => {
    const seams = freshSeams();
    const dir = join(seams.home, '.claude/agents');
    write(join(dir, 'nameless.md'), definition(['description: carries no name']));
    write(join(dir, 'README.md'), '# Agents\n');
    write(join(dir, 'named.md'), definition(['name: named']));

    expect(readAgentTree('user', seams).items.map((item) => item.name)).toEqual(['named']);
  });

  it('reads rafa\'s own agents beside the entry', () => {
    const seams = freshSeams();
    plantEntry(seams);
    write(join(bundledAgentsDirectory(seams.entry), 'bundled.md'), definition(['name: bundled']));

    const listing = readAgentTree('rafa', seams);

    expect(listing.exists).toBe(true);
    expect(listing.items.map((item) => [item.name, item.source])).toEqual([['bundled', 'rafa']]);
  });
});

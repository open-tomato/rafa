/**
 * Tests for the layout check.
 *
 * Every case plants its own tree under this file's temporary
 * directory with {@link plant}, and the first case asserts the paths
 * the scan answers resolve there: the directories this check is aimed
 * at in the loop are `~/.claude/skills` and `~/.rafa/instincts`, and a
 * case that lost its root would walk one of those.
 *
 * Most claims here are a file REPORTED, and the shape of the reading
 * is that the same tree also holds the near-identical file that
 * passes: a `learned/thing.md` reported as the flat grouped layout is
 * a reading about where it sits only when the `thing/SKILL.md` beside
 * it is reported clean in the same scan. The cases under `the issue
 * codes` close the set both ways against {@link LAYOUT_ISSUE_CODES} —
 * a code nothing here provokes and a code produced by nothing named
 * here are both red — and the severity table is closed over the same
 * list, so a new code with no severity cannot ship.
 *
 * The two layouts the spec names are asserted on the MESSAGE, not on
 * the code alone: an operator reading a failing run gets the sentence,
 * and the sentence is what has to hold `<dir>/<group>/<name>.md` and
 * `<dir>/<group>/<name>/SKILL.md`.
 *
 * ## The mutation legs
 *
 * Four mutations of `check/layout.ts` were driven against this file on
 * 2026-09-18, the module restored sha256-identical after each, and
 * every one reddened at least two cases: making
 * `dotfile-only-directory` a failure (2), letting the scan go on past
 * a registered `SKILL.md` (3), passing a broken symlink over instead
 * of reporting it (2), and keeping dot-prefixed names in the walk (3).
 */
import type { LayoutEntry, LayoutIssueCode } from './layout.js';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  LAYOUT_ISSUE_CODES,
  LAYOUT_SEVERITY,
  declaredNameIssue,
  hasLayoutFailure,
  scanLayout,
} from './layout.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-check-layout-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/**
 * Plants a tree and answers its root. A key ending in `/` is an empty
 * directory; every other key is a file holding its value.
 */
function plant(files: Readonly<Record<string, string>>): string {
  planted += 1;
  const root = join(tempBase, `case-${planted}`);
  mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return root;
}

/** A skill file body, which no check here reads. */
const SKILL_TEXT = ['---', 'name: whatever', '---', 'Body.', ''].join('\n');

/** The entry whose path is `<root>/<name>`, or undefined. */
function at(entries: readonly LayoutEntry[], root: string, name: string): LayoutEntry | undefined {
  return entries.find((entry) => entry.path === join(root, name));
}

/** Every code carried by `entries`, in the order they were reported. */
function codesOf(entries: readonly LayoutEntry[]): LayoutIssueCode[] {
  return entries.flatMap((entry) => entry.issues.map((issue) => issue.code));
}

describe('scanning a skills directory', () => {
  it('reports a registered skill clean and answers a path under its root', () => {
    const root = plant({
      'alpha/SKILL.md': SKILL_TEXT,
      'alpha/reference.md': 'A resource beside it.',
      'alpha/scripts/run.sh': 'echo hi\n',
    });

    const scan = scanLayout(root, 'skill');

    expect(scan.root).toBe(root);
    expect(scan.kind).toBe('skill');
    expect(scan.entries).toHaveLength(1);
    const [entry] = scan.entries;
    expect(entry.path).toBe(join(root, 'alpha', 'SKILL.md'));
    expect(entry.path.startsWith(tempBase)).toBe(true);
    expect(entry.shape).toBe('skill-file');
    expect(entry.name).toBe('alpha');
    expect(entry.isFile).toBe(true);
    expect(entry.issues).toEqual([]);
  });

  it('names the flat grouped layout, beside the registered skill it sits with', () => {
    const root = plant({
      'learned/thing.md': SKILL_TEXT,
      'kept/SKILL.md': SKILL_TEXT,
    });

    const scan = scanLayout(root, 'skill');
    const flat = at(scan.entries, root, join('learned', 'thing.md'));
    const kept = at(scan.entries, root, join('kept', 'SKILL.md'));

    expect(kept?.issues).toEqual([]);
    expect(flat?.shape).toBe('flat-grouped');
    expect(flat?.name).toBe('thing');
    expect(flat?.isFile).toBe(true);
    expect(flat?.issues).toHaveLength(1);
    expect(flat?.issues[0].code).toBe('flat-grouped-layout');
    expect(flat?.issues[0].severity).toBe('failure');
    expect(flat?.issues[0].message).toContain('<dir>/<group>/<name>.md');
    expect(flat?.issues[0].message).toContain('thing/SKILL.md');
  });

  it('names the nested layout, beside the registered skill it sits with', () => {
    const root = plant({
      'learned/thing/SKILL.md': SKILL_TEXT,
      'kept/SKILL.md': SKILL_TEXT,
    });

    const scan = scanLayout(root, 'skill');
    const nested = at(scan.entries, root, join('learned', 'thing', 'SKILL.md'));

    expect(at(scan.entries, root, join('kept', 'SKILL.md'))?.issues).toEqual([]);
    expect(nested?.shape).toBe('nested-group');
    expect(nested?.name).toBe('thing');
    expect(nested?.issues[0].code).toBe('nested-group-layout');
    expect(nested?.issues[0].message).toContain('<dir>/<group>/<name>/SKILL.md');
  });

  it('reports a markdown file loose at the top level', () => {
    const root = plant({ 'loose.md': SKILL_TEXT, 'kept/SKILL.md': SKILL_TEXT });

    const scan = scanLayout(root, 'skill');
    const loose = at(scan.entries, root, 'loose.md');

    expect(loose?.shape).toBe('loose-file');
    expect(loose?.name).toBe('loose');
    expect(loose?.issues[0].code).toBe('loose-file');
    expect(loose?.issues[0].message).toContain('loose/SKILL.md');
  });

  it('reports a directory holding no SKILL.md, at either level', () => {
    const root = plant({
      'shallow/notes.txt': 'not markdown',
      'group/member/notes.txt': 'not markdown either',
    });

    const scan = scanLayout(root, 'skill');

    expect(codesOf(scan.entries)).toEqual(['missing-skill-file', 'missing-skill-file']);
    const shallow = at(scan.entries, root, 'shallow');
    expect(shallow?.isFile).toBe(false);
    expect(shallow?.shape).toBe('no-skill-file');
    expect(shallow?.name).toBeNull();
    expect(at(scan.entries, root, join('group', 'member'))?.shape).toBe('no-skill-file');
  });

  it('stops at a SKILL.md, so a nested one beside it is a resource of that skill', () => {
    const root = plant({
      'alpha/SKILL.md': SKILL_TEXT,
      'alpha/examples/SKILL.md': SKILL_TEXT,
    });

    const scan = scanLayout(root, 'skill');

    expect(scan.entries).toHaveLength(1);
    expect(scan.entries[0].path).toBe(join(root, 'alpha', 'SKILL.md'));
  });

  it('follows a symlinked skill directory', () => {
    const root = plant({ 'elsewhere/real/SKILL.md': SKILL_TEXT });
    symlinkSync(join(root, 'elsewhere', 'real'), join(root, 'linked'));

    const scan = scanLayout(root, 'skill');
    const linked = at(scan.entries, root, join('linked', 'SKILL.md'));

    expect(linked?.shape).toBe('skill-file');
    expect(linked?.name).toBe('linked');
    expect(linked?.issues).toEqual([]);
  });

  it('reports a broken symlink rather than passing over it', () => {
    const root = plant({ 'kept/SKILL.md': SKILL_TEXT });
    symlinkSync(join(root, 'absent'), join(root, 'dangling'));

    const scan = scanLayout(root, 'skill');
    const dangling = at(scan.entries, root, 'dangling');

    expect(dangling?.shape).toBe('unreadable');
    expect(dangling?.issues[0].code).toBe('unreadable-entry');
    expect(dangling?.issues[0].severity).toBe('failure');
  });

  it('passes over dotfiles and files that are not markdown', () => {
    const root = plant({
      '.DS_Store': 'finder',
      'README.txt': 'not a skill',
      '.hidden/SKILL.md': SKILL_TEXT,
      'kept/SKILL.md': SKILL_TEXT,
    });

    const scan = scanLayout(root, 'skill');

    expect(scan.entries).toHaveLength(1);
    expect(scan.entries[0].path).toBe(join(root, 'kept', 'SKILL.md'));
  });

  it('sorts the entries by path', () => {
    const root = plant({
      'zeta/SKILL.md': SKILL_TEXT,
      'alpha/SKILL.md': SKILL_TEXT,
      'middle/SKILL.md': SKILL_TEXT,
    });

    const paths = scanLayout(root, 'skill').entries.map((entry) => entry.path);

    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
    expect(paths[0]).toBe(join(root, 'alpha', 'SKILL.md'));
  });
});

describe('a directory holding nothing but dotfiles', () => {
  it('warns rather than failing, at either level', () => {
    const root = plant({
      'empty/': '',
      'finder/.DS_Store': 'finder',
      'group/member/.DS_Store': 'finder',
      'group/kept.md': SKILL_TEXT,
    });

    const scan = scanLayout(root, 'skill');
    const finder = at(scan.entries, root, 'finder');

    expect(finder?.shape).toBe('dotfile-only');
    expect(finder?.isFile).toBe(false);
    expect(finder?.issues[0].code).toBe('dotfile-only-directory');
    expect(finder?.issues[0].severity).toBe('warning');
    expect(hasLayoutFailure(finder?.issues ?? [])).toBe(false);
    expect(at(scan.entries, root, 'empty')?.shape).toBe('dotfile-only');
    expect(at(scan.entries, root, join('group', 'member'))?.shape).toBe('dotfile-only');
    // The control: the flat grouped file in the same scan does count.
    expect(hasLayoutFailure(at(scan.entries, root, join('group', 'kept.md'))?.issues ?? []))
      .toBe(true);
  });
});

describe('scanning an instincts directory', () => {
  it('reports a flat record clean and passes over the adapter files', () => {
    const root = plant({
      'bun-install-after-fork.md': SKILL_TEXT,
      'instincts.ndjson': '{}\n',
      'flags.ndjson': '{}\n',
    });

    const scan = scanLayout(root, 'instinct');

    expect(scan.kind).toBe('instinct');
    expect(scan.entries).toHaveLength(1);
    const [entry] = scan.entries;
    expect(entry.kind).toBe('instinct');
    expect(entry.shape).toBe('instinct-file');
    expect(entry.name).toBe('bun-install-after-fork');
    expect(entry.issues).toEqual([]);
  });

  it('reports a record below the top level, at any depth', () => {
    const root = plant({
      'kept.md': SKILL_TEXT,
      'workflow/grouped.md': SKILL_TEXT,
      'workflow/deeper/buried.md': SKILL_TEXT,
    });

    const scan = scanLayout(root, 'instinct');
    const grouped = at(scan.entries, root, join('workflow', 'grouped.md'));
    const buried = at(scan.entries, root, join('workflow', 'deeper', 'buried.md'));

    expect(at(scan.entries, root, 'kept.md')?.issues).toEqual([]);
    expect(grouped?.shape).toBe('nested-instinct');
    expect(grouped?.issues[0].code).toBe('nested-instinct-file');
    expect(grouped?.issues[0].message).toContain('grouped.md');
    expect(buried?.name).toBe('buried');
    expect(buried?.issues[0].code).toBe('nested-instinct-file');
  });

  it('never reads a SKILL.md as a skill under an instincts directory', () => {
    const root = plant({ 'alpha/SKILL.md': SKILL_TEXT });

    const scan = scanLayout(root, 'instinct');

    expect(scan.entries).toHaveLength(1);
    expect(scan.entries[0].shape).toBe('nested-instinct');
  });
});

describe('a root that is not a directory', () => {
  it('throws for a missing path, naming the kind', () => {
    const root = plant({});

    expect(() => scanLayout(join(root, 'absent'), 'skill'))
      .toThrow(/check layout: no skill directory at /);
    expect(() => scanLayout(join(root, 'absent'), 'instinct'))
      .toThrow(/check layout: no instinct directory at /);
  });

  it('throws for a path holding a file', () => {
    const root = plant({ 'file.md': SKILL_TEXT });

    expect(() => scanLayout(join(root, 'file.md'), 'skill')).toThrow(/no skill directory at/);
    // The control: the directory holding it scans.
    expect(scanLayout(root, 'skill').entries).toHaveLength(1);
  });
});

describe('the declared name', () => {
  it('reports a skill whose frontmatter name is not its directory name', () => {
    const root = plant({ 'alpha/SKILL.md': SKILL_TEXT });
    const [entry] = scanLayout(root, 'skill').entries;

    const issue = declaredNameIssue(entry, 'beta');

    expect(issue?.code).toBe('name-mismatch');
    expect(issue?.severity).toBe('failure');
    expect(issue?.message).toContain('frontmatter name "beta"');
    expect(issue?.message).toContain('directory name "alpha"');
    expect(declaredNameIssue(entry, 'alpha')).toBeNull();
  });

  it('reports a record whose frontmatter id is not its file name', () => {
    const root = plant({ 'alpha.md': SKILL_TEXT });
    const [entry] = scanLayout(root, 'instinct').entries;

    const issue = declaredNameIssue(entry, 'beta');

    expect(issue?.message).toContain('frontmatter id "beta"');
    expect(issue?.message).toContain('file name "alpha"');
    expect(declaredNameIssue(entry, 'alpha')).toBeNull();
  });

  it('leaves an absent name to the schema, and says nothing for an entry with no name', () => {
    const root = plant({ 'alpha/SKILL.md': SKILL_TEXT, 'group/member/notes.txt': 'x' });
    const scan = scanLayout(root, 'skill');
    const skill = at(scan.entries, root, join('alpha', 'SKILL.md'));
    const directory = at(scan.entries, root, join('group', 'member'));

    expect(declaredNameIssue(skill as LayoutEntry, null)).toBeNull();
    expect(directory?.name).toBeNull();
    expect(declaredNameIssue(directory as LayoutEntry, 'member')).toBeNull();
  });
});

describe('the issue codes', () => {
  it('produces every code, and no code outside the list', () => {
    const skills = plant({
      'flat/thing.md': SKILL_TEXT,
      'nested/thing/SKILL.md': SKILL_TEXT,
      'loose.md': SKILL_TEXT,
      'bare/notes.txt': 'no skill file',
      'finder/.DS_Store': 'finder',
    });
    symlinkSync(join(skills, 'absent'), join(skills, 'dangling'));
    const instincts = plant({ 'workflow/grouped.md': SKILL_TEXT });
    const mismatch = declaredNameIssue(scanLayout(instincts, 'instinct').entries[0], 'other');

    const produced = new Set<LayoutIssueCode>([
      ...codesOf(scanLayout(skills, 'skill').entries),
      ...codesOf(scanLayout(instincts, 'instinct').entries),
      ...(mismatch === null
        ? []
        : [mismatch.code]),
    ]);

    expect([...produced].sort()).toEqual([...LAYOUT_ISSUE_CODES].sort());
  });

  it('gives every code a severity, and warns for exactly one', () => {
    const warnings = LAYOUT_ISSUE_CODES.filter((code) => LAYOUT_SEVERITY[code] === 'warning');

    expect(Object.keys(LAYOUT_SEVERITY).sort()).toEqual([...LAYOUT_ISSUE_CODES].sort());
    expect(warnings).toEqual(['dotfile-only-directory']);
  });
});

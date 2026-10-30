/**
 * The layout check: which files under a skills or instincts directory
 * the tool that reads them actually registers, and the name every way
 * of sitting in the wrong place goes by.
 *
 * This is the checker's first check, and it is the only one that walks
 * a tree. It answers two things at once: WHICH files the later checks
 * (schema, resolution, locality) should be run over, and which files
 * are in a shape whose only symptom is silence — a `.md` that parses,
 * says everything right, and is never loaded because of where it sits.
 *
 * ## The two layouts that do not register
 *
 * Claude Code registers a skill at `<dir>/<name>/SKILL.md`, exactly
 * one level under the skills directory. Two near-misses are common
 * enough to have their own failure codes, and {@link
 * LAYOUT_ISSUE_CODES} names both:
 *
 *   - `flat-grouped-layout`, `<dir>/<group>/<name>.md`. Measured in
 *     `~/.claude/skills/` on 2026-09-18: `learned/` alone holds 101
 *     such files, each a whole skill written by `/learn`, none of them
 *     registered.
 *   - `nested-group-layout`, `<dir>/<group>/<name>/SKILL.md`. The same
 *     corpus holds none: all 197 of its `SKILL.md` files sit exactly
 *     one level deep. It is named anyway because it is the shape a
 *     grouping of the registered layout produces, and it fails the
 *     same silent way.
 *
 * A loose `<dir>/<name>.md` and a one-level directory holding no
 * `SKILL.md` are the two remaining ways to register nothing, and each
 * has a code too. None of this module's failures is about a file's
 * contents: a file that never loads is a failure whatever it says.
 *
 * ## Instincts are flat
 *
 * An instinct record is `<scope>/.rafa/instincts/<id>.md`, with no
 * grouping layer at all, so the only layout failure a record can have
 * is sitting below the top level (`nested-instinct-file`). The
 * directory also holds the local Learning adapter's `instincts.ndjson`
 * and `flags.ndjson`; those are not records, and every non-`.md` file
 * is passed over without a word.
 *
 * ## What is a warning, and what is passed over
 *
 * A directory holding nothing but dotfiles — the `.DS_Store`-only
 * directory a Finder visit leaves behind, and the empty directory
 * `rafa init` scaffolds — registers nothing, but it is nobody's broken
 * skill. It is a WARNING ({@link LAYOUT_SEVERITY}), and the checker's
 * exit code, a count of failing files, never counts it. Dot-prefixed
 * entries themselves are skipped everywhere, as is any non-`.md` file:
 * a skill's own `scripts/` and `reference.txt` are its resources, not
 * candidates.
 *
 * ## Symlinks are followed, and a broken one is named
 *
 * Every entry's kind is read with `statSync`, which follows a
 * symlink, so a skill directory symlinked into a tier is scanned as
 * the directory it points at. A path `statSync` refuses — a broken
 * symlink, a permission the process lacks — registers nothing either,
 * and is reported as `unreadable-entry` rather than skipped, because
 * skipping it would make an unreadable tier read as a clean one.
 *
 * ## What this module does not read
 *
 * It opens no file. The one layout rule that needs a file's
 * frontmatter — `name` equal to the directory name, `id` equal to the
 * file name — is {@link declaredNameIssue}, which the checker calls
 * with the value the schema already parsed, so a file is read once.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The file name Claude Code registers a skill by. */
export const SKILL_FILE = 'SKILL.md';

/** The extension a skill or instinct record is written with. */
export const MARKDOWN_EXTENSION = '.md';

/** Which of the two directories is being scanned. */
export type CheckKind = 'skill' | 'instinct';

/** Whether an issue counts towards the checker's exit code. */
export type LayoutSeverity = 'failure' | 'warning';

/** Every way a path can sit wrong, one code per rule. */
export type LayoutIssueCode =
  | 'flat-grouped-layout'
  | 'nested-group-layout'
  | 'loose-file'
  | 'missing-skill-file'
  | 'nested-instinct-file'
  | 'unreadable-entry'
  | 'name-mismatch'
  | 'dotfile-only-directory';

/** The codes, in the order this module reports them. */
export const LAYOUT_ISSUE_CODES: readonly LayoutIssueCode[] = [
  'flat-grouped-layout',
  'nested-group-layout',
  'loose-file',
  'missing-skill-file',
  'nested-instinct-file',
  'unreadable-entry',
  'name-mismatch',
  'dotfile-only-directory',
];

/**
 * What each code costs. Only `dotfile-only-directory` is a warning:
 * the spec's rule is that a dotfile-only directory never counts.
 */
export const LAYOUT_SEVERITY: Readonly<Record<LayoutIssueCode, LayoutSeverity>> = Object.freeze({
  'flat-grouped-layout': 'failure',
  'nested-group-layout': 'failure',
  'loose-file': 'failure',
  'missing-skill-file': 'failure',
  'nested-instinct-file': 'failure',
  'unreadable-entry': 'failure',
  'name-mismatch': 'failure',
  'dotfile-only-directory': 'warning',
});

/** One broken layout rule, ready to print. */
export interface LayoutIssue {
  /** Which rule was broken. */
  readonly code: LayoutIssueCode;
  /** Whether it counts towards the exit code. */
  readonly severity: LayoutSeverity;
  /**
   * A sentence a checker prints unedited. Paths in it are relative to
   * the scanned directory, which the checker names once.
   */
  readonly message: string;
}

/** Where a path sits, whether or not that place registers. */
export type LayoutShape =
  | 'skill-file'
  | 'flat-grouped'
  | 'nested-group'
  | 'loose-file'
  | 'no-skill-file'
  | 'instinct-file'
  | 'nested-instinct'
  | 'dotfile-only'
  | 'unreadable';

/** One path the scan found, with what its place costs it. */
export interface LayoutEntry {
  /** Which directory it was found under. */
  readonly kind: CheckKind;
  /**
   * The markdown file, or the directory itself when the finding is
   * that it holds no markdown file to check.
   */
  readonly path: string;
  /** Whether {@link path} is a file the later checks can be run over. */
  readonly isFile: boolean;
  /** Where it sits. */
  readonly shape: LayoutShape;
  /**
   * The name its place implies — the directory name for a `SKILL.md`,
   * the file stem for a record — or null when its place implies none.
   * {@link declaredNameIssue} compares the frontmatter against it.
   */
  readonly name: string | null;
  /** What its place costs it, empty for a registered file. */
  readonly issues: readonly LayoutIssue[];
}

/** Everything one directory holds, in path order. */
export interface LayoutScan {
  /** Which directory was scanned. */
  readonly kind: CheckKind;
  /** The directory, as it was passed in. */
  readonly root: string;
  /** Every entry found, sorted by path. */
  readonly entries: readonly LayoutEntry[];
}

/** Whether any of `issues` counts towards the exit code. */
export function hasLayoutFailure(issues: readonly LayoutIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'failure');
}

/** Builds an issue, taking its severity from {@link LAYOUT_SEVERITY}. */
function layoutIssue(code: LayoutIssueCode, message: string): LayoutIssue {
  return { code, severity: LAYOUT_SEVERITY[code], message };
}

/**
 * What kind of thing sits at `path`, following symlinks, or null when
 * nothing readable does.
 */
function entryKind(path: string): 'file' | 'directory' | null {
  try {
    const stats = statSync(path);
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    return null;
  } catch {
    return null;
  }
}

/** The names under `dir` that are not dot-prefixed, sorted. */
function visibleNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort((left, right) => left.localeCompare(right));
}

/** Whether `name` is a markdown file name. */
function isMarkdown(name: string): boolean {
  return name.endsWith(MARKDOWN_EXTENSION);
}

/** `name` without its markdown extension. */
function markdownStem(name: string): string {
  return name.slice(0, -MARKDOWN_EXTENSION.length);
}

/** Every entry's message names paths this way. */
function shown(root: string, path: string): string {
  return relative(root, path) || '.';
}

/** A directory whose only contents are dotfiles, which registers nothing. */
function dotfileOnlyEntry(kind: CheckKind, root: string, dir: string): LayoutEntry {
  return {
    kind,
    path: dir,
    isFile: false,
    shape: 'dotfile-only',
    name: null,
    issues: [layoutIssue(
      'dotfile-only-directory',
      `${shown(root, dir)}/ holds nothing but dotfiles, so it registers nothing`,
    )],
  };
}

/** A path `statSync` refused, which registers nothing either. */
function unreadableEntry(kind: CheckKind, root: string, path: string): LayoutEntry {
  return {
    kind,
    path,
    isFile: false,
    shape: 'unreadable',
    name: null,
    issues: [layoutIssue(
      'unreadable-entry',
      `${shown(root, path)} cannot be read (a broken symlink, or a path stat refuses)`,
    )],
  };
}

/** A registered `<dir>/<name>/SKILL.md`. */
function skillFileEntry(path: string, name: string): LayoutEntry {
  return { kind: 'skill', path, isFile: true, shape: 'skill-file', name, issues: [] };
}

/** A `<dir>/<group>/<name>.md`, the flat grouped layout. */
function flatGroupedEntry(root: string, path: string, name: string): LayoutEntry {
  return {
    kind: 'skill',
    path,
    isFile: true,
    shape: 'flat-grouped',
    name,
    issues: [layoutIssue(
      'flat-grouped-layout',
      `${shown(root, path)} is the flat grouped layout <dir>/<group>/<name>.md,`
      + ` which does not register; move it to <dir>/${name}/${SKILL_FILE}`,
    )],
  };
}

/** A `<dir>/<group>/<name>/SKILL.md`, the nested layout. */
function nestedGroupEntry(root: string, path: string, name: string): LayoutEntry {
  return {
    kind: 'skill',
    path,
    isFile: true,
    shape: 'nested-group',
    name,
    issues: [layoutIssue(
      'nested-group-layout',
      `${shown(root, path)} is the nested layout <dir>/<group>/<name>/${SKILL_FILE},`
      + ` which does not register; move it to <dir>/${name}/${SKILL_FILE}`,
    )],
  };
}

/** A `<dir>/<name>.md`, loose at the top level. */
function looseFileEntry(root: string, path: string, name: string): LayoutEntry {
  return {
    kind: 'skill',
    path,
    isFile: true,
    shape: 'loose-file',
    name,
    issues: [layoutIssue(
      'loose-file',
      `${shown(root, path)} sits directly under the skills directory, which registers`
      + ` only <dir>/<name>/${SKILL_FILE}; move it to <dir>/${name}/${SKILL_FILE}`,
    )],
  };
}

/** A directory that should have held a `SKILL.md` and did not. */
function noSkillFileEntry(root: string, dir: string): LayoutEntry {
  return {
    kind: 'skill',
    path: dir,
    isFile: false,
    shape: 'no-skill-file',
    name: null,
    issues: [layoutIssue(
      'missing-skill-file',
      `${shown(root, dir)}/ holds no ${SKILL_FILE}, so it registers no skill`,
    )],
  };
}

/** A record below the flat instincts directory. */
function nestedInstinctEntry(root: string, path: string, name: string): LayoutEntry {
  return {
    kind: 'instinct',
    path,
    isFile: true,
    shape: 'nested-instinct',
    name,
    issues: [layoutIssue(
      'nested-instinct-file',
      `${shown(root, path)} sits below the instincts directory, which is flat;`
      + ` move it to <dir>/${name}${MARKDOWN_EXTENSION}`,
    )],
  };
}

/**
 * A group member `<dir>/<group>/<name>/`: a `SKILL.md` in it is the
 * nested layout, and anything else is a directory registering nothing.
 */
function scanGroupMember(root: string, dir: string, name: string): LayoutEntry[] {
  const children = visibleNames(dir);
  if (children.length === 0) return [dotfileOnlyEntry('skill', root, dir)];

  const skillPath = join(dir, SKILL_FILE);
  if (children.includes(SKILL_FILE) && entryKind(skillPath) === 'file') {
    return [nestedGroupEntry(root, skillPath, name)];
  }
  return [noSkillFileEntry(root, dir)];
}

/**
 * A `<dir>/<group>/` holding no `SKILL.md` of its own: every markdown
 * file in it is the flat grouped layout, and every directory in it a
 * candidate for the nested one.
 */
function scanSkillGroup(root: string, dir: string, children: readonly string[]): LayoutEntry[] {
  const entries: LayoutEntry[] = [];
  for (const child of children) {
    const path = join(dir, child);
    const found = entryKind(path);
    if (found === null) {
      entries.push(unreadableEntry('skill', root, path));
      continue;
    }
    if (found === 'directory') {
      entries.push(...scanGroupMember(root, path, child));
      continue;
    }
    if (isMarkdown(child)) entries.push(flatGroupedEntry(root, path, markdownStem(child)));
  }

  if (entries.length === 0) return [noSkillFileEntry(root, dir)];
  return entries;
}

/**
 * A `<dir>/<name>/`: a `SKILL.md` in it is the registered layout and
 * everything beside it is that skill's own resources, so the scan
 * stops. Without one, the directory is read as a group.
 */
function scanSkillDirectory(root: string, dir: string, name: string): LayoutEntry[] {
  const children = visibleNames(dir);
  if (children.length === 0) return [dotfileOnlyEntry('skill', root, dir)];

  const skillPath = join(dir, SKILL_FILE);
  if (children.includes(SKILL_FILE) && entryKind(skillPath) === 'file') {
    return [skillFileEntry(skillPath, name)];
  }
  return scanSkillGroup(root, dir, children);
}

/** The skills directory itself. */
function scanSkillRoot(root: string): LayoutEntry[] {
  const entries: LayoutEntry[] = [];
  for (const name of visibleNames(root)) {
    const path = join(root, name);
    const found = entryKind(path);
    if (found === null) {
      entries.push(unreadableEntry('skill', root, path));
      continue;
    }
    if (found === 'directory') {
      entries.push(...scanSkillDirectory(root, path, name));
      continue;
    }
    if (isMarkdown(name)) entries.push(looseFileEntry(root, path, markdownStem(name)));
  }
  return entries;
}

/** Everything below the flat instincts directory, at any depth. */
function scanInstinctSubdirectory(root: string, dir: string): LayoutEntry[] {
  const children = visibleNames(dir);
  if (children.length === 0) return [dotfileOnlyEntry('instinct', root, dir)];

  const entries: LayoutEntry[] = [];
  for (const child of children) {
    const path = join(dir, child);
    const found = entryKind(path);
    if (found === null) {
      entries.push(unreadableEntry('instinct', root, path));
      continue;
    }
    if (found === 'directory') {
      entries.push(...scanInstinctSubdirectory(root, path));
      continue;
    }
    if (isMarkdown(child)) entries.push(nestedInstinctEntry(root, path, markdownStem(child)));
  }
  return entries;
}

/** The instincts directory itself. */
function scanInstinctRoot(root: string): LayoutEntry[] {
  const entries: LayoutEntry[] = [];
  for (const name of visibleNames(root)) {
    const path = join(root, name);
    const found = entryKind(path);
    if (found === null) {
      entries.push(unreadableEntry('instinct', root, path));
      continue;
    }
    if (found === 'directory') {
      entries.push(...scanInstinctSubdirectory(root, path));
      continue;
    }
    if (!isMarkdown(name)) continue;
    entries.push({
      kind: 'instinct',
      path,
      isFile: true,
      shape: 'instinct-file',
      name: markdownStem(name),
      issues: [],
    });
  }
  return entries;
}

/**
 * Walks `root` and names where everything in it sits.
 *
 * A missing directory, or a path holding a file, THROWS rather than
 * answering an empty scan: an empty answer is what a wrong path and a
 * tier with no skills both look like, and only one of those is worth
 * reporting as a clean run of zero.
 */
export function scanLayout(root: string, kind: CheckKind): LayoutScan {
  if (entryKind(root) !== 'directory') {
    throw new Error(`check layout: no ${kind} directory at ${root}`);
  }

  const entries = kind === 'skill'
    ? scanSkillRoot(root)
    : scanInstinctRoot(root);
  return {
    kind,
    root,
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

/**
 * The one layout rule that needs the file read: a skill's frontmatter
 * `name` is its directory's name, and a record's `id` is its file's.
 *
 * `declared` is what the schema parsed, so the checker passes the
 * value it already has rather than opening the file again. A null
 * `declared` — the field is absent or is not a string — answers null:
 * that is the schema's `missing-field`, and naming it twice would
 * count one file's one mistake as two rules broken.
 */
export function declaredNameIssue(entry: LayoutEntry, declared: string | null): LayoutIssue | null {
  if (entry.name === null || declared === null || declared === entry.name) return null;

  const field = entry.kind === 'skill'
    ? 'name'
    : 'id';
  const source = entry.kind === 'skill'
    ? 'directory name'
    : 'file name';
  return layoutIssue(
    'name-mismatch',
    `frontmatter ${field} "${declared}" is not the ${source} "${entry.name}"`,
  );
}

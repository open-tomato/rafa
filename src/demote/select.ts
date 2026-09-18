/**
 * Which directory the demotion pass may run over, where that directory
 * writes, and which of its files the pass looks at.
 *
 * `./classify.ts` answers what one file IS and `./report.ts` carries
 * the verdicts; this module answers the two questions ahead of both:
 * WHICH directory, and WHICH files in it. It is the only module of the
 * pass that reads a directory, and it writes nothing at all — a run
 * without `--apply` is this module plus the classifier plus one report
 * write, which is what makes "writing the report moves nothing" a
 * property of the code rather than a promise.
 *
 * ## The two directories, and why anything else is refused
 *
 * A skills directory is `<base>/.claude/skills`, and the `<base>` is
 * what decides the scope: the home makes it a user scope and any other
 * base a project one. So the scope is arithmetic over the path the line
 * named ({@link resolveDemotionScope}) and never a flag, and a
 * directory in any other shape answers null — the pass writes instincts
 * and moves originals under `<base>/.rafa/`, and a `<base>` derived
 * from a path that is not a skills directory would be a directory
 * nobody named.
 *
 * The comparison against the home is made on real paths, as
 * `../project/scope.ts` compares them and for its reason: a home
 * reached through a link, and a home spelled in another case on a
 * case-insensitive filesystem, are the same home, and reading the user
 * tier as a project scope would file every demoted instinct in
 * `~/.rafa/instincts` under `scope: project`.
 *
 * ## The selection, and the one place the two scopes differ
 *
 * Both scopes take every `<name>/SKILL.md`, which is the only shape
 * Claude Code registers. `learned/` is the directory `/learn` writes a
 * single-file skill into, and its files are the corpus the pass was
 * built for; they are taken by their `origin`:
 *
 *   - `origin: auto-extracted` — selected in either scope.
 *   - no `origin` at all — selected in either scope, and the
 *     classifier's `learned-without-origin` rule makes it
 *     `unclassified` for the review to decide.
 *   - any other `origin` — selected in a PROJECT scope, where the plan
 *     says "every skill", and passed over in a USER scope, where it
 *     says the auto-extracted ones. A user `learned/` file someone
 *     wrote by hand is therefore never in the report at all.
 *
 * Nothing else is selected: a loose `<dir>/<name>.md`, a nested
 * `<dir>/<group>/<name>/SKILL.md` and a directory holding no
 * `SKILL.md` register nothing, and demoting a file that registers
 * nothing would be the checker's job (`rafa skill check`) rather than
 * this pass's.
 *
 * ## What comes back with each file
 *
 * A {@link SelectedFile} is a {@link SkillSource} the classifier can
 * take, plus the three things the report and the apply step need and
 * nothing else can recover later: the absolute path, the
 * {@link sourceHash} of the text as it was read, and the mtime, which
 * is the extraction date for a body carrying no `**Extracted:**` line.
 * Reading them here means the file is opened ONCE per run and the hash
 * in the report is the hash of the bytes that were classified.
 */
import type { SkillSource } from './classify.js';
import type { InstinctScope } from '../schema/instinct.js';

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { MARKDOWN_EXTENSION, SKILL_FILE } from '../check/layout.js';
import { readFrontmatter } from '../schema/frontmatter.js';

import { LEARNED_DIRECTORY, ORIGIN_FIELD } from './classify.js';
import { sourceHash } from './report.js';

/** The last segment of a skills directory. */
export const SKILLS_DIRECTORY = 'skills';

/** The segment above it, which makes the directory Claude Code's. */
export const CLAUDE_DIRECTORY = '.claude';

/** The `origin` a `/learn` run writes, and the one the pass takes. */
export const AUTO_EXTRACTED_ORIGIN = 'auto-extracted';

/** The directory under `<base>/.rafa/` the originals move into. */
export const DEMOTED_PATH = join('.rafa', 'demoted');

/** The directory under `<base>/.rafa/` the instincts are written into. */
export const INSTINCTS_PATH = join('.rafa', 'instincts');

/** The report's name under {@link DEMOTED_PATH}. */
export const REPORT_FILE = 'report.md';

/** One skills directory, the scope it is, and where it writes. */
export interface DemotionScope {
  /** Which scope the demoted records are filed under. */
  readonly scope: InstinctScope;
  /** The skills directory itself, absolute. */
  readonly dir: string;
  /** `<base>`: the home for a user scope, the project root for a project one. */
  readonly base: string;
  /** `<base>/.rafa/demoted`, which the originals and the report go under. */
  readonly demotedDir: string;
  /** `<base>/.rafa/instincts`, which the records go into. */
  readonly instinctsDir: string;
  /** `<base>/.rafa/demoted/report.md`. */
  readonly reportPath: string;
}

/** One file the pass looks at, as this module read it. */
export interface SelectedFile extends SkillSource {
  /** The file itself, absolute. */
  readonly absolute: string;
  /** {@link sourceHash} of {@link SkillSource.text}. */
  readonly hash: string;
  /** The file's mtime as an ISO 8601 instant, for an undated body. */
  readonly mtime: string;
}

/** `path` with its links resolved, or as it was when nothing is there. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Whether two paths name the same place, links and case resolved where they can be. */
function samePath(left: string, right: string): boolean {
  if (left === right) return true;
  const resolved = realOrSelf(left);
  const other = realOrSelf(right);
  return resolved === other || resolved.toLowerCase() === other.toLowerCase();
}

/**
 * The scope `dir` is, or null when `dir` is no `<base>/.claude/skills`.
 * `home` decides between the two scopes; see the module note on why the
 * comparison is made on real paths.
 */
export function resolveDemotionScope(dir: string, home: string): DemotionScope | null {
  if (basename(dir) !== SKILLS_DIRECTORY) return null;
  const claude = dirname(dir);
  if (basename(claude) !== CLAUDE_DIRECTORY) return null;

  const base = dirname(claude);
  const demotedDir = join(base, DEMOTED_PATH);
  return {
    scope: samePath(base, home)
      ? 'user'
      : 'project',
    dir,
    base,
    demotedDir,
    instinctsDir: join(base, INSTINCTS_PATH),
    reportPath: join(demotedDir, REPORT_FILE),
  };
}

/** What kind of thing sits at `path`, or null when nothing readable does. */
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

/** The visible names directly under `dir`, sorted, or none when it cannot be read. */
function visibleNames(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

/** One file read, with everything the report and the apply step need. */
function readSelected(
  absolute: string,
  path: string,
  entries: readonly string[] | undefined,
): SelectedFile | null {
  let text: string;
  let mtime: string;
  try {
    text = readFileSync(absolute, 'utf8');
    mtime = statSync(absolute).mtime.toISOString();
  } catch {
    return null;
  }
  return { path, text, entries, absolute, hash: sourceHash(text), mtime };
}

/**
 * Whether a `learned/` file is selected in `scope`, by its `origin`.
 * See the module note: a user scope takes the auto-extracted ones and
 * the ones carrying no `origin`, and a project scope takes them all.
 */
export function selectsLearned(text: string, scope: InstinctScope): boolean {
  if (scope === 'project') return true;
  const origin = readFrontmatter(text)?.[ORIGIN_FIELD];
  if (origin === undefined || origin === null || origin === '') return true;
  return origin === AUTO_EXTRACTED_ORIGIN;
}

/** Every `learned/*.md` `scope` selects, in name order. */
function selectLearned(scope: DemotionScope): readonly SelectedFile[] {
  const dir = join(scope.dir, LEARNED_DIRECTORY);
  if (entryKind(dir) !== 'directory') return [];

  const selected: SelectedFile[] = [];
  for (const name of visibleNames(dir)) {
    if (!name.endsWith(MARKDOWN_EXTENSION) || name === MARKDOWN_EXTENSION) continue;
    const absolute = join(dir, name);
    if (entryKind(absolute) !== 'file') continue;

    const file = readSelected(absolute, `${LEARNED_DIRECTORY}/${name}`, undefined);
    if (file !== null && selectsLearned(file.text, scope.scope)) selected.push(file);
  }
  return selected;
}

/** Every `<name>/SKILL.md` under the directory, in name order. */
function selectSkillFiles(scope: DemotionScope): readonly SelectedFile[] {
  const selected: SelectedFile[] = [];
  for (const name of visibleNames(scope.dir)) {
    if (name === LEARNED_DIRECTORY) continue;
    const skillDir = join(scope.dir, name);
    if (entryKind(skillDir) !== 'directory') continue;

    const absolute = join(skillDir, SKILL_FILE);
    if (entryKind(absolute) !== 'file') continue;

    const file = readSelected(absolute, `${name}/${SKILL_FILE}`, visibleNames(skillDir));
    if (file !== null) selected.push(file);
  }
  return selected;
}

/**
 * Every file the pass looks at under `scope`, the `<name>/SKILL.md`
 * ones first and the `learned/` ones after, each in name order. See
 * the module note for what is left out and why.
 */
export function selectSources(scope: DemotionScope): readonly SelectedFile[] {
  return [...selectSkillFiles(scope), ...selectLearned(scope)];
}

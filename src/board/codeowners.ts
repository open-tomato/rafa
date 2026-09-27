/**
 * The repository's CODEOWNERS file, read the way GitHub reads it: where
 * the file is, which of its lines are rules, whose a path is, and which
 * lines name a given owner.
 *
 * `.rafa/specs/rafa-245-boards-several-roadmaps-per.md` gives a board its
 * folders from CODEOWNERS when the repository has the file, "read with
 * GitHub's own last-match rule so rafa and GitHub never disagree". The
 * rules below are GitHub's documentation for the file ("About code
 * owners", `github/docs`, read on 2026-09-27), with the pattern
 * translation taken from `hmarr/codeowners` (`match.go`), a Go reader
 * built to agree with GitHub where the documentation is silent.
 *
 * ## Where the file is
 *
 * {@link CODEOWNERS_LOCATIONS} lists `.github/CODEOWNERS`, `CODEOWNERS`
 * and `docs/CODEOWNERS` in the order GitHub searches them, and the FIRST
 * that is a regular file is the file: a later one is never read, even
 * when the first is empty. A directory named `CODEOWNERS` is not the
 * file. GitHub's 3 MB cap, above which it loads no file at all, is not
 * applied here.
 *
 * ## Lines
 *
 * {@link parseCodeowners} reads one rule per line: a pattern, then its
 * owners, separated by whitespace. A blank line and a line whose first
 * non-blank character is `#` are skipped silently; a later word opening
 * with `#` starts an inline comment, so it and the rest of the line are
 * dropped. An owner is `@login`, `@org/team` or an email address, kept as
 * written. A pattern with no owners is still a rule: it UNASSIGNS the
 * paths it matches, so a later empty line beats an earlier owned one.
 *
 * GitHub skips a line it cannot read, and so does this reader, recording
 * each in {@link Codeowners.skipped} with the reason: a pattern opening
 * with `!` (negation does not work in CODEOWNERS), one holding `[` or `]`
 * (character ranges do not work), one holding `***`, and a line whose
 * owner is neither handle nor address. Whether GitHub counts each of
 * these as invalid syntax, rather than as a pattern matching nothing, is
 * not measured here; either way the line owns nothing. Nothing throws on
 * a bad line, because one bad line would hide the rest of the file.
 *
 * ## Patterns
 *
 * Patterns follow gitignore's rules, case-sensitively, as
 * {@link matchesPattern} spells them:
 *
 * - A leading `/` anchors the pattern to the repository root. So does a
 *   `/` in its middle: `docs/*` is the root's `docs`, never `a/docs`. A
 *   pattern with no `/` but a trailing one matches at any depth: `apps/`
 *   is every `apps` folder, `*.js` every JavaScript file.
 * - A trailing `/` matches a directory: `/build/logs/` owns everything
 *   under `build/logs` and never a file named `logs`. A pattern without
 *   one matches the path itself or anything under it: `/apps/github`
 *   owns `apps/github` and `apps/github/x.ts`.
 * - `*` and `?` do not cross `/`, and a final `/*` is one level only:
 *   GitHub's own example has `docs/*` match `docs/getting-started.md`
 *   but not `docs/build-app/troubleshooting.md`.
 * - `**` does cross `/`: a `**` segment opening the pattern matches at
 *   any depth, one between two others zero or more folders, and one
 *   closing it everything under.
 * - A `\` makes the next character literal.
 *
 * ## Owners of a path
 *
 * {@link lastMatchingRule} answers the LAST rule whose pattern matches a
 * path, and {@link ownersOf} its owners: empty both when no rule matches
 * and when the last match unassigns. {@link rulesNaming} answers the rules
 * that name one owner, in file order; handles are compared case folded,
 * as GitHub compares logins and team slugs. A rule naming an owner still
 * loses the paths a later line matches, and that reading is the caller's.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Where GitHub looks for the file, repo-relative, in the order it looks. */
export const CODEOWNERS_LOCATIONS = Object.freeze([
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
] as const);

/** One rule: a line's pattern and the owners it names. */
export interface CodeownersRule {
  /** The pattern as written. */
  readonly pattern: string;
  /** The owners as written, in order; empty when the line unassigns. */
  readonly owners: readonly string[];
  /** The 1-based line it sits on. */
  readonly line: number;
}

/** Why a line that is not a comment was skipped. */
export type CodeownersSkipReason =
  /** A pattern opening with `!`. */
  | 'negation'
  /** A pattern holding `[` or `]`. */
  | 'character-range'
  /** A pattern holding three asterisks in a row. */
  | 'triple-asterisk'
  /** An owner that is neither `@handle` nor an email address. */
  | 'malformed-owner';

/** One line skipped as GitHub skips a line it cannot read. */
export interface CodeownersSkip {
  /** The 1-based line it sits on. */
  readonly line: number;
  /** The line, trimmed. */
  readonly text: string;
  /** Why it was skipped. */
  readonly reason: CodeownersSkipReason;
}

/** A CODEOWNERS file, read. */
export interface Codeowners {
  /** Where it was found, one of {@link CODEOWNERS_LOCATIONS}; null when parsed from text. */
  readonly path: string | null;
  /** Every rule, in file order. */
  readonly rules: readonly CodeownersRule[];
  /** Every skipped line, in file order. */
  readonly skipped: readonly CodeownersSkip[];
}

/** `@login` or `@org/team`: no whitespace, one optional slash. */
const HANDLE = /^@[^\s@/]+(?:\/[^\s@/]+)?$/u;

/** An email address, loosely: one `@` with text on both sides. */
const EMAIL = /^[^\s@]+@[^\s@]+$/u;

/** What separates the words of a line. */
const WORDS = /\s+/u;

/** The characters a regular expression reads as syntax. */
const REGEX_SYNTAX = /[.*+?^${}()|[\]\\/]/gu;

/** True when `owner` is a handle or an address. */
function isOwner(owner: string): boolean {
  return HANDLE.test(owner) || EMAIL.test(owner);
}

/** Why `pattern` and `owners` cannot be read, or null when they can. */
function skipReason(pattern: string, owners: readonly string[]): CodeownersSkipReason | null {
  if (pattern.startsWith('!')) return 'negation';
  if (pattern.includes('[') || pattern.includes(']')) return 'character-range';
  if (pattern.includes('***')) return 'triple-asterisk';
  if (!owners.every(isOwner)) return 'malformed-owner';
  return null;
}

/**
 * The CODEOWNERS text `text`, read into its rules and skipped lines.
 * Never throws; the module note holds why.
 */
export function parseCodeowners(text: string): Pick<Codeowners, 'rules' | 'skipped'> {
  const rules: CodeownersRule[] = [];
  const skipped: CodeownersSkip[] = [];

  text.split(/\r?\n/u).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const words = trimmed.split(WORDS);
    const comment = words.findIndex((word) => word.startsWith('#'));
    const [pattern = '', ...owners] = comment === -1
      ? words
      : words.slice(0, comment);
    const line = index + 1;
    const reason = skipReason(pattern, owners);

    if (reason === null) {
      rules.push(Object.freeze({ pattern, owners: Object.freeze(owners), line }));
    } else {
      skipped.push(Object.freeze({ line, text: trimmed, reason }));
    }
  });

  return { rules: Object.freeze(rules), skipped: Object.freeze(skipped) };
}

/** True when `path` is a regular file; false when absent or anything else. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The CODEOWNERS file in the repository at `root`, as a repo-relative
 * path: the first of {@link CODEOWNERS_LOCATIONS} that is a regular file,
 * or null when none is.
 */
export function findCodeowners(root: string): string | null {
  return CODEOWNERS_LOCATIONS.find((location) => isFile(join(root, location))) ?? null;
}

/**
 * The CODEOWNERS file in the repository at `root`, read; null when the
 * repository has none. A file found but unreadable throws, naming it:
 * reading it as absent would hand its paths to another rule.
 */
export function readCodeowners(root: string): Codeowners | null {
  const path = findCodeowners(root);
  if (path === null) return null;

  let text: string;
  try {
    text = readFileSync(join(root, path), 'utf8');
  } catch (error) {
    const why = error instanceof Error
      ? error.message
      : String(error);
    throw new Error(`Cannot read ${path}: ${why}`, { cause: error });
  }
  return Object.freeze({ path, ...parseCodeowners(text) });
}

/** The regular expression source for one ordinary pattern segment. */
function segmentSource(segment: string): string {
  let source = '';
  let isEscaped = false;
  for (const char of segment) {
    if (isEscaped) {
      source += char.replace(REGEX_SYNTAX, '\\$&');
      isEscaped = false;
    } else if (char === '\\') {
      isEscaped = true;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(REGEX_SYNTAX, '\\$&');
    }
  }
  return source;
}

/** The segments of `pattern`, anchored and with a trailing `/` spelled `**`. */
function patternSegments(pattern: string): readonly string[] {
  const split = pattern.split('/');
  const isSingle = split.length === 1 || (split.length === 2 && split[1] === '');
  const anchored = split[0] === ''
    ? split.slice(1)
    : split;
  const floating = split[0] !== '' && isSingle && split[0] !== '**'
    ? ['**', ...anchored]
    : anchored;
  return floating.length > 1 && floating.at(-1) === ''
    ? [...floating.slice(0, -1), '**']
    : floating;
}

/** The source for the `**` at `index` of `last + 1` segments. */
function globstarSource(index: number, last: number): string {
  if (index === 0) {
    return index === last
      ? '.+'
      : '(?:.+/)?';
  }
  return index === last
    ? '/.*'
    : '(?:/.+)?';
}

/** `pattern` as an anchored regular expression over repo-relative paths. */
function patternRegex(pattern: string): RegExp {
  if (pattern === '/') return /^$/u;

  const segments = patternSegments(pattern);
  const last = segments.length - 1;
  let source = '';
  let needsSlash = false;

  segments.forEach((segment, index) => {
    if (segment === '**') {
      source += globstarSource(index, last);
      needsSlash = index !== 0;
      return;
    }
    const slash = needsSlash
      ? '/'
      : '';
    if (segment === '*') {
      source += `${slash}[^/]+`;
    } else {
      const under = index === last
        ? '(?:/.*)?'
        : '';
      source += `${slash}${segmentSource(segment)}${under}`;
    }
    needsSlash = true;
  });

  return new RegExp(`^${source}$`, 'u');
}

/** `path` repo-relative: every leading `./` and `/` taken off. */
function repoRelative(path: string): string {
  let relative = path;
  while (relative.startsWith('./') || relative.startsWith('/')) {
    relative = relative.startsWith('/')
      ? relative.slice(1)
      : relative.slice(2);
  }
  return relative;
}

/**
 * True when the CODEOWNERS `pattern` matches `path`, a path relative to
 * the repository root (a leading `./` or `/` is taken off). The module
 * note holds the rules.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  return pattern !== '' && patternRegex(pattern).test(repoRelative(path));
}

/** The last rule of `file` matching `path`, or null when none does. */
export function lastMatchingRule(file: Pick<Codeowners, 'rules'>, path: string): CodeownersRule | null {
  const matching = file.rules.filter((rule) => matchesPattern(rule.pattern, path));
  return matching.at(-1) ?? null;
}

/**
 * The owners of `path` under `file`: the last matching rule's owners, or
 * none when no rule matches or the last match unassigns.
 */
export function ownersOf(file: Pick<Codeowners, 'rules'>, path: string): readonly string[] {
  return lastMatchingRule(file, path)?.owners ?? Object.freeze([]);
}

/** The rules of `file` naming `owner`, in file order, compared case folded. */
export function rulesNaming(file: Pick<Codeowners, 'rules'>, owner: string): readonly CodeownersRule[] {
  const wanted = owner.toLowerCase();
  return Object.freeze(file.rules.filter((rule) => rule.owners.some((named) => named.toLowerCase() === wanted)));
}

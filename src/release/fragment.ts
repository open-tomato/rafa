/**
 * One change fragment: the file a branch's wrap-up commits under
 * `release.fragments` instead of stamping a version, and the unit
 * `rafa release settle` later folds into one version on the base branch.
 *
 * ## The format
 *
 * ```text
 * ---
 * plan: rafa-247
 * title: rafa next --roadmap
 * level: minor
 * ---
 *
 * - next: one hop to a blocker's epic, and back home
 * ```
 *
 * A front matter block fenced by two `---` lines holds exactly three
 * fields, `plan`, `title` and `level`, one `key: value` line each, in
 * any order. The value is the rest of the line after the first colon,
 * trimmed, so a title may hold colons of its own; there is no quoting,
 * because nothing here needs it and a YAML reader would bring a second
 * spelling of every value. Below the block are the notes, one line per
 * area as the wrap-up session writes them. A note is one non-blank line,
 * trimmed; blank lines between notes carry nothing and are dropped.
 *
 * `level: none` is written, not implied: a plan that ships no bump still
 * commits a fragment, so a missing fragment and "no release" stay two
 * different readings. It is also the only level whose body may be empty;
 * a `patch` with no notes would fold into a changelog section with
 * nothing under its heading.
 *
 * ## Refusals
 *
 * {@link parseFragment} answers a {@link FragmentReading}: the fragment,
 * or one of four reasons with a sentence naming what was wrong. The
 * reasons are the ones the spec lists — a missing level, an unknown
 * level, an empty body under a level other than `none`, and a malformed
 * front matter. Malformed covers everything else about the block: no
 * opening or closing fence, a line that is not `key: value`, a key
 * other than the three, a key given twice, and a missing or unusable
 * `plan` or `title`. Windows line endings are read as plain ones, since
 * a checkout with `core.autocrlf` would otherwise refuse every fragment.
 *
 * ## Names
 *
 * {@link allocateFragmentName} answers `<plan id>.md`, and when that is
 * taken by a fragment still waiting unsettled, `<plan id>-2.md`, then
 * `-3`, and so on: the first free name. A plan id has to be usable both
 * as a file name and as one word of the receipt comment
 * `<!-- rafa:fragments <id> <id> -->`, so {@link FRAGMENT_PLAN_ID_PATTERN}
 * admits letters, digits, `.`, `_` and `-`, starting with a letter or a
 * digit — no separator, no space, no leading dot.
 *
 * {@link serializeFragment} writes the format back and throws on a
 * fragment the parser would refuse, so nothing this module writes is a
 * file it would then refuse to read. The level words and their order are
 * `PLAN_RELEASE_LEVELS` from `src/plan/parse.ts`, not a third spelling.
 */
import type { PlanReleaseLevel } from '../plan/parse.js';

import { PLAN_RELEASE_LEVELS } from '../plan/parse.js';

/** The fence line that opens and closes a fragment's front matter. */
export const FRAGMENT_FENCE = '---';

/** The file extension every fragment name carries. */
export const FRAGMENT_EXTENSION = '.md';

/**
 * What a plan id has to look like to name a fragment file and to be one
 * word of the receipt comment.
 */
export const FRAGMENT_PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The first suffix a second fragment of one plan takes: `-2`. */
const FIRST_REPEAT_SUFFIX = 2;

/** One change fragment, as parsed from or serialised to its file. */
export interface Fragment {
  /** The plan id the fragment belongs to, e.g. `rafa-247`. */
  readonly plan: string;
  /** The plan's title, one line, rendered into `{title}` of a heading. */
  readonly title: string;
  /** The bump this fragment asks for; `none` ships no version change. */
  readonly level: PlanReleaseLevel;
  /** The notes below the front matter, one trimmed non-blank line each. */
  readonly notes: readonly string[];
}

/** Why a fragment's text was refused. */
export type FragmentRefusal =
  /** The front matter carries no `level`, or an empty one. */
  | 'missing-level'
  /** The `level` is not one of `patch`, `minor`, `major`, `none`. */
  | 'unknown-level'
  /** No note below the front matter, under a level other than `none`. */
  | 'empty-body'
  /** The front matter block is not the three-field block this reads. */
  | 'malformed-front-matter';

/** What {@link parseFragment} answers: the fragment, or why not. */
export type FragmentReading =
  | { readonly ok: true; readonly fragment: Fragment }
  | {
    readonly ok: false;
    readonly reason: FragmentRefusal;
    /** One sentence naming what was wrong, for a caller to print. */
    readonly sentence: string;
  };

/** The three front matter keys, in the order the serialiser writes them. */
const FRONT_MATTER_KEYS = ['plan', 'title', 'level'] as const;

type FrontMatterKey = (typeof FRONT_MATTER_KEYS)[number];

function isFrontMatterKey(key: string): key is FrontMatterKey {
  return (FRONT_MATTER_KEYS as readonly string[]).includes(key);
}

function isReleaseLevel(value: string): value is PlanReleaseLevel {
  return (PLAN_RELEASE_LEVELS as readonly string[]).includes(value);
}

function refuse(reason: FragmentRefusal, sentence: string): FragmentReading {
  return { ok: false, reason, sentence };
}

/**
 * Why `plan` cannot name a fragment, or null when it can. Shared by the
 * parser, the serialiser and the name allocation, so the three agree.
 */
function planIdProblem(plan: string): string | null {
  if (plan === '') return 'the plan id is empty';
  if (!FRAGMENT_PLAN_ID_PATTERN.test(plan)) {
    return `the plan id ${JSON.stringify(plan)} is not letters, digits, '.', '_' and '-' starting with a letter or digit`;
  }
  return null;
}

/** The text split into lines, Windows line endings read as plain ones. */
function linesOf(text: string): readonly string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * The front matter's key/value pairs, or the sentence saying why the
 * block is malformed. `lines` are the lines between the two fences.
 */
function readFrontMatter(
  lines: readonly string[],
): { readonly values: ReadonlyMap<FrontMatterKey, string> } | { readonly problem: string } {
  const entries: [FrontMatterKey, string][] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    const key = colon < 0
      ? ''
      : line.slice(0, colon).trim();
    if (key === '') return { problem: `the line ${JSON.stringify(line)} is not key: value` };
    if (!isFrontMatterKey(key)) {
      return { problem: `the key ${JSON.stringify(key)} is not one of ${FRONT_MATTER_KEYS.join(', ')}` };
    }
    if (entries.some(([seen]) => seen === key)) return { problem: `the key ${key} is given twice` };
    entries.push([key, line.slice(colon + 1).trim()]);
  }
  return { values: new Map(entries) };
}

/** The level field read on its own, since it has refusals of its own. */
function readLevel(value: string | undefined): PlanReleaseLevel | FragmentReading {
  if (value === undefined || value === '') {
    return refuse('missing-level', 'The fragment declares no level.');
  }
  if (!isReleaseLevel(value)) {
    return refuse(
      'unknown-level',
      `The fragment's level is ${JSON.stringify(value)}, not one of ${PLAN_RELEASE_LEVELS.join(', ')}.`,
    );
  }
  return value;
}

/**
 * Read one fragment file's text. Answers the fragment, or a refusal
 * naming one of the four reasons in the module note.
 */
export function parseFragment(text: string): FragmentReading {
  const lines = linesOf(text);
  if (lines[0]?.trim() !== FRAGMENT_FENCE) {
    return refuse('malformed-front-matter', `The fragment does not open with a ${FRAGMENT_FENCE} line.`);
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === FRAGMENT_FENCE);
  if (close < 0) {
    return refuse('malformed-front-matter', `The fragment's front matter has no closing ${FRAGMENT_FENCE} line.`);
  }

  const frontMatter = readFrontMatter(lines.slice(1, close));
  if ('problem' in frontMatter) {
    return refuse('malformed-front-matter', `The fragment's front matter is malformed: ${frontMatter.problem}.`);
  }
  const plan = frontMatter.values.get('plan') ?? '';
  const planProblem = planIdProblem(plan);
  if (planProblem !== null) {
    return refuse('malformed-front-matter', `The fragment's front matter is malformed: ${planProblem}.`);
  }
  const title = frontMatter.values.get('title') ?? '';
  if (title === '') {
    return refuse('malformed-front-matter', 'The fragment\'s front matter is malformed: the title is empty.');
  }

  const level = readLevel(frontMatter.values.get('level'));
  if (typeof level !== 'string') return level;

  const notes = lines.slice(close + 1)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (notes.length === 0 && level !== 'none') {
    return refuse('empty-body', `The fragment of ${plan} is level ${level} and carries no notes.`);
  }
  return { ok: true, fragment: { plan, title, level, notes } };
}

/**
 * Why `fragment` could not be written so that {@link parseFragment}
 * reads it back unchanged, or null when it can.
 */
function fragmentProblem(fragment: Fragment): string | null {
  const planProblem = planIdProblem(fragment.plan);
  if (planProblem !== null) return planProblem;
  if (fragment.title === '' || fragment.title !== fragment.title.trim() || /[\r\n]/.test(fragment.title)) {
    return `the title ${JSON.stringify(fragment.title)} is not one trimmed non-empty line`;
  }
  if (!isReleaseLevel(fragment.level)) {
    return `the level ${JSON.stringify(fragment.level)} is not one of ${PLAN_RELEASE_LEVELS.join(', ')}`;
  }
  const badNote = fragment.notes.find((note) => note === '' || note !== note.trim() || /[\r\n]/.test(note));
  if (badNote !== undefined) return `the note ${JSON.stringify(badNote)} is not one trimmed non-empty line`;
  if (fragment.notes.length === 0 && fragment.level !== 'none') {
    return `level ${fragment.level} carries no notes`;
  }
  return null;
}

/**
 * The file text for `fragment`: the three-field front matter in the
 * order `plan`, `title`, `level`, a blank line, then one note per line,
 * ending in a newline. Throws when the fragment is one
 * {@link parseFragment} would refuse or read back differently.
 */
export function serializeFragment(fragment: Fragment): string {
  const problem = fragmentProblem(fragment);
  if (problem !== null) throw new Error(`Cannot write the fragment of ${fragment.plan}: ${problem}.`);
  const head = [
    FRAGMENT_FENCE,
    `plan: ${fragment.plan}`,
    `title: ${fragment.title}`,
    `level: ${fragment.level}`,
    FRAGMENT_FENCE,
  ];
  const body = fragment.notes.length === 0
    ? []
    : ['', ...fragment.notes];
  return `${[...head, ...body].join('\n')}\n`;
}

/**
 * The first free fragment file name for `plan`: `<plan>.md`, else
 * `<plan>-2.md`, `<plan>-3.md` and on. `taken` holds the file names
 * (not paths) already present in the fragments directory. Throws when
 * `plan` cannot name a fragment.
 */
export function allocateFragmentName(plan: string, taken: Iterable<string>): string {
  const problem = planIdProblem(plan);
  if (problem !== null) throw new Error(`Cannot name a fragment: ${problem}.`);
  const names = new Set(taken);
  const first = `${plan}${FRAGMENT_EXTENSION}`;
  if (!names.has(first)) return first;
  for (let suffix = FIRST_REPEAT_SUFFIX; ; suffix += 1) {
    const name = `${plan}-${suffix}${FRAGMENT_EXTENSION}`;
    if (!names.has(name)) return name;
  }
}

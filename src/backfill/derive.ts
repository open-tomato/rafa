/**
 * The backfill's deterministic half: the three fields a skill's
 * frontmatter can be filled with from tables and from its own bytes,
 * with no session and no judgement.
 *
 * The spec's backfill has four steps, and three of them need nobody to
 * read anything: `stack` for a skill whose DIRECTORY name names a
 * stack (the ECC corpus's `<stack>-<concern>` rule), `paths` from the
 * vocabulary's glob table for a non-agnostic `stack`, and
 * `when_to_use` from the template `"<trigger sentence>. Prevents:
 * <prevents>"`. The fourth step — `prevents` and `signal` themselves —
 * is the one that reads a body with judgement and belongs to
 * `./propose.ts`. This module is what runs before it and after it, and
 * running it twice changes nothing the second time.
 *
 * ## Plan, then apply
 *
 * {@link planDerivation} reads every skill of a directory and answers
 * one {@link DerivationAction} per file saying what it WOULD write,
 * without writing a byte. {@link applyDerivation} writes what the plan
 * holds and answers the plan as carried out. The split is
 * `src/demote/apply.ts`'s, for the same reason: a pass over a corpus
 * of two hundred files has to be reviewable before it runs.
 *
 * ## Every file it writes is checked, and a worse file is put back
 *
 * The derivation cannot check a candidate in a temporary directory the
 * way the demotion pass checks a record, because a skill's body
 * resolves against its OWN directory: a `SKILL.md` copied to a scratch
 * path names scripts that are not beside it there, so every skill with
 * a helper script would be refused for a reason that is an artifact of
 * the check. So the check happens in place and twice. The plan records
 * the failures the file ALREADY had ({@link DerivationAction.before}),
 * the apply writes and re-checks the same path, and a file that came
 * out with a failure it did not have before is RESTORED from the bytes
 * the plan read and reported `refused`.
 *
 * That is a narrower promise than "the file passes the checker", and
 * deliberately: most of the corpus fails something before the
 * derivation ever opens it (a dead body path, a home path in a fenced
 * command), and a derivation that refused those files would fill in
 * nothing at all. What it does promise is that no file leaves this
 * module in worse shape than it arrived, measured by the checker's own
 * stage, code and field.
 *
 * ## The body is never touched
 *
 * Every write goes through `writeFrontmatter`, which reassembles the
 * file from its own bytes: the body survives byte for byte, every key
 * the derivation does not name keeps its place and its spelling, and a
 * key the derivation adds is appended. A body is READ — the trigger
 * sentence comes out of its "When to Use" section — and never written.
 *
 * ## What each of the three fields is written from
 *
 *   - **`stack`** is written ONLY for a directory name the ECC table
 *     recognises ({@link stacksFromEccSkillName}), and then it
 *     REPLACES what the file carries rather than merging with it. The
 *     name is stronger evidence than a body scan: `--fix` infers
 *     `stack` from the fenced languages of a body, and a
 *     `kotlin-testing` whose examples are shell and YAML infers
 *     `[bash]` or `[agnostic]`. A union of the two would gate the
 *     skill into every Bash project, which is the failure nobody sees.
 *     A name the table does not recognise is left alone entirely —
 *     `verification-loop` is about no stack, and writing `[agnostic]`
 *     over an inferred list would be a loss.
 *   - **`paths`** is {@link stackPaths} over the stack the file ends
 *     the run with. It is written when the file carries no `paths`, and
 *     when this run changes `stack` — a stale `paths` beside a new
 *     `stack` gates the skill on the old language. A `paths` somebody
 *     wrote by hand, beside a `stack` this run does not touch, survives:
 *     a narrower gate than the table's is a decision, not a gap.
 *   - **`when_to_use`** is the template, for every skill carrying
 *     `prevents`. The trigger sentence is the first sentence of the
 *     body's "When to Use" section; a skill with no such section takes
 *     one from {@link DerivationOptions.triggers}, which is where the
 *     reviewed proposals arrive, and a skill with neither is left
 *     alone.
 *
 * ## Trimming, and why `description` is never rewritten
 *
 * The spec asks that `when_to_use` be trimmed together with
 * `description` to the 1,536-character listing cap. It never needs to
 * be: the schema caps `description` at 129 characters, so a pair at or
 * past 1,536 has a `when_to_use` of at least 1,407 and trimming that
 * one field always reaches the cap. {@link trimWhenToUse} therefore
 * spends the whole budget the description leaves and leaves the
 * description untouched — which is also what keeps this pass out of
 * the one field a human certainly wrote.
 *
 * A file whose `description` is ITSELF over the cap leaves no budget;
 * that file gets no `when_to_use` and says so, rather than getting a
 * one-character one.
 */
import type { LayoutEntry } from '../check/layout.js';
import type { CheckIssue } from '../check/run.js';
import type { StackName } from '../schema/stack.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { SKILL_FILE, scanLayout } from '../check/layout.js';
import { checkFile } from '../check/run.js';
import { bodySections, firstSentence, WHEN_TO_USE_HEADING } from '../demote/classify.js';
import { mergeFrontmatter, readFrontmatterDocument, writeFrontmatter } from '../schema/frontmatter.js';
import { countCharacters, LISTING_LIMIT } from '../schema/skill.js';
import { isStackList, stackPaths, stacksFromEccSkillName } from '../schema/stack.js';

/** The three fields the derivation writes, in the order it writes them. */
export const DERIVED_FIELDS: readonly string[] = ['stack', 'paths', 'when_to_use'];

/**
 * What `when_to_use` says, given a trigger sentence and a `prevents`:
 * the spec's template, with the one terminator {@link sentenceEnded}
 * guarantees between the two halves.
 */
export function renderWhenToUse(trigger: string, prevents: string): string {
  return `${sentenceEnded(trigger)} Prevents: ${prevents}`;
}

/** What the derivation did, or would do, with one file. */
export type DerivationKind = 'derived' | 'unchanged' | 'skipped' | 'refused';

/** Every kind, in the order a summary counts them. */
export const DERIVATION_KINDS: readonly DerivationKind[] = [
  'derived',
  'unchanged',
  'skipped',
  'refused',
];

/** The seams a derivation resolves against, and the triggers it was given. */
export interface DerivationOptions {
  /**
   * The project a body is consumed in, or null for a tier that has
   * none. Passed straight to the checker, so the before-and-after
   * readings are made the same way.
   */
  readonly projectRoot: string | null;
  /** The directories a command name in a body is looked up in. */
  readonly pathDirs: readonly string[];
  /**
   * A trigger sentence per skill NAME, for a skill whose body has no
   * "When to Use" section. This is where a reviewed proposal's
   * sentence arrives; absent, such a skill gets no `when_to_use`.
   */
  readonly triggers?: Readonly<Record<string, string>>;
}

/** One skill, and what the derivation makes of it. */
export interface DerivationAction {
  /** The file, absolute, as the layout scan found it. */
  readonly path: string;
  /** The skill name its directory implies, or null when its place implies none. */
  readonly name: string | null;
  /** What happens to it. */
  readonly kind: DerivationKind;
  /** One line a caller prints unedited, saying what and why. */
  readonly detail: string;
  /** The fields written, with their values, empty for every other kind. */
  readonly changes: Readonly<Record<string, unknown>>;
  /** The whole file as it would be written, or null when nothing is written. */
  readonly text: string | null;
  /** The file's bytes as the plan read them, or null when it read none. */
  readonly original: string | null;
  /** The checker failures the file carried BEFORE the derivation. */
  readonly before: readonly string[];
  /** The failures the write ADDED, which is why a `refused` file was put back. */
  readonly added: readonly string[];
}

/** Everything the derivation makes of one directory. */
export interface DerivationPlan {
  /** The directory, as it was passed in. */
  readonly root: string;
  /** One action per entry the layout scan found, in path order. */
  readonly actions: readonly DerivationAction[];
  /** How many actions came to each kind. */
  readonly counts: Readonly<Record<DerivationKind, number>>;
}

/** The string at `key`, or null when it is absent or another type. */
function stringAt(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string'
    ? value
    : null;
}

/** The list at `key` read as strings, or null when it is not a list. */
function stringListAt(
  data: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | null {
  const value = data[key];
  return Array.isArray(value)
    ? value.map((entry) => String(entry))
    : null;
}

/** Whether two string lists hold the same entries in the same order. */
function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * The stacks an ECC skill directory name declares, or null when the
 * table recognises nothing in it — which is the reading that leaves
 * `stack` alone rather than writing `[agnostic]` over it.
 */
export function eccStack(directory: string): readonly StackName[] | null {
  const stacks = stacksFromEccSkillName(directory);
  return stacks.length > 0
    ? stacks
    : null;
}

/**
 * The first sentence of the body's "When to Use" section, or the empty
 * string when the body has no such section or an empty one.
 */
export function triggerSentence(body: string): string {
  const section = bodySections(body).find((entry) => WHEN_TO_USE_HEADING.test(entry.title));
  return section === undefined
    ? ''
    : firstSentence(section.text);
}

/**
 * `whenToUse` cut to the budget `description` leaves under
 * {@link LISTING_LIMIT}, in codepoints, with trailing whitespace
 * dropped. The empty string when the description leaves no budget at
 * all; see this module's note on why the description itself is never
 * rewritten.
 */
export function trimWhenToUse(description: string, whenToUse: string): string {
  const budget = LISTING_LIMIT - 1 - countCharacters(description);
  if (budget <= 0) return '';
  if (countCharacters(whenToUse) <= budget) return whenToUse;

  return Array.from(whenToUse)
    .slice(0, budget)
    .join('')
    .replace(/\s+$/, '');
}

/** The failures of a check report, each as one comparable line. */
function failureLines(issues: readonly CheckIssue[]): readonly string[] {
  return issues
    .filter((issue) => issue.severity === 'failure')
    .map((issue) => `${issue.stage} ${issue.code} ${issue.field ?? '-'}: ${issue.message}`);
}

/** The entries of `after` that `before` does not already hold. */
function addedFailures(
  before: readonly string[],
  after: readonly string[],
): readonly string[] {
  const known = new Set(before);
  return after.filter((line) => !known.has(line));
}

/** An action that writes nothing. */
function inert(
  entry: LayoutEntry,
  kind: DerivationKind,
  detail: string,
  original: string | null = null,
): DerivationAction {
  return {
    path: entry.path,
    name: entry.name,
    kind,
    detail,
    changes: {},
    text: null,
    original,
    before: [],
    added: [],
  };
}

/** What the `stack` derivation writes for this file, or null. */
function stackChange(
  name: string,
  data: Readonly<Record<string, unknown>>,
): readonly StackName[] | null {
  const derived = eccStack(name);
  if (derived === null) return null;

  const current = stringListAt(data, 'stack');
  return current !== null && sameList(current, [...derived])
    ? null
    : derived;
}

/**
 * What the `paths` derivation writes, or null. The stack it gates on is
 * the one the file ends the run with, and a `paths` the file already
 * carries survives unless this run moved the stack under it.
 */
function pathsChange(
  data: Readonly<Record<string, unknown>>,
  stack: readonly string[] | null,
  stackMoved: boolean,
): readonly string[] | null {
  if (stack === null || !isStackList(stack)) return null;

  const derived = stackPaths(stack);
  if (derived.length === 0) return null;

  const current = stringListAt(data, 'paths');
  if (current === null || current.length === 0) return derived;
  if (!stackMoved) return null;

  return sameList(current, derived)
    ? null
    : derived;
}

/** What the `when_to_use` derivation writes, or null, with the reason it wrote none. */
interface WhenToUseOutcome {
  /** The value to write, or null when none is written. */
  readonly value: string | null;
  /** Why none is written, or null when one is. */
  readonly reason: string | null;
}

/** Nothing to write, for the stated reason. */
function noWhenToUse(reason: string | null): WhenToUseOutcome {
  return { value: null, reason };
}

/** What the `when_to_use` derivation makes of this file. */
function whenToUseChange(
  name: string,
  data: Readonly<Record<string, unknown>>,
  body: string,
  options: DerivationOptions,
): WhenToUseOutcome {
  const prevents = stringAt(data, 'prevents');
  if (prevents === null || prevents.trim() === '') return noWhenToUse(null);

  const fromBody = triggerSentence(body);
  const trigger = fromBody !== ''
    ? fromBody
    : options.triggers?.[name]?.trim() ?? '';
  if (trigger === '') {
    return noWhenToUse('prevents is set, but the body has no When to Use section and no trigger was given');
  }

  const template = renderWhenToUse(trigger, prevents.trim());
  const value = trimWhenToUse(stringAt(data, 'description') ?? '', template);
  if (value === '') {
    return noWhenToUse('the description leaves no room for when_to_use under the listing cap');
  }

  return value === stringAt(data, 'when_to_use')
    ? noWhenToUse(null)
    : { value, reason: null };
}

/**
 * `trigger` with one terminator: the template joins the sentence to
 * "Prevents:" with a space, and a first sentence cut at a `?` or with
 * no terminator at all would otherwise run into it.
 */
function sentenceEnded(trigger: string): string {
  return /[.!?]$/.test(trigger)
    ? trigger
    : `${trigger}.`;
}

/** The changes for one file, in {@link DERIVED_FIELDS} order. */
function fileChanges(
  name: string,
  data: Readonly<Record<string, unknown>>,
  body: string,
  options: DerivationOptions,
): { readonly changes: Record<string, unknown>; readonly notes: readonly string[] } {
  const changes: Record<string, unknown> = {};
  const notes: string[] = [];

  const stack = stackChange(name, data);
  if (stack !== null) changes['stack'] = [...stack];

  const paths = pathsChange(data, stack ?? stringListAt(data, 'stack'), stack !== null);
  if (paths !== null) changes['paths'] = [...paths];

  const whenToUse = whenToUseChange(name, data, body, options);
  if (whenToUse.value !== null) changes['when_to_use'] = whenToUse.value;
  if (whenToUse.reason !== null) notes.push(whenToUse.reason);

  return { changes, notes };
}

/** One skill planned: its bytes read, its changes computed, nothing written. */
function planFile(entry: LayoutEntry, options: DerivationOptions): DerivationAction {
  if (basename(entry.path) !== SKILL_FILE) {
    return inert(entry, 'skipped', `${basename(entry.path)} is no ${SKILL_FILE}, so it registers no skill`);
  }
  if (entry.name === null) {
    return inert(entry, 'skipped', 'its place implies no skill name, so no stack can be derived from it');
  }

  let original: string;
  try {
    original = readFileSync(entry.path, 'utf8');
  } catch (error) {
    return inert(entry, 'skipped', `the file cannot be read (${error instanceof Error
      ? error.message
      : String(error)})`);
  }

  const document = readFrontmatterDocument(original);
  if (document === null) {
    return inert(entry, 'skipped', 'the file opens with no --- block holding a YAML mapping', original);
  }

  const { changes, notes } = fileChanges(entry.name, document.data, document.body, options);
  if (Object.keys(changes).length === 0) {
    return inert(entry, 'unchanged', notes.length > 0
      ? notes.join('; ')
      : 'every field the derivation writes is already what it would write', original);
  }

  const before = failureLines(checkFile(entry.path, 'skill', {
    projectRoot: options.projectRoot,
    pathDirs: options.pathDirs,
    entry,
  }).issues);
  const written = DERIVED_FIELDS.filter((field) => Object.hasOwn(changes, field));

  return {
    path: entry.path,
    name: entry.name,
    kind: 'derived',
    detail: [`writes ${written.join(', ')}`, ...notes].join('; '),
    changes,
    text: writeFrontmatter(document, mergeFrontmatter(document.data, changes)),
    original,
    before,
    added: [],
  };
}

/** How many actions came to each kind. */
export function countDerivations(
  actions: readonly DerivationAction[],
): Readonly<Record<DerivationKind, number>> {
  const counts = Object.fromEntries(
    DERIVATION_KINDS.map((kind) => [kind, 0]),
  ) as Record<DerivationKind, number>;

  for (const action of actions) counts[action.kind] += 1;
  return counts;
}

/**
 * What the derivation would write across `root`, with every file read
 * and not one byte written. A missing directory THROWS, as
 * `scanLayout` does.
 */
export function planDerivation(root: string, options: DerivationOptions): DerivationPlan {
  const scan = scanLayout(root, 'skill');
  const actions = scan.entries.map((entry) => (entry.isFile
    ? planFile(entry, options)
    : inert(entry, 'skipped', 'the entry is no file to open')));

  return { root, actions, counts: countDerivations(actions) };
}

/**
 * Writes one planned file and re-checks it, answering the action as
 * carried out: `derived` when the check came out no worse than the
 * plan's reading, and `refused` with the file's own bytes put back when
 * it came out worse.
 */
function applyFile(action: DerivationAction, options: DerivationOptions): DerivationAction {
  if (action.text === null || action.original === null) return action;

  const current = readFileSync(action.path, 'utf8');
  if (current !== action.original) {
    return {
      ...action,
      kind: 'refused',
      detail: 'the file changed since the plan read it, so nothing was written',
      text: null,
    };
  }

  writeFileSync(action.path, action.text, 'utf8');
  const after = failureLines(checkFile(action.path, 'skill', {
    projectRoot: options.projectRoot,
    pathDirs: options.pathDirs,
  }).issues);
  const added = addedFailures(action.before, after);
  if (added.length === 0) return action;

  writeFileSync(action.path, action.original, 'utf8');
  return {
    ...action,
    kind: 'refused',
    detail: `the derived file fails a check it passed before, so it was put back — ${added.join('; ')}`,
    added,
  };
}

/**
 * Carries out `plan` and answers it as carried out. Every `derived`
 * action is written and re-checked in place; every other kind is
 * passed through untouched, so the answer is a plan a caller can
 * count and print the same way.
 */
export function applyDerivation(
  plan: DerivationPlan,
  options: DerivationOptions,
): DerivationPlan {
  const actions = plan.actions.map((action) => (action.kind === 'derived'
    ? applyFile(action, options)
    : action));

  return { root: plan.root, actions, counts: countDerivations(actions) };
}

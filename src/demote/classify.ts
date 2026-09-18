/**
 * The demotion pass's first half: which shape a skill file is in, why
 * the classifier says so, and the instinct an observation-shaped file
 * becomes. The pass exists because 122 of the 207 skills in the user
 * tier were written by `/learn` as the only durable place to put a
 * single observation, and under Q1 a single observation is an instinct
 * rather than a skill.
 *
 * Nothing here moves, writes or opens a file: {@link classifySkill}
 * takes a file's text and answers a verdict with the rule that decided
 * it, {@link convertToInstinct} takes the same text and answers a
 * record, and the report writer and the `--apply` step own every side
 * effect — so a wrong verdict costs a row in a markdown table, never a
 * file.
 *
 * ## The three shapes, and the order the rules are tried in
 *
 * The spec states the shapes twice over, and the two statements overlap
 * at the edge:
 *
 *   - OBSERVATION-SHAPED is "exactly one Problem section and one
 *     Solution section (at any heading level), no numbered procedure of
 *     three or more consecutive steps, and no referenced script".
 *   - PROCEDURE-SHAPED is "anything else that has a Problem or Solution
 *     section".
 *   - UNCLASSIFIED covers "a file with no Problem and Solution pair, a
 *     file with no frontmatter, and a `learned/*.md` file with no
 *     `origin`".
 *
 * A file carrying a Problem and no Solution answers to both the second
 * sentence (it HAS a Problem section) and the third (it has no PAIR).
 * This module reads the pair as the precondition: a file missing either
 * half is {@link RULE_VERDICTS} `unclassified`, not procedure. That is
 * the conservative direction — an unclassified row is decided by a human
 * in the review task, a procedure row is a file the pass leaves alone
 * forever — and it makes the verdicts a partition. The rules are tried
 * in the order the spec writes them and the FIRST to decide names the
 * reason, so a file with two Problem sections AND a numbered procedure
 * reads as `repeated-section`.
 *
 * ## Why the heading match is anchored, and what it deliberately misses
 *
 * Measured over the 200 skill directories of `~/.claude/skills` on
 * 2026-09-18, the headings are `## Problem` (111), `## Solution` (89)
 * and a long tail of `## Solution — <clause>`, `## Problem 2 — <clause>`
 * and `## The Problem`. One heading, `## Fitting a doc-dense module
 * under a line cap is a DELETION problem`, carries the word in a
 * sentence and is no Problem section at all. So {@link PROBLEM_HEADING}
 * and {@link SOLUTION_HEADING} anchor at the start of the heading text
 * after an optional `The`, reading every spelling in the tail and
 * refusing that one.
 *
 * It also misses `## The Core Problem`, which IS a Problem section. The
 * miss is deliberate: an anchored rule sends that file to
 * `no-section-pair` for a human to decide, where a contains-the-word
 * rule would silently demote the DELETION-problem one. Every rule here
 * fails towards the review.
 *
 * A numbered procedure is three or more numbered items in one RUN,
 * where a run survives blank lines, indented continuation lines and
 * fenced blocks and is broken by a heading or any other unindented line
 * ({@link numberedRuns}). The plan's rough grep counted numbered lines
 * anywhere in the file instead, reading `1.` in one paragraph and `2.`
 * ten paragraphs later as a procedure; this counts the list.
 *
 * ## The conversion, and the two fields the plan does not name
 *
 * {@link convertToInstinct} fills what the plan names — `trigger` from
 * the first sentence of "When to Use", Action from Solution, Cause from
 * Problem, {@link DEMOTED_SOURCE}, {@link DEMOTED_CONFIDENCE},
 * {@link DEMOTED_KIND}, a `silent` signal unless the body names an
 * error string, an empty `artifact`, evidence holding the original path
 * and the `**Extracted:**` date, and `scope` and `project_id` from the
 * scope — and two it does not, because `../schema/instinct.ts` requires
 * them of every record:
 *
 *   - **`usage_count` is {@link DEMOTED_USAGE_COUNT}, which is 1 and
 *     not the 0 the plan names.** `checkInstinctFrontmatter` refuses 0
 *     with `invalid-usage-count` (its floor is `DEFAULT_USAGE_COUNT`,
 *     1, documented there as "the one observation that filed it"), and
 *     `--apply` checks a record before writing it, so a record carrying
 *     0 would be refused on every demoted file and the pass would move
 *     nothing. `classify.test.ts` measures both halves: the converted
 *     record checks clean, and the same record with `usage_count: 0` is
 *     refused by name.
 *   - **`domain` is inferred** ({@link inferDomain}), because it is
 *     required and closed. The name decides where it can, the body
 *     second, {@link DEFAULT_DOMAIN} when neither says anything. It is
 *     a floor for the review, not a claim.
 *
 * The record answered is the one read back OUT of the rendered text, so
 * a caller can never hold a record the file it writes does not carry: a
 * conversion the schema would refuse answers `null` with the schema's
 * own issues beside it.
 */

import type { BodyReference } from '../check/references.js';
import type {
  Instinct,
  InstinctDomain,
  InstinctIssue,
  InstinctKind,
  InstinctScope,
  InstinctSignal,
  InstinctSource,
} from '../schema/instinct.js';

import { collectReferences } from '../check/references.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';
import { actionHash, parseInstinct, writeInstinct } from '../schema/instinct.js';

/** The directory `/learn` writes a single-file skill into. */
export const LEARNED_DIRECTORY = 'learned';

/** The frontmatter key the selection rule reads on a learned file. */
export const ORIGIN_FIELD = 'origin';

/** What the classifier can say about one file. */
export type DemotionVerdict = 'observation' | 'procedure' | 'unclassified';

/** Every verdict, in the order the spec names them. */
export const DEMOTION_VERDICTS: readonly DemotionVerdict[] = [
  'observation',
  'procedure',
  'unclassified',
];

/** Which rule decided a verdict. One code per RULE, as on a skill issue. */
export type ClassificationRule =
  /** The file opens with no readable `---` block. */
  | 'no-frontmatter'
  /** A `learned/*.md` whose frontmatter carries no `origin`. */
  | 'learned-without-origin'
  /** A Problem section, a Solution section, or both, absent. */
  | 'no-section-pair'
  /** More than one Problem section, or more than one Solution section. */
  | 'repeated-section'
  /** A numbered run of {@link PROCEDURE_STEP_MINIMUM} steps or more. */
  | 'numbered-procedure'
  /** The body names a script shipped with the skill. */
  | 'referenced-script'
  /** One of each section, no numbered procedure, no referenced script. */
  | 'observation-shape';

/** Every rule, in the order {@link classifySkill} tries them. */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  'no-frontmatter',
  'learned-without-origin',
  'no-section-pair',
  'repeated-section',
  'numbered-procedure',
  'referenced-script',
  'observation-shape',
];

/** The verdict each rule answers with. */
export const RULE_VERDICTS: Readonly<Record<ClassificationRule, DemotionVerdict>> = Object.freeze({
  'no-frontmatter': 'unclassified',
  'learned-without-origin': 'unclassified',
  'no-section-pair': 'unclassified',
  'repeated-section': 'procedure',
  'numbered-procedure': 'procedure',
  'referenced-script': 'procedure',
  'observation-shape': 'observation',
});

/** How many consecutive numbered steps make a body a procedure. */
export const PROCEDURE_STEP_MINIMUM = 3;

/** A heading opening a Problem section, at any level. */
export const PROBLEM_HEADING = /^(?:the\s+)?problem\b/i;

/** A heading opening a Solution section, at any level. */
export const SOLUTION_HEADING = /^(?:the\s+)?solution\b/i;

/** A heading opening the section `trigger` is drawn from. */
export const WHEN_TO_USE_HEADING = /^when\s+to\s+use\b/i;

/** The line a `/learn` extraction stamps its date on. */
export const EXTRACTED_LINE = /^\s*\*\*Extracted:\*\*\s*(\S+)/m;

/** Extensions that make a referenced path a script. */
export const SCRIPT_EXTENSIONS: readonly string[] = [
  '.sh', '.bash', '.zsh', '.py', '.rb', '.pl', '.js', '.mjs', '.cjs', '.ts',
];

/** A fenced block's opening or closing line. */
const FENCE_LINE = /^ {0,3}(?:```|~~~)/;

/** An ATX heading: up to three spaces, one to six hashes, then text. */
const HEADING_LINE = /^ {0,3}(#{1,6})\s+(.*)$/;

/** A numbered list item at list level: `1.` or `1)`, then content. */
const NUMBERED_ITEM = /^ {0,3}\d+[.)]\s+\S/;

/** A line indented far enough to continue the item above it. */
const CONTINUATION = /^ {2,}\S/;

/** A file the demotion pass considers, as the pass found it. */
export interface SkillSource {
  /**
   * Its path relative to the skills directory, in posix form:
   * `bun-spawn-child-readings/SKILL.md` or `learned/bash-shim.md`. The
   * `learned/` rule reads the first segment and nothing else does.
   */
  readonly path: string;
  /** The whole file, frontmatter included. */
  readonly text: string;
  /**
   * The names of the entries in the skill's own directory — its files
   * and its subdirectories, one segment each, `SKILL.md` included or
   * not. A path the body names resolves as a script only when it starts
   * with one of these, so a `learned/*.md`, which has no directory,
   * passes none and can reference no script.
   */
  readonly entries?: readonly string[];
}

/** What {@link classifySkill} answers. */
export interface Classification {
  /** The shape the file is in. */
  readonly verdict: DemotionVerdict;
  /** Which rule decided it; {@link RULE_VERDICTS} maps it to the verdict. */
  readonly rule: ClassificationRule;
  /** One line naming the rule, for the report's reason column. */
  readonly reason: string;
}

/** One markdown section: its heading, and everything under it. */
export interface BodySection {
  /** How many hashes opened it, 1 to 6. */
  readonly level: number;
  /** The heading text, without its hashes and without a closing run. */
  readonly title: string;
  /** The heading's 1-based line in the body, which excludes frontmatter. */
  readonly line: number;
  /**
   * Everything under the heading down to the next heading at the same
   * level or above, trimmed. A subsection stays INSIDE its parent, so
   * a Solution carrying `### Step one` keeps it.
   */
  readonly text: string;
}

/** One run of numbered items that nothing broke. */
export interface NumberedRun {
  /** How many items the run holds. */
  readonly steps: number;
  /** The first item's 1-based line in the body. */
  readonly line: number;
}

/** Where a converted record is filed, and what it is filed beside. */
export interface ConversionOptions {
  /** The tier the skills directory belongs to. */
  readonly scope: InstinctScope;
  /** The project hash for a project scope, absent or null for a user one. */
  readonly projectId?: string | null;
  /** Ids already used in the scope; a clash takes a numeric suffix. */
  readonly takenIds?: readonly string[];
  /** The instant the record is filed at, an ISO 8601 instant. */
  readonly now: string;
  /**
   * The file's mtime, used as the extraction date when the body
   * carries no {@link EXTRACTED_LINE}. Written into evidence as given.
   */
  readonly mtime: string;
}

/** What {@link convertToInstinct} answers. */
export interface Conversion {
  /** The record, read back out of {@link Conversion.text}, or null. */
  readonly instinct: Instinct | null;
  /** The file the record would be written as, or null when it is refused. */
  readonly text: string | null;
  /** Every schema rule the conversion broke. Empty on a clean record. */
  readonly issues: readonly InstinctIssue[];
}

/** `source` for a record the demotion pass files. */
export const DEMOTED_SOURCE: InstinctSource = 'demoted';

/** `confidence` for a demoted record: half, pending a use. */
export const DEMOTED_CONFIDENCE = 0.5;

/** `kind` for a demoted record, unless the review says otherwise. */
export const DEMOTED_KIND: InstinctKind = 'gotcha';

/** `signal` for a demoted record whose body names no error string. */
export const DEMOTED_SIGNAL: InstinctSignal = 'silent';

/**
 * `usage_count` for a demoted record. The plan says 0; the schema's
 * floor is 1 and refuses 0 with `invalid-usage-count`, and the
 * `--apply` step checks a record before writing it. See the module
 * note, and `classify.test.ts` for the pair of readings behind it.
 */
export const DEMOTED_USAGE_COUNT = 1;

/** The evidence key carrying the original file's path. */
export const EVIDENCE_PATH_KEY = 'path';

/** The evidence key carrying the extraction date. */
export const EVIDENCE_EXTRACTED_KEY = 'extracted';

/** `domain` when neither the name nor the body names one. */
export const DEFAULT_DOMAIN: InstinctDomain = 'general-best-practices';

/**
 * The words that put a record in a domain, most specific first: the
 * first pattern that matches the name decides, then the first that
 * matches the body. A floor for the review, not a claim.
 */
export const DOMAIN_MARKERS: readonly (readonly [InstinctDomain, RegExp])[] = [
  ['security', /\b(?:security|secret|credential|token|auth|csrf|xss|injection)\b/i],
  ['testing', /\b(?:test|tests|testing|spec|assertion|assert|mock|stub|fixture|coverage)\b/i],
  ['git', /\b(?:git|commit|rebase|worktree|branch|merge|checkout)\b/i],
  ['debugging', /\b(?:debug|debugging|traceback|reproduce|bisect)\b/i],
  ['code-style', /\b(?:lint|eslint|format|formatter|prettier|naming)\b/i],
  ['workflow', /\b(?:workflow|pipeline|release|deploy|build|ci|loop|dispatch)\b/i],
];

/**
 * What makes a quoted string an error string: the words a failure
 * announces itself with. Matched only inside inline code spans and
 * fenced blocks, never in prose, because prose says "cannot" about
 * everything and an error string is what a recurrence matches on.
 */
export const ERROR_WORDS
  = /\b(?:error|exception|traceback|panic|fatal|refused|denied|not found|no such|cannot|could not|failed|failure|unexpected|undefined)\b/i;

/** Abbreviations whose full stop does not end a sentence. */
export const SENTENCE_ABBREVIATIONS: readonly string[] = ['e.g', 'i.e', 'vs', 'cf', 'etc'];

/** Whether `value` is a string carrying something. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** `body` split into lines, with a CRLF terminator dropped. */
function bodyLines(body: string): string[] {
  return body.split('\n').map((line) => line.replace(/\r$/, ''));
}

/**
 * Every section `body` holds, in body order. A heading inside a fenced
 * block is not a heading: a shell block whose comment opens with `##`
 * would otherwise cut a section in half.
 */
export function bodySections(body: string): readonly BodySection[] {
  const lines = bodyLines(body);
  const headings: { level: number; title: string; index: number }[] = [];
  let fenced = false;

  lines.forEach((line, index) => {
    if (FENCE_LINE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const match = HEADING_LINE.exec(line);
    if (match === null) return;

    const [, hashes = '', title = ''] = match;
    headings.push({
      level: hashes.length,
      title: title.replace(/\s+#+\s*$/, '').trim(),
      index,
    });
  });

  return headings.map((heading, position) => {
    const next = headings.slice(position + 1)
      .find((other) => other.level <= heading.level);
    const end = next === undefined
      ? lines.length
      : next.index;

    return {
      level: heading.level,
      title: heading.title,
      line: heading.index + 1,
      text: lines.slice(heading.index + 1, end)
        .join('\n')
        .trim(),
    };
  });
}

/**
 * Every maximal run of numbered items in `body`, in body order. A run
 * survives a blank line, a line indented two spaces or more, and a
 * fenced block, because each of those is how a list item carries a
 * paragraph or a command; it is broken by a heading or by any other
 * unindented line, because that is where the list ended.
 */
export function numberedRuns(body: string): readonly NumberedRun[] {
  const runs: NumberedRun[] = [];
  let fenced = false;
  let steps = 0;
  let line = 0;

  const close = (): void => {
    if (steps > 0) runs.push({ steps, line });
    steps = 0;
  };

  bodyLines(body).forEach((text, index) => {
    if (FENCE_LINE.test(text)) {
      fenced = !fenced;
      return;
    }
    if (fenced || text.trim() === '') return;

    if (NUMBERED_ITEM.test(text)) {
      if (steps === 0) line = index + 1;
      steps += 1;
      return;
    }
    if (CONTINUATION.test(text)) return;

    close();
  });
  close();

  return runs;
}

/** A relative path whose last segment ends in {@link SCRIPT_EXTENSIONS}. */
export function isScriptPath(token: string): boolean {
  if (token.startsWith('/')) return false;

  const last = token.split('/')
    .at(-1) ?? '';
  return SCRIPT_EXTENSIONS.some((extension) => last.endsWith(extension));
}

/**
 * The first script `body` names out of the skill's OWN directory, or
 * null when it names none: a path reference ending in a script
 * extension whose first segment is one of `entries`. The ownership test
 * is what the rule is about, and it is the same one `../check/
 * references.ts` makes against the skill directory on disk.
 *
 * A shape test alone would be wrong by a measured margin: over the 125
 * `origin: auto-extracted` skills of `~/.claude/skills` on 2026-09-18,
 * a rule reading any `scripts/*.mjs` or `./*.js` as a script called
 * nine of them procedures — `scripts/build.mjs`, `./dist/index.js`,
 * `scripts/thing.ts` — and every one of those paths belongs to the
 * project the skill is ABOUT. Eight of the 200 directories ship any
 * file at all beside their `SKILL.md` and none of the eight is
 * auto-extracted, so over this corpus the rule correctly never fires.
 *
 * References come from `../check/references.ts`: code spans and shell,
 * text and unlabelled fences only, never a language fence full of
 * another project's imports. A bare `probe.awk` is not among them at
 * all — that reader answers a single-segment token as a command name —
 * so a skill has to name its script with a path to be seen here.
 */
export function referencedScript(
  body: string,
  entries: readonly string[] = [],
): BodyReference | null {
  const owned = new Set(entries.map((entry) => entry.replace(/^\.\//, '')));

  for (const reference of collectReferences(body)) {
    if (reference.kind !== 'path') continue;

    const token = reference.text.replace(/^\.\//, '');
    const [first = ''] = token.split('/');
    if (owned.has(first) && isScriptPath(token)) return reference;
  }

  return null;
}

/** Whether `path` is a `learned/` file rather than a skill directory. */
export function isLearnedFile(path: string): boolean {
  const [first] = path.split(/[\\/]/);
  return first === LEARNED_DIRECTORY;
}

/** One classification, so every rule answers the same shape. */
function decide(rule: ClassificationRule, reason: string): Classification {
  return { verdict: RULE_VERDICTS[rule], rule, reason };
}

/** The reason for a pair the body does not carry, naming the half missing. */
function pairReason(problems: number, solutions: number): string {
  if (problems === 0 && solutions === 0) {
    return 'the body carries no Problem section and no Solution section';
  }
  return problems === 0
    ? 'the body carries a Solution section and no Problem section, so there is no pair'
    : 'the body carries a Problem section and no Solution section, so there is no pair';
}

/** The reason for a section the body carries more than once. */
function repeatReason(problems: number, solutions: number): string {
  const counted = problems > 1
    ? `${problems} Problem sections`
    : `${solutions} Solution sections`;
  return `the body carries ${counted}, and an observation carries exactly one of each`;
}

/**
 * The shape `source` is in, and the rule that decided it. The rules
 * are tried in the order {@link CLASSIFICATION_RULES} lists them and
 * the first to decide answers, so a file breaking two of them is
 * reported under the first.
 */
export function classifySkill(source: SkillSource): Classification {
  const document = readFrontmatterDocument(source.text);
  if (document === null) {
    return decide('no-frontmatter', 'the file opens with no --- block holding a YAML mapping');
  }

  if (isLearnedFile(source.path) && !isFilled(document.data[ORIGIN_FIELD])) {
    return decide(
      'learned-without-origin',
      `a ${LEARNED_DIRECTORY}/ file whose frontmatter carries no ${ORIGIN_FIELD}`,
    );
  }

  const sections = bodySections(document.body);
  const problems = sections.filter((section) => PROBLEM_HEADING.test(section.title));
  const solutions = sections.filter((section) => SOLUTION_HEADING.test(section.title));

  if (problems.length === 0 || solutions.length === 0) {
    return decide('no-section-pair', pairReason(problems.length, solutions.length));
  }
  if (problems.length > 1 || solutions.length > 1) {
    return decide('repeated-section', repeatReason(problems.length, solutions.length));
  }

  const run = numberedRuns(document.body).find((each) => each.steps >= PROCEDURE_STEP_MINIMUM);
  if (run !== undefined) {
    return decide(
      'numbered-procedure',
      `a numbered procedure of ${run.steps} consecutive steps at line ${run.line}`,
    );
  }

  const script = referencedScript(document.body, source.entries ?? []);
  if (script !== null) {
    return decide(
      'referenced-script',
      `the body names the script ${script.text} at line ${script.line}`,
    );
  }

  return decide(
    'observation-shape',
    'one Problem section and one Solution section, no numbered procedure of '
    + `${PROCEDURE_STEP_MINIMUM} or more consecutive steps, and no referenced script`,
  );
}

/** The first section of `sections` whose title matches `heading`. */
function firstSection(
  sections: readonly BodySection[],
  heading: RegExp,
): BodySection | undefined {
  return sections.find((section) => heading.test(section.title));
}

/** `text` with its fenced blocks removed, so prose is all that is left. */
function withoutFences(text: string): string[] {
  const kept: string[] = [];
  let fenced = false;

  for (const line of bodyLines(text)) {
    if (FENCE_LINE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) kept.push(line);
  }

  return kept;
}

/** A list marker, a blockquote marker or emphasis, stripped from `line`. */
function stripMarkers(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, '')
    .replace(/\*\*|__|\*|`/g, '')
    .trim();
}

/** Whether a full stop at `index` of `text` closes an abbreviation. */
function isAbbreviation(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return SENTENCE_ABBREVIATIONS.some((word) => before.toLowerCase()
    .endsWith(word));
}

/**
 * The first sentence of `text`: its first paragraph or list item,
 * joined into one line with its markdown markers dropped, cut at the
 * first `.`, `!` or `?` followed by whitespace or the end that closes
 * no {@link SENTENCE_ABBREVIATIONS}. A paragraph with no terminator is
 * answered whole.
 */
export function firstSentence(text: string): string {
  const lines = withoutFences(text);
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return '';

  const collected = [lines[start] ?? ''];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*(?:[-*+]|\d+[.)]|#)/.test(line)) break;
    collected.push(line);
  }

  const joined = stripMarkers(collected.join(' ')).replace(/\s+/g, ' ');
  for (let index = 0; index < joined.length; index += 1) {
    if (!'.!?'.includes(joined[index] ?? '')) continue;
    if (isAbbreviation(joined, index)) continue;

    const next = joined[index + 1];
    if (next === undefined) return joined.slice(0, index + 1).trim();
    if (next === ' ') return joined.slice(0, index + 1).trim();
  }

  return joined.trim();
}

/**
 * The `trigger` a record takes: the first sentence of the "When to
 * Use" section, the frontmatter `description` when there is no such
 * section, and the first sentence of the Problem when there is neither.
 * A record with no trigger at all is refused by the schema rather than
 * given a placeholder here.
 */
export function demotedTrigger(
  sections: readonly BodySection[],
  data: Readonly<Record<string, unknown>>,
): string {
  const whenToUse = firstSection(sections, WHEN_TO_USE_HEADING);
  const fromSection = whenToUse === undefined
    ? ''
    : firstSentence(whenToUse.text);
  if (fromSection !== '') return fromSection;

  const description = data['description'];
  if (isFilled(description)) return description.trim();

  const problem = firstSection(sections, PROBLEM_HEADING);
  return problem === undefined
    ? ''
    : firstSentence(problem.text);
}

/** The `**Extracted:**` date `body` stamps, or null when it stamps none. */
export function extractedDate(body: string): string | null {
  const match = EXTRACTED_LINE.exec(body);
  return match?.[1] ?? null;
}

/**
 * The first error string `body` names inside an inline code span or a
 * fenced block, or null when it names none. What makes a string an
 * error string is {@link ERROR_WORDS}.
 */
export function errorString(body: string): string | null {
  let fenced = false;

  for (const line of bodyLines(body)) {
    if (FENCE_LINE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (ERROR_WORDS.test(line)) return line.trim();
      continue;
    }
    for (const span of line.matchAll(/`([^`\n]+)`/g)) {
      const inner = span[1] ?? '';
      if (ERROR_WORDS.test(inner)) return inner.trim();
    }
  }

  return null;
}

/**
 * The domain a record takes: the first {@link DOMAIN_MARKERS} pattern
 * the name matches, then the first the body matches, then
 * {@link DEFAULT_DOMAIN}. The name is asked first because it is the
 * skill's own summary of itself, where a body mentions everything.
 */
export function inferDomain(name: string, body: string): InstinctDomain {
  for (const [domain, pattern] of DOMAIN_MARKERS) {
    if (pattern.test(name)) return domain;
  }
  for (const [domain, pattern] of DOMAIN_MARKERS) {
    if (pattern.test(body)) return domain;
  }

  return DEFAULT_DOMAIN;
}

/**
 * `value` as an id the schema accepts: lowercase, every run of other
 * characters a single hyphen, and no hyphen at either end. Every one
 * of the 200 skill names measured on 2026-09-18 is already in that
 * shape, so this is a net under a name that is not.
 */
export function slugifyId(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `base`, or `base-2`, `base-3` and so on: the first id `taken` does not
 * already hold. The suffix stays inside the schema's id pattern, so a
 * clash never produces a record the checker refuses.
 */
export function uniqueInstinctId(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** The id a source takes before the clash suffix: its `name`, else its path. */
function sourceName(source: SkillSource, data: Readonly<Record<string, unknown>>): string {
  const declared = data['name'];
  if (isFilled(declared)) return slugifyId(declared);

  const segments = source.path.split(/[\\/]/)
    .filter((segment) => segment !== '');
  const last = segments.at(-1) ?? '';
  const stem = last.toUpperCase() === 'SKILL.MD'
    ? segments.at(-2) ?? ''
    : last.replace(/\.md$/i, '');

  return slugifyId(stem);
}

/**
 * `source` as an instinct record. The draft is rendered and read back,
 * so `instinct` and `text` always agree and a record the schema would
 * refuse comes back null with `issues` naming every rule it broke.
 * Nothing here decides whether the file SHOULD be demoted: that is
 * {@link classifySkill}, and the report's override column above it.
 */
export function convertToInstinct(
  source: SkillSource,
  options: ConversionOptions,
): Conversion {
  const document = readFrontmatterDocument(source.text);
  const data = document?.data ?? {};
  const body = document?.body ?? source.text;
  const sections = bodySections(body);

  const action = firstSection(sections, SOLUTION_HEADING)?.text ?? '';
  const named = errorString(body);
  const name = sourceName(source, data);
  const draft: Instinct = {
    id: uniqueInstinctId(name, options.takenIds ?? []),
    trigger: demotedTrigger(sections, data),
    kind: DEMOTED_KIND,
    domain: inferDomain(name, body),
    confidence: DEMOTED_CONFIDENCE,
    usageCount: DEMOTED_USAGE_COUNT,
    artifact: null,
    signal: named === null
      ? DEMOTED_SIGNAL
      : 'loud',
    scope: options.scope,
    projectId: options.projectId ?? null,
    source: DEMOTED_SOURCE,
    evidence: [{
      [EVIDENCE_PATH_KEY]: source.path,
      [EVIDENCE_EXTRACTED_KEY]: extractedDate(body) ?? options.mtime,
    }],
    createdAt: options.now,
    updatedAt: options.now,
    action,
    cause: firstSection(sections, PROBLEM_HEADING)?.text ?? '',
    actionHash: actionHash(action),
  };

  const text = writeInstinct(draft);
  const parsed = parseInstinct(text);

  return parsed.instinct === null
    ? { instinct: null, text: null, issues: parsed.issues }
    : { instinct: parsed.instinct, text, issues: parsed.issues };
}

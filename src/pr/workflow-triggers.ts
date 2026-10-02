/**
 * Whether any of a repository's workflow files runs on pull requests
 * into a given base branch.
 *
 * `rafa pr merge --skip-checks --yes` may answer its own question only
 * when nothing on GitHub was ever going to test the pull request. A
 * repository can define workflows and still test no pull request into a
 * base: `verify.yml` runs on `pull_request` into `main` only, so a pull
 * request into `stretch/1` reports no checks by design. This module
 * reads workflow file texts, already fetched by the caller, and answers
 * that question alone: no git, no provider, no terminal.
 *
 * ## How a workflow names a base
 *
 * Following GitHub's own filter rules:
 *
 *  - `on` as a string or a list naming `pull_request`, or as a map
 *    holding a `pull_request` key, is a pull-request trigger. Any other
 *    event (`push`, `pull_request_target`, `workflow_dispatch`) is not.
 *  - A trigger with neither `branches` nor `branches-ignore` names every
 *    base.
 *  - `branches` names a base when its patterns, read in order, leave it
 *    matched: a pattern matches it in, and a pattern opening with `!`
 *    takes a match listed before it back out. `branches-ignore` names a
 *    base when none of its patterns matches it.
 *  - A pattern is GitHub's filter glob: `*` is any run of characters but
 *    `/`, `**` any run including `/`, `?` zero or one of the preceding
 *    character, `+` one or more of it, `[...]` one character from a set
 *    or range of letters and digits, and `\` escapes the next character.
 *    GitHub's own page (workflow-syntax.md, "Filter pattern cheat
 *    sheet", read 2026-10-02) spells `?` that way, not as "any one
 *    character".
 *
 * ## The side an unreadable answer lands on
 *
 * A file that does not parse, a trigger shape this reader does not
 * know (a `pull_request` value that is neither empty nor a map, a filter
 * that is not a string or a list of strings, both filters at once, a
 * pattern that does not compile) names the base. Answering "names it"
 * keeps `--yes` refused, as `uncheckedCaseOf` in `./unchecked.ts` does
 * for a workflow count that could not be read: a reading this module
 * got wrong must never pass for "nothing tests this base", the answer
 * that relaxes the rule.
 *
 * YAML is parsed with `Bun.YAML.parse`, which reads the `on` key as the
 * string `"on"` (YAML 1.2), not as the boolean YAML 1.1 would make it.
 */

/** The event key a pull-request trigger is spelled with. */
const PULL_REQUEST_EVENT = 'pull_request';

/** A reading this module could not make, which answers as naming the base. */
const UNKNOWN = 'unknown';

/** What one workflow's trigger says about a base: names it, does not, or unknown. */
type TriggerReading = boolean | typeof UNKNOWN;

/** The characters `[...]` may hold in a GitHub filter pattern: letters, digits, ranges. */
const BRACKET_BODY = /^[A-Za-z0-9-]+$/;

/** Characters a regular expression gives meaning to, escaped when a pattern holds them literally. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

/**
 * Whether any of `workflowTexts` (each the whole text of one file under
 * `.github/workflows/`) holds a `pull_request` trigger naming `base`.
 * A text that does not parse, or whose trigger this reader does not
 * know, counts as naming it; see the module note.
 *
 * @param workflowTexts - The workflow files' texts, one entry per file.
 * @param base - The pull request's base branch, such as `stretch/1`.
 * @returns True when at least one workflow runs on pull requests into `base`.
 */
export function workflowsRunOnPullRequestsInto(workflowTexts: readonly string[], base: string): boolean {
  return workflowTexts.some((text) => workflowNamesBase(text, base));
}

/**
 * Whether one workflow file's text holds a `pull_request` trigger
 * naming `base`; an unparsable text or unknown shape answers true.
 *
 * @param workflowText - The whole text of one workflow file.
 * @param base - The pull request's base branch.
 * @returns True when the workflow runs on pull requests into `base`, or cannot be read.
 */
export function workflowNamesBase(workflowText: string, base: string): boolean {
  let document: unknown;
  try {
    document = Bun.YAML.parse(workflowText);
  } catch {
    return true;
  }
  return readWorkflow(document, base) !== false;
}

/** The trigger reading of one parsed workflow document. */
function readWorkflow(document: unknown, base: string): TriggerReading {
  if (!isPlainObject(document) || !('on' in document)) return UNKNOWN;
  const on = document.on;
  if (typeof on === 'string') return on === PULL_REQUEST_EVENT;
  if (Array.isArray(on)) {
    if (!on.every((event) => typeof event === 'string')) return UNKNOWN;
    return on.includes(PULL_REQUEST_EVENT);
  }
  if (!isPlainObject(on)) return UNKNOWN;
  if (!(PULL_REQUEST_EVENT in on)) return false;
  return readPullRequestTrigger(on[PULL_REQUEST_EVENT], base);
}

/** The reading of a `pull_request:` value: empty names every base, a map is read for its filters. */
function readPullRequestTrigger(trigger: unknown, base: string): TriggerReading {
  if (trigger === null || trigger === undefined) return true;
  if (!isPlainObject(trigger)) return UNKNOWN;
  const branches = trigger.branches;
  const ignored = trigger['branches-ignore'];
  if (branches !== undefined && ignored !== undefined) return UNKNOWN;
  if (branches !== undefined) return readBranches(branches, base);
  if (ignored !== undefined) return readBranchesIgnore(ignored, base);
  return true;
}

/** `branches`: matched in by a pattern, taken back out by a later `!` pattern; last match wins. */
function readBranches(filter: unknown, base: string): TriggerReading {
  const patterns = patternListOf(filter);
  if (patterns === null) return UNKNOWN;
  let named = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const matches = branchPatternMatches(negated
      ? pattern.slice(1)
      : pattern, base);
    if (matches === null) return UNKNOWN;
    if (matches) named = !negated;
  }
  return named;
}

/** `branches-ignore`: names the base when no pattern matches it; `!` has no meaning here. */
function readBranchesIgnore(filter: unknown, base: string): TriggerReading {
  const patterns = patternListOf(filter);
  if (patterns === null || patterns.some((pattern) => pattern.startsWith('!'))) return UNKNOWN;
  let anyMatch = false;
  for (const pattern of patterns) {
    const matches = branchPatternMatches(pattern, base);
    if (matches === null) return UNKNOWN;
    anyMatch = anyMatch || matches;
  }
  return !anyMatch;
}

/** A filter's patterns: a string is one pattern, a list must hold strings only; anything else is null. */
function patternListOf(filter: unknown): readonly string[] | null {
  if (typeof filter === 'string') return [filter];
  if (Array.isArray(filter) && filter.every((pattern) => typeof pattern === 'string')) return filter;
  return null;
}

/**
 * Whether GitHub's filter glob `pattern` (with no leading `!`) matches
 * the whole of `branch`; null when the pattern does not compile, such as
 * a `?` or `+` with no character before it or an unclosed `[`.
 *
 * @param pattern - One branch filter pattern, its `!` already removed.
 * @param branch - The branch name to test.
 * @returns Whether it matches, or null for a pattern this reader cannot read.
 */
export function branchPatternMatches(pattern: string, branch: string): boolean | null {
  const source = regexSourceOf(pattern);
  if (source === null) return null;
  try {
    return new RegExp(`^${source}$`).test(branch);
  } catch {
    return null;
  }
}

/** The regular-expression source for one filter pattern, or null when it does not compile. */
function regexSourceOf(pattern: string): string | null {
  let source = '';
  let quantifiable = false;
  let index = 0;
  while (index < pattern.length) {
    const char = pattern.charAt(index);
    if (char === '*') {
      const isDouble = pattern.charAt(index + 1) === '*';
      source += isDouble
        ? '.*'
        : '[^/]*';
      index += isDouble
        ? 2
        : 1;
      quantifiable = false;
    } else if (char === '?' || char === '+') {
      if (!quantifiable) return null;
      source += char;
      index += 1;
      quantifiable = false;
    } else if (char === '[') {
      const close = pattern.indexOf(']', index + 1);
      if (close === -1) return null;
      const body = pattern.slice(index + 1, close);
      if (!BRACKET_BODY.test(body)) return null;
      source += `[${body}]`;
      index = close + 1;
      quantifiable = true;
    } else if (char === '\\') {
      if (index + 1 >= pattern.length) return null;
      source += escapeRegex(pattern.charAt(index + 1));
      index += 2;
      quantifiable = true;
    } else {
      source += escapeRegex(char);
      index += 1;
      quantifiable = true;
    }
  }
  return source;
}

/** One literal character, escaped for a regular expression when it carries meaning there. */
function escapeRegex(char: string): string {
  return char.replace(REGEX_SPECIAL, '\\$&');
}

/** Whether a parsed YAML value is a mapping (not null, not a list). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

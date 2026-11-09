/**
 * What an upstream filing's text goes through before it reaches the board
 * of a tool the project consumes (`--upstream=<tool>`,
 * `.rafa/specs/rafa-751-report-rafa-gaps-bugs.md`, design points 4 and 5).
 *
 * ## The private-name rule
 *
 * {@link privateNameRule} answers a function that, unless this board's
 * visibility was read `PUBLIC`, replaces each of:
 *
 *   - this board's `owner/name`, as the gate read it
 *     (`UpstreamTarget.own`, `./upstream.ts`);
 *   - the bare repository name, the part after its `/`;
 *   - the filing package's name, each one given (the `package:` line of
 *     a bug's Versions block names it, `packages/rafa/src/bugs/versions.ts`)
 *
 * with {@link PRIVATE_SIBLING}, `a private sibling repository`. A
 * `PRIVATE`, `INTERNAL` or unread visibility is not public, so each keeps
 * the rule; a `PUBLIC` board answers the text unchanged.
 *
 * The names are matched in one pass, the longest first, so `owner/name`
 * is replaced whole rather than leaving its owner before a replaced bare
 * name, and a marker already written is never matched again. GitHub's
 * names hold no case, so each is matched ignoring case. A name is matched
 * whole: no letter, digit or `_` right before or after it, so `app` in
 * `application` stays, while `-`, `.`, `/`, `@` and space each end one,
 * and `components` in `components-workspace` is replaced. A leaked name
 * costs more than a word replaced too often, so the rule errs toward the
 * replacement. A blank name names nothing and is skipped.
 *
 * ## An upstream comment's redaction
 *
 * {@link upstreamCommentRedactor} answers the redaction `create-bug.ts`
 * runs over a bug before filing, for the text of a comment: the checkout's
 * roots and the home taken out by `localPathRedactor`
 * (`packages/rafa/src/triage/local-paths.ts`), every root in one pass,
 * then every secret `namedSecrets` names replaced by `redactSecrets`
 * (`packages/rafa/src/triage/filed-text.ts`), in that order, as triage
 * composes the two. The private-name rule is not part of it: a caller
 * runs both, the redaction first, since a path's folders may hold the
 * repository's name and the redaction takes the whole path out.
 *
 * Neither reads a file, a variable or `gh`: what they work from is what
 * the caller hands them.
 */
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { SecretEnvironment } from '@open-tomato/rafa/triage/filed-text';

import { namedSecrets, redactSecrets } from '@open-tomato/rafa/triage/filed-text';
import { localPathRedactor } from '@open-tomato/rafa/triage/local-paths';

/** What stands for a private board's repository and package names upstream. */
export const PRIVATE_SIBLING = 'a private sibling repository';

/** The characters that continue a name: one before or after a match makes it part of a longer word. */
const NAME_CHARACTER = '[A-Za-z0-9_]';

/** What the private-name rule reads: this board, whether it is public, and the filing package's names. */
export interface PrivateNames {
  /** This board's repository, `owner/name`. */
  readonly own: string;
  /** True only when `gh` answered this board's visibility `PUBLIC`. */
  readonly ownIsPublic: boolean;
  /** The filing package's name, each one given; none for a filing naming no package. */
  readonly packages: readonly string[];
}

/** What an upstream comment is redacted of: the checkout's roots, the home, and the secrets' sources. */
export interface UpstreamCommentRedaction {
  /** The checkout the command runs in and the project root, each taken out as `.`. */
  readonly roots: readonly string[];
  /** The home directory, taken out as `[redacted: HOME]`. */
  readonly home: string;
  /** The config naming `env` prerequisites, each one a secret. */
  readonly config: Pick<RafaConfig, 'prerequisitesRequired' | 'prerequisitesOptional'>;
  /** The environment the secrets' values are read from. */
  readonly env: SecretEnvironment;
}

/** A text matched literally inside a regular expression. */
function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The bare name of an `owner/name`, the part after its `/`, or the whole when it holds none. */
function bareName(repository: string): string {
  const slash = repository.indexOf('/');
  return slash < 0
    ? repository
    : repository.slice(slash + 1);
}

/** Each name the rule replaces, once, longest first; blank ones left out. */
function namesOf(names: PrivateNames): readonly string[] {
  const all = [names.own, bareName(names.own), ...names.packages]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const byCase = new Map(all.map((name) => [name.toLowerCase(), name]));
  return [...byCase.values()].sort((a, b) => b.length - a.length);
}

/** The text unchanged: what a public board's rule answers. */
function unchanged(text: string): string {
  return text;
}

/**
 * The function that replaces a private board's repository and package
 * names with {@link PRIVATE_SIBLING}, or answers a text unchanged for a
 * `PUBLIC` board. See the module note.
 */
export function privateNameRule(names: PrivateNames): (text: string) => string {
  if (names.ownIsPublic) return unchanged;
  const replaced = namesOf(names);
  if (replaced.length === 0) return unchanged;
  const alternatives = replaced.map(literalPattern).join('|');
  const matcher = new RegExp(`(?<!${NAME_CHARACTER})(?:${alternatives})(?!${NAME_CHARACTER})`, 'gi');
  return (text) => text.replace(matcher, PRIVATE_SIBLING);
}

/**
 * The function that takes local paths, then named secrets, out of an
 * upstream comment's text. See the module note.
 */
export function upstreamCommentRedactor(redaction: UpstreamCommentRedaction): (text: string) => string {
  const local = localPathRedactor(redaction.roots, redaction.home);
  const secrets = namedSecrets(redaction.config, redaction.env);
  return (text) => redactSecrets(local(text), secrets);
}

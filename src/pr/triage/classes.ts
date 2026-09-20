/**
 * What a triage can conclude, and which of those conclusions another
 * session is allowed to act on.
 *
 * `rafa pr triage` assesses a red pull request in CODE, and the whole
 * point of assessing it in code is that the answer is drawn from a
 * CLOSED set: a caller switches on it, a comment stores it, a re-run
 * compares against it, and `--resolve` looks it up to decide whether a
 * plan exists for it. A tenth class invented at a call site would be
 * stored in a comment nothing can read back and would silently make a
 * pull request ineligible for a resolve that should have run. So the
 * list lives here, once, frozen, with the eligibility rule beside it.
 *
 * Nothing in this module reads a pull request's checks, its conflict or
 * its logs — {@link TriageClass} is what those readers ANSWER, not how
 * they answer it. The classifier is `./classify.ts`; this module is the
 * vocabulary it is held to, and it is pure and dependency-free so that
 * the comment reader, the re-run readings and the resolve plans can all
 * import the same words without importing the classifier.
 *
 * ## Simple, and why it is not a property of the class alone
 *
 * SIMPLE means "a pinned resolve plan can fix this without judgement".
 * Two classes are simple whoever opened the pull request: a lockfile
 * conflict is resolved by taking the base's lockfile and reinstalling,
 * and a manifest conflict by keeping both sides' entries and the higher
 * version where both bumped one. Neither needs to know what the pull
 * request was FOR.
 *
 * The other two — {@link DEPENDENCY_BUMP_SIMPLE_CLASSES}, a failing
 * install or a failing lint — are simple only on a dependency bump. On
 * a bump, a red install or lint is the bump's own mechanical fallout
 * and the fix is bounded. On a human pull request, the same two classes
 * are the author's code being wrong, which is the work itself and not a
 * conflict to clear. That is why {@link isSimpleTriageClass} takes the
 * bump reading as an argument rather than a class carrying `simple` as
 * a field: the same class is eligible on one pull request and assessed
 * only on the next.
 *
 * ## How a dependency bump is recognised
 *
 * Two readings, either one enough
 * (`.rafa/specs/rafa-20-pr-commands.md`): the author is one of
 * {@link DEPENDENCY_BUMP_AUTHORS} — both of dependabot's login
 * spellings, the app path `gh` itself writes and the bracketed one the
 * payloads carry — or the title opens
 * {@link DEPENDENCY_BUMP_TITLE_PREFIX}. The title reading is kept
 * beside the author one because a bump does not always come from the
 * bot — a `chore(deps): bump …` branch pushed by hand, or a bot run
 * through a token that commits as somebody else, reads red in exactly
 * the same mechanical way.
 *
 * The prefix is `chore(deps`, open on the right on purpose, so that
 * `chore(deps):` and `chore(deps-dev):` both match; dependabot writes
 * the second for a devDependency. Both readings fold case and the title
 * one trims leading whitespace, because a retitled `Chore(deps): …` is
 * the same pull request and GitHub itself matches logins without
 * regard to case. Neither reading looks at labels: a `dependencies`
 * label is repository configuration, absent on a repository that never
 * set one up, and its absence must not make a bump unrecognisable.
 */
import type { PullRequestSummary } from '../types.js';

/**
 * What one triage concluded about one pull request.
 *
 * Exactly one of these is the answer, so the set covers the reasons a
 * pull request is NOT actionable (`green`, `pending`) beside the ones
 * that make it red. `ci-other` and `conflict-other` are the deliberate
 * catch-alls: a failing step nothing recognises is still reported and
 * still commented, it is simply never resolved automatically.
 */
export type TriageClass
  = | 'green'
    | 'pending'
    | 'conflict-lockfile'
    | 'conflict-manifest'
    | 'conflict-other'
    | 'ci-install'
    | 'ci-lint'
    | 'ci-types'
    | 'ci-test'
    | 'ci-other';

/**
 * Every class, in the order a listing and the closed-set test read
 * them: the two non-red readings, then the conflicts, then the CI
 * failures. Frozen, because a caller that pushed onto it would change
 * what every later reader accepts.
 */
export const TRIAGE_CLASSES: readonly TriageClass[] = Object.freeze([
  'green',
  'pending',
  'conflict-lockfile',
  'conflict-manifest',
  'conflict-other',
  'ci-install',
  'ci-lint',
  'ci-types',
  'ci-test',
  'ci-other',
] as const);

/**
 * Whether a value is one of {@link TRIAGE_CLASSES}.
 *
 * The reader of a stored triage comment is what this is for: a `class`
 * field written by an older rafa, or edited by hand, is untrusted text
 * until it has been through here.
 */
export function isTriageClass(value: unknown): value is TriageClass {
  return typeof value === 'string'
    && (TRIAGE_CLASSES as readonly string[]).includes(value);
}

/**
 * The classes that are simple on any pull request at all.
 *
 * Both are conflicts over a generated or near-generated file, where the
 * resolution is mechanical and the pinned plan needs nothing from the
 * pull request's intent.
 */
export const SIMPLE_TRIAGE_CLASSES: readonly TriageClass[] = Object.freeze([
  'conflict-lockfile',
  'conflict-manifest',
] as const);

/**
 * The classes that are simple only on a dependency bump; see the module
 * note for why the distinction is not a property of the class.
 */
export const DEPENDENCY_BUMP_SIMPLE_CLASSES: readonly TriageClass[] = Object.freeze([
  'ci-install',
  'ci-lint',
] as const);

/**
 * The logins whose pull requests are dependency bumps by authorship
 * alone. Two, because dependabot answers under two spellings and only
 * one of them is what `gh` writes: `src/pr/gh-fake-shapes.ts` records,
 * off `cli/cli`'s own dependabot pull requests, that a bot author is
 * `{"is_bot","login"}` whose login is the app path `app/dependabot`,
 * NOT `dependabot[bot]`. The bracketed spelling is what the REST and
 * webhook payloads carry, so it is kept beside the app path rather than
 * replaced by it. A third bot is added here rather than at a call site,
 * so every reader agrees about which accounts those are.
 */
export const DEPENDENCY_BUMP_AUTHORS: readonly string[] = Object.freeze([
  'dependabot[bot]',
  'app/dependabot',
] as const);

/**
 * What a dependency bump's title opens with. Open on the right so that
 * `chore(deps):` and `chore(deps-dev):` both match.
 */
export const DEPENDENCY_BUMP_TITLE_PREFIX = 'chore(deps';

/**
 * The part of a pull request the bump reading needs: who opened it and
 * what it is called.
 *
 * Spelled as a `Pick` of {@link PullRequestSummary} rather than its own
 * interface so that a summary or a detail is passed straight in, and so
 * that a rename on the port reaches this reading through the compiler.
 */
export type DependencyBumpReading = Pick<PullRequestSummary, 'title' | 'author'>;

/**
 * Whether a pull request is a dependency bump: authored by a known bot,
 * or titled as one. Either reading alone is enough; see the module note.
 */
export function isDependencyBump(pr: DependencyBumpReading): boolean {
  const login = pr.author.login.toLowerCase();
  const byAuthor = DEPENDENCY_BUMP_AUTHORS
    .some((known) => known.toLowerCase() === login);
  const byTitle = pr.title
    .trimStart()
    .toLowerCase()
    .startsWith(DEPENDENCY_BUMP_TITLE_PREFIX);
  return byAuthor || byTitle;
}

/**
 * Whether a class is eligible for `rafa pr triage --resolve` on a pull
 * request with this bump reading.
 *
 * The one rule: {@link SIMPLE_TRIAGE_CLASSES} always, and
 * {@link DEPENDENCY_BUMP_SIMPLE_CLASSES} when `dependencyBump` is true.
 * Everything else — including `green` and `pending`, which are not
 * failures to resolve at all — is assessed only.
 *
 * The bump reading is taken as an already-read boolean rather than as a
 * pull request, because a re-run reads its class and its `simple` flag
 * back out of a stored comment, where the pull request behind them may
 * since have been retitled.
 */
export function isSimpleTriageClass(
  triageClass: TriageClass,
  options: { readonly dependencyBump: boolean },
): boolean {
  if (SIMPLE_TRIAGE_CLASSES.includes(triageClass)) return true;
  return options.dependencyBump
    && DEPENDENCY_BUMP_SIMPLE_CLASSES.includes(triageClass);
}

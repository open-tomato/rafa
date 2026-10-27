/**
 * The one sentence rafa says about a merge conflict, and the bullet
 * form the wrap-up prompt puts it in.
 *
 * Two places tell an agent what to do when merging the base into a
 * branch raises a conflict: the wrap-up prompt, which merges before it
 * pushes (`../start/wrap-up.ts`), and the pinned resolve plans, which
 * are run for a pull request already classified as conflicting
 * (`./plans/load.ts`). They must say the SAME thing — a wrap-up that
 * resolved a lockfile itself and a resolve plan that stopped for one
 * would be the same tree answering two ways — and nothing in this repo
 * compares two prose paragraphs, so a second copy would drift silently
 * and never be reported. Hence one exported string, read by both.
 *
 * ## What the sentence decides, and why it is worded this way
 *
 * The split is MECHANICAL versus SEMANTIC, and the sentence names the
 * mechanical cases exhaustively rather than gesturing at them: version
 * bumps, lockfiles, generated artifacts, and complementary additions.
 * An agent handed "resolve trivial conflicts" stops for a `bun.lock`,
 * which is the single most common conflict a dependency-bump branch
 * raises and the one that is never a judgement call. The deliberate
 * pin is carved out because a branch that pinned a version on purpose
 * is the one case where taking the base's version silently undoes the
 * work under review.
 *
 * The stop branch is as explicit as the resolve branch for the same
 * reason in reverse: an agent told only what to resolve resolves
 * everything. So a genuine semantic conflict commits NOTHING, and what
 * it reports — the paths and both sides' intent — is stated, because a
 * stop that reports "there was a conflict" costs the human the whole
 * diagnosis again.
 *
 * ## Prose, not a bullet
 *
 * {@link MECHANICAL_CONFLICT_SENTENCE} carries no list marker. The
 * pinned plans drop it into a `rafa:context` block as a paragraph, and
 * the wrap-up prompt is a list of bullets, so the marker belongs to the
 * caller: {@link mechanicalConflictBullet} is the wrap-up's form of it
 * and lives here so the two readers share the sentence rather than the
 * sentence plus a stray `* ` one of them has to strip.
 *
 * The wrap-up prompt's FIRST LINE is the `wrap-up` classifier key that
 * `PROMPT_SHAPES` reads out of `../start/wrap-up.ts` (`effort/classify.ts`),
 * and this sentence is not it: nothing here may be moved to the head of
 * that prompt.
 */

/**
 * What an agent does when merging the base raises a conflict, as one
 * paragraph with no list marker; see the module note.
 */
export const MECHANICAL_CONFLICT_SENTENCE = 'Resolve MECHANICAL conflicts yourself and do not stop for them: dependency version bumps (take the base\'s version unless this branch deliberately pinned it, and say which in the commit), lockfiles, generated artifacts, and complementary additions where both sides appended different material to the same file (keep BOTH). Stop only for a genuine semantic conflict — two sides changing the same behaviour incompatibly. In that case commit nothing, leave the branch as it is, and report the conflicting paths and both sides\' intent, so a human decides.';

/**
 * {@link MECHANICAL_CONFLICT_SENTENCE} as one bullet of the wrap-up
 * prompt's list.
 */
export function mechanicalConflictBullet(): string {
  return `* ${MECHANICAL_CONFLICT_SENTENCE}`;
}

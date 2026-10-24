/**
 * Quoting a word for a POSIX shell.
 *
 * A word reaches a shell from more than one place: a preflight probe
 * names a remote's host, a printed remedy names a branch or a path, and
 * a step list prints the git command a reader can run by hand. Each of
 * those words is read off a checkout or a config, so none is trusted: a
 * quote or a space in it would otherwise end the string around it.
 * {@link shellQuote} is the one quoter they call, so two of them never
 * disagree on how a word is written.
 */

/** A word a shell takes as it stands; anything else is quoted. */
const PLAIN_WORD = /^[A-Za-z0-9._:/-]+$/;

/** The quote a shell word is wrapped in. */
const QUOTE = '\'';

/** A single quote inside a single-quoted shell word: `'\''`. */
const QUOTED_QUOTE = '\'\\\'\'';

/**
 * `word` as one shell word: left as it stands when it is plain, so a
 * printed line stays readable, and single-quoted otherwise, each single
 * quote inside it written `'\''`.
 */
export function shellQuote(word: string): string {
  return PLAIN_WORD.test(word)
    ? word
    : QUOTE + word.split(QUOTE).join(QUOTED_QUOTE) + QUOTE;
}

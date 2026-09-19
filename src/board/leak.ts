/**
 * The refusal that keeps a machine path or a credential off the board:
 * the shapes a body is read for, the line each match is named by, and
 * the sentence the refusal carries.
 *
 * Issues on this repository are public, and `plan create --issue` turns
 * an issue body into the spec a planner session reads
 * (`.specs/rafa-20-pr-commands.md`). A body is therefore written by
 * someone at a machine and read by everyone: a path under a home
 * directory names its author and their filesystem layout, and a token
 * pasted into a repro is a credential published to the internet. The
 * spec's answer is two-sided — the issue template's first comment line
 * asks for neither, and `--issue` REFUSES a body that carries one
 * anyway, naming the line so the author can find it.
 *
 * Naming the line is the whole interface. The check cannot fix the
 * body: only the author can decide whether the path belongs in the
 * local notes file (`<specs.dir>/rafa-<n>-notes.md`, which the spec
 * keeps off the board for exactly this) or should go altogether. So
 * every finding carries a line number, and the refusal lists them.
 *
 * Nothing here touches the filesystem, the board, the environment or
 * the real home. It reads the string it is handed, which is why the
 * cases in `./leak.test.ts` need no seams and why the check reaches the
 * same answer on a machine whose home is elsewhere. In particular it
 * does NOT compare against `os.homedir()`: the body was written on
 * somebody else's machine, and a check that only caught the reader's
 * own home would pass every leak it exists to catch.
 *
 * ## What counts as a home path
 *
 * `/Users/<name>`, `/home/<name>` and `<drive>:\Users\<name>` — the
 * three roots under which an account's directory lives. The leak is the
 * ACCOUNT SEGMENT, not the root: `/Users/` alone says nothing, and
 * `~/.rafa`, which this repository's own documentation is full of, says
 * where a file lives without saying whose machine it is on. Neither is
 * a finding, and `~` is deliberately not a shape.
 *
 * A root is matched only where a path can START — the character before
 * it may not be a word character, a dot or a hyphen — so the `/home/`
 * inside `https://example.com/home/index` is a URL and not a leak. The
 * guard costs nothing real: a path in prose is preceded by a space, a
 * quote, a bracket or an `=`, and `file:///Users/<name>` still matches,
 * since the character before its root is a slash.
 *
 * ## What counts as a token shape
 *
 * A prefix a vendor issues credentials under, followed by enough
 * random-looking body to be a real one: GitHub's `ghp_`/`gho_`/`ghu_`/
 * `ghs_`/`ghr_` and `github_pat_`, AWS's `AKIA`/`ASIA` key ids, the
 * `sk-` and `sk-ant-` keys, Slack's `xox?-` and Google's `AIza`. The
 * prefix is what makes the shape recognisable without a secret scanner,
 * and it is also the only part {@link LeakFinding.evidence} prints.
 *
 * The list is not every credential in the world and is not meant to be.
 * It is the set whose prefixes appear in a repro someone would paste
 * into an issue about this tool, and a body carrying a credential this
 * misses is caught by the person reviewing it, not by a scanner this
 * module grows into.
 *
 * ## A body that only looks like one
 *
 * A check this cheap is read by people writing DOCUMENTATION, and a
 * spec explaining a flag says things like `/Users/<name>/projects` or
 * `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Refusing those would
 * teach the author to stop writing examples, so a placeholder is not a
 * finding:
 *
 *  - A bracketed or substituted segment never matches in the first
 *    place. `<name>`, `{user}`, `$USER` and `%USERNAME%` hold
 *    characters an account segment cannot, so the pattern fails at the
 *    root rather than needing a rule.
 *  - A segment spelled as a stand-in — {@link PLACEHOLDER_USERS}, the
 *    words a person writes when they mean "whoever you are" — is
 *    dropped, as is any secret holding one of
 *    {@link PLACEHOLDER_WORDS}.
 *  - A token body drawn from fewer than {@link MIN_TOKEN_CHARSET}
 *    distinct characters is dropped: `ghp_xxxx…` and `ghp_0000…` are
 *    how a redacted token is written, and no issued one looks like
 *    that. The floor is NOT applied to an account segment, because a
 *    real login can be three letters long.
 *
 * Each of those is a hole a leak could be written through on purpose,
 * and that is the trade the spec makes: the check is a guard against
 * the accident of pasting a real path or key, not a control against an
 * author who wants to publish one.
 */
import { CommandExit } from '../cli/command.js';

/** The exit code a refused body ends the command with; the spec's own. */
export const LEAK_REFUSAL_EXIT = 2;

/** What a finding is: a path that names a machine, or a credential. */
export type LeakKind = 'home-path' | 'token';

/** Which pattern found it; {@link SHAPES} holds one entry per name. */
export type LeakShapeName =
  | 'aws-key-id'
  | 'github-fine-grained'
  | 'github-token'
  | 'google-api-key'
  | 'secret-key'
  | 'slack-token'
  | 'unix-home'
  | 'windows-home';

/** One thing in a body that must not be published, and where it is. */
export interface LeakFinding {
  /** What kind of leak it is. */
  readonly kind: LeakKind;
  /** The shape that matched. */
  readonly shape: LeakShapeName;
  /** Which line of the body holds it, counting from 1. */
  readonly line: number;
  /** The match with its secret part masked; safe to print. */
  readonly evidence: string;
}

/** A pattern read over one line, with the part of a match that may be printed. */
interface LeakShape {
  /** What this pattern is called in a finding. */
  readonly name: LeakShapeName;
  /** What a match of it is. */
  readonly kind: LeakKind;
  /**
   * The pattern, global, whose first group is the part safe to print —
   * the path root or the vendor prefix — and whose remainder is the
   * secret: the account segment or the token body.
   */
  readonly pattern: RegExp;
}

/** What a masked match prints in place of the secret. */
export const MASK = '[redacted]';

/**
 * Account segments that mean "whoever you are" rather than a person.
 * Matched whole and case-insensitively; see the module note.
 */
export const PLACEHOLDER_USERS: ReadonlySet<string> = new Set([
  'me', 'name', 'runner', 'someone', 'user', 'username', 'you', 'your-name',
  'your-user', 'yourname', 'youruser',
]);

/** Words a stand-in secret carries; matched as substrings, case-insensitively. */
export const PLACEHOLDER_WORDS: readonly string[] = [
  'dummy', 'example', 'fake', 'placeholder', 'redacted', 'sample', 'your',
];

/** How few distinct characters make a token body a stand-in rather than a key. */
export const MIN_TOKEN_CHARSET = 5;

/** Every shape a body is read for, in the order findings on one line are listed. */
const SHAPES: readonly LeakShape[] = [
  { name: 'unix-home', kind: 'home-path', pattern: /(?<![\w.-])(\/(?:Users|home)\/)([A-Za-z0-9._-]+)/giu },
  { name: 'windows-home', kind: 'home-path', pattern: /(?<![\w.-])([A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)/giu },
  { name: 'github-token', kind: 'token', pattern: /\b(gh[pousr]_)([A-Za-z0-9]{20,})\b/gu },
  { name: 'github-fine-grained', kind: 'token', pattern: /\b(github_pat_)([A-Za-z0-9_]{20,})\b/gu },
  { name: 'aws-key-id', kind: 'token', pattern: /\b(A[KS]IA)([A-Z0-9]{16})\b/gu },
  { name: 'secret-key', kind: 'token', pattern: /(?<![\w-])(sk-(?:ant-)?)([A-Za-z0-9_-]{20,})(?![\w-])/gu },
  { name: 'slack-token', kind: 'token', pattern: /(?<![\w-])(xox[abeoprs]-)([A-Za-z0-9-]{12,})(?![\w-])/gu },
  { name: 'google-api-key', kind: 'token', pattern: /(?<![\w-])(AIza)([A-Za-z0-9_-]{35})(?![\w-])/gu },
];

/** What a refusal calls each kind. */
const KIND_LABEL: Readonly<Record<LeakKind, string>> = Object.freeze({
  'home-path': 'a home path',
  token: 'a token',
});

/** What the author must do about a refused body. */
const REMEDY = 'the board is public, so move it to the local notes file beside the spec and edit the body';

/** True when `secret` is spelled as a stand-in rather than a real one. */
function holdsPlaceholderWord(secret: string): boolean {
  const lowered = secret.toLowerCase();
  return PLACEHOLDER_WORDS.some((word) => lowered.includes(word));
}

/** True when `secret` is drawn from too few characters to be an issued token. */
function isTooPlainForAToken(secret: string): boolean {
  return new Set(secret).size < MIN_TOKEN_CHARSET;
}

/**
 * True when the secret part of a match is a stand-in, so the match is
 * documentation rather than a leak. The module note holds each rule and
 * why the character floor is kept off an account segment.
 */
function isPlaceholder(kind: LeakKind, secret: string): boolean {
  if (holdsPlaceholderWord(secret)) return true;
  if (kind === 'home-path') return PLACEHOLDER_USERS.has(secret.toLowerCase());
  return isTooPlainForAToken(secret);
}

/** A match printed with its secret part masked. */
function maskedEvidence(keep: string): string {
  return `${keep}${MASK}`;
}

/** Every finding on one line, in {@link SHAPES} order. */
function findLeaksInLine(line: string, number: number): readonly LeakFinding[] {
  const found: LeakFinding[] = [];

  for (const shape of SHAPES) {
    const pattern = new RegExp(shape.pattern.source, shape.pattern.flags);
    let match = pattern.exec(line);
    while (match !== null) {
      const [, keep = '', secret = ''] = match;
      if (!isPlaceholder(shape.kind, secret)) {
        found.push({
          kind: shape.kind,
          shape: shape.name,
          line: number,
          evidence: maskedEvidence(keep),
        });
      }
      match = pattern.exec(line);
    }
  }

  return found;
}

/**
 * Every home path and token shape in `body`, each naming the line that
 * holds it, counting from 1. A body that carries none answers an empty
 * list, which is the only reading that lets a plan be written from it.
 *
 * The findings are ordered by line, and within a line by the order of
 * {@link SHAPES}; a line carrying two leaks answers two findings, so
 * the author is not sent back a second time for the second one.
 */
export function findLeaks(body: string): readonly LeakFinding[] {
  return body.split(/\r?\n/u)
    .flatMap((line, index) => findLeaksInLine(line, index + 1));
}

/** One finding, as the refusal names it. */
function describeFinding(finding: LeakFinding): string {
  return `line ${String(finding.line)} holds ${KIND_LABEL[finding.kind]} (${finding.evidence})`;
}

/**
 * The sentence a refused body is refused with: what `source` names, the
 * line each finding sits on, and what the author must do.
 *
 * `source` is the caller's name for the text — `issue #20`, or a spec
 * file's path — because this module is handed a string and cannot know
 * where it came from, and a refusal that did not say would leave an
 * operator with a line number and no document.
 *
 * Throws a `TypeError` for an empty list, as `src/board/trust.ts` does
 * for a trusted reading: there is no refusal to spell for a clean body,
 * and a caller asking for one has read the findings backwards.
 */
export function leakRefusalMessage(source: string, findings: readonly LeakFinding[]): string {
  if (findings.length === 0) {
    throw new TypeError(`board leak: ${source} carries no leak, and has no refusal to name`);
  }

  const named = findings.map(describeFinding).join(', ');
  return `${source} names a machine path or a credential: ${named}; ${REMEDY}`;
}

/**
 * Lets a clean `body` through, and throws
 * `CommandExit(2, {@link leakRefusalMessage})` for one carrying a leak.
 *
 * Called before the body is snapshotted or handed to a session, so a
 * refused body leaves no copy of the leak behind on disk.
 */
export function requireNoLeak(source: string, body: string): void {
  const findings = findLeaks(body);
  if (findings.length === 0) return;
  throw new CommandExit(LEAK_REFUSAL_EXIT, leakRefusalMessage(source, findings));
}

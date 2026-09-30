/**
 * Local path redaction: the machine's own directories taken out of the
 * text triage files, before a bug's key or any of its text is built.
 *
 * A session reports what it saw, and what it saw holds absolute paths:
 * the plan it ran under, the file a test failed in, the toolchain it
 * called. Filed as reported, those paths put the user's name and the
 * machine's layout on a public board, and they make the recurrence key
 * differ between two checkouts of one repository, so one bug seen on two
 * machines is filed twice. Measured on `open-tomato/rafa` on 2026-09-30:
 * 16 open bug bodies and 68 recurrence comments held a `/Users/<name>` or
 * `/home/<name>` path, most in the `Artifact` and `Feedback` fences.
 *
 * {@link localPathRedactor} answers a function that rewrites, in one
 * pass, longest root first:
 *
 *   - a path under the repository root as relative to it, and the bare
 *     root as `.` (`<root>/` alone as `./`, never as nothing), so
 *     `<root>/src/a.ts` reads `src/a.ts` on every machine and the `Refs`
 *     section can read it against the tree;
 *   - the home directory, the run's own and any `/Users/<name>` or
 *     `/home/<name>` under any absolute prefix, as {@link HOME_MARKER}, so
 *     `~/.bun/bin/bun` reads `[redacted: HOME]/.bun/bin/bun` whoever ran
 *     it, and `/Users/bob:12` keeps its `:12`.
 *
 * The root and the home are each matched as given and at their real
 * location, when that differs (a `/tmp` root is `/private/tmp` on macOS),
 * so a path a tool printed resolved is taken out too.
 *
 * A root is matched as a whole path: at the start of a path or right
 * after a short flag (`-I/Users/bob/inc`), not inside a word or after one
 * (`src/home/user` stays), and ending at a `/` or where the path ends.
 * `/repo-old` is not under `/repo`, and a sentence's full stop after the
 * root does not stop it being the root. A system path
 * (`/usr/local/bin/bun`) is left as it is: it names no one.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** What stands for a home directory in filed text. */
export const HOME_MARKER = '[redacted: HOME]';

/** One path segment's name: nothing that ends a path, and no `:`, `,` or `;` after it. */
const SEGMENT = '[^/\\s\'"`()<>:,;]+';

/**
 * A home directory named by its pattern alone, whoever the run's home is:
 * `/Users/<name>` or `/home/<name>`, under any absolute prefix, so a WSL
 * mount (`/mnt/c/Users/<name>`) or a macOS data volume is one too.
 */
const HOME_PATTERN = `(?:/${SEGMENT})*?/(?:Users|home)/${SEGMENT}`;

/** A root starts a path: nothing that continues a path name before it, or a short flag (`-I`). */
const PATH_START = '(?:(?<![\\w.\\-])|(?<=(?:^|\\s)-[A-Za-z]))';

/** A slash after a root that a path name follows; a bare one leaves the root bare. */
const UNDER = '(/)(?=[^\\s\'"`()<>])';

/** A root not followed by `/` ends where its path does; a full stop then a space is still its end. */
const PATH_END = '(?![\\w\\-]|\\.[\\w.\\-/])';

/** A text matched literally inside a regular expression. */
function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `path` resolved, then at its real location when it has one that differs. */
function forms(path: string): readonly string[] {
  const given = resolve(path);
  try {
    const real = realpathSync(given);
    return real === given
      ? [given]
      : [given, real];
  } catch {
    return [given];
  }
}

/** A root worth matching: not the file system's root, which is under nothing. */
function isRoot(path: string): boolean {
  return path.length > 1;
}

/** One root to match, and what a path under it and the bare root become. */
interface Root {
  readonly pattern: string;
  /** What `<root>/` becomes. */
  readonly under: string;
  /** What the bare root becomes. */
  readonly bare: string;
}

/**
 * The function that takes the repository root and the home directory out
 * of a text; see the module note.
 */
export function localPathRedactor(repoRoot: string, home: string): (text: string) => string {
  const asHome = (pattern: string): Root => ({ pattern, under: `${HOME_MARKER}/`, bare: HOME_MARKER });
  const asRepo = (pattern: string): Root => ({ pattern, under: '', bare: '.' });
  const literals: Root[] = [
    ...forms(repoRoot).filter(isRoot)
      .map((root) => asRepo(literalPattern(root))),
    ...forms(home).filter(isRoot)
      .map((root) => asHome(literalPattern(root))),
  ];
  // Longest literal first, so the repository root inside a home is made
  // relative rather than marked; the pattern goes after every literal.
  const roots = [
    ...[...literals].sort((a, b) => b.pattern.length - a.pattern.length),
    asHome(HOME_PATTERN),
  ];

  const alternatives = roots.map(({ pattern }) => `(${pattern})(?:${UNDER}|${PATH_END})`);
  const matcher = new RegExp(`${PATH_START}(?:${alternatives.join('|')})`, 'g');
  return (text) => text.replace(matcher, (...groups: (string | undefined)[]) => {
    const index = roots.findIndex((_, at) => groups[1 + at * 2] !== undefined);
    const root = roots[index]!;
    return groups[2 + index * 2] === undefined
      ? root.bare
      : root.under;
  });
}

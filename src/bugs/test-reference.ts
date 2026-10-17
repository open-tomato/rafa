/**
 * The test a bug's `Rerun` section names, read strictly (#953): the only
 * thing `rafa bug recheck` can run. No word of the value reaches a shell;
 * the caller builds the argv itself from the file and pattern read here.
 *
 * ## Reading a value
 *
 * {@link readTestReference} touches no file system. A value is runnable
 * when it is one line whose words are `bun`, `test`, one file, and
 * optionally `-t` followed by one double-quoted value, and nothing else.
 * Anything else is `manual`, with the reason it was refused:
 *
 *   - a null or blank value: `no Rerun section`;
 *   - a second line;
 *   - a shell character (`;`, `&`, `|`, `<`, `>`, `$`, a backtick, a
 *     parenthesis or a backslash) or a quote in a word outside the `-t`
 *     value;
 *   - a flag other than `-t`, a second `-t`, a `-t` with no value or an
 *     unquoted one, an empty value or a double quote inside it;
 *   - an absolute path or one with a `..` segment, a file word that is not
 *     a test file, or a word after the file.
 *
 * A test file is a relative path whose name ends in `.test` or `.spec`
 * and a JavaScript or TypeScript extension, as `src/triage/test-failure.ts`
 * defines one.
 *
 * The `-t` value is taken literally, as one argv word: it never reaches a
 * shell, so a backslash or a parenthesis inside it is kept as written. So
 * the value triage's `rerunOf` writes for a case holding a regular
 * expression's special character, shell-escaped for a double-quoted
 * string, reads with its backslashes doubled. Measured on bun 1.3.14:
 * `-t 'a \\(case\\)'` matched 0 tests where `-t 'a \(case\)'` matched the
 * case `a (case)`.
 *
 * ## Resolving a reference
 *
 * {@link resolveTestReference} is the boundary check against a checkout:
 * the file is resolved against it, and both are read through their real
 * path, so a symlink that leaves the checkout is `outside` (judged
 * `manual`). A file that is not there is `missing` (judged `stale`); one
 * inside is `resolved`, with the path relative to the checkout's real
 * path to hand to the runner. Nothing here spawns.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { isInside } from '../project/package-of.js';

/** A `Rerun` value recheck can run: a test file and an optional `-t` pattern. */
export interface RunnableReference {
  readonly kind: 'runnable';
  /** The test file, relative to the checkout, as written. */
  readonly file: string;
  /** The `-t` value as one argv word, or null when the value has no `-t`. */
  readonly pattern: string | null;
}

/** A `Rerun` value recheck refuses to run, with the reason. */
export interface ManualReference {
  readonly kind: 'manual';
  readonly reason: string;
}

/** What {@link readTestReference} answers; see the module note. */
export type TestReference = RunnableReference | ManualReference;

/** What {@link resolveTestReference} answers; see the module note. */
export type ResolvedTestReference =
  | { readonly kind: 'resolved'; readonly path: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'missing' };

/** The reason a null or blank value is refused with. */
export const NO_RERUN_REASON = 'no Rerun section';

/** A word of the value: its text, and whether it was double-quoted. */
interface Word {
  readonly text: string;
  readonly quoted: boolean;
}

/** The characters a word outside the `-t` value may not hold. */
const SHELL_CHARACTER = /[;&|<>$`()\\'"]/;

/** A test file's relative path: folders, then a name ending `.test` or `.spec` and a JS or TS extension. */
const TEST_FILE = /^(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** The words before the file. */
const COMMAND = ['bun', 'test'] as const;

/** The one flag a value may carry. */
const NAME_FLAG = '-t';

/** A refusal with `reason`. */
function manual(reason: string): ManualReference {
  return { kind: 'manual', reason };
}

/** The words of a one-line value, or the reason they cannot be read. */
function wordsOf(line: string): readonly Word[] | ManualReference {
  const words: Word[] = [];
  let at = 0;
  while (at < line.length) {
    if (/\s/.test(line[at] ?? '')) {
      at += 1;
      continue;
    }
    if (line[at] === '"') {
      const close = line.indexOf('"', at + 1);
      if (close === -1) return manual('an unterminated double quote');
      const after = line[close + 1];
      if (after !== undefined && !/\s/.test(after)) return manual('a double quote inside the -t value');
      words.push({ text: line.slice(at + 1, close), quoted: true });
      at = close + 1;
      continue;
    }
    const end = line.slice(at).search(/\s/);
    const stop = end === -1
      ? line.length
      : at + end;
    words.push({ text: line.slice(at, stop), quoted: false });
    at = stop;
  }
  return words;
}

/** The reason a file word is refused, or null when it is a test file inside the checkout. */
function fileRefusal(word: Word): string | null {
  const { text } = word;
  if (word.quoted) return `a quoted file "${text}"`;
  if (text.startsWith('-')) return `a flag other than -t: ${text}`;
  const shell = SHELL_CHARACTER.exec(text);
  if (shell !== null) return `a shell character ${shell[0]} in ${text}`;
  if (text.startsWith('/')) return `an absolute path ${text}`;
  if (text.split('/').includes('..')) return `a path that leaves the checkout: ${text}`;
  if (!TEST_FILE.test(text)) return `not a test file: ${text}`;
  return null;
}

/** The pattern of the words after the file, or the reason they are refused. */
function patternOf(rest: readonly Word[]): string | null | ManualReference {
  const [flag, value, ...after] = rest;
  if (flag === undefined) return null;
  if (flag.quoted || !flag.text.startsWith('-')) return manual(`a word after the file: ${flag.text}`);
  if (flag.text !== NAME_FLAG) return manual(`a flag other than -t: ${flag.text}`);
  if (value === undefined) return manual('a missing -t value');
  if (!value.quoted) return manual(`an unquoted -t value: ${value.text}`);
  if (value.text.trim() === '') return manual('an empty -t value');
  const next = after[0];
  if (next === undefined) return value.text;
  if (!next.quoted && next.text === NAME_FLAG) return manual('a second -t');
  return manual(`a word after the -t value: ${next.text}`);
}

/** A `Rerun` value read strictly as `bun test <file> [-t "<case>"]`; see the module note. */
export function readTestReference(rerun: string | null): TestReference {
  if (rerun === null || rerun.trim() === '') return manual(NO_RERUN_REASON);
  const line = rerun.trim();
  if (/[\r\n]/.test(line)) return manual('a second line');
  const words = wordsOf(line);
  if ('kind' in words) return words;
  const [bun, test, file, ...rest] = words;
  if (bun?.text !== COMMAND[0] || bun.quoted || test?.text !== COMMAND[1] || test.quoted) {
    return manual('not a bun test command');
  }
  if (file === undefined) return manual('no test file');
  const refused = fileRefusal(file);
  if (refused !== null) return manual(refused);
  for (const word of rest) {
    const shell = word.quoted
      ? null
      : SHELL_CHARACTER.exec(word.text);
    if (shell !== null) return manual(`a shell character ${shell[0]} in ${word.text}`);
  }
  const pattern = patternOf(rest);
  if (typeof pattern === 'object' && pattern !== null) return pattern;
  return { kind: 'runnable', file: file.text, pattern };
}

/** Where a runnable reference's file lies against `checkout`; see the module note. */
export function resolveTestReference(reference: RunnableReference, checkout: string): ResolvedTestReference {
  const target = resolve(checkout, reference.file);
  if (!existsSync(target)) return { kind: 'missing' };
  const root = realpathSync(checkout);
  const real = realpathSync(target);
  if (real === root || !isInside(root, real)) return { kind: 'outside' };
  if (!statSync(real).isFile()) return { kind: 'missing' };
  return { kind: 'resolved', path: relative(root, real) };
}

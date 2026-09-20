/**
 * Which line of a shell fence is a command, and which is another
 * language's code.
 *
 * `src/check/references.ts` reads a `bash`, `sh`, `shell`, `zsh` or
 * `console` fence for the tools and the paths its command lines name.
 * That reading is worth exactly as much as the line classification
 * under it: a first word taken off a line that is NOT a command is
 * reported as a missing tool, and the author of the body is asked to
 * fix a line that was never a claim about `PATH`. This module is that
 * classification, split out of `references.ts` when that module passed
 * the 800-line convention (`context/source.md`). Nothing here reads
 * the filesystem, the environment or the `PATH`: every function is a
 * decision about one line of text.
 *
 * ## What a shell fence line is not a command
 *
 * A comment, an empty line, the body of a heredoc
 * ({@link heredocTerminator}), the continuation of a line ending in a
 * backslash ({@link continuesLine}), and — in a `console` fence — any
 * line carrying no `$ ` prompt, which is output rather than input. The
 * cost of that last rule is named: a `console` fence written with no
 * prompts at all contributes no tools, and nothing here notices. A
 * line ending in `|` or `&&` is not a continuation; the next line
 * opens a command of its own, and its first word is read as one.
 *
 * ## What is not a shell line at all
 *
 * A fence labelled `bash` regularly holds something that is not shell.
 * A skill shows the JavaScript its shell command will run, or pastes a
 * config, and reaches for the one fence label its editor highlights.
 * `const ready = true;` in such a fence is read by a first-word rule
 * as the command `const`, which no `PATH` directory holds — the false
 * positive `src/tests/checker-fixtures.test.ts` pins.
 * {@link isForeignCodeLine} is the reading that answers it, on three
 * kinds of evidence a shell line does not carry:
 *
 * - **A foreign statement keyword opens the line**
 *   ({@link FOREIGN_KEYWORDS}). Every word in that list is one no
 *   shell interprets and no common tool is named for, and NONE of them
 *   is a {@link SHELL_BUILTINS} entry — `let`, `time`, `function`,
 *   `export`, `local`, `declare`, `readonly`, `test` and `type` all
 *   open real shell lines, so none of them is evidence of anything and
 *   none is listed. `shell-lines.test.ts` holds that disjointness as a
 *   case rather than as a promise.
 * - **The line opens with a spaced assignment** (`ready = true`). A
 *   shell assignment never carries spaces around its `=`: `x = 1` asks
 *   a shell to run the command `x`, which is why no body means it that
 *   way. `x=1`, and `git commit -m "const x = 1"`, are untouched — the
 *   shape is anchored at the start of the line.
 * - **The line opens with a C-family comment marker**: a `//`, a
 *   block-comment opener, a block-comment closer, or the ` * ` a
 *   continued block comment carries. `#` is the shell's own comment
 *   and is not evidence of anything.
 *
 * Measured on 2026-09-20 over the corpus `references.ts`'s own note
 * measures over, this repository's `.claude/skills` and `~/.claude/
 * skills`, with the sibling checkout's tier beside them — 146
 * `SKILL.md` bodies holding 1_357 shell-fence lines. The three rules
 * together flag 15 of those lines, in 8 bodies: 11 by keyword
 * (`const`, `import`, `from`), 3 by spaced assignment (`block = ...`,
 * `line = ...`, `logger = ...`) and 1 by comment marker. Fourteen of
 * the 15 are lines whose first word the tool rule looks up today, so
 * they are the false `missing-tool` reports themselves and not a
 * neighbouring reading; every one of the 15 was read by hand and every
 * one is Python or JavaScript in a fence labelled for a shell. No line
 * naming a real command was flagged.
 *
 * ## Nothing here is wired yet
 *
 * {@link isForeignCodeLine} is not called by {@link commandOf}, and
 * `references.ts` does not call it either: this module is the reading,
 * and the task after the one that added it is what changes what the
 * checker does with it. The three functions moved out of
 * `references.ts` ({@link commandOf}, {@link toolOf},
 * {@link isShellFence}) answer byte for byte what they answered there.
 */

/** The fence info strings whose blocks hold shell command lines. */
export const SHELL_FENCE_LANGUAGES: readonly string[] = ['bash', 'sh', 'shell', 'zsh', 'console'];

/**
 * First words that name no file on `PATH`: shell keywords, and the
 * builtins a POSIX shell runs itself. `test` and `echo` are here even
 * though `/bin` also holds them, because the shell never reaches
 * `/bin` for either.
 */
export const SHELL_BUILTINS: readonly string[] = [
  '.', ':', '[', 'alias', 'bg', 'break', 'builtin', 'case', 'cd', 'command',
  'continue', 'declare', 'do', 'done', 'echo', 'elif', 'else', 'esac', 'eval',
  'exec', 'exit', 'export', 'false', 'fc', 'fg', 'fi', 'for', 'function',
  'getopts', 'hash', 'if', 'in', 'jobs', 'kill', 'let', 'local', 'logout',
  'popd', 'printf', 'pushd', 'pwd', 'read', 'readonly', 'return', 'select',
  'set', 'shift', 'source', 'test', 'then', 'time', 'times', 'trap', 'true',
  'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'until', 'wait',
  'while',
];

/**
 * First words that open a statement in a language that is not a shell.
 * Each is a declaration or a statement keyword of a language whose
 * samples land in `bash` fences — JavaScript and TypeScript (`const`,
 * `class`, `async`), Python (`def`, `from`), Go (`func`, `package`),
 * Rust (`fn`, `impl`, `struct`), Java and Kotlin (`public`, `static`,
 * `val`) — and none is a {@link SHELL_BUILTINS} entry or a command
 * name a body plausibly means.
 *
 * `import` is the one entry a real command also answers to
 * (ImageMagick's screen grabber). It is listed anyway: a `bash` fence
 * opening a line with `import` is a mislabelled module import far more
 * often than it is a screenshot, and a body that does mean the tool
 * still names it in every other line of the fence.
 */
export const FOREIGN_KEYWORDS: readonly string[] = [
  'async', 'await', 'class', 'const', 'def', 'enum', 'fn', 'from', 'func',
  'impl', 'import', 'interface', 'new', 'package', 'private', 'protected',
  'public', 'static', 'struct', 'throw', 'val', 'var',
];

/** The shape a command name takes: a letter, then name characters. */
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.+-]*$/;

/** A heredoc opener, with the terminator word captured. */
const HEREDOC = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/;

/**
 * A command line the next line continues: a trailing backslash, and
 * only that. A line ending in `|` or `&&` continues the PIPELINE, and
 * the next line opens with a command name of its own.
 */
const CONTINUES = /\\$/;

/**
 * An assignment written with spaces around its `=`, anchored at the
 * start of the line. `=(?!=)` keeps an `==` comparison out, and the
 * required space after the `=` keeps `=>` out.
 */
const SPACED_ASSIGNMENT = /^\s*[A-Za-z_$][A-Za-z0-9_$.]*\s+=(?!=)\s+\S/;

/** A C-family comment opener, closer or continuation, at line start. */
const FOREIGN_COMMENT = /^\s*(?:\/\/|\/\*|\*\/|\*\s)/;

/** Whether `info` names a fence holding shell command lines. */
export function isShellFence(info: string): boolean {
  return SHELL_FENCE_LANGUAGES.includes(info);
}

/**
 * The command a line of a shell fence holds, or null when it holds
 * none: a comment, an empty line, or — in a `console` fence — a line
 * with no `$ ` prompt, which is output.
 */
export function commandOf(line: string, info: string): string | null {
  const text = line.trim();
  if (text === '' || text.startsWith('#')) return null;
  if (text.startsWith('$ ') || text === '$') return text.slice(1).trim() || null;
  if (info === 'console') return null;
  if (text.startsWith('> ')) return null;
  return text;
}

/**
 * The tool a command line names, or null when its first word is not
 * one: a flag, an assignment, a builtin, a path, or anything not
 * shaped like a command name.
 */
export function toolOf(command: string): string | null {
  const word = command.split(/\s+/)[0] ?? '';
  if (word === '' || word.includes('=') || word.includes('/')) return null;
  if (!TOOL_NAME.test(word) || SHELL_BUILTINS.includes(word)) return null;
  return word;
}

/**
 * The terminator word a command line's heredoc opens, or null when the
 * line opens none. Every line up to that word is the heredoc's body:
 * data, not commands.
 */
export function heredocTerminator(command: string): string | null {
  return HEREDOC.exec(command)?.[1] ?? null;
}

/** Whether the line after this command line is its continuation. */
export function continuesLine(command: string): boolean {
  return CONTINUES.test(command);
}

/**
 * Whether a line of a shell fence is another language's code rather
 * than a shell command. See this module's note for the three kinds of
 * evidence and for what each one deliberately leaves alone.
 */
export function isForeignCodeLine(line: string): boolean {
  const text = line.trim();
  if (text === '') return false;
  if (FOREIGN_COMMENT.test(text)) return true;
  if (SPACED_ASSIGNMENT.test(text)) return true;
  return FOREIGN_KEYWORDS.includes(text.split(/\s+/)[0] ?? '');
}

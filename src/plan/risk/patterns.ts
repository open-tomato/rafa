/**
 * The fixed list of destructive command shapes `rafa plan risk` reports,
 * and the matcher that reads one command line against it.
 *
 * The list is the spec's, in its order: `rm -rf`, `git push --force`,
 * `git reset --hard`, `git clean -f`, `sudo`, the three package installs
 * `brew install`, `npm i -g` and `pip install`, `npm publish`,
 * `curl … | sh`, `chmod -R`, `DROP TABLE` and `docker system prune`. It
 * lives in code on purpose: a finding the report prints has to be one a
 * reader can find here, and a pattern added here arrives with its two
 * fixtures in `patterns.test.ts` or that suite goes red.
 *
 * Nothing here reads a file, the environment or a process. Which lines
 * of a body are command lines at all is decided upstream, by the caller
 * over `src/check/shell-lines.ts`; this module is handed one command
 * and answers which patterns it matches.
 *
 * ## Where a command word counts
 *
 * Every pattern but `DROP TABLE` names a program, and a program's name
 * is only a command where the shell would run it: at the start of the
 * line, after a separator (`;`, `&`, `|`, `(`, `{`, a backtick), after
 * `find`'s `-exec`, and behind any run of `NAME=value` assignments and
 * the wrappers in {@link COMMAND_WRAPPERS}. So `cd out && rm -rf build`
 * and `sudo rm -rf /` match `rm -rf`, while
 * `echo "never run rm -rf here"` matches nothing: its `rm` is an
 * argument to `echo`. What that costs is named: a wrapper taking a
 * flag WITH an argument, as `sudo -u bob rm -rf x` does, hides the
 * command behind it, because a flag's argument is not a wrapper word.
 * `DROP TABLE` is SQL and arrives inside an argument
 * (`psql -c "DROP TABLE users"`), so it is matched anywhere on the line.
 *
 * A pattern's flags are read up to the next separator only, so the
 * `-f` of `git push origin main && rm -f x` is not taken as a force push.
 */

/** One entry of the fixed destructive-command list. */
export interface DestructivePattern {
  /** The shape as the report prints it, e.g. `git push --force`. */
  readonly name: string;
  /** The expression a command line is tested against; never global. */
  readonly expression: RegExp;
}

/**
 * Words that run the command after them: a destructive program behind
 * one is still at a command position. Each may carry dash flags of its
 * own (`sudo -E`, `xargs -0`), but not a flag's separate argument.
 */
export const COMMAND_WRAPPERS: readonly string[] = [
  'command', 'do', 'else', 'env', 'exec', 'nohup', 'sudo', 'then', 'time', 'xargs',
];

/** A separator, or `find`'s `-exec`, that opens a new command. */
const OPENER = String.raw`(?:^|[;&|({\x60]|\s-exec(?:dir)?\s)`;

/** Any run of `NAME=value` assignments ahead of a command word. */
const ASSIGNMENTS = String.raw`(?:[A-Za-z_]\w*=\S*\s+)*`;

/** Any run of wrappers, each with its own flags and assignments. */
const WRAPPERS = String.raw`(?:(?:${COMMAND_WRAPPERS.join('|')})(?:\s+-\S+)*\s+${ASSIGNMENTS})*`;

/** The whole prefix that puts the word after it at a command position. */
const AT_COMMAND = String.raw`${OPENER}\s*${ASSIGNMENTS}${WRAPPERS}`;

/** The rest of the current command: everything up to the next separator. */
const REST = '[^;&|]*';

/** `git`'s own options ahead of its subcommand, `-C dir` included. */
const GIT_OPTIONS = String.raw`(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*`;

/**
 * A lookahead that holds when the current command carries a flag: a
 * short cluster holding `short` (`-rf` for `r`), or the long `long`.
 */
function hasFlag(short: string, long: string): string {
  return String.raw`(?=(?:${REST}\s)?(?:-[A-Za-z]*${short}[A-Za-z]*|--${long})(?=\s|$))`;
}

/** Builds one pattern whose program sits at a command position. */
function atCommand(name: string, body: string): DestructivePattern {
  return { name, expression: new RegExp(`${AT_COMMAND}${body}`) };
}

/**
 * The fixed destructive-command list, in the spec's order. Every entry
 * has one matching and one near-miss fixture in `patterns.test.ts`.
 */
export const DESTRUCTIVE_PATTERNS: readonly DestructivePattern[] = [
  atCommand('rm -rf', String.raw`rm\s+${hasFlag('[rR]', 'recursive')}${hasFlag('f', 'force')}`),
  atCommand(
    'git push --force',
    String.raw`git${GIT_OPTIONS}\s+push\b(?=${REST}\s(?:--force|-[A-Za-z]*f[A-Za-z]*)(?=\s|$))`,
  ),
  atCommand('git reset --hard', String.raw`git${GIT_OPTIONS}\s+reset\b(?=${REST}\s--hard(?=\s|$))`),
  atCommand('git clean -f', String.raw`git${GIT_OPTIONS}\s+clean\s+${hasFlag('f', 'force')}`),
  atCommand('sudo', String.raw`sudo(?=\s|$)`),
  atCommand('brew install', String.raw`brew(?:\s+-\S+)*\s+install\b`),
  atCommand('npm i -g', String.raw`npm\s+(?:i|install|add)(?=\s)(?=${REST}\s(?:-g|--global)(?=\s|$))`),
  atCommand('pip install', String.raw`(?:python3?\s+-m\s+)?pip3?\s+install\b`),
  atCommand('npm publish', String.raw`npm\s+publish\b(?!${REST}--dry-run)`),
  atCommand('curl … | sh', String.raw`curl\b[^;&|]*\|(?!\|)\s*${WRAPPERS}(?:ba|z|da)?sh(?=\s|$)`),
  atCommand('chmod -R', String.raw`chmod\s+${hasFlag('R', 'recursive')}`),
  { name: 'DROP TABLE', expression: /\bDROP\s+TABLE\b/i },
  atCommand('docker system prune', String.raw`docker\s+system\s+prune\b`),
];

/**
 * The patterns one command line matches, in list order; empty when it
 * matches none. `sudo rm -rf /` answers both `rm -rf` and `sudo`.
 *
 * @param command - One command line, as `commandOf` returns it.
 */
export function destructiveMatches(command: string): readonly DestructivePattern[] {
  return DESTRUCTIVE_PATTERNS.filter((pattern) => pattern.expression.test(command));
}

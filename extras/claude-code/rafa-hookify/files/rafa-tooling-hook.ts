/**
 * A Claude Code PreToolUse hook for Bash that holds agents to the
 * `rafa-tooling` skill where wording alone did not: in measured sessions a
 * smaller model ran `gh` with the skill in reach, and a larger one tried a
 * merge before handing it over.
 *
 * It reads the hook input on stdin and, for each command in a Bash line,
 * answers one of four ways:
 *
 * - **deny, hand it over**: a rafa command the user runs (merge, tag,
 *   self-update, loop start, and the ones that need a terminal).
 * - **deny, use rafa**: a `gh` command one rafa line replaces, with that line.
 *   A `gh pr view --json` is one only when `rafa pr show` answers every
 *   field it asks for.
 * - **let through, with a reason**: a `gh` command a rafa line almost
 *   replaces, such as a `gh pr view --json` asking for a field `rafa pr
 *   show` does not answer. No permission decision is written, so the
 *   normal permission flow applies, and the reason goes to the session as
 *   `additionalContext`: what rafa lacks, ending with the offer to report
 *   the gap under `module:cli-gap`.
 * - **ask**: a rafa command that starts a Claude session (🪙).
 *
 * A `gh pr` or `gh issue` naming another repository with `-R`/`--repo`
 * passes, since rafa reads only the project's own; the project's
 * repository is `git remote get-url origin`, and when that cannot be read
 * a named repository counts as another one.
 *
 * Anything else passes with no output. `/rafa-hookify` copies it to
 * `.claude/hooks/` and wires it in `.claude/settings.json`:
 *
 * ```json
 * { "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [
 *   { "type": "command", "command": "bun \"$CLAUDE_PROJECT_DIR/.claude/hooks/rafa-tooling-hook.ts\"" }
 * ] }] } }
 * ```
 */

/**
 * What the hook answers for a command. `deny` and `ask` are written as the
 * permission decision; `let-through` writes none and hands its reason to
 * the session as `additionalContext`.
 */
export type Verdict = { decision: 'deny' | 'ask' | 'let-through'; reason: string };

const SKILL = '.claude/skills/rafa-tooling/SKILL.md';
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
const SEPARATORS = /&&|\|\||[;|\n]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ISSUE_NUMBER = /^#?\d+$/;
const REPO_FLAG = /^(?:-R|--repo)(?:=(.*))?$/;
const SHORT_REPO_FLAG = /^-R(.+)$/;
// Only a line that may name a repository spends a `git` call on reading the project's own.
const NAMES_A_REPO = /(?:^|\s)(?:-R|--repo)/;
const NEXT_SAFE_IDS = new Set(['sync', 'wait', 'unblock', 'home', 'resume']);
// `rafa pr list` shows the open pull requests and takes no filter, so a
// `gh pr list` that filters, or reads closed and merged ones, passes.
const PR_LIST_FILTERS = ['state', 'head', 'base', 'search', 'author', 'label', 'assignee', 'draft', 'app'];
const PR_LIST_SHORT_FILTERS = new Set(['-s', '-H', '-B', '-S', '-A', '-l', '-a', '-d']);
const JSON_FLAG = /^--json(?:=(.*))?$/;

/**
 * The `gh pr view --json` fields `rafa pr show --output=json` answers: its
 * `detail`, the issues it closes, and its checks.
 */
export const PR_SHOW_ANSWERED_FIELDS: readonly string[] = Object.freeze([
  'author',
  'baseRefName',
  'body',
  'closingIssuesReferences',
  'headRefName',
  'headRefOid',
  'isCrossRepository',
  'labels',
  'mergeStateStatus',
  'mergeable',
  'number',
  'state',
  'statusCheckRollup',
  'title',
  'updatedAt',
  'url',
]);
const PR_SHOW_ANSWERS = new Set(PR_SHOW_ANSWERED_FIELDS);

const handOver = (line: string, why: string): Verdict => ({
  decision: 'deny',
  reason: `\`${line}\` is the user's to run (${why}). Do not run it or retry it another way: hand it over in a fenced bash block, one command per block, with one line on what it does. See ${SKILL}.`,
});

const useRafa = (instead: string, rafa: string): Verdict => ({
  decision: 'deny',
  reason: `This project has rafa installed: run \`${rafa}\` in place of \`${instead}\`. Keep gh for steps rafa has no action for (gh pr create outside a loop, gh pr checkout, gh run view --log, gh api). See ${SKILL}.`,
});

/**
 * The offer every let-through reason ends with: search for an open report
 * of the gap, ask the person once, and file one under `module:cli-gap`.
 * `missing` names what `command` lacks; with none or several named, the
 * search and title carry a `<flag or field>` placeholder.
 */
export const reportOffer = (command: string, missing: readonly string[]): string => {
  const gap = missing.length === 1
    ? missing[0]
    : '<flag or field>';
  const each = missing.length > 1
    ? ', once for each one named'
    : '';
  return `If rafa should have a line for this, report the gap: first run \`rafa issue list --module=cli-gap --search="${command} ${gap}"\`${each}, and when an open report covers it, say which one and file nothing. Otherwise ask the person once whether to report it, never filing unasked; on a yes, run \`rafa issue create --type=bug --module=cli-gap --title="${command} has no ${gap}" --body=…\` with the gh line, this reason, the rafa line and what it lacks in the body, and no local path.`;
};

const letThrough = (instead: string, why: string, command: string, missing: readonly string[]): Verdict => ({
  decision: 'let-through',
  reason: `\`${instead}\` is not denied: ${why} It goes to the normal permission flow. ${reportOffer(command, missing)}`,
});

const spends = (line: string): Verdict => ({
  decision: 'ask',
  reason: `\`${line}\` starts a Claude session (🪙) and spends the user's usage.`,
});

/** The words of each simple command in a Bash line, quoted text blanked and env assignments dropped. */
export const commandsOf = (line: string): string[][] => line
  .replace(QUOTED, '""')
  .split(SEPARATORS)
  .map((segment) => segment.trim().split(/\s+/)
    .filter((word) => word !== ''))
  .map((words) => words.slice(words.findIndex((word) => !ENV_ASSIGNMENT.test(word))))
  .filter((words) => words.length > 0);

const hasFlag = (words: string[], name: string): boolean => words.some((word) => word === `--${name}` || word.startsWith(`--${name}=`));

const flagValue = (words: string[], name: string): string | undefined => words
  .find((word) => word.startsWith(`--${name}=`))
  ?.slice(name.length + 3);

const numberIn = (words: string[]): string => words.find((word) => ISSUE_NUMBER.test(word))?.replace('#', '') ?? '<n>';

/**
 * A repository named as a URL, `HOST/OWNER/REPO` or `OWNER/REPO`, as its
 * lower-cased `owner/repo`; null when it names no owner and repository.
 */
export const repoOf = (named: string): string | null => {
  const path = named.trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')
    .replace(/^[^@/]+@[^:/]+:/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const parts = path.split('/').filter((part) => part !== '');
  if (parts.length < 2) return null;
  return parts.slice(-2).join('/')
    .toLowerCase();
};

/** The repository a gh command names with `-R`/`--repo`, or undefined when it names none. */
export const repoFlagOf = (words: string[]): string | undefined => {
  for (const [i, word] of words.entries()) {
    const long = REPO_FLAG.exec(word);
    if (long !== null) return long[1] ?? words[i + 1] ?? '';
    const short = SHORT_REPO_FLAG.exec(word);
    if (short?.[1] !== undefined) return short[1];
  }
  return undefined;
};

/** Whether a gh command names a repository other than the project's own, `ownRepo` as `owner/repo` or null when unread. */
const namesOtherRepo = (words: string[], ownRepo: string | null): boolean => {
  const named = repoFlagOf(words);
  if (named === undefined) return false;
  const repo = repoOf(named);
  return ownRepo === null || repo === null || repo !== ownRepo;
};

const prListFilters = (words: string[]): boolean => {
  const openOnly = words.includes('--state=open') || words.join(' ').includes('--state open') || words.join(' ').includes('-s open');
  const filters = PR_LIST_FILTERS.some((name) => hasFlag(words, name)) || words.some((word) => PR_LIST_SHORT_FILTERS.has(word));
  return filters && !openOnly;
};

/**
 * The fields a `--json` flag asks for, or undefined when the command has no
 * `--json`. An empty list is a field list the hook cannot read: quoted,
 * whose text is blanked, or left out.
 */
export const jsonFieldsOf = (words: string[]): string[] | undefined => {
  for (const [i, word] of words.entries()) {
    const flag = JSON_FLAG.exec(word);
    if (flag === null) continue;
    const next = words[i + 1];
    const list = flag[1] ?? (next === undefined || next.startsWith('-')
      ? ''
      : next);
    return list.split(',')
      .map((field) => field.trim())
      .filter((field) => field !== '' && field !== '""');
  }
  return undefined;
};

/** The verdict on a `gh pr view --json`: deny when `rafa pr show` answers every field, else let it through naming the rest. */
const judgePrViewJson = (instead: string, fields: string[], target: string): Verdict => {
  const rafa = `rafa pr show${target} --output=json`;
  if (fields.length === 0) {
    return letThrough(instead, `the hook cannot read the --json fields it asks for, quoted or left out. \`${rafa}\` answers ${PR_SHOW_ANSWERED_FIELDS.join(', ')}: run it in place of this line when those cover every field asked.`, 'rafa pr show', []);
  }
  const unanswered = fields.filter((field) => !PR_SHOW_ANSWERS.has(field));
  if (unanswered.length === 0) return useRafa(instead, rafa);
  return letThrough(instead, `\`${rafa}\` does not answer the --json field${unanswered.length === 1
    ? ''
    : 's'} ${unanswered.join(', ')}.`, 'rafa pr show', unanswered);
};

const nextIsSafe =(words: string[]): boolean => {
  if (hasFlag(words, 'dry-run')) return true;
  const ids = flagValue(words, 'yes');
  if (ids === undefined) return false;
  return ids.split(',').every((id) => NEXT_SAFE_IDS.has(id.trim()));
};

/** The verdict on one rafa command, its words after `rafa`. */
export const judgeRafa = (words: string[]): Verdict | null => {
  const [subject, action] = words;
  const line = `rafa ${words.join(' ')}`;
  const pair = `${subject} ${action}`;
  if (pair === 'pr merge') return handOver(line, 'it merges and deletes branches');
  if (pair === 'release tag') return handOver(line, 'it tags a release');
  if (pair === 'loop start') return handOver(line, 'it starts a loop in a checkout and spends 🪙');
  if (pair === 'issue ready') return handOver(line, 'it asks its question on a terminal and has no --yes');
  if (subject === 'self-update') return handOver(line, 'it replaces the rafa that live loops run');
  if (subject === 'cleanup' && !hasFlag(words, 'dry-run') && !hasFlag(words, 'output')) return handOver(line, 'it removes branches from a checklist on a terminal');
  if (subject === 'next' && !nextIsSafe(words)) return handOver(line, 'it runs the steps it proposes; only --dry-run, or a --yes list of sync, wait, unblock, home and resume, runs unasked');
  if (pair === 'plan create' && !hasFlag(words, 'dry-run')) return spends(line);
  if (pair === 'epic close' || pair === 'pr triage' || pair === 'skill backfill') return spends(line);
  return null;
};

const judgeGhPr = (words: string[]): Verdict | null => {
  const [, action] = words;
  const n = numberIn(words.slice(2));
  const target = n === '<n>'
    ? ''
    : ` ${n}`;
  const instead = `gh ${words.join(' ')}`;
  if (action === 'merge') return handOver(`rafa pr merge${target}`, 'it merges and deletes branches');
  if (action === 'list') {
    return prListFilters(words)
      ? null
      : useRafa(instead, 'rafa pr list');
  }
  if (action === 'view' && hasFlag(words, 'web')) return useRafa(instead, `rafa pr view${target}`);
  if (action === 'checks' && hasFlag(words, 'watch')) return useRafa(instead, `rafa pr wait${target}`);
  const fields = action === 'view'
    ? jsonFieldsOf(words)
    : undefined;
  if (fields !== undefined) return judgePrViewJson(instead, fields, target);
  if (action === 'view' || action === 'checks') {
    return useRafa(instead, target === ''
      ? 'rafa pr current'
      : `rafa pr show${target}`);
  }
  return null;
};

const judgeGhIssue = (words: string[]): Verdict | null => {
  const [, action] = words;
  const n = numberIn(words.slice(2));
  const instead = `gh ${words.join(' ')}`;
  if (action === 'list') return useRafa(instead, 'rafa issue list --type=… --search=…');
  if (action === 'view') return useRafa(instead, `rafa issue show ${n}`);
  if (action === 'create') return useRafa(instead, 'rafa issue create --title=… --body=… --type=…');
  if (action === 'comment') return useRafa(instead, `rafa issue comment ${n} --body=…`);
  if (action === 'close') return useRafa(instead, `rafa issue move ${n} done (and rafa issue comment ${n} --body=… for a comment)`);
  return null;
};

/**
 * The verdict on one gh command, its words after `gh`. `ownRepo` is the
 * project's repository as `owner/repo`, or null when it could not be read.
 */
export const judgeGh = (words: string[], ownRepo: string | null = null): Verdict | null => {
  if ((words[0] === 'pr' || words[0] === 'issue') && namesOtherRepo(words, ownRepo)) return null;
  if (words[0] === 'pr') return judgeGhPr(words);
  if (words[0] === 'issue') return judgeGhIssue(words);
  return null;
};

const isRafa = (word: string | undefined): boolean => word === 'rafa' || (word?.endsWith('/rafa') ?? false);

/**
 * The first verdict over every command in a Bash line, or null when all
 * pass. `ownRepo` is the project's repository as `owner/repo`, or null when
 * it could not be read.
 */
export const judgeLine = (line: string, ownRepo: string | null = null): Verdict | null => {
  for (const words of commandsOf(line)) {
    const [program, ...rest] = words;
    const verdict = isRafa(program)
      ? judgeRafa(rest)
      : program === 'gh'
        ? judgeGh(rest, ownRepo)
        : null;
    if (verdict !== null) return verdict;
  }
  return null;
};

const readCommand = (input: string): string | null => {
  try {
    const parsed = JSON.parse(input) as { tool_name?: unknown; tool_input?: { command?: unknown } };
    if (parsed.tool_name !== 'Bash') return null;
    return typeof parsed.tool_input?.command === 'string'
      ? parsed.tool_input.command
      : null;
  } catch {
    console.error('rafa-tooling-hook: the hook input is not JSON; letting the command through');
    return null;
  }
};

/** The project's repository from `git remote get-url origin`, or null when git cannot read it. */
const readOwnRepo = (): string | null => {
  const read = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return read.exitCode === 0
    ? repoOf(read.stdout.toString())
    : null;
};

if (import.meta.main) {
  const command = readCommand(await Bun.stdin.text());
  const verdict = command === null
    ? null
    : judgeLine(command, NAMES_A_REPO.test(command)
      ? readOwnRepo()
      : null);
  if (verdict !== null) {
    const hookSpecificOutput = verdict.decision === 'let-through'
      ? { hookEventName: 'PreToolUse', additionalContext: verdict.reason }
      : { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason };
    console.log(JSON.stringify({ hookSpecificOutput }));
  }
}

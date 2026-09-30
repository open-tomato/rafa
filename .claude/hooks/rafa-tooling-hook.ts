/**
 * A Claude Code PreToolUse hook for Bash that holds agents to the
 * `rafa-tooling` skill where wording alone did not: in measured sessions a
 * smaller model ran `gh` with the skill in reach, and a larger one tried a
 * merge before handing it over.
 *
 * It reads the hook input on stdin and, for each command in a Bash line,
 * answers one of three ways:
 *
 * - **deny, hand it over**: a rafa command the user runs (merge, tag,
 *   self-update, loop start, and the ones that need a terminal).
 * - **deny, use rafa**: a `gh` command one rafa line replaces, with that line.
 * - **ask**: a rafa command that starts a Claude session (🪙).
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

export type Verdict = { decision: 'deny' | 'ask'; reason: string };

const SKILL = '.claude/skills/rafa-tooling/SKILL.md';
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
const SEPARATORS = /&&|\|\||[;|\n]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ISSUE_NUMBER = /^#?\d+$/;
const NEXT_SAFE_IDS = new Set(['sync', 'wait', 'unblock', 'home', 'resume']);
// `rafa pr list` shows the open pull requests and takes no filter, so a
// `gh pr list` that filters, or reads closed and merged ones, passes.
const PR_LIST_FILTERS = ['state', 'head', 'base', 'search', 'author', 'label', 'assignee', 'draft', 'app'];
const PR_LIST_SHORT_FILTERS = new Set(['-s', '-H', '-B', '-S', '-A', '-l', '-a', '-d']);

const handOver = (line: string, why: string): Verdict => ({
  decision: 'deny',
  reason: `\`${line}\` is the user's to run (${why}). Do not run it or retry it another way: hand it over in a fenced bash block, one command per block, with one line on what it does. See ${SKILL}.`,
});

const useRafa = (instead: string, rafa: string): Verdict => ({
  decision: 'deny',
  reason: `This project has rafa installed: run \`${rafa}\` in place of \`${instead}\`. Keep gh for steps rafa has no action for (gh pr create outside a loop, gh pr checkout, gh run view --log, gh api). See ${SKILL}.`,
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

const prListFilters = (words: string[]): boolean => {
  const openOnly = words.includes('--state=open') || words.join(' ').includes('--state open') || words.join(' ').includes('-s open');
  const filters = PR_LIST_FILTERS.some((name) => hasFlag(words, name)) || words.some((word) => PR_LIST_SHORT_FILTERS.has(word));
  return filters && !openOnly;
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

/** The verdict on one gh command, its words after `gh`. */
export const judgeGh = (words: string[]): Verdict | null => {
  if (words[0] === 'pr') return judgeGhPr(words);
  if (words[0] === 'issue') return judgeGhIssue(words);
  return null;
};

const isRafa = (word: string | undefined): boolean => word === 'rafa' || (word?.endsWith('/rafa') ?? false);

/** The first verdict over every command in a Bash line, or null when all pass. */
export const judgeLine = (line: string): Verdict | null => {
  for (const words of commandsOf(line)) {
    const [program, ...rest] = words;
    const verdict = isRafa(program)
      ? judgeRafa(rest)
      : program === 'gh'
        ? judgeGh(rest)
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

if (import.meta.main) {
  const command = readCommand(await Bun.stdin.text());
  const verdict = command === null
    ? null
    : judgeLine(command);
  if (verdict !== null) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.decision,
        permissionDecisionReason: verdict.reason,
      },
    }));
  }
}

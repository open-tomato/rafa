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
 *   field it asks for, and a `gh issue create` only when every flag and
 *   label on it maps onto `rafa issue create` (see {@link mapIssueCreate}),
 *   the translated line named.
 * - **let through, with a reason**: a `gh` command a rafa line almost
 *   replaces, such as a `gh pr view --json` asking for a field `rafa pr
 *   show` does not answer, or a `gh issue create` carrying a flag or label
 *   `rafa issue create` has no flag for, an `epic:` label among them. No
 *   permission decision is written, so the normal permission flow
 *   applies, and the reason goes to the session as `additionalContext`:
 *   what rafa lacks, ending with the offer to report the gap under
 *   `module:cli-gap`.
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

/** The `--type` values `rafa issue create` takes, each mapped from a `type:<t>` label. */
export const ISSUE_CREATE_TYPES: readonly string[] = Object.freeze(['code', 'bug', 'spike', 'adr', 'chore', 'package-api', 'epic', 'spec']);

/** The `--priority` values `rafa issue create` takes, each mapped from a `priority:<p>` label. */
export const ISSUE_CREATE_PRIORITIES: readonly string[] = Object.freeze(['urgent', 'high', 'medium', 'low']);

/** The `rafa issue create` flags the `gh issue create` mapping writes. */
export const ISSUE_CREATE_FLAGS: readonly string[] = Object.freeze(['title', 'body', 'body-file', 'type', 'module', 'priority']);

// `gh issue create`'s short flags by their long names, and the flags that take no value.
const GH_ISSUE_CREATE_SHORT: Readonly<Record<string, string>> = Object.freeze({
  '-a': '--assignee',
  '-b': '--body',
  '-e': '--editor',
  '-F': '--body-file',
  '-l': '--label',
  '-m': '--milestone',
  '-p': '--project',
  '-R': '--repo',
  '-T': '--template',
  '-t': '--title',
  '-w': '--web',
});
const GH_ISSUE_CREATE_SWITCHES = new Set(['--editor', '--web']);
// The gh flags with a rafa flag of the same name, and the label prefixes the mapping reads.
const ISSUE_CREATE_SAME_FLAGS = new Set(['--title', '--body', '--body-file']);
const MAPPED_LABEL_PREFIXES = new Set(['type', 'module', 'priority', 'spec']);
const SPEC_BLOCKED = 'spec:blocked';
const BLANKED = '""';
const LONG_OPTION = /^(--[^=]+)(?:=(.*))?$/;
const SHORT_OPTION = /^(-[A-Za-z])=?(.*)$/;

const handOver = (line: string, why: string): Verdict => ({
  decision: 'deny',
  reason: `\`${line}\` is the user's to run (${why}). Do not run it or retry it another way: hand it over in a fenced bash block, one command per block, with one line on what it does. See ${SKILL}.`,
});

const useRafa = (instead: string, rafa: string, notes: readonly string[] = []): Verdict => ({
  decision: 'deny',
  reason: `This project has rafa installed: run \`${rafa}\` in place of \`${instead}\`.${notes.map((note) => ` ${note}`).join('')} Keep gh for steps rafa has no action for (gh pr create outside a loop, gh pr checkout, gh run view --log, gh api). See ${SKILL}.`,
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

/** One option of a gh line: its flag, long where gh names one, and its value; a word no flag takes has an empty flag. */
export type GhOption = { flag: string; value: string | undefined };

const optionIn = (word: string): GhOption => {
  const long = LONG_OPTION.exec(word);
  if (long?.[1] !== undefined) return { flag: long[1], value: long[2] };
  const short = SHORT_OPTION.exec(word);
  if (short?.[1] === undefined) return { flag: '', value: word };
  return {
    flag: GH_ISSUE_CREATE_SHORT[short[1]] ?? short[1],
    value: short[2] === ''
      ? undefined
      : short[2],
  };
};

/**
 * The options of a `gh issue create`, its words after `create`. A flag
 * written `--flag value`, `--flag=value`, `-f value` or `-fvalue` takes
 * its value; one gh takes no value for does not.
 */
export const issueCreateOptionsOf = (words: string[]): GhOption[] => {
  const options: GhOption[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const option = optionIn(words[i] ?? '');
    const next = words[i + 1];
    const takesNext = option.flag !== '' && option.value === undefined && !GH_ISSUE_CREATE_SWITCHES.has(option.flag)
      && next !== undefined && (next === '-' || !next.startsWith('-'));
    options.push(takesNext
      ? { ...option, value: next }
      : option);
    if (takesNext) i += 1;
  }
  return options;
};

/** The `rafa issue create` flag a label maps to, `''` for one rafa adds itself, or null for one with no flag. */
const rafaFlagForLabel = (label: string, specFromFile: boolean): string | null => {
  if (label === SPEC_BLOCKED) {
    return specFromFile
      ? ''
      : null;
  }
  const colon = label.indexOf(':');
  if (colon <= 0) return null;
  const prefix = label.slice(0, colon);
  const value = label.slice(colon + 1);
  if (prefix === 'type' && ISSUE_CREATE_TYPES.includes(value)) return `--type=${value}`;
  if (prefix === 'module' && value !== '') return `--module=${value}`;
  if (prefix === 'priority' && ISSUE_CREATE_PRIORITIES.includes(value)) return `--priority=${value}`;
  return null;
};

/** How a label rafa has no flag for is named: in full, or by its prefix when rafa reads no label with that prefix. */
const labelName = (label: string): string => {
  const colon = label.indexOf(':');
  const prefix = label.slice(0, colon);
  return colon <= 0 || MAPPED_LABEL_PREFIXES.has(prefix)
    ? `${label} label`
    : `${prefix}: label`;
};

/** The labels one `--label` value names, comma-joined or alone. */
const labelsIn = (value: string | undefined): string[] => (value ?? '')
  .split(',')
  .map((label) => label.trim())
  .filter((label) => label !== '');

const shownValue = (value: string): string => value === BLANKED
  ? '"…"'
  : value;

/**
 * What a `gh issue create` maps to: the `rafa issue create` flags in the
 * line's order, what rafa has no flag for, what the hook cannot read,
 * the rafa flags asked for two different values, and whether
 * `spec:blocked` was left to rafa.
 */
export type IssueCreateMapping = {
  flags: string[];
  unmapped: string[];
  unreadable: string[];
  conflicting: string[];
  leavesSpecBlocked: boolean;
};

/**
 * The mapping of a `gh issue create`, its words after `create`.
 * `--title`/`-t`, `--body`/`-b` and `--body-file`/`-F` map to the rafa
 * flag of the same name; a `type:<t>`, `module:<m>` or `priority:<p>`
 * label, one per `--label`/`-l` or comma-joined, to `--type`, `--module`
 * or `--priority` for a value rafa takes; `spec:blocked` to nothing on a
 * `type:spec` with a body file, since rafa adds it from the body's
 * `Blocked by:` line; `-R`/`--repo` to nothing, as only the project's
 * own reaches here. Every other flag, label and argument has no flag.
 */
export const mapIssueCreate = (words: string[]): IssueCreateMapping => {
  const options = issueCreateOptionsOf(words);
  const labels = options
    .filter((option) => option.flag === '--label')
    .flatMap((option) => labelsIn(option.value));
  const specFromFile = labels.includes('type:spec') && options.some((option) => option.flag === '--body-file' && option.value !== undefined);
  const flags: string[] = [];
  const unmapped: string[] = [];
  const unreadable: string[] = [];
  const conflicting: string[] = [];
  const add = (flag: string): void => {
    const name = flag.slice(0, flag.indexOf('='));
    const held = flags.find((written) => written.startsWith(`${name}=`));
    if (held === undefined) flags.push(flag);
    else if (held !== flag && !conflicting.includes(name)) conflicting.push(name);
  };
  const addLabel = (label: string): void => {
    const rafa = label.includes('"')
      ? undefined
      : rafaFlagForLabel(label, specFromFile);
    if (rafa === undefined) unreadable.push('a quoted --label');
    else if (rafa === null) unmapped.push(labelName(label));
    else if (rafa !== '') add(rafa);
  };
  for (const { flag, value } of options) {
    if (flag === '--label') labelsIn(value).forEach(addLabel);
    else if (flag === '--repo') continue;
    else if (flag === '') unmapped.push(`argument ${shownValue(value ?? '')}`);
    else if (!ISSUE_CREATE_SAME_FLAGS.has(flag)) unmapped.push(flag);
    else if (value === undefined) unreadable.push(`${flag} with no value`);
    else add(`${flag}=${shownValue(value)}`);
  }
  return { flags, unmapped, unreadable, conflicting, leavesSpecBlocked: specFromFile && labels.includes(SPEC_BLOCKED) };
};

/**
 * The verdict on a `gh issue create`: deny naming the translated
 * `rafa issue create` line when every flag and label maps, else let it
 * through naming the ones that do not.
 */
const judgeIssueCreate = (instead: string, words: string[]): Verdict => {
  const { flags, unmapped, unreadable, conflicting, leavesSpecBlocked } = mapIssueCreate(words);
  if (unmapped.length === 0 && unreadable.length === 0 && conflicting.length === 0) {
    const notes = [
      ...flags.some((flag) => flag.startsWith('--title='))
        ? []
        : ['`rafa issue create` needs a `--title`, which this line leaves out: add one.'],
      ...leavesSpecBlocked
        ? ['Leave `spec:blocked` off: rafa adds it itself when the body file carries a `Blocked by: #<n>` line.']
        : [],
    ];
    return useRafa(instead, ['rafa issue create', ...flags].join(' '), notes);
  }
  const why = [
    ...unmapped.length > 0
      ? [`\`rafa issue create\` has no flag for ${unmapped.join(', ')}.`]
      : [],
    ...unreadable.length > 0
      ? [`The hook cannot read ${unreadable.join(', ')}, so it cannot tell whether rafa has a flag for it.`]
      : [],
    ...conflicting.length > 0
      ? [`The line asks ${conflicting.join(', ')} for two values, and rafa takes one.`]
      : [],
  ].join(' ');
  return letThrough(instead, why, 'rafa issue create', unmapped);
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
  if (action === 'create') return judgeIssueCreate(instead, words.slice(2));
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

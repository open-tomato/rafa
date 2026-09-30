/**
 * Prints the whole rafa command tree in one compact page, read from
 * `rafa describe`: one line per action with its usage and summary, and the
 * 🪙 mark on the actions that start a Claude session. `--flag-notes` adds
 * the first sentence of each argument and flag under its action.
 *
 * Usage: `rafa describe | bun .claude/skills/rafa-tooling/help-tree.ts [--flag-notes]`
 */

export {};

interface Param {
  name: string;
  description: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

interface Action {
  name: string;
  summary: string;
  args: Param[];
  flags: Param[];
  spends: { when: string } | null;
}

interface Roster {
  version: string;
  subjects: { name: string; summary: string; actions: Action[] }[];
  commands: Action[];
}

const INDENT = '  ';
const NOTE_INDENT = '      ';

const firstSentence = (text: string): string => (text.match(/^.*?[.;](\s|$)/)?.[0] ?? text).trim();

const spendMark = (action: Action): string => {
  if (action.spends === null) return '';
  return action.spends.when === 'always'
    ? ' 🪙'
    : ' 🪙?';
};

const argUsage = (arg: Param): string => (arg.required
  ? `<${arg.name}>`
  : `[${arg.name}]`);

const flagUsage = (flag: Param): string => {
  if (flag.type !== 'boolean') return `--${flag.name}=<${flag.type}>`;
  return flag.default === true
    ? `--no-${flag.name}`
    : `--${flag.name}`;
};

const actionLines = (action: Action, withNotes: boolean): string[] => {
  const usage = [...action.args.map(argUsage), ...action.flags.map(flagUsage)].join(' ');
  const head = `${INDENT}${action.name}${spendMark(action)}${usage === ''
    ? ''
    : ` ${usage}`} — ${action.summary}`;
  if (!withNotes) return [head];
  const argNotes = action.args.map((arg) => `${NOTE_INDENT}${argUsage(arg)}: ${firstSentence(arg.description)}`);
  const flagNotes = action.flags.map((flag) => `${NOTE_INDENT}${flagUsage(flag)}: ${firstSentence(flag.description)}`);
  return [head, ...argNotes, ...flagNotes];
};

const renderTree = (roster: Roster, withNotes: boolean): string => [
  `rafa ${roster.version} — flags take --name=value; every command also takes --output=json.`,
  '🪙 starts a Claude session (needs the claude CLI, spends usage); 🪙? only in some cases.',
  '',
  ...roster.subjects.flatMap((subject) => [
    `${subject.name} — ${subject.summary}`,
    ...subject.actions.flatMap((action) => actionLines(action, withNotes)),
  ]),
  '',
  'top-level commands',
  ...roster.commands.flatMap((command) => actionLines(command, withNotes)),
].join('\n');

const input = await Bun.stdin.text();
if (input.trim() === '') {
  console.error('help-tree: no input; pipe `rafa describe` into it');
  process.exit(2);
}
console.log(renderTree(JSON.parse(input) as Roster, process.argv.includes('--flag-notes')));

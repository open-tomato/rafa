/**
 * The lines a stretch starts its operators with: the `claude` line one
 * operator session runs, and the tmux lines that open the engineer,
 * watchtower and analyst windows (#816).
 *
 * The rules are the ones `scripts/stretch/stretch.sh` follows, with one
 * change: each window runs `rafa stretch start --role=<role> --n=<n>`
 * where the script ran itself.
 *
 *   - **The session** ({@link claudeLine}) is
 *     `claude --plugin-dir <copy> --agent rafa-operators:rafa-stretch-<role> -n <name> <prompt>`.
 *     `<copy>` is the stretch's own copy of the operators, and the plugin
 *     loads under {@link OPERATOR_PLUGIN}, so the agent is named
 *     `<plugin>:<agent>`. Remote Control names the session itself, so
 *     `--remote-control` takes the place of `-n` rather than joining it,
 *     and the name follows it.
 *   - **The name** ({@link operatorSessionName}) is
 *     `<project> stretch <n> <role>`, so two projects' sessions never
 *     share one.
 *   - **The prompts** of the watchtower and analyst
 *     ({@link besideEngineerPrompt}) are the script's: `/loop`, and a
 *     message naming the stretch's folder. The engineer's comes from
 *     `./prompt.ts`.
 *   - **The window command** ({@link windowCommand}) runs
 *     {@link roleCommand} and then holds the window: a window closes with
 *     its command, taking a refusal's message with it, so it prints the
 *     exit code and waits for Enter. tmux hands a one-word command to
 *     the person's own shell, which may not read `$?`, so the whole
 *     script runs under `sh -c`.
 *   - **The tmux lines** ({@link tmuxLines}) are `new-session` for the
 *     engineer, `new-window` for the watchtower and the analyst, then
 *     `select-window` back on the engineer. Every target is the exact
 *     match `=<session>` (`./folder.ts`), and every window starts in the
 *     project root.
 *
 * Every line is returned as argv, never run here; {@link lineText}
 * renders one as the shell would read it, for `--dry-run`. Nothing
 * outside `src/commands/stretch/` and `src/commands/doctor-stretch.ts`
 * imports this module, so the stretch logic can move into its own
 * package.
 */
import { shellQuote } from '../pr/preflight-items.js';

import { tmuxSessionName, tmuxTarget } from './folder.js';
import { OPERATOR_PREFIX } from './operators.js';

/** The name the operators load under; an agent is `<plugin>:<agent>`. */
export const OPERATOR_PLUGIN = 'rafa-operators';

/** The three operator roles, in the order their windows open. */
export const OPERATOR_ROLES = ['engineer', 'watchtower', 'analyst'] as const;

/** One operator role. */
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/** The program each window starts its role with, unless told another. */
export const DEFAULT_RAFA_COMMAND: readonly string[] = ['rafa'];

/** What a window runs after its role ends, so the exit message stays until Enter. */
export const HOLD_SCRIPT = 'echo "exited: $?, press Enter to close"; read -r _';

/** A `-f=value` or `--flag=value` word a shell takes as it stands. */
const PLAIN_FLAG = /^--?[\w-]+=[\w.:/-]*$/;

/** What one operator's `claude` line needs. */
export interface ClaudeLineInput {
  /** The stretch's own copy of the operators, `.rafa/stretch/<n>/operators`. */
  readonly pluginDir: string;
  readonly role: OperatorRole;
  readonly project: string;
  readonly n: number;
  readonly prompt: string;
  readonly remoteControl: boolean;
}

/** What one window's command needs. */
export interface RoleCommandInput {
  readonly role: OperatorRole;
  readonly n: number;
  readonly remoteControl: boolean;
  /** The program words that run rafa; {@link DEFAULT_RAFA_COMMAND} when absent. */
  readonly rafa?: readonly string[];
}

/** What the tmux lines need. */
export interface TmuxLinesInput {
  /** The project root every window starts in. */
  readonly root: string;
  readonly project: string;
  readonly n: number;
  readonly remoteControl: boolean;
  /** The program words that run rafa; {@link DEFAULT_RAFA_COMMAND} when absent. */
  readonly rafa?: readonly string[];
}

/** Whether `value` names an operator role. */
export function isOperatorRole(value: string): value is OperatorRole {
  return (OPERATOR_ROLES as readonly string[]).includes(value);
}

/** `rafa-operators:rafa-stretch-<role>`, the `--agent` value of a role. */
export function operatorAgent(role: OperatorRole): string {
  return `${OPERATOR_PLUGIN}:${OPERATOR_PREFIX}${role}`;
}

/** `<project> stretch <n> <role>`, the Claude session's name. */
export function operatorSessionName(project: string, n: number, role: OperatorRole): string {
  return `${project} stretch ${String(n)} ${role}`;
}

/** The opening message of the watchtower or the analyst for stretch `n`. */
export function besideEngineerPrompt(role: Exclude<OperatorRole, 'engineer'>, n: number): string {
  if (role === 'watchtower') return '/loop';
  return `Stretch ${String(n)} is running. Read .rafa/stretch/${String(n)}/, then wait for my first hunch.`;
}

/** The `claude` line one operator session runs, as argv; see the module note. */
export function claudeLine(input: ClaudeLineInput): readonly string[] {
  const nameFlag = input.remoteControl
    ? '--remote-control'
    : '-n';
  return [
    'claude',
    '--plugin-dir',
    input.pluginDir,
    '--agent',
    operatorAgent(input.role),
    nameFlag,
    operatorSessionName(input.project, input.n, input.role),
    input.prompt,
  ];
}

/** `rafa stretch start --role=<role> --n=<n>`, with `--remote-control` when asked, as argv. */
export function roleCommand(input: RoleCommandInput): readonly string[] {
  const flags = input.remoteControl
    ? ['--remote-control']
    : [];
  return [
    ...(input.rafa ?? DEFAULT_RAFA_COMMAND),
    'stretch',
    'start',
    `--role=${input.role}`,
    `--n=${String(input.n)}`,
    ...flags,
  ];
}

/** The one shell word a window runs: its role, then the hold, under `sh -c`. */
export function windowCommand(input: RoleCommandInput): string {
  const script = `${lineText(roleCommand(input))}; ${HOLD_SCRIPT}`;
  return `sh -c ${shellQuote(script)}`;
}

/** The tmux `new-session`, two `new-window` and `select-window` lines, in order, as argv. */
export function tmuxLines(input: TmuxLinesInput): readonly (readonly string[])[] {
  const session = tmuxSessionName(input.project, input.n);
  const target = tmuxTarget(session);
  const command = (role: OperatorRole): string => windowCommand({
    role,
    n: input.n,
    remoteControl: input.remoteControl,
    rafa: input.rafa,
  });
  const [engineer, ...beside] = OPERATOR_ROLES;
  return [
    ['tmux', 'new-session', '-d', '-s', session, '-c', input.root, '-n', engineer, command(engineer)],
    ...beside.map((role) => ['tmux', 'new-window', '-t', `${target}:`, '-c', input.root, '-n', role, command(role)]),
    ['tmux', 'select-window', '-t', `${target}:${engineer}`],
  ];
}

/**
 * `argv` as one shell line, each word quoted unless it is plain. A
 * `--flag=value` word with a plain value stays bare: a word opening with
 * `-` is never read as an assignment, and `shellQuote` alone would quote
 * every `=`.
 */
export function lineText(argv: readonly string[]): string {
  return argv.map((word) => PLAIN_FLAG.test(word)
    ? word
    : shellQuote(word)).join(' ');
}

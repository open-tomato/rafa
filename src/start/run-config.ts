/**
 * What a run reads off its command line and its plan before the first
 * task is dispatched.
 *
 * `start()` first refuses a detached run through
 * {@link refuseDetachedRun}, then resolves the settings it runs on through
 * {@link loadRunConfig}, reads its other flags through {@link argValue},
 * names where the injection mode came from with
 * {@link injectSourceLabel}, and hands the plan to
 * {@link announcePlanIssues} once, at start.
 *
 * `-d|--detached` is declared on `loop start` so its help does not change
 * when detached runs arrive in phase 6, and refused until then: a run is
 * single-thread, holding the terminal it starts in. The refusal comes
 * before anything else is read, so a refused run loads no config, waits
 * for no `--start-at` and writes no session record.
 *
 * Every line either writes goes through the active output
 * (`adapters/output/active.ts`), at warn level.
 */
import type { ConfigRoots } from '../config-load.js';
import type { ConfigSource, ResolvedConfig } from '../config.js';
import type { PlanIssue } from '../plan/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { loadConfig } from '../config-load.js';
import { parsePlan } from '../plan/index.js';

import { NOTHING_DISPATCHED } from './session.js';

/**
 * The value of the first `flag=value` argument, or undefined when no
 * argument starts with `flag=`. A bare `flag` is not one.
 */
export function argValue(args: readonly string[], flag: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit?.slice(flag.length + 1);
}

/** The flag asking for a detached run. */
const DETACHED_FLAG = '--detached';

/** Its one-letter alias, as `loop start` declares it. */
const DETACHED_ALIAS = '-d';

/**
 * Whether the words ask for a detached run: `--detached` or `-d`, bare or
 * with any value but `false`, ahead of a `--`. `--no-detached` asks for
 * none.
 */
export function asksDetached(args: readonly string[]): boolean {
  const end = args.indexOf('--');
  const words = end === -1
    ? args
    : args.slice(0, end);
  return words.some((word) => {
    const eqIndex = word.indexOf('=');
    const name = eqIndex === -1
      ? word
      : word.slice(0, eqIndex);
    if (name !== DETACHED_FLAG && name !== DETACHED_ALIAS) return false;
    return eqIndex === -1 || word.slice(eqIndex + 1) !== 'false';
  });
}

/**
 * Throws `CommandExit` with exit code 1 when the words ask for a detached
 * run ({@link asksDetached}), and returns otherwise. See the module note.
 */
export function refuseDetachedRun(args: readonly string[]): void {
  if (!asksDetached(args)) return;
  throw new CommandExit(1, [
    '❌ Refusing to start detached: `-d|--detached` arrives with phase 6, where sessions run beside each other.',
    '   Until then a run holds the terminal it starts in. Start it without the flag in a terminal of its own,',
    '   and reach it from any other with `rafa loop status`, `pause`, `resume` and `stop`.',
    NOTHING_DISPATCHED,
  ].join('\n'));
}

/** The flag naming how much of the plan each task session is handed. */
const INJECT_FLAG = '--inject';

/** The flag naming the resolver that picks each task's skills. */
const SKILLS_RESOLVER_FLAG = '--skills-resolver';

/**
 * The raw value of a valued flag, for `resolveConfig` to validate:
 * undefined without the flag, and the empty string for the bare flag.
 *
 * A bare flag is an empty value rather than no flag, so it is refused.
 * Read as absent, it would dispatch every task under the config's
 * setting while the operator believed they had named one.
 */
function valuedFlag(args: readonly string[], flag: string): string | undefined {
  return args.includes(flag)
    ? ''
    : argValue(args, flag);
}

/**
 * Resolves the settings a run starts on: `--inject=` and
 * `--skills-resolver=` over the project's `.rafa/config.yaml` under
 * `roots.root`, that over the user scope's under `roots.home`, and both
 * over the defaults, as `config.ts` ranks them.
 *
 * `--inject` overrides `plan.inject` and `--skills-resolver` overrides
 * `task.skills`, each for this run only: neither writes a file. They are
 * the two flags. `store` resolves from the files and the default and the
 * loop acts on nothing it says, but each file is judged whole, so an
 * unusable `store:` refuses the run as an unusable `plan.inject:` does.
 * A flag's value no setting accepts, a bare flag's empty one included,
 * refuses the run rather than falling back to the file's.
 *
 * Throws the {@link ConfigError} `loadConfig` throws, naming every
 * problem. A warning per unknown key goes to `warn`, or through the
 * active output's `warn` when none is given, as `loadConfig` writes one
 * when it is handed no sink either.
 */
export function loadRunConfig(
  roots: ConfigRoots,
  args: readonly string[],
  warn: (message: string) => void = warnThroughActiveOutput,
): ResolvedConfig {
  return loadConfig(roots, {
    inject: valuedFlag(args, INJECT_FLAG),
    taskSkills: valuedFlag(args, SKILLS_RESOLVER_FLAG),
  }, warn);
}

/** Writes one config warning through the active output. */
function warnThroughActiveOutput(message: string): void {
  activeOutput().warn(message);
}

/**
 * Where the injection mode came from, as the operator log names it: the
 * flag, the file that answered, or the default. The labels sit in a
 * record over every source, so a source added to `ConfigSource` fails to
 * compile here until it has one, rather than being named the default.
 */
export function injectSourceLabel({ sources, path, userPath }: ResolvedConfig): string {
  const labels: Record<ConfigSource, string> = {
    cli: INJECT_FLAG,
    file: path ?? 'the config file',
    user: userPath ?? 'the user config file',
    default: 'the default',
  };
  return labels[sources.inject];
}

/**
 * Names every part of the plan `parsePlan` did not read as written, and
 * answers them. Called once, at start.
 *
 * Nothing here stops a run: the parser never throws, and an issue is a
 * warning. It is printed because two of the reasons change what the
 * loop does and nothing else says so. A task line inside a closed
 * `rafa:*` block is block body and is never dispatched, so a block
 * missing its closing fence, closed instead by a later fence, takes
 * every task between the two out of the run. And every line
 * after a block never closed is read by the model as that block's
 * body, so a `stage` or `task` rendering of a task there falls back to
 * `full`.
 */
export function announcePlanIssues(planContent: string): readonly PlanIssue[] {
  const { issues } = parsePlan(planContent);
  if (issues.length === 0) return issues;

  const output = activeOutput();
  output.warn(`\n⚠️  The plan holds ${issues.length} part(s) the loop does not read as written:`);
  for (const issue of issues) output.warn(`   line ${issue.line}: ${issue.text}`);
  return issues;
}

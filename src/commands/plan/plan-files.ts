/**
 * What `rafa plan list`, `rafa plan show`, `rafa plan validate` and
 * `rafa plan risk` share that reads a command's context, arguments or
 * flags: the project a command was handed, the config that resolves for
 * it, where its plans sit by that config, the refusal of a line handing
 * a command the wrong number of arguments, and the read of a flag taking
 * no value. This is the command half; the library half,
 * `../../plan/plan-files.ts`, holds the readings that take none of those
 * (the {@link PlansDir} shape, the task counts, the file names, an issue
 * as a line, where a refused plan is moved aside), and every importer
 * takes them from there: this file re-exports none of them.
 *
 * ## Where plans sit
 *
 * `list` and `show` read the directory {@link resolvePlansDir} answers:
 * `plan.dir` of the config that resolves for the project the dispatcher
 * found, resolved against that project's root, which is `.rafa/plans`
 * unless a config names another. That is the directory `rafa plan
 * create` writes `PLAN-<stub>.md` into and the one `rafa loop start`
 * looks for its default plan in, so the readers and the writers are on
 * one directory whatever `plan.dir` is set to. `rafa plan validate` takes
 * a file path and reads no config, so it is on none of this.
 *
 * A config `loadConfig` refuses is refused with exit code 1, naming the
 * command and every problem; {@link resolveProjectConfig} is that
 * refusal, and `rafa plan risk` reads the whole config through it.
 *
 * ## A flag taking no value
 *
 * The parser reads the word after a flag as its value whenever the line
 * gives that flag none with `=`, a boolean flag included: `--strict
 * plan.md` reads `plan.md` as the value of `--strict` and hands the
 * command no argument (measured on 2026-09-23 with `parseArgs` over a
 * boolean `strict`: `{"positional":[],"flags":{"strict":"plan.md"}}`).
 * {@link readSwitch} refuses such a value rather than reading the flag
 * as set and the plan as absent.
 */
import type { RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { PlansDir } from '../../plan/plan-files.js';
import type { ProjectFound } from '../../project/scope.js';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { plansDirAt } from '../../plan/plan-files.js';

/**
 * The project the dispatcher resolved for a command that declares it
 * needs one, which is every command but the three that do not.
 */
export function requireProject(context: RafaContext, command: string): ProjectFound {
  if (context.project === null) throw new Error(`${command} runs inside a project, and was handed none`);
  return context.project;
}

/**
 * Where plans sit for `project`, read off the `plan.dir` of the config
 * that resolves there; a refusal with exit code 1 naming `command` for a
 * config `loadConfig` refuses. See the module note.
 */
export function resolvePlansDir(
  project: ProjectFound,
  command: string,
  warn: (message: string) => void,
): PlansDir {
  return plansDirAt(project.root, resolveProjectConfig(project, command, warn).planDir);
}

/**
 * The config that resolves for `project`; a refusal with exit code 1
 * naming `command` and every problem for a config `loadConfig` refuses.
 */
export function resolveProjectConfig(
  project: ProjectFound,
  command: string,
  warn: (message: string) => void,
): RafaConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      `❌ ${command}: the config cannot be used:`,
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
}

/** Refuses a line handing a command reading none any argument: exit code 1, naming the words and the usage. */
export function expectNoArgument(args: readonly string[], usage: string): void {
  if (args.length === 0) return;
  throw new CommandExit(1, `❌ Expected no argument, got ${args.length}: ${args.join(' ')}\nUsage: ${usage}`);
}

/**
 * The one argument a line hands a command reading one, or a refusal with
 * exit code 1 naming what the line handed and the usage.
 */
export function expectOneArgument(args: readonly string[], usage: string): string {
  const [only] = args;
  if (args.length === 1 && only !== undefined) return only;
  const got = args.length === 0
    ? 'none'
    : `${args.length}: ${args.join(' ')}`;
  throw new CommandExit(1, `❌ Expected one argument, got ${got}\nUsage: ${usage}`);
}

/**
 * The argument a line hands a command reading at most one, null for a
 * line handing none, or a refusal with exit code 1 naming the words and
 * the usage for a line handing more.
 */
export function expectAtMostOneArgument(args: readonly string[], usage: string): string | null {
  const [only] = args;
  if (only === undefined) return null;
  if (args.length === 1) return only;
  throw new CommandExit(1, `❌ Expected at most one argument, got ${args.length}: ${args.join(' ')}\nUsage: ${usage}`);
}

/**
 * Whether a flag taking no value was typed: false when absent, true when
 * bare. A value the parser read into it is refused with exit code 1,
 * naming the flag, the value and `hint`; see the module note.
 */
export function readSwitch(name: string, value: string | boolean | undefined, hint: string): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(1, `❌ --${name} takes no value, and read "${value}" as one. ${hint}`);
}

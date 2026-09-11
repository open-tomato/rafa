#!/usr/bin/env bun

/**
 * ralph — spec → plan → loop, in four commands.
 *
 *   bun tools/ralph/ralph.ts plan  --spec=specs/<file>.md [--stub=<name>]
 *   bun tools/ralph/ralph.ts start [--plan=PLAN-<name>.md] [--start-at=HH:MM]
 *   bun tools/ralph/ralph.ts usage
 *   bun tools/ralph/ralph.ts effort <collect|report> [flags]
 *
 * (Also available as `bun run ralph <command>`.)
 */
import collect from './effort/collect.js';
import report from './effort/report.js';
import plan from './plan.js';
import start from './start.js';
import usage from './usage.js';

const HELP = [
  'ralph — agent task loop',
  '',
  'Commands:',
  '  plan  --spec=specs/<file>.md [--stub=<name>]   Generate PLAN-<stub>.md (+ PREREQUISITES-<stub>.md) from a spec',
  '  start [--plan=<file>] [--start-at=HH:MM]       Execute a plan task-by-task (resumes blocked tasks first),',
  '                                                 then wrap up, open the PR and wait for CI',
  '                                                 (--no-ci-wait, --ci-timeout=<min>, --ci-attempts=<n>)',
  '  usage                                          Show Claude usage (CLAUDE_USAGE_PERCENT override)',
  '  effort collect [--since=<date>] [--no-git]     Collect session and commit rows into .ralph/effort/ (--no-sessions, --verbose)',
  '  effort report [--kind=<k>] [--entrypoint=<e>]  Roll the stored session rows up per plan (--json)',
].join('\n');

/**
 * True when argv asked for the help text rather than mistyping a
 * command. Shared by both dispatch levels so the two cannot drift.
 */
function isHelpRequest(word: string | undefined): boolean {
  return word === undefined || word === 'help' || word === '--help';
}

/**
 * Dispatches an `effort` sub-command.
 *
 * An unrecognised sub-command REFUSES rather than falling back to
 * either half, for the same reason both effort parsers refuse an
 * unrecognised flag: a `ralph effort reprot` that exited 0 having
 * neither collected nor reported is the silent success this stack
 * is built to avoid.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, which
 * is what both dispatched commands do, so nothing is truncated
 * mid-flush.
 */
async function effort(args: string[]): Promise<void> {
  const [subcommand, ...flags] = args;

  switch (subcommand) {
    case 'collect':
      await collect(flags);
      return;
    case 'report':
      await report(flags);
      return;
    default:
      console.log(HELP);
      if (!isHelpRequest(subcommand)) {
        console.error(`\nUnknown effort command: ${subcommand}`);
        process.exitCode = 1;
      }
  }
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'plan':
    await plan(rest);
    break;
  case 'start':
    await start(rest);
    break;
  case 'usage':
    await usage(rest);
    break;
  case 'effort':
    await effort(rest);
    break;
  default:
    console.log(HELP);
    if (!isHelpRequest(command)) {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
}

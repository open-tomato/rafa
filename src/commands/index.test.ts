/**
 * Tests for the core roster (`src/commands/index.ts`) and the
 * declarations of the thirty-nine commands it registers: what the registry
 * holds, how each spelling of the command tree routes, with the
 * deprecation line each alias prints, and that each command wrapping a
 * phase 0 command declares the flags its phase 0 module reads.
 * `describe`, `doctor`, `init`, `self-update`, `plan list`, `plan show`, `plan validate`,
 * `loop stop`, `loop pause`, `loop resume`, `loop status`, `loop list`,
 * the five `issue` actions, `module list`, `module exec`, `agent vendor`, `agent list`,
 * `skill check`, `skill list`, `skill demote`, `instinct check`, `instinct list`, `instinct show`
 * and the four `pr` readers beside `pr merge` and `pr triage`
 * wrap none, and each is held to the
 * arguments and flags spelled for it here. Every command is held to
 * exactly one of the two lists.
 *
 * The routing cases dispatch over a registry built from the roster's own
 * subjects and commands, each `run` swapped for one recording what ran
 * and the words it was handed. So each declaration routes as registered,
 * inside a project of this file's own beside a home of its own, and no
 * phase 0 command runs: no git, no real home, no session. That a
 * wrapped `run` hands those words on is held in `wrap.test.ts`, and the
 * phase 0 commands run behind `src/rafa.ts` in the suites that spawn it.
 *
 * ## The flag cases read source
 *
 * A flag declared and not read by its phase 0 parser promises what the
 * command lacks: `-p` for `--plan`, which the command tree spells for
 * `loop start`, is read by no parser, so the loop would run its default
 * plan. A flag read and not declared is missing from help. So each
 * command's flags, typed as a line types them (`--<name>`, or
 * `--no-<name>` for one defaulting to true), are held equal to the quoted
 * `--` literals of the modules reading its command line, a literal being
 * one a quote or an `=` closes. Read when this landed, those literals are
 * exactly the flags each parser compares an argument against: no message,
 * usage line or comment in those modules quotes one that way. The control
 * reads a planted `--session-id`, which the tree declares for `loop stop`
 * and no phase 0 module reads, and skips the same flag inside a message.
 * `--detached`, which `loop start` now declares, is read by
 * `start/run-config.ts`, which refuses it.
 *
 * Seven mutations were driven on 2026-09-14, one run each over this file,
 * with 28 pass before and after and every file restored byte-identical
 * (sha256), and each reddened at least one case. The `start` alias
 * dropped reddened three: the alias case, its route and its help line.
 * `--detached` declared for `loop start` and `--any-branch` left
 * undeclared each reddened the `loop start` flag case, and the default of
 * `progress` dropped reddened the `plan create` one, the flag then typed
 * as `--progress`. The subject `issue` declared ahead of any action
 * reddened the subject case, `json` among the outputs of `usage` its
 * declaration case, and `effort report` ahead of `effort collect` the
 * roster order case and the refusal listing the actions of `effort`.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { RafaCommand } from '../cli/command.js';
import type { DispatchOutcome } from '../cli/dispatch.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { commandProblem, commandSpelling } from '../cli/command.js';
import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';
import { plantProjectConfig } from '../tests/cli-capture.js';

import { CORE_COMMANDS, CORE_REGISTRY, CORE_SUBJECTS } from './index.js';

/** The `src/` directory, which the phase 0 modules sit in. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The modules reading each command line, from `src/`. */
const READERS: Readonly<Record<string, readonly string[]>> = {
  'plan create': ['plan.ts'],
  'loop start': ['start.ts', 'start/run-config.ts', 'start/runtime.ts'],
  'effort collect': ['effort/collect.ts'],
  'effort report': ['effort/report.ts'],
  'usage': ['usage.ts'],
};

/** The outputs each command declares: text and json, each phase 0 command now writing through the active output. */
const OUTPUTS: Readonly<Record<string, RafaCommand['outputs']>> = {
  'plan create': ['text', 'json'],
  'plan list': ['text', 'json'],
  'plan show': ['text', 'json'],
  'plan validate': ['text', 'json'],
  'loop start': ['text', 'json'],
  'loop stop': ['text', 'json'],
  'loop pause': ['text', 'json'],
  'loop resume': ['text', 'json'],
  'loop status': ['text', 'json'],
  'loop list': ['text', 'json'],
  'issue list': ['text', 'json'],
  'issue show': ['text', 'json'],
  'issue create': ['text', 'json'],
  'issue comment': ['text', 'json'],
  'issue move': ['text', 'json'],
  'pr current': ['text', 'json'],
  'pr show': ['text', 'json'],
  'pr view': ['text', 'json'],
  'pr list': ['text', 'json'],
  'pr merge': ['text', 'json'],
  'pr triage': ['text', 'json'],
  'effort collect': ['text', 'json'],
  'effort report': ['text', 'json'],
  'module list': ['text', 'json'],
  'module exec': ['text', 'json'],
  'agent vendor': ['text', 'json'],
  'agent list': ['text', 'json'],
  'skill check': ['text', 'json'],
  'skill list': ['text', 'json'],
  'skill demote': ['text', 'json'],
  'skill backfill': ['text', 'json'],
  'instinct check': ['text', 'json'],
  'instinct list': ['text', 'json'],
  'instinct show': ['text', 'json'],
  'init': ['text', 'json'],
  'doctor': ['text', 'json'],
  'self-update': ['text', 'json'],
  'usage': ['text', 'json'],
  'describe': ['text', 'json'],
};

/** What each command wrapping no phase 0 command declares: its arguments, then its flags, by name. */
const OWN_DECLARATIONS: Readonly<Record<string, [string[], string[]]>> = {
  'plan list': [[], []],
  'plan show': [['stub'], ['tracker']],
  'plan validate': [['file'], []],
  'loop stop': [[], ['session-id']],
  'loop pause': [[], ['session-id']],
  'loop resume': [[], ['session-id']],
  'loop status': [[], ['session-id']],
  'loop list': [[], []],
  'issue list': [[], ['state', 'type', 'module', 'search', 'limit']],
  'issue show': [['id'], []],
  'issue create': [[], ['title', 'body', 'type', 'module', 'priority']],
  'issue comment': [['id'], ['body']],
  'issue move': [['id', 'state'], []],
  'pr current': [[], []],
  'pr show': [['n'], []],
  'pr view': [['n'], []],
  'pr list': [[], []],
  'pr merge': [['n'], ['yes', 'method']],
  'pr triage': [['n'], ['comment', 'max-attempts']],
  'module list': [[], []],
  'module exec': [['module', 'action'], []],
  'agent vendor': [['name'], ['force']],
  'agent list': [[], []],
  'skill check': [['dir'], ['fix', 'project']],
  'skill list': [[], ['tier']],
  'skill demote': [['dir'], ['apply']],
  'skill backfill': [['dir'], ['propose', 'apply', 'project']],
  'instinct check': [['dir'], []],
  'instinct list': [[], []],
  'instinct show': [['id'], []],
  'init': [[], ['root', 'yes']],
  'doctor': [[], ['plan']],
  'self-update': [[], ['force']],
  'describe': [[], []],
};

/** The commands running outside a project too: `module exec`, whose modules route before any project is resolved, `skill check` and `instinct check`, whose only project seam is `--project`, `init`, which makes one, and `describe`. */
const OUTSIDE_A_PROJECT = ['module exec', 'skill check', 'instinct check', 'init', 'describe'];

/** A temporary directory of this file's own, holding the project and the home every routing case dispatches with. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-roster-'));
const PROJECT = join(tempBase, 'project');
const HOME = join(tempBase, 'home');
plantProjectConfig(PROJECT);
mkdirSync(HOME);

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The deprecation line typing `typed` writes, as stderr holds it. */
function deprecation(typed: string, spelling: string): string {
  return `rafa: "rafa ${typed}" is deprecated; use "rafa ${spelling}"\n`;
}

/** Each line: the words after `rafa`, the command that runs, the words it is handed, and stderr. */
const ROUTES: readonly (readonly [string, string, readonly string[], string])[] = [
  ['plan create --spec=.specs/a.md --stub=a', 'plan create', ['--spec=.specs/a.md', '--stub=a'], ''],
  ['plan --spec=.specs/a.md', 'plan create', ['--spec=.specs/a.md'], deprecation('plan', 'plan create')],
  ['plan', 'plan create', [], deprecation('plan', 'plan create')],
  ['plan list', 'plan list', [], ''],
  ['plans show my-plan --tracker', 'plan show', ['my-plan', '--tracker'], ''],
  ['plan validate .plans/PLAN-a.md', 'plan validate', ['.plans/PLAN-a.md'], ''],
  ['loop start --plan=.plans/PLAN-a.md --no-ci-wait', 'loop start', ['--plan=.plans/PLAN-a.md', '--no-ci-wait'], ''],
  ['start --plan=.plans/PLAN-a.md', 'loop start', ['--plan=.plans/PLAN-a.md'], deprecation('start', 'loop start')],
  ['loops start', 'loop start', [], ''],
  ['loop start -d', 'loop start', ['-d'], ''],
  ['loop stop -s session-0001', 'loop stop', ['-s', 'session-0001'], ''],
  ['loop pause --session-id=session-0001', 'loop pause', ['--session-id=session-0001'], ''],
  ['loops resume', 'loop resume', [], ''],
  ['loop status', 'loop status', [], ''],
  ['loop list', 'loop list', [], ''],
  ['issue list --type=bug', 'issue list', ['--type=bug'], ''],
  ['issues show 12', 'issue show', ['12'], ''],
  ['issue create --title=Timeouts', 'issue create', ['--title=Timeouts'], ''],
  ['issue comment 12 --body=Reproduced', 'issue comment', ['12', '--body=Reproduced'], ''],
  ['issue move 12 done', 'issue move', ['12', 'done'], ''],
  ['pr current', 'pr current', [], ''],
  ['prs show 41', 'pr show', ['41'], ''],
  ['pr view', 'pr view', [], ''],
  ['pr list', 'pr list', [], ''],
  ['pr merge 41 --yes --method=squash', 'pr merge', ['41', '--yes', '--method=squash'], ''],
  ['pr triage 41 --no-comment', 'pr triage', ['41', '--no-comment'], ''],
  ['usage', 'usage', [], ''],
  ['effort collect --since=2026-09-01 --no-git', 'effort collect', ['--since=2026-09-01', '--no-git'], ''],
  ['efforts report --kind=task', 'effort report', ['--kind=task'], ''],
  ['module list', 'module list', [], ''],
  ['modules exec', 'module exec', [], ''],
  ['agent vendor tdd-guide', 'agent vendor', ['tdd-guide'], ''],
  ['agents list', 'agent list', [], ''],
  ['skill check .claude/skills --fix', 'skill check', ['.claude/skills', '--fix'], ''],
  ['skills check .claude/skills --project=.', 'skill check', ['.claude/skills', '--project=.'], ''],
  ['skill list --tier=user', 'skill list', ['--tier=user'], ''],
  ['skill demote --apply .claude/skills', 'skill demote', ['--apply', '.claude/skills'], ''],
  ['skill backfill .claude/skills --propose', 'skill backfill', ['.claude/skills', '--propose'], ''],
  ['instinct check .rafa/instincts', 'instinct check', ['.rafa/instincts'], ''],
  ['instincts check .rafa/instincts', 'instinct check', ['.rafa/instincts'], ''],
  ['instinct list', 'instinct list', [], ''],
  ['instinct show gate-order', 'instinct show', ['gate-order'], ''],
  ['init --root=. --yes', 'init', ['--root=.', '--yes'], ''],
  ['doctor --plan=.plans/PLAN-a.md', 'doctor', ['--plan=.plans/PLAN-a.md'], ''],
  ['self-update', 'self-update', [], ''],
  ['describe', 'describe', [], ''],
];

/** Each core command by its spelling. */
const COMMANDS = CORE_COMMANDS.map((command): [string, RafaCommand] => [commandSpelling(command), command]);

/** What one line ran, and what it wrote. */
interface Dispatched {
  readonly ran: readonly (readonly [string, readonly string[]])[];
  readonly outcome: DispatchOutcome;
  readonly stdout: string;
  readonly stderr: string;
}

/** A stream of its own, and the text written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(''),
  };
}

/** Dispatches the words of `line` over the roster, each command recording what it was handed in place of running. */
async function dispatchRecorded(line: string): Promise<Dispatched> {
  const ran: (readonly [string, readonly string[]])[] = [];
  const commands = CORE_COMMANDS.map((command): RafaCommand => ({
    ...command,
    run: async (context) => {
      ran.push([commandSpelling(command), [...context.argv]]);
    },
  }));
  const stdout = memoryStream();
  const stderr = memoryStream();
  const outcome = await dispatch(line.split(' ').filter((word) => word.length > 0), {
    registry: createCommandRegistry({ subjects: CORE_SUBJECTS, commands }),
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
    cwd: PROJECT,
    home: HOME,
  });
  return { ran, outcome, stdout: stdout.text(), stderr: stderr.text() };
}

/** A declared flag as a line types it: `--<name>`, or `--no-<name>` for one defaulting to true. */
function typedFlag(flag: RafaCommand['flags'][number]): string {
  return flag.default === true
    ? `--no-${flag.name}`
    : `--${flag.name}`;
}

/** The quoted flag literals of a source, each once and sorted: `'--name'` and `'--name=`. */
function literalFlags(source: string): string[] {
  const flags = [...source.matchAll(/'(--[a-z][a-z-]*)['=]/g)].map((match) => match[1] ?? '');
  return [...new Set(flags)].sort((a, b) => a.localeCompare(b));
}

describe('the core roster', () => {
  it('registers the nine subjects with an action, in roster order', () => {
    expect(CORE_REGISTRY.subjects().map((subject) => subject.name)).toEqual(['plan', 'loop', 'issue', 'pr', 'effort', 'module', 'agent', 'skill', 'instinct']);
    expect(CORE_SUBJECTS.filter((subject) => CORE_REGISTRY.actionsOf(subject.name).length === 0)).toEqual([]);
  });

  it('registers plan create, the three plan readers, loop start with its five session actions, the five issue actions, the four pr readers, pr merge and pr triage, the effort commands, module list and module exec, the two agent actions, skill check, skill list, skill demote and skill backfill, the three instinct actions, init, doctor, self-update, usage and describe, in roster order, none of them hidden', () => {
    expect(CORE_REGISTRY.commands({ includeHidden: true }).map(commandSpelling)).toEqual([
      'plan create',
      'plan list',
      'plan show',
      'plan validate',
      'loop start',
      'loop stop',
      'loop pause',
      'loop resume',
      'loop status',
      'loop list',
      'issue list',
      'issue show',
      'issue create',
      'issue comment',
      'issue move',
      'pr current',
      'pr show',
      'pr view',
      'pr list',
      'pr merge',
      'pr triage',
      'effort collect',
      'effort report',
      'module list',
      'module exec',
      'agent vendor',
      'agent list',
      'skill check',
      'skill list',
      'skill demote',
      'skill backfill',
      'instinct check',
      'instinct list',
      'instinct show',
      'init',
      'doctor',
      'self-update',
      'usage',
      'describe',
    ]);
    expect(CORE_REGISTRY.commands()).toHaveLength(CORE_COMMANDS.length);
  });

  it('runs every command inside a project but module exec, the two checkers, init and describe, which declare needsProject false', () => {
    const outside = CORE_COMMANDS.filter((command) => command.needsProject === false).map(commandSpelling);

    expect(outside).toEqual(OUTSIDE_A_PROJECT);
  });

  it('aliases plan create as plan and loop start as start, and nothing else', () => {
    expect(CORE_REGISTRY.aliases().map((alias) => [alias.words.join(' '), commandSpelling(alias.command)])).toEqual([
      ['plan', 'plan create'],
      ['start', 'loop start'],
    ]);
  });

  it.each(COMMANDS)('declares for %s a summary, a description, examples of its own spelling and its outputs', (spelling, command) => {
    expect(commandProblem(command)).toBeNull();
    expect(command.summary.length).toBeGreaterThan(0);
    expect(command.description.length).toBeGreaterThan(command.summary.length);
    expect(command.examples.length).toBeGreaterThan(0);
    expect(command.examples.filter((example) => !example.cmd.startsWith(`rafa ${spelling}`))).toEqual([]);
    expect(command.outputs).toEqual(OUTPUTS[spelling] ?? []);
  });
});

describe('how the command tree routes', () => {
  it.each(ROUTES)('runs rafa %s as %s', async (line, spelling, argv, stderr) => {
    const run = await dispatchRecorded(line);

    expect(run.ran).toEqual([[spelling, argv]]);
    expect(run.stderr).toBe(stderr);
    expect(run.stdout).toBe('');
    expect(run.outcome.exitCode).toBe(0);
  });

  it('runs rafa effort report --json in json mode after one deprecation line, handed --json as typed', async () => {
    const run = await dispatchRecorded('effort report --json');

    expect(run.ran).toEqual([['effort report', ['--json']]]);
    expect(run.stderr).toBe('rafa: "rafa effort report --json" is deprecated; use "rafa effort report --output=json"\n');
    const types = run.stdout
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types).toEqual(['start', 'result']);
    expect(run.outcome.exitCode).toBe(0);
  });

  it.each(['--help', 'start --help', 'plan --help', 'plan show --help', 'loop --help', 'loop stop --help', 'issue --help', 'issue move --help', 'effort report --help'])('answers rafa %s with help, running nothing', async (line) => {
    const run = await dispatchRecorded(line);

    expect(run.ran).toEqual([]);
    expect(run.stdout.length).toBeGreaterThan(0);
    expect(run.stderr).toBe('');
    expect(run.outcome.exitCode).toBe(0);
  });

  it('refuses a subject with no action, and a word naming nothing, running nothing', async () => {
    const bare = await dispatchRecorded('effort');
    const issue = await dispatchRecorded('issue');
    const unknown = await dispatchRecorded('stop');

    expect(bare.stderr).toBe('rafa: "effort" needs an action; one of: collect, report\n');
    expect(issue.stderr).toBe('rafa: "issue" needs an action; one of: list, show, create, comment, move\n');
    expect(unknown.stderr).toBe('rafa: unknown subject or command "stop"\n');
    expect([bare.outcome.exitCode, issue.outcome.exitCode, unknown.outcome.exitCode]).toEqual([1, 1, 1]);
    expect([...bare.ran, ...issue.ran, ...unknown.ran]).toEqual([]);
  });
});

describe('the flags each command declares', () => {
  it('holds each core command to the flags its phase 0 module reads or to its own declaration, never both or neither', () => {
    const neitherOrBoth = COMMANDS
      .map(([spelling]) => spelling)
      .filter((spelling) => Object.hasOwn(READERS, spelling) === Object.hasOwn(OWN_DECLARATIONS, spelling));

    expect(neitherOrBoth).toEqual([]);
  });

  it.each(COMMANDS.filter(([spelling]) => Object.hasOwn(OWN_DECLARATIONS, spelling)))('declares for %s, which wraps no phase 0 command, the arguments and flags spelled here', (spelling, command) => {
    expect([command.args.map((arg) => arg.name), command.flags.map((flag) => flag.name)]).toEqual(OWN_DECLARATIONS[spelling] ?? []);
  });

  it.each(COMMANDS.filter(([spelling]) => Object.hasOwn(READERS, spelling)))('declares for %s exactly the flags its phase 0 module reads', (spelling, command) => {
    const readers = READERS[spelling] ?? [];
    const read = literalFlags(readers.map((file) => readFileSync(join(SRC_DIR, file), 'utf8')).join('\n'));

    expect(readers.length).toBeGreaterThan(0);
    expect(command.flags.map(typedFlag).sort((a, b) => a.localeCompare(b))).toEqual(read);
  });

  it('reads a planted quoted flag literal, and none inside a message', () => {
    expect(literalFlags('if (args.includes(\'--session-id\')) return;')).toEqual(['--session-id']);
    expect(literalFlags('argValue(args, \'--plan\'); arg.startsWith(\'--since=\');')).toEqual(['--plan', '--since']);
    expect(literalFlags('console.error(\'Usage: rafa loop stop --session-id\');')).toEqual([]);
  });
});

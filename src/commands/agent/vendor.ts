/**
 * `rafa agent vendor <name>... [--force]`: an agent definition the home
 * carries copied into the project, so a session spawned under the loop's
 * default `loop.settingSources` resolves the name.
 *
 * This is the fix command the roster names (`agents/roster.ts`,
 * `VENDOR_COMMAND`). A task routed `agent=tdd-guide` is dispatched with
 * `--agent tdd-guide`, and a name no loaded scope defines exits 1 before
 * any model call, which is what `loop start`'s preflight and
 * `rafa plan validate` refuse ahead of the run. Under
 * `project,local`, the default, `~/.claude/agents` is out of reach, so a
 * definition that resolves for an interactive `claude` in the same
 * checkout resolves for none of the loop's sessions until it sits in
 * `<root>/.claude/agents/`. Copying it is the fix, and this command is
 * the copy.
 *
 * ## Which file is copied where
 *
 * A name is the frontmatter `name` of a definition, never its file stem,
 * because that is what `--agent` resolves by
 * (`utils/agent-definition.ts`). So the source is the
 * `~/.claude/agents/*.md` whose frontmatter carries the name asked for,
 * as `readAgentDefinitions` reads the directory, and the destination
 * keeps that file's own name: a `~/.claude/agents/weird-file.md`
 * carrying `name: renamed-agent` is vendored to
 * `<root>/.claude/agents/weird-file.md`, and resolves as
 * `renamed-agent` there as it did at home. Two home files carrying one
 * name leave the first in directory order the one copied, as
 * `resolveAgentRoster` takes the first.
 *
 * The home is the project's, the dispatcher's, and the command reads no
 * config: which scopes a session loads decides nothing about where a
 * definition may be copied from or to, and `rafa agent list` is where
 * the sources are read.
 *
 * ## The source header
 *
 * The copy carries one line the original does not, an HTML comment
 * naming the file it came from and the day it was taken:
 *
 *     <!-- vendored by rafa from /Users/x/.claude/agents/tdd-guide.md on 2026-09-18 -->
 *
 * It sits directly AFTER the frontmatter's closing `---`, never before
 * the opening one: the CLI reads the frontmatter off the first line, and
 * a comment ahead of it would leave the file carrying none, which is a
 * file `--agent` never resolves. A file with no frontmatter to sit after
 * is copied with the header as its first line, since such a file
 * resolves under no name whatever is done to it, and the header then
 * says where the bytes came from.
 *
 * ## Refusing, before anything is written
 *
 * Every name is checked before the first byte is copied, so a line
 * naming one name that cannot be vendored copies none of the others: the
 * refusal ends with `Nothing was written.` as `rafa init`'s refusals do.
 * A name no home file carries is refused, and so is one whose
 * destination file is already there, unless `--force` is on the line,
 * which overwrites it. The overwrite is whole, and what the project file
 * held is not kept: a project definition is the shadowing one
 * (`context/workflow.md`), so its bytes are what a session would have
 * read.
 *
 * ## Type `--force` after the names
 *
 * `parseArgs` gives a flag the next word as its value unless that word
 * opens with `-`, whatever type the flag declares, so
 * `rafa agent vendor --force tdd-guide` reads `tdd-guide` as the value
 * of `--force` and hands the command no name at all. The value is
 * refused with exit code 1, naming the order that works, as
 * `rafa plan show --tracker` is. The value is read BEFORE the names, so
 * that line meets the refusal naming the order rather than the one
 * saying it named no agent, which is true of it and says nothing about
 * why.
 *
 * ## The exit code
 *
 * 0 copied. 1 for a `--force` value that is neither `true` nor `false`,
 * for a line naming no name, for a name no home definition carries, for
 * a destination already there without `--force`, and for a copy that
 * failed, the message naming the file and what the error said.
 */
import type { AgentDefinitionFile } from '../../agents/roster.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ProjectFound } from '../../project/scope.js';

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readAgentDefinitions } from '../../agents/roster.js';
import { CommandExit } from '../../cli/command.js';
import { AGENT_DEFINITION_DIR, readFrontmatter } from '../../utils/agent-definition.js';

/** The usage line a refusal names. */
export const USAGE = 'rafa agent vendor <name>... [--force]';

/** The sentence every refusal ends with, since nothing is copied until every name checks out. */
export const NOTHING_WRITTEN = 'Nothing was written.';

/** Answers the day the source header is stamped with. */
export type Clock = () => Date;

/** One definition copied. */
export interface VendoredAgent {
  /** The frontmatter `name` the copy resolves under. */
  readonly name: string;
  /** The `~/.claude/agents` file it was read from. */
  readonly from: string;
  /** The `<root>/.claude/agents` file it was written to. */
  readonly to: string;
  /** Whether a file was already there and `--force` replaced it. */
  readonly replaced: boolean;
}

/** What json mode gives as the terminal result's `data`. */
export interface AgentVendorResult {
  /** The project root the definitions were copied into. */
  readonly root: string;
  /** `<root>/.claude/agents`, made when it was missing. */
  readonly dir: string;
  /** Each definition copied, in the order the line named them. */
  readonly vendored: readonly VendoredAgent[];
}

/**
 * The value of `--force` as a boolean, refusing a value that is neither
 * `true` nor `false`: the flag takes none.
 */
export function readForce(value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(
    1,
    `❌ --force takes no value, and read "${value}" as one; type it after the names\nUsage: ${USAGE}`,
  );
}

/** The names a line names, or a refusal with exit code 1 when it names none. */
export function readNames(args: readonly string[]): readonly string[] {
  if (args.length === 0) {
    throw new CommandExit(1, `❌ Expected at least one agent name, got none\nUsage: ${USAGE}\n${NOTHING_WRITTEN}`);
  }
  return args;
}

/** The home's definitions, the first file answering for each name it carries. */
function homeDefinitions(home: string): ReadonlyMap<string, AgentDefinitionFile> {
  const byName = new Map<string, AgentDefinitionFile>();
  for (const definition of readAgentDefinitions(home)) {
    if (!byName.has(definition.name)) byName.set(definition.name, definition);
  }
  return byName;
}

/** A date as `YYYY-MM-DD`, the day the header names. */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The comment line naming where a copy came from and when. */
export function sourceHeader(from: string, date: Date): string {
  return `<!-- vendored by rafa from ${from} on ${dayOf(date)} -->`;
}

/**
 * `text` with the header written in: after the frontmatter's closing
 * fence when it opens with one, and as the first line otherwise. See the
 * module note on why it is never written ahead of the frontmatter.
 */
export function withSourceHeader(text: string, from: string, date: Date): string {
  const header = sourceHeader(from, date);
  const lines = text.split('\n');
  if (readFrontmatter(text) === null) return [header, ...lines].join('\n');

  const close = lines.findIndex((line, index) => index > 0 && line === '---');
  return [...lines.slice(0, close + 1), header, ...lines.slice(close + 1)].join('\n');
}

/** Each name with the home file that answers for it, or every refusal there is. */
function planCopies(
  names: readonly string[],
  project: ProjectFound,
  force: boolean,
): readonly VendoredAgent[] {
  const definitions = homeDefinitions(project.home);
  const dir = join(project.root, AGENT_DEFINITION_DIR);
  const problems: string[] = [];
  const copies: VendoredAgent[] = [];

  for (const name of names) {
    const definition = definitions.get(name);
    if (definition === undefined) {
      problems.push(`   agent "${name}": no definition under ${join(project.home, AGENT_DEFINITION_DIR)} carries that name`);
      continue;
    }
    const to = join(dir, basename(definition.path));
    const replaced = existsSync(to);
    if (replaced && !force) {
      problems.push(`   agent "${name}": ${to} is already there; pass --force to replace it`);
      continue;
    }
    copies.push({ name, from: definition.path, to, replaced });
  }

  if (problems.length > 0) {
    throw new CommandExit(1, [`❌ ${USAGE}:`, ...problems, NOTHING_WRITTEN].join('\n'));
  }
  return copies;
}

/** Copies one definition, with its source header written in, or refuses with exit code 1. */
function copyOne(copy: VendoredAgent, date: Date): void {
  try {
    copyFileSync(copy.from, copy.to);
    writeFileSync(copy.to, withSourceHeader(readFileSync(copy.to, 'utf8'), copy.from, date), 'utf8');
  } catch (error) {
    throw new CommandExit(1, `❌ ${USAGE}: agent "${copy.name}" could not be written to ${copy.to}: ${String(error)}`);
  }
}

/** The line text mode writes for one copy. */
export function vendoredLine(copy: VendoredAgent): string {
  return `✅ ${copy.name}: ${copy.to}${copy.replaced
    ? ' (replaced)'
    : ''}`;
}

function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa agent vendor runs inside a project, and was handed none');
  return context.project;
}

/** Vendors each named definition. See the module note. */
function runVendor(context: RafaContext, now: Clock): void {
  const force = readForce(context.flags['force']);
  const names = readNames(context.args);
  const project = projectOf(context);
  const copies = planCopies(names, project, force);
  const dir = join(project.root, AGENT_DEFINITION_DIR);
  const date = now();

  mkdirSync(dir, { recursive: true });
  for (const copy of copies) copyOne(copy, date);

  const result: AgentVendorResult = { root: project.root, dir, vendored: copies };
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const copy of copies) context.output.info(vendoredLine(copy));
}

/** The command, stamping its headers from `now`. See the module note. */
export function createAgentVendorCommand(now: Clock = () => new Date()): RafaCommand {
  const command: RafaCommand = {
    name: 'agent vendor',
    subject: 'agent',
    action: 'vendor',
    summary: 'copy an agent definition from ~/.claude/agents into this project, so the loop resolves its name',
    description: 'Copies each named definition from `~/.claude/agents` into `<root>/.claude/agents`, keeping'
      + ' the source file\'s own name and writing one HTML comment after its frontmatter naming the file it'
      + ' came from and the day. A name is a definition\'s frontmatter `name`, which is what `--agent`'
      + ' resolves by, not its file stem. Under the loop\'s default `loop.settingSources` of'
      + ' `project,local` the home is out of reach, so a task routed `agent=<name>` exits 1 before any'
      + ' model call until the definition sits in the project: this is the fix `rafa loop start` and'
      + ' `rafa plan validate` name when they refuse one. Every name is checked before the first byte is'
      + ' copied, and the command refuses a name no home definition carries and a destination already'
      + ' there, which `--force` replaces whole. With `--output=json` the copies are the data of the'
      + ' terminal result event.',
    args: [
      {
        name: 'name',
        description: 'The frontmatter `name` of a definition under `~/.claude/agents`; more than one may be named.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'force',
        description: 'Replace a definition of the same file name already in the project, whole, instead of refusing it.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa agent vendor tdd-guide',
        note: 'Copies `~/.claude/agents/tdd-guide.md` into `.claude/agents/`, so a task routed to it dispatches.',
      },
      {
        cmd: 'rafa agent vendor tdd-guide code-reviewer --force',
        note: 'Vendors both names, replacing the project definitions already there.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runVendor(context, now);
    },
  };
  return Object.freeze(command);
}

export default createAgentVendorCommand();

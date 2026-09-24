/**
 * `rafa agent vendor <name>... [--force]`: an agent definition the rafa
 * tier or the home carries copied into the project, so a session spawned
 * under the loop's default `loop.settingSources` resolves the name, and
 * so a project can edit its own copy of one rafa ships.
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
 * ## Which tier a name is copied from
 *
 * Two tiers are read, in the one order rafa resolves every name in
 * (`schema/tiers.ts`, `SKILL_TIERS`) with the project left out, since the
 * project is the destination: {@link VENDOR_TIERS}, the rafa tier's
 * `bundled/agents` beside the entry first, then the home's
 * `~/.claude/agents`. A name both hold is copied from the rafa tier, the
 * holder a session loading both would be served. Each copy names the
 * tier it came from: the text line says `(from the rafa tier)` or
 * `(from the user tier)`, and json mode's row carries `tier`.
 *
 * The entry is a seam, `Bun.main` for the registered command: under
 * `bun test` that is the test file, so a case hands an entry of its own
 * and plants the rafa tier beside it.
 *
 * ## Which file is copied where
 *
 * A name is the frontmatter `name` of a definition, never its file stem,
 * because that is what `--agent` resolves by
 * (`utils/agent-definition.ts`). So the source is the tier's `*.md`
 * whose frontmatter carries the name asked for, as `readAgentDirectory`
 * reads the directory, and the destination keeps that file's own name:
 * a `~/.claude/agents/weird-file.md` carrying `name: renamed-agent` is
 * vendored to `<root>/.claude/agents/weird-file.md`, and resolves as
 * `renamed-agent` there as it did at home. Two files of one tier
 * carrying one name leave the first in directory order the one copied,
 * as `resolveAgentRoster` takes the first.
 *
 * The home is the project's, the dispatcher's, and the command reads no
 * config: which tiers a session loads, `tiers.rafa: off` included,
 * decides nothing about where a definition may be copied from or to,
 * and `rafa agent list` is where the sources are read.
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
 * A name neither tier carries is refused, naming both directories, and so is one whose
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
 * for a line naming no name, for a name neither tier carries, for
 * a destination already there without `--force`, and for a copy that
 * failed, the message naming the file and what the error said.
 */
import type { AgentDefinitionFile } from '../../agents/roster.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ProjectFound } from '../../project/scope.js';
import type { SkillTier } from '../../schema/tiers.js';

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readAgentDirectory } from '../../agents/roster.js';
import { CommandExit } from '../../cli/command.js';
import { bundledAgentsDirectory } from '../../inventory/trees.js';
import { AGENT_DEFINITION_DIR, readFrontmatter } from '../../utils/agent-definition.js';

/** The usage line a refusal names. */
export const USAGE = 'rafa agent vendor <name>... [--force]';

/** The sentence every refusal ends with, since nothing is copied until every name checks out. */
export const NOTHING_WRITTEN = 'Nothing was written.';

/** Answers the day the source header is stamped with. */
export type Clock = () => Date;

/** Answers the entry the rafa tier's `bundled/agents` sits beside. */
export type Entry = () => string;

/** A tier a definition may be vendored from: every tier but the project, which is the destination. */
export type VendorTier = Exclude<SkillTier, 'project'>;

/** The tiers read for a name, in the order the first holder wins. See the module note. */
export const VENDOR_TIERS: readonly VendorTier[] = Object.freeze(['rafa', 'user']);

/** Where one tier's definitions were read from, and what it holds by name. */
interface TierDefinitions {
  readonly tier: VendorTier;
  readonly dir: string;
  readonly byName: ReadonlyMap<string, AgentDefinitionFile>;
}

/** One definition copied. */
export interface VendoredAgent {
  /** The frontmatter `name` the copy resolves under. */
  readonly name: string;
  /** The tier it was copied from. */
  readonly tier: VendorTier;
  /** The file it was read from, under that tier's agents directory. */
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

/** The agents directory `tier` is read from. */
export function vendorTierDirectory(tier: VendorTier, home: string, entry: string): string {
  return tier === 'rafa'
    ? bundledAgentsDirectory(entry)
    : join(home, AGENT_DEFINITION_DIR);
}

/** One tier's definitions, the first file answering for each name it carries. */
function tierDefinitions(tier: VendorTier, home: string, entry: string): TierDefinitions {
  const dir = vendorTierDirectory(tier, home, entry);
  const byName = new Map<string, AgentDefinitionFile>();
  for (const definition of readAgentDirectory(dir)) {
    if (!byName.has(definition.name)) byName.set(definition.name, definition);
  }
  return { tier, dir, byName };
}

/** The first tier in {@link VENDOR_TIERS} order holding `name`, with its file, or null. */
function firstHolder(
  tiers: readonly TierDefinitions[],
  name: string,
): { readonly tier: VendorTier; readonly definition: AgentDefinitionFile } | null {
  for (const { tier, byName } of tiers) {
    const definition = byName.get(name);
    if (definition !== undefined) return { tier, definition };
  }
  return null;
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

/** Each name with the tier file that answers for it, or every refusal there is. */
function planCopies(
  names: readonly string[],
  project: ProjectFound,
  force: boolean,
  entry: string,
): readonly VendoredAgent[] {
  const tiers = VENDOR_TIERS.map((tier) => tierDefinitions(tier, project.home, entry));
  const searched = tiers.map(({ tier, dir }) => `the ${tier} tier (${dir})`).join(' or ');
  const dir = join(project.root, AGENT_DEFINITION_DIR);
  const problems: string[] = [];
  const copies: VendoredAgent[] = [];

  for (const name of names) {
    const holder = firstHolder(tiers, name);
    if (holder === null) {
      problems.push(`   agent "${name}": no definition under ${searched} carries that name`);
      continue;
    }
    const to = join(dir, basename(holder.definition.path));
    const replaced = existsSync(to);
    if (replaced && !force) {
      problems.push(`   agent "${name}": ${to} is already there; pass --force to replace it`);
      continue;
    }
    copies.push({ name, tier: holder.tier, from: holder.definition.path, to, replaced });
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

/** The line text mode writes for one copy, naming the tier it came from. */
export function vendoredLine(copy: VendoredAgent): string {
  return `✅ ${copy.name}: ${copy.to} (from the ${copy.tier} tier${copy.replaced
    ? ', replaced'
    : ''})`;
}

function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa agent vendor runs inside a project, and was handed none');
  return context.project;
}

/** Vendors each named definition. See the module note. */
function runVendor(context: RafaContext, now: Clock, entry: Entry): void {
  const force = readForce(context.flags['force']);
  const names = readNames(context.args);
  const project = projectOf(context);
  const copies = planCopies(names, project, force, entry());
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

/**
 * The command, stamping its headers from `now` and reading the rafa tier
 * beside `entry`. See the module note.
 */
export function createAgentVendorCommand(
  now: Clock = () => new Date(),
  entry: Entry = () => Bun.main,
): RafaCommand {
  const command: RafaCommand = {
    name: 'agent vendor',
    subject: 'agent',
    action: 'vendor',
    summary: 'copy an agent definition from the rafa tier or ~/.claude/agents into this project',
    description: 'Copies each named definition from the rafa tier (`bundled/agents` beside the running'
      + ' entry) or, when rafa ships no definition of that name, from `~/.claude/agents` into'
      + ' `<root>/.claude/agents`, naming the tier each copy came from, keeping'
      + ' the source file\'s own name and writing one HTML comment after its frontmatter naming the file it'
      + ' came from and the day. A name is a definition\'s frontmatter `name`, which is what `--agent`'
      + ' resolves by, not its file stem. Under the loop\'s default `loop.settingSources` of'
      + ' `project,local` the home is out of reach, so a task routed `agent=<name>` exits 1 before any'
      + ' model call until the definition sits in the project: this is the fix `rafa loop start` and'
      + ' `rafa plan validate` name when they refuse one. Every name is checked before the first byte is'
      + ' copied, and the command refuses a name neither tier carries and a destination already'
      + ' there, which `--force` replaces whole. With `--output=json` the copies are the data of the'
      + ' terminal result event.',
    args: [
      {
        name: 'name',
        description: 'The frontmatter `name` of a definition the rafa tier or `~/.claude/agents` holds; more than one may be named.',
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
      runVendor(context, now, entry);
    },
  };
  return Object.freeze(command);
}

export default createAgentVendorCommand();

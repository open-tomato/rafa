/**
 * `rafa agent show <name> [--full]`: one agent definition whole, as the
 * show view of `src/inventory/show.ts` renders it.
 *
 * `rafa agent list` says where each agent sits and whether a loop
 * session resolves it; this command says what one of them IS: its
 * inventory record, its frontmatter as written, every other holder of
 * the name with its source and state, and the body's headings with
 * their file lines. `--full` prints the whole file in place of the
 * frontmatter and the headings. Every part is built by
 * `src/inventory/show.ts`, which `rafa skill show` and the browse view
 * share, so no two of them can print one item two ways.
 *
 * ## Which agent a name shows
 *
 * The inventory is built exactly as `rafa skill list` and
 * `rafa agent list` build it — the project the dispatcher resolved, its
 * config's `loop.settingSources`, the modules `loadModules` answers
 * `loaded`, and the rafa tier beside {@link AgentShowSeams.entry} —
 * through the `projectInventory` `src/commands/skill/list.ts` exports.
 * An agent is named by its frontmatter `name`, the way `rafa agent list`
 * prints it and a task routed `agent=<name>` reaches it. The name then
 * shows its FIRST holder in precedence order ({@link findShown}): the
 * definition that answers, or the disabled one still holding the name.
 * A shadowed holder is listed under the other holders, with its path,
 * rather than shown in its own right. The Claude Code built-ins are not
 * inventory rows, since no file holds them, so no name shows one.
 *
 * ## `--full` is read ahead of the name
 *
 * The parser hands the word after a bare flag to it as its value, so
 * `rafa agent show --full code-reviewer` reaches this command with no
 * argument and `--full` set to the name. The switch is read first,
 * through `readSwitch`, so that line is refused naming the order that
 * works rather than saying no name was given.
 *
 * ## Exit codes
 *
 * 0 when the agent is shown, including when its file no longer reads:
 * the view then carries the record, the other holders and the reason
 * (`readError`). Exit code 1 is kept for the refusals: no name or more
 * than one, a value read into `--full`, a name no agent holds, and a
 * config `loadConfig` refuses. A name no agent holds but a skill does
 * says so in its refusal and points at `rafa skill show`.
 *
 * ## Warnings and json mode
 *
 * The inventory's warnings go out one each through the active output
 * (`warn: ` on stdout in text mode), as `rafa agent list` writes them.
 * In json mode the view's every part ({@link ShowView}), the project
 * root, `loop.settingSources` and the warnings are the terminal
 * result's `data`; `text` holds the file under `--full` and is null
 * without it.
 */
import type { AgentListSeams } from './list.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource } from '../../config-sections.js';
import type { Inventory } from '../../inventory/index.js';
import type { ShowView } from '../../inventory/show.js';
import type { ProjectFound } from '../../project/scope.js';

import { CommandExit } from '../../cli/command.js';
import { findShown, readShowView, renderShowView } from '../../inventory/show.js';
import { expectOneArgument, readSwitch } from '../plan/plan-files.js';
import { projectInventory, warningLines } from '../skill/list.js';

import { DEFAULT_AGENT_LIST_SEAMS } from './list.js';

/** The seams `rafa agent show` runs with: the ones `rafa agent list` takes. */
export type AgentShowSeams = AgentListSeams;

/** The seams the registered command runs with. */
export const DEFAULT_AGENT_SHOW_SEAMS: AgentShowSeams = DEFAULT_AGENT_LIST_SEAMS;

/** The command's name, which its config refusal opens with. */
const COMMAND_NAME = 'rafa agent show';

/** The usage line a refusal names. */
const USAGE = 'rafa agent show <name> [--full]';

/** What json mode gives as the terminal result's `data`: the view, and where it was read. */
export interface AgentShowResult extends ShowView {
  /** The project the inventory was built in. */
  readonly projectRoot: string;
  /** `loop.settingSources`, which decided each holder's `visibleToLoop`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** One line per source or settings file that did not read. */
  readonly warnings: readonly string[];
}

/** The refusal of a name no agent holds, pointing at a skill of that name when one is there. */
export function unknownAgentMessage(name: string, inventory: Inventory): string {
  const skill = findShown(inventory.records, 'skill', name);
  const hint = skill === null
    ? []
    : [`A skill is named "${name}" (${skill.source}): rafa skill show ${name}`];
  return [
    `❌ No agent is named "${name}".`,
    ...hint,
    'Run `rafa agent list` to see every agent definition and where it comes from.',
    `Usage: ${USAGE}`,
  ].join('\n');
}

/** The agent `name` shows in `inventory`, as its view; refused with exit code 1 when no agent holds the name. */
export function agentShowView(
  inventory: Inventory,
  name: string,
  options: { readonly full: boolean; readonly read?: (path: string) => string },
): ShowView {
  const record = findShown(inventory.records, 'agent', name);
  if (record === null) throw new CommandExit(1, unknownAgentMessage(name, inventory));
  return readShowView(record, inventory.records, options);
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa agent show runs inside a project, and was handed none');
  return context.project;
}

/** Shows the agent. See the module note. */
async function runShow(context: RafaContext, seams: AgentShowSeams): Promise<void> {
  const full = readSwitch('full', context.flags['full'], `Type the name ahead of it: ${USAGE}`);
  const name = expectOneArgument(context.args, USAGE);
  const project = projectOf(context);
  const { inventory, settingSources } = await projectInventory(project, context, seams, COMMAND_NAME);

  const warnings = warningLines(inventory);
  for (const warning of warnings) context.output.warn(warning);
  const view = agentShowView(inventory, name, { full });

  if (context.outputMode === 'json') {
    const result: AgentShowResult = { ...view, projectRoot: project.root, settingSources, warnings };
    context.output.result(result);
    return;
  }
  for (const line of renderShowView(view)) context.output.info(line);
}

/** The command, measuring the rafa tier and loading modules through `seams`. See the module note. */
export function createAgentShowCommand(seams: AgentShowSeams = DEFAULT_AGENT_SHOW_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'agent show',
    subject: 'agent',
    action: 'show',
    summary: 'show one agent definition: its record, frontmatter, other holders and headings',
    description: 'Shows the agent definition a name resolves to, from the same inventory `rafa agent list`'
      + ' reads, the name being the frontmatter `name` a task routes to: its record (path, state, whether'
      + ' a session the loop spawns resolves it, summary, stack and tags), its frontmatter as written,'
      + ' every other agent of that name with its source and state, and the headings of its body with'
      + ' their lines in the file. The name shows its nearest holder — project, then rafa, user, add-ons'
      + ' and plugins — so a shadowed copy is listed under the other holders. The Claude Code built-ins'
      + ' are not inventory rows and are not shown. `--full` prints the whole file in place of the'
      + ' frontmatter and the headings. A name no agent holds is refused with exit code 1. With'
      + ' `--output=json` every part of the view is the data of the terminal result event, the file text'
      + ' included under `--full`.',
    args: [
      {
        name: 'name',
        description: 'The agent\'s name, as `rafa agent list` prints it.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'full',
        description: 'Print the whole file in place of the frontmatter and the headings; type it after the name.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa agent show code-reviewer',
        note: 'Shows the definition that answers to the name, what it shadows, its frontmatter and its headings.',
      },
      {
        cmd: 'rafa agent show code-reviewer --full',
        note: 'Shows its record and other holders, then the whole file.',
      },
      {
        cmd: 'rafa agent show code-reviewer --output=json',
        note: 'Writes a start event, then a result event whose data holds every part of the view.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runShow(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createAgentShowCommand();

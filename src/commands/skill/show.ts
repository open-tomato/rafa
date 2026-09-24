/**
 * `rafa skill show <name> [--full]`: one skill whole, as the show view
 * of `src/inventory/show.ts` renders it.
 *
 * `rafa skill list` says where each skill sits and whether it answers;
 * this command says what one of them IS: its inventory record, its
 * frontmatter as written, every other holder of the name with its
 * source and state, and the body's headings with their file lines.
 * `--full` prints the whole file in place of the frontmatter and the
 * headings. Every part is built by `src/inventory/show.ts`, which
 * `rafa agent show` and the browse view share, so no two of them can
 * print one item two ways.
 *
 * ## Which skill a name shows
 *
 * The inventory is built exactly as `rafa skill list` builds it — the
 * project the dispatcher resolved, its config's `loop.settingSources`,
 * the modules `loadModules` answers `loaded`, and the rafa tier beside
 * {@link SkillListSeams.entry} — through the `projectInventory` that
 * command exports. The name then shows its FIRST holder in precedence
 * order ({@link findShown}): the skill that answers, or the disabled one
 * still holding the name. A shadowed holder is listed under the other
 * holders, with its path, rather than shown in its own right.
 *
 * ## `--full` is read ahead of the name
 *
 * The parser hands the word after a bare flag to it as its value, so
 * `rafa skill show --full verification-loop` reaches this command with
 * no argument and `--full` set to the name. The switch is read first,
 * through `readSwitch`, so that line is refused naming the order that
 * works rather than saying no name was given.
 *
 * ## Exit codes
 *
 * 0 when the skill is shown, including when its file no longer reads:
 * the view then carries the record, the other holders and the reason
 * (`readError`), since the inventory read the file moments ago and the
 * record is still the answer to "what holds this name". Exit code 1 is
 * kept for the refusals: no name or more than one, a value read into
 * `--full`, a name no skill holds, and a config `loadConfig` refuses.
 * A name no skill holds but an agent does says so in its refusal and
 * points at `rafa agent show`.
 *
 * ## Warnings and json mode
 *
 * The inventory's warnings — a plugin record, plugin, add-on manifest,
 * settings file or `skillOverrides` entry that did not read — go out
 * one each through the active output (`warn: ` on stdout in text mode),
 * as `rafa skill list` writes them, since each can be why a name shows
 * a holder other than the one expected. In json mode the view's every
 * part ({@link ShowView}), the project root, `loop.settingSources` and
 * the warnings are the terminal result's `data`; `text` holds the file
 * under `--full` and is null without it.
 */
import type { SkillListSeams } from './list.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource } from '../../config-sections.js';
import type { Inventory } from '../../inventory/index.js';
import type { ShowView } from '../../inventory/show.js';
import type { ProjectFound } from '../../project/scope.js';

import { CommandExit } from '../../cli/command.js';
import { findShown, readShowView, renderShowView } from '../../inventory/show.js';
import { expectOneArgument, readSwitch } from '../plan/plan-files.js';

import { DEFAULT_SKILL_LIST_SEAMS, projectInventory, warningLines } from './list.js';

/** The seams `rafa skill show` runs with: the ones `rafa skill list` takes. */
export type SkillShowSeams = SkillListSeams;

/** The seams the registered command runs with. */
export const DEFAULT_SKILL_SHOW_SEAMS: SkillShowSeams = DEFAULT_SKILL_LIST_SEAMS;

/** The command's name, which its config refusal opens with. */
const COMMAND_NAME = 'rafa skill show';

/** The usage line a refusal names. */
const USAGE = 'rafa skill show <name> [--full]';

/** What json mode gives as the terminal result's `data`: the view, and where it was read. */
export interface SkillShowResult extends ShowView {
  /** The project the inventory was built in. */
  readonly projectRoot: string;
  /** `loop.settingSources`, which decided each holder's `visibleToLoop`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** One line per source or settings file that did not read. */
  readonly warnings: readonly string[];
}

/** The refusal of a name no skill holds, pointing at an agent of that name when one is there. */
export function unknownSkillMessage(name: string, inventory: Inventory): string {
  const agent = findShown(inventory.records, 'agent', name);
  const hint = agent === null
    ? []
    : [`An agent is named "${name}" (${agent.source}): rafa agent show ${name}`];
  return [
    `❌ No skill is named "${name}".`,
    ...hint,
    'Run `rafa skill list` to see every skill and where it comes from.',
    `Usage: ${USAGE}`,
  ].join('\n');
}

/** The skill `name` shows in `inventory`, as its view; refused with exit code 1 when no skill holds the name. */
export function skillShowView(
  inventory: Inventory,
  name: string,
  options: { readonly full: boolean; readonly read?: (path: string) => string },
): ShowView {
  const record = findShown(inventory.records, 'skill', name);
  if (record === null) throw new CommandExit(1, unknownSkillMessage(name, inventory));
  return readShowView(record, inventory.records, options);
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa skill show runs inside a project, and was handed none');
  return context.project;
}

/** Shows the skill. See the module note. */
async function runShow(context: RafaContext, seams: SkillShowSeams): Promise<void> {
  const full = readSwitch('full', context.flags['full'], `Type the name ahead of it: ${USAGE}`);
  const name = expectOneArgument(context.args, USAGE);
  const project = projectOf(context);
  const { inventory, settingSources } = await projectInventory(project, context, seams, COMMAND_NAME);

  const warnings = warningLines(inventory);
  for (const warning of warnings) context.output.warn(warning);
  const view = skillShowView(inventory, name, { full });

  if (context.outputMode === 'json') {
    const result: SkillShowResult = { ...view, projectRoot: project.root, settingSources, warnings };
    context.output.result(result);
    return;
  }
  for (const line of renderShowView(view)) context.output.info(line);
}

/** The command, measuring the rafa tier and loading modules through `seams`. See the module note. */
export function createSkillShowCommand(seams: SkillShowSeams = DEFAULT_SKILL_SHOW_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'skill show',
    subject: 'skill',
    action: 'show',
    summary: 'show one skill: its record, frontmatter, other holders and headings',
    description: 'Shows the skill a name resolves to, from the same inventory `rafa skill list` reads:'
      + ' its record (path, state, whether a session the loop spawns resolves it, checker verdict,'
      + ' summary, stack and tags), its frontmatter as written, every other skill of that name with its'
      + ' source and state, and the headings of its body with their lines in the file. The name shows'
      + ' its nearest holder — project, then rafa, user, add-ons and plugins — so a shadowed copy is'
      + ' listed under the other holders. `--full` prints the whole file in place of the frontmatter and'
      + ' the headings. A name no skill holds is refused with exit code 1. With `--output=json` every'
      + ' part of the view is the data of the terminal result event, the file text included under'
      + ' `--full`.',
    args: [
      {
        name: 'name',
        description: 'The skill\'s name, as `rafa skill list` prints it.',
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
        cmd: 'rafa skill show verification-loop',
        note: 'Shows the skill that answers to the name, what it shadows, its frontmatter and its headings.',
      },
      {
        cmd: 'rafa skill show verification-loop --full',
        note: 'Shows its record and other holders, then the whole file.',
      },
      {
        cmd: 'rafa skill show verification-loop --output=json',
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

export default createSkillShowCommand();

/**
 * `rafa instinct flag <id> <reason>`: marks one held lesson as wrong, so
 * no later bundle blesses it, by calling the Learning adapter's `flag`.
 *
 * The adapter is the one the project's `learning.adapter` names, made
 * as the loop makes it after a task's report (`start/dispatch.ts`): from
 * {@link CORE_ADAPTER_REGISTRY}, over the project root, with the home
 * the dispatcher resolved and `learning.bless.minConfidence`. So a flag
 * written here is the one the loop's next pull reads. Under `local` that
 * is one line appended to `.rafa/instincts/flags.ndjson`, naming the id,
 * the reason and when; no record file is touched, and the flag keeps the
 * id out of every later bundle whatever a later merge writes under it.
 *
 * ## An id no held record carries is refused
 *
 * Which ids are held is the adapter's to say, so the refusal is the
 * adapter's: `flag` rejects an id none of the project's held records
 * carries, and the command turns that rejection into exit code 1 with
 * the adapter's own words, the kind that refused, and the command that
 * lists what is held. The command does not read `.rafa/instincts` to
 * check first: the files are only the `local` adapter's held set, and a
 * second reading of them here could disagree with the adapter's. The
 * `local` adapter answers the id in a record's frontmatter, and a
 * user-scope id is refused like an unknown one, since nothing writes
 * the user scope.
 *
 * Every other way the call can fail — a config `loadConfig` refuses, a
 * kind no registry holds, an adapter that cannot be made — is the same
 * exit code 1, each naming what failed, and nothing is written. So is a
 * reason that is blank once trimmed: a flag is read back by a person
 * deciding whether to lift it, and a blank one tells them nothing.
 *
 * ## What a clean run answers
 *
 * One line naming the id and the reason, and a second saying what the
 * flag does. With `--output=json`, {@link InstinctFlagResult} is the
 * data of the terminal result event.
 */
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Learning } from '../../ports/index.js';

import { CORE_ADAPTER_REGISTRY } from '../../adapters/registry.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { expectTwoArguments } from '../issue/issue-tracker.js';
import { requireProject, resolveProjectConfig } from '../plan/plan-files.js';

/** The command's name, as a refusal opens with it. */
const NAME = 'rafa instinct flag';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct flag <id> <reason>';

/** What json mode gives as the terminal result's `data`. */
export interface InstinctFlagResult {
  /** The id flagged. */
  readonly id: string;
  /** The reason the flag was written with, as typed. */
  readonly reason: string;
  /** The learning adapter kind that wrote the flag: the project's `learning.adapter`. */
  readonly adapter: string;
}

/** What the command resolves its adapter through. */
export interface InstinctFlagSeams {
  /** Where `learning.adapter` is resolved. {@link CORE_ADAPTER_REGISTRY} when left out. */
  readonly registry?: AdapterRegistry;
}

/** The message a flag the adapter did not write is refused with. */
export function refusedFlagMessage(id: string, kind: string, reason: string): string {
  return [
    `❌ ${NAME}: the \`${kind}\` learning adapter did not flag "${id}": ${reason}`,
    'Run `rafa instinct list` to see the ids the project holds.',
  ].join('\n');
}

/** The message a reason that is blank once trimmed is refused with. */
export function blankReasonMessage(id: string): string {
  return `❌ ${NAME}: the reason to flag "${id}" is blank; say why the lesson is wrong.\nUsage: ${USAGE}`;
}

/** The adapter `kind` names, made as the loop makes it, or a refusal naming the kind. */
function makeAdapter(
  registry: AdapterRegistry,
  kind: string,
  context: { readonly repoRoot: string; readonly home: string; readonly minConfidence: number },
): Learning {
  try {
    return registry.resolve('learning', kind).create({
      repoRoot: context.repoRoot,
      home: context.home,
      learningBlessMinConfidence: context.minConfidence,
    });
  } catch (error) {
    throw new CommandExit(1, `❌ ${NAME}: the \`${kind}\` learning adapter cannot be made: ${messageOf(error)}`);
  }
}

/** Flags the id a line names; see the module note. */
export async function flagInstinct(context: RafaContext, seams: InstinctFlagSeams): Promise<InstinctFlagResult> {
  const [id, reason] = expectTwoArguments(context.args, USAGE);
  if (reason.trim() === '') throw new CommandExit(1, blankReasonMessage(id));
  const project = requireProject(context, NAME);
  const config = resolveProjectConfig(project, NAME, (message) => {
    context.output.warn(message);
  });
  const kind = config.learningAdapter;
  const adapter = makeAdapter(seams.registry ?? CORE_ADAPTER_REGISTRY, kind, {
    repoRoot: project.root,
    home: project.home,
    minConfidence: config.learningBlessMinConfidence,
  });
  try {
    await adapter.flag(id, reason);
  } catch (error) {
    throw new CommandExit(1, refusedFlagMessage(id, kind, messageOf(error)));
  }
  return { id, reason, adapter: kind };
}

/** The command, resolving its adapter with `seams`; see the module note. */
export function createInstinctFlagCommand(seams: InstinctFlagSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct flag',
    subject: 'instinct',
    action: 'flag',
    summary: 'flag one held lesson as wrong, so no later bundle blesses it',
    description: 'Flags one lesson the project holds as wrong, through the learning adapter'
      + ' `learning.adapter` names in `.rafa/config.yaml`. A flagged id is left out of every bundle the'
      + ' loop pulls afterwards, whatever a later merge writes under it; under the `local` adapter the'
      + ' flag is one line appended to `.rafa/instincts/flags.ndjson` and no record file changes. An id'
      + ' no held record carries is refused with exit code 1 in the adapter\'s words, a user-scope id'
      + ' included, as is a blank reason. With `--output=json` the id, the reason and the adapter kind'
      + ' are the data of the terminal result event.',
    args: [
      {
        name: 'id',
        description: 'The id of a lesson the project holds, as `rafa instinct list` prints it.',
        type: 'string',
        required: true,
      },
      {
        name: 'reason',
        description: 'Why the lesson is wrong, quoted as one word; stored beside the flag.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa instinct flag worktree-missing-node-modules "bun install runs on fork since 0.9"',
        note: 'Keeps that lesson out of every bundle the loop pulls from now on.',
      },
      {
        cmd: 'rafa instinct flag worktree-missing-node-modules "stale" --output=json',
        note: 'Gives the id, the reason and the adapter kind as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await flagInstinct(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(`🚩 Flagged ${result.id}: ${result.reason}`);
      context.output.info(`   The \`${result.adapter}\` learning adapter leaves it out of every later bundle.`);
    },
  };
  return Object.freeze(command);
}

export default createInstinctFlagCommand();

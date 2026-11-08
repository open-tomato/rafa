/**
 * `rafa instinct promote`: prints the lessons the project holds that
 * have recurred enough to promote, under the configured
 * `learning.promote.after` and `learning.promote.minConfidence`, and
 * writes nothing.
 *
 * ## The list is the wrap-up's
 *
 * The lessons are read as the wrap-up reads them before its session
 * (`lessonsToPromote` in `start/wrap-up.ts`): the adapter
 * `learning.adapter` names, made from {@link CORE_ADAPTER_REGISTRY} over
 * the project root with the home the dispatcher resolved and
 * `learning.bless.minConfidence`, is asked for its blessed set, and the
 * library's `promotable` (`learning/bless.ts`) narrows it at the two
 * `learning.promote.*` keys. So a lesson tasks may not use — flagged,
 * already promoted, or below the bless floor — is never listed, whatever
 * `learning.promote.minConfidence` says, and what this prints is what
 * the next wrap-up would be asked to promote. Under `local` the blessed
 * set carries the user scope's lessons on triggers the project holds
 * nothing on, and those are listed like any other.
 *
 * ## Nothing is written
 *
 * The command calls `pullBlessed` and nothing else on the adapter: no
 * `promoted_to` is set, no flag appended and no directory made. Setting
 * `promoted_to` stays the loop's, once a wrap-up session has named the
 * page it wrote a lesson into (`start/promoted-check.ts`).
 *
 * ## Refusals
 *
 * A positional word, a config `loadConfig` refuses, a kind no registry
 * holds, an adapter that cannot be made and a pull the adapter refuses
 * are each exit code 1, naming what failed. Unlike the wrap-up, which
 * warns and goes on because it still has a PR to open, a command asked
 * for the list has nothing else to do, so an empty list would read as
 * "nothing recurred" when nothing was read.
 *
 * ## What a clean run answers
 *
 * A heading naming the adapter and the two keys' values, then one line
 * per lesson — its id, confidence, `usage_count`, source count and
 * trigger, with its action beneath — most trusted first, or one line
 * saying none is promotable. With `--output=json`,
 * {@link InstinctPromoteResult} is the data of the terminal result event.
 *
 * ## The confidence and sources printed are the group's
 *
 * `promotable` floors a lesson's same-action group, not the record it
 * names (`learning/groups.ts`): three wordings from three sources at
 * 0.50 each pool to 0.60 and pass a floor of 0.60 that none meets alone.
 * So each listed lesson carries its group's pooled confidence and source
 * count ({@link PromotableLesson}), and the line prints those, the two
 * readings the keys were compared with; the record's own `confidence`
 * and `sources` stay as the adapter answered them.
 */
import type { AdapterRegistry } from '@open-tomato/rafa/core/adapters';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { InstinctRecord, Learning } from '@open-tomato/rafa/ports';

import { promotable, sameActionGroups } from '@open-tomato/rafa-inventory';

import { expectNoArgument, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CORE_ADAPTER_REGISTRY } from '@open-tomato/rafa/core/adapters';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

/** The command's name, as a refusal opens with it. */
const NAME = 'rafa instinct promote';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct promote';

/** How many digits a confidence is written with. */
const CONFIDENCE_DIGITS = 2;

/** A promotable lesson: its named record, with the same-action group's readings the keys were compared with. */
export interface PromotableLesson extends InstinctRecord {
  /** The group's pooled confidence, at two decimals: the reading `learning.promote.minConfidence` floors. */
  readonly pooled_confidence: number;
  /** How many distinct sources the group's members hold together: the reading `learning.promote.after` floors. */
  readonly pooled_sources: number;
}

/** What json mode gives as the terminal result's `data`. */
export interface InstinctPromoteResult {
  /** The learning adapter kind the lessons were read from: the project's `learning.adapter`. */
  readonly adapter: string;
  /** The project's `learning.promote.after`: the fewest distinct sources a listed lesson has. */
  readonly after: number;
  /** The project's `learning.promote.minConfidence`: the lowest confidence a listed lesson carries. */
  readonly minConfidence: number;
  /** The promotable lessons, most trusted first, each with its group's pooled readings. */
  readonly lessons: readonly PromotableLesson[];
}

/** What the command resolves its adapter through. */
export interface InstinctPromoteSeams {
  /** Where `learning.adapter` is resolved. {@link CORE_ADAPTER_REGISTRY} when left out. */
  readonly registry?: AdapterRegistry;
}

/** The message a pull the adapter refused is refused with, opening with `name`, the command asking. */
export function refusedPullMessage(kind: string, reason: string, name: string = NAME): string {
  return `❌ ${name}: the \`${kind}\` learning adapter answered no blessed set: ${reason}`;
}

/**
 * The adapter `kind` names, made as the loop makes it, or a refusal
 * opening with `name` (the command asking) and naming the kind.
 * `rafa instinct list --blessed` makes its adapter through it too.
 */
export function makeLearningAdapter(
  registry: AdapterRegistry,
  kind: string,
  context: { readonly repoRoot: string; readonly home: string; readonly minConfidence: number },
  name: string = NAME,
): Learning {
  try {
    return registry.resolve('learning', kind).create({
      repoRoot: context.repoRoot,
      home: context.home,
      learningBlessMinConfidence: context.minConfidence,
    });
  } catch (error) {
    throw new CommandExit(1, `❌ ${name}: the \`${kind}\` learning adapter cannot be made: ${messageOf(error)}`);
  }
}

/** Reads the promotable lessons; see the module note. */
export async function promotableLessons(
  context: RafaContext,
  seams: InstinctPromoteSeams,
): Promise<InstinctPromoteResult> {
  expectNoArgument(context.args, USAGE);
  const project = requireProject(context, NAME);
  const config = await resolveProjectConfig(project, NAME, (message) => {
    context.output.warn(message);
  });
  const kind = config.learningAdapter;
  const adapter = makeLearningAdapter(seams.registry ?? CORE_ADAPTER_REGISTRY, kind, {
    repoRoot: project.root,
    home: project.home,
    minConfidence: config.learningBlessMinConfidence,
  });
  const after = config.learningPromoteAfter;
  const minConfidence = config.learningPromoteMinConfidence;
  let blessed: readonly InstinctRecord[];
  try {
    blessed = (await adapter.pullBlessed()).instincts;
  } catch (error) {
    throw new CommandExit(1, refusedPullMessage(kind, messageOf(error)));
  }
  return { adapter: kind, after, minConfidence, lessons: withPooledReadings(blessed, promotable(blessed, { after, minConfidence })) };
}

/**
 * Each of `lessons` with the pooled readings of the same-action group it
 * names, grouped over `blessed` as `promotable` groups it: `active` and
 * unpromoted records only.
 */
function withPooledReadings(
  blessed: readonly InstinctRecord[],
  lessons: readonly InstinctRecord[],
): PromotableLesson[] {
  const usable = blessed.filter((each) => each.status === 'active' && each.promoted_to === undefined);
  const byNamed = new Map(sameActionGroups(usable).map((group) => [group.named.id, group]));
  return lessons.map((lesson) => {
    const group = byNamed.get(lesson.id);
    return {
      ...lesson,
      pooled_confidence: group?.confidence ?? lesson.confidence,
      pooled_sources: group?.sources.length ?? Math.max(lesson.sources?.length ?? 0, 1),
    };
  });
}

/** Every line text mode writes: the heading, then each lesson or the line saying there is none. */
export function renderPromotable(result: InstinctPromoteResult): readonly string[] {
  const keys = `learning.promote.after ${String(result.after)},`
    + ` learning.promote.minConfidence ${result.minConfidence.toFixed(CONFIDENCE_DIGITS)}`;
  if (result.lessons.length === 0) {
    return [`No lesson the \`${result.adapter}\` learning adapter holds is promotable at ${keys}.`];
  }
  return [
    `${String(result.lessons.length)} lesson(s) to promote from the \`${result.adapter}\` learning adapter, at ${keys}:`,
    ...result.lessons.flatMap((lesson) => [
      `  ${lesson.id}  ${lesson.pooled_confidence.toFixed(CONFIDENCE_DIGITS)}  used ${String(lesson.usage_count)}`
        + `  from ${String(lesson.pooled_sources)} source(s)  ${lesson.trigger}`,
      `      ${lesson.action}`,
    ]),
  ];
}

/** The command, resolving its adapter with `seams`; see the module note. */
export function createInstinctPromoteCommand(seams: InstinctPromoteSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct promote',
    subject: 'instinct',
    action: 'promote',
    summary: 'print the lessons that recurred enough to promote, writing nothing',
    description: 'Prints the lessons the project holds that recurred enough to promote: the blessed set'
      + ' of the learning adapter `learning.adapter` names in `.rafa/config.yaml`, narrowed to the'
      + ' lessons at least `learning.promote.after` distinct sources confirmed at a confidence of at least'
      + ' `learning.promote.minConfidence`, most trusted first. It is the list the next wrap-up session'
      + ' would be asked to promote. Nothing is written: no lesson is marked promoted and no file'
      + ' changes. A kind no registry holds, an adapter that cannot be made or a pull it refuses is exit'
      + ' code 1. With `--output=json` the adapter kind, the two keys\' values and the lessons are the'
      + ' data of the terminal result event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa instinct promote',
        note: 'Lists each promotable lesson with its confidence, usage, trigger and action.',
      },
      {
        cmd: 'rafa instinct promote --output=json',
        note: 'Gives the adapter kind, the two keys\' values and the lessons as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await promotableLessons(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      for (const line of renderPromotable(result)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createInstinctPromoteCommand();
export default command;

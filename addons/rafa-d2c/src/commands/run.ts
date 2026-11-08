/** `run`: check, seed, the project's own suite command, then place. */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa-core/core/command';

import { runVisual } from '../steps/run.js';

import { files } from './seed.js';
import { execLine, prepare, printCheck, refusing, SUBJECT } from './shared.js';

/** The words after the first `--`, which go to the suite as typed. */
export function passArgsOf(context: RafaContext): readonly string[] {
  const at = context.argv.indexOf('--');
  return at === -1
    ? []
    : context.argv.slice(at + 1);
}

export const runCommand: RafaCommand = {
  name: 'visual run',
  subject: SUBJECT,
  action: 'run',
  summary: 'check, seed, run the project\'s visual suite, then place its results',
  description: 'Runs check (stopping on a gap), seed, the suite command from .rafa/d2c.yaml with the words after -- passed through, and place, whatever the suite\'s exit code. The last line names the suite\'s exit code and whether place ran clean; either failing exits 1.',
  args: [],
  flags: [],
  examples: [
    { cmd: execLine('run'), note: 'compares against the set, or seeds one when there is none' },
    { cmd: execLine('run', '-- --update'), note: 'passes --update to the suite, to accept changed shots' },
  ],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const env = await prepare(context);
    const result = await runVisual(env.loaded, passArgsOf(context), {
      ...env,
      now: () => new Date(),
      random: Math.random,
      onCheck: (check) => printCheck(context, check),
    });
    const { place } = result;
    if (place !== null) {
      for (const line of place.warnings) context.output.warn(line);
      context.output.info(place.line);
      if (place.staged.length > 0) context.output.info(`staged ${files(place.staged.length)}; promote with: ${execLine('promote', `--run=${place.runId}`)}`);
    }
    const ending = `suite exit ${result.suiteExit ?? 'none'}; ${result.placeError === null
      ? 'place ok'
      : `place failed: ${result.placeError}`}`;
    if (result.suiteExit !== 0 || result.placeError !== null) throw new Error(ending);
    context.output.info(ending);
  }),
};

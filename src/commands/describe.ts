/**
 * `rafa describe`: every command rafa dispatches, as the schema 2
 * document `src/cli/describe.ts` builds, for an agent or the TUI to read.
 *
 * A top-level command, its action spelled as its subject, so it sits
 * directly under `src/commands/`. It is the one core command wrapping no
 * phase 0 command. It reads the registry its own line was routed through
 * off its context, so the document holds exactly what that invocation
 * dispatches, every module the dispatcher mounted included, and never a
 * roster of its own.
 *
 * ## What it writes
 *
 * In json mode the document is the command's result: the invocation
 * writes its start event, then one terminal result event whose `data` is
 * the document. In text mode the same document is written as JSON
 * indented by two spaces, through one `info` line, so `rafa describe | jq`
 * reads it with no envelope to strip and no `result: ` prefix. The help
 * is the roster a person reads; this one is for a program in either mode.
 *
 * `version` is the `version` of `package.json`, imported by name so
 * `bun build` inlines it into `dist/cli.js`. The command reads no argument
 * and declares no flag: `--output=json` is the global flag
 * `assembleContext` reads for every command.
 */
import type { RafaCommand } from '../cli/command.js';

import { version } from '../../package.json';
import { describeRegistry } from '../cli/describe.js';

/** The command; see the module note. */
const describeCommand: RafaCommand = {
  name: 'describe',
  subject: 'describe',
  action: 'describe',
  summary: 'print every command rafa dispatches as one JSON document',
  description: 'Prints the roster of every command this invocation can dispatch as one JSON document,'
    + ' schema 2: each subject with its summary and its actions, then the top-level commands, each with'
    + ' its summary, description, arguments, flags, examples, outputs, aliases, deprecation and the'
    + ' module it comes from. A hidden command is left out, and an action a module provides is listed'
    + ' after the actions of the subject whose `exec` action reaches it. With `--output=json` the'
    + ' document is the data of the terminal result event; otherwise it is printed as indented JSON.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa describe --output=json',
      note: 'Writes a start event, then a result event whose data is the document.',
    },
    {
      cmd: 'rafa describe',
      note: 'Prints the document as JSON indented by two spaces.',
    },
  ],
  outputs: ['text', 'json'],
  run: async (context) => {
    const document = describeRegistry(context.registry, version);
    if (context.outputMode === 'json') {
      context.output.result(document);
      return;
    }
    context.output.info(JSON.stringify(document, null, 2));
  },
};

export default Object.freeze(describeCommand);

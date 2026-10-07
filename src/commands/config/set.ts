/**
 * `rafa config set <key>=<value>`: one setting written into the
 * project's `.rafa/config.yaml` by its dotted key, and the key's old and
 * new values printed. Starts no Claude session and declares no `spends`.
 *
 * The edit is `withConfigSetting` (`src/config-set.ts`, whose note is the
 * long form): the file's text is edited and never re-serialised, so every
 * comment survives, and the edited text is read back through
 * `parseConfigText` before anything is written. This module reads the
 * file, splits the one argument, hands both to the editor, and writes
 * the text it answers only when that text differs from the file.
 *
 * ## The argument
 *
 * One word, split at its first `=`: the key before it and the value
 * after it, written as YAML is after a key's colon. So
 * `pr.base=stretch/9` sets `pr.base` to `stretch/9`, and a value holding
 * a further `=` keeps it. A word with no `=`, or with nothing before it,
 * is refused before the file is read. An empty value is the editor's to
 * refuse, with the editor's own sentence.
 *
 * ## The old value
 *
 * The old value is what the project file itself set the key to, or
 * `(not set)` when the file names no value for it: the user scope and
 * the default are not read, since the edit writes the project file
 * alone. A file already reading the value is left byte-identical, and
 * the line says so.
 *
 * ## Exit codes
 *
 * 0 for a value written and for a file already reading it. 1 for every
 * refusal, each naming why and that nothing was written: a malformed
 * argument, a file that cannot be read or written, and each
 * `ConfigSetRefusal` (an unknown key, a value its reader refuses, a key
 * written twice or in flow style, an edit that does not read back).
 * With `--output=json` the {@link ConfigSetResult} is the data of the
 * terminal result event.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { ConfigSetRefusal, withConfigSetting } from '../../config-set.js';
import { configFilePath } from '../../config.js';
import { expectOneArgument, requireProject } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa config set';

/** The usage line a refusal ends with. */
export const CONFIG_SET_USAGE = 'rafa config set <key>=<value>';

/** The exit code of every refusal. */
const REFUSED_EXIT = 1;

/** How a value the project file does not set is printed. */
export const NOT_SET = '(not set)';

/** What json mode gives as the terminal result's `data`. */
export interface ConfigSetResult {
  /** The dotted key set. */
  readonly key: string;
  /** The config file edited. */
  readonly path: string;
  /** What the file set the key to before, or null when it set none. */
  readonly before: unknown;
  /** What the file sets the key to now. */
  readonly after: unknown;
  /** False when the file already read the value and was left as it was. */
  readonly changed: boolean;
}

/** A refusal naming `why`, that nothing was written, and the usage. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}. Nothing was written.\nUsage: ${CONFIG_SET_USAGE}`);
}

/** The key and the value one `<key>=<value>` word names; a refusal for a word naming no key. */
export function splitAssignment(word: string): { key: string; value: string } {
  const at = word.indexOf('=');
  if (at === -1) throw refusal(`expected <key>=<value>, got ${JSON.stringify(word)} with no "="`);
  const key = word.slice(0, at).trim();
  if (key === '') throw refusal(`expected <key>=<value>, got ${JSON.stringify(word)} with no key before "="`);
  return { key, value: word.slice(at + 1) };
}

/** A value as one line prints it: a string as written, `(not set)` for null, anything else as JSON. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return NOT_SET;
  return typeof value === 'string'
    ? value
    : JSON.stringify(value);
}

/** The file's text, or a refusal naming why it could not be read. */
function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw refusal(`${path} could not be read (${messageOf(error)})`);
  }
}

/** Sets the key one line names in the project's config; see the module note. */
export function setConfig(context: RafaContext): ConfigSetResult {
  const word = expectOneArgument(context.args, CONFIG_SET_USAGE);
  const { key, value } = splitAssignment(word);
  const project = requireProject(context, COMMAND_NAME);
  const path = configFilePath(project.root);
  const text = readText(path);

  let edit: ReturnType<typeof withConfigSetting>;
  try {
    edit = withConfigSetting(text, key, value, path);
  } catch (error) {
    if (error instanceof ConfigSetRefusal) throw refusal(error.message);
    throw error;
  }
  if (edit.changed) {
    try {
      writeFileSync(path, edit.text, 'utf8');
    } catch (error) {
      throw new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${path} could not be written (${messageOf(error)}); it may hold the old text.`);
    }
  }
  return { key, path, before: edit.before, after: edit.after, changed: edit.changed };
}

/** Every line one result prints. */
export function renderConfigSet(result: ConfigSetResult): string[] {
  if (!result.changed) {
    return [`✅ ${result.path} already reads ${result.key}: ${formatValue(result.after)}; left as it was.`];
  }
  return [
    `✅ Set ${result.key} in ${result.path}.`,
    `   was: ${formatValue(result.before)}`,
    `   now: ${formatValue(result.after)}`,
  ];
}

/** The command; see the module note. */
export function createConfigSetCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'config set',
    subject: 'config',
    action: 'set',
    summary: 'set one key in the project\'s .rafa/config.yaml, keeping every comment',
    description: 'Sets one setting in the project\'s `.rafa/config.yaml` by its dotted key, one or two'
      + ' levels deep, and prints the value the file held before and the value it holds now. The file\'s'
      + ' text is edited in place and never re-serialised, so every comment survives: an uncommented line'
      + ' setting the key is replaced, a key missing from its section is added under it, and a missing'
      + ' section is appended. The edited text is read back through the config reader before it is'
      + ' written, and a file already reading the value is left as it was. Exit code 1, with nothing'
      + ' written, for an argument that is not `<key>=<value>`, a key the config schema does not know, a'
      + ' value the key\'s reader refuses, and a key written twice or in flow style. With `--output=json`'
      + ' the key, the file, the old and new values and whether it changed are the data of the terminal'
      + ' result event. Starts no session.',
    args: [
      {
        name: 'assignment',
        description: 'The dotted key, `=`, and the value as YAML writes it after the key\'s colon.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa config set pr.base=stretch/9',
        note: 'Points pull requests at stretch/9 and prints the base they pointed at before.',
      },
      {
        cmd: 'rafa config set pr.base=main --output=json',
        note: 'Gives the key, the file, the old and new values and whether it changed as the terminal result.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = setConfig(context);
      if (context.outputMode === 'json') {
        context.output.result(result);
      } else {
        for (const line of renderConfigSet(result)) context.output.info(line);
      }
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createConfigSetCommand();

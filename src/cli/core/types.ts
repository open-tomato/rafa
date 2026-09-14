/**
 * The contracts a rafa command is written against: the context it runs
 * with, the positional arguments and flags it declares, and the command.
 *
 * Copied from open-tomato's `packages/shared/cli-core/src/types.ts` at
 * commit `6c774b81fc62489f31748c47e251f11448e3904a` (2026-06-25). The
 * package is not on the public registry, so rafa copies it rather than
 * depending on it, as it copies `parseArgs.ts` and `assembleContext.ts`
 * beside this module from the same package.
 *
 * ## What the copy changes
 *
 * `CliContext.output` is rafa's `Output` port, which `src/ports/index.ts`
 * copies from the source's `CliOutput`. The source imports that type from
 * its own `output.ts`, whose two renderers rafa ported to
 * `src/adapters/output/`. Every member is otherwise the source's, with a
 * TSDoc line added to each.
 *
 * `ArgSpec` and `FlagSpec` are still two names for one shape. The source
 * declares `default` and `aliases` on both and reads neither. The copy's
 * `parseArgs` reads a flag's `default` and `aliases` and an argument's
 * `default`, and refuses an argument that declares `aliases`, as its
 * module note says.
 */
import type { Output } from '../../ports/index.js';

/** Everything a command runs with, built and frozen by `assembleContext`. */
export interface CliContext {
  /** The positional words of the line, in order. */
  args: readonly string[];
  /** The flags of the line by name: a value, `true` for a bare flag, `false` for `--no-<name>`. */
  flags: Readonly<Record<string, string | boolean>>;
  /** How the command's output is rendered: lines a person reads, or NDJSON events. */
  outputMode: 'text' | 'json';
  /** How much the command writes, from 0, the least, to 3. */
  verbosity: 0 | 1 | 2 | 3;
  /** Where the command writes, rendered in its `outputMode`. */
  output: Output;
  /** Aborted when the command is asked to stop. */
  signal: AbortSignal;
  /** The environment the context was built from, as a frozen copy. */
  env: Readonly<Record<string, string | undefined>>;
}

/** A positional argument a command declares. */
export interface ArgSpec {
  /** What the argument is called. */
  name: string;
  /** What the argument holds, in a sentence. */
  description: string;
  /** The value's type. `parseArgs` converts no word to it: every word is a string. */
  type: 'string' | 'boolean' | 'number';
  /** Whether the command needs the argument. `parseArgs` refuses no line leaving it out. */
  required?: boolean;
  /** The word filled in when the line leaves the argument out, as a string. */
  default?: string | boolean | number;
  /** Refused by `parseArgs` when it names any: a positional word has no spelling but its place. */
  aliases?: readonly string[];
}

/** A flag a command declares. */
export interface FlagSpec {
  /** The flag's name, which `CliContext.flags` is keyed by: `plan` for `--plan`. */
  name: string;
  /** What the flag does, in a sentence. */
  description: string;
  /** The value's type. `parseArgs` converts no value to it: a value is a string. */
  type: 'string' | 'boolean' | 'number';
  /** Whether the command needs the flag. `parseArgs` refuses no line leaving it out. */
  required?: boolean;
  /** The value filled in when the line gives the flag none: a number as its string, anything else as it is. */
  default?: string | boolean | number;
  /** Other spellings of the flag, each read as its name: `p` reads `-p` and `--p` as `plan`. */
  aliases?: readonly string[];
}

/** A command: what it declares, and what runs. */
export interface CliCommand {
  /** The command's name. */
  name: string;
  /** What the command does. */
  description: string;
  /** The positional arguments, in the order the line gives them. */
  args: ArgSpec[];
  /** The flags. */
  flags: FlagSpec[];
  /** Runs the command with the context built for it. */
  run: (context: CliContext) => Promise<void>;
}

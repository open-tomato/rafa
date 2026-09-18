/**
 * `rafa skill check <dir> [--fix] [--project=<root>]`: the checker's
 * five checks over every skill a skills directory registers, and over
 * every file in it that registers nothing.
 *
 * The work is `src/check/run.ts`'s and the reading of the line is
 * `src/commands/check-report.ts`'s; this module is the declaration.
 * What it is FOR is the law the phase spells out: nothing enters a
 * tier unchecked, rafa's own bundled skills included. The demotion
 * pass and the backfill call `checkFile` on their own output and
 * refuse a failing write, and this command is the same checker with a
 * person in front of it.
 *
 * ## The directory is a tier, and `--project` is the tier's consumer
 *
 * `<dir>` is a skills directory — `~/.claude/skills`, a project's
 * `.claude/skills`, or rafa's own `skills/` — and is scanned one level
 * deep, as Claude Code registers it. `--project=<root>` is the
 * checkout the bodies are consumed in, which is what a body's
 * `src/check/references.ts` is resolved against. The two are separate
 * on purpose: checking a user tier against the project you happen to
 * stand in would fail every body naming a file of some OTHER project,
 * so without the flag a project-looking path is counted
 * `unchecked-path`, a warning that never reaches the exit code.
 *
 * ## `--fix` fills two fields and never a body
 *
 * A file whose ONLY failures are a missing `tags` or a missing `stack`
 * is rewritten with both inferred — `stack` from the body's fenced
 * languages and the file extensions it names, falling back to
 * `agnostic`, and `tags` from the skill name's hyphen tokens plus
 * those stacks. Anything else wrong and the file is left alone: the
 * judgement fields are the backfill's, and they come from a session
 * that reads the body. The write goes through
 * `src/schema/frontmatter.ts`, so the body survives byte for byte, and
 * the report is the RE-CHECK of what was written.
 *
 * ## The exit code
 *
 * The number of failing entries, capped at 255. Exit code 1 is a
 * refusal: no directory on the line, a second word, a `--fix` that
 * read the next word as its value, a bare `--project`, or a path that
 * is no directory.
 */
import type { RafaCommand } from '../../cli/command.js';
import type { CheckCommandSeams } from '../check-report.js';

import { checkCommandRun, DEFAULT_CHECK_SEAMS, SKILL_CHECK_USAGE } from '../check-report.js';

/** The command, resolving relative paths through `seams`. See the module note. */
export function createSkillCheckCommand(seams: CheckCommandSeams = DEFAULT_CHECK_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'skill check',
    subject: 'skill',
    action: 'check',
    summary: 'check every skill under a skills directory for layout, schema, resolution and locality',
    description: 'Runs the five checks over a skills directory, in order and all of them on every file, so'
      + ' one run names every rule a file breaks: layout (the two shapes that parse and silently register'
      + ' nothing, `<dir>/<group>/<name>.md` and `<dir>/<group>/<name>/SKILL.md`), schema (the required'
      + ' fields, the enums, the `description` and `when_to_use` caps, the `stack` vocabulary and the'
      + ' `paths` globs), resolution (every path the body names, every script under the skill\'s own'
      + ' directory and every tool named in a fenced shell command) and locality (an absolute path that is'
      + ' one machine\'s home). The exit code is the number of failing files, capped at 255; warnings, such'
      + ' as a project path in a run given no `--project`, never count. `--project=<root>` is the checkout'
      + ' the bodies are consumed in, and without it a project-looking path is left unchecked. `--fix`'
      + ' fills `tags` and `stack` by inference on a file whose only failures are those two missing fields,'
      + ' and never touches a body. With `--output=json` a clean run gives the reports as the data of the'
      + ' terminal result event.',
    args: [
      {
        name: 'dir',
        description: 'The skills directory to check: `~/.claude/skills`, a project\'s `.claude/skills`, or rafa\'s own.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'fix',
        description: 'Fill `tags` and `stack` by inference on a file whose only failures are those two missing fields.',
        type: 'boolean',
      },
      {
        name: 'project',
        description: 'The project root the bodies are consumed in, which their paths resolve against.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa skill check .claude/skills --project=.',
        note: 'Checks this project\'s tier against this checkout, exiting with the number of failing files.',
      },
      {
        cmd: 'rafa skill check ~/.claude/skills --fix',
        note: 'Fills `tags` and `stack` on every user skill that lacks only those, leaving each body unchanged.',
      },
    ],
    outputs: ['text', 'json'],
    needsProject: false,
    run: checkCommandRun({ kind: 'skill', usage: SKILL_CHECK_USAGE, writes: true }, seams),
  };
  return Object.freeze(command);
}

export default createSkillCheckCommand();

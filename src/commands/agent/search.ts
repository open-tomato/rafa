/**
 * `rafa agent search "<question>" [--all] [--no-model]`: the agent
 * definitions that answer a question, each with the quote it was kept
 * on.
 *
 * The same command as `rafa skill search` over the inventory's agent
 * rows, built by that module's `createSearchCommand`, so the two cannot
 * read a line, run a search or print an answer two ways. An agent is
 * named by its frontmatter `name`, as `rafa agent list` prints it. The
 * Claude Code built-ins are not inventory rows, since no file holds
 * them, so no search ranks one. `--all` searches skills as well, agents
 * first, one session per kind. See `src/commands/skill/search.ts` for
 * the steps, the output, the exit code and json mode.
 */
import type { RafaCommand } from '../../cli/command.js';
import type { SearchSeams } from '../skill/search.js';

import { createSearchCommand, DEFAULT_SEARCH_SEAMS } from '../skill/search.js';

/** `rafa agent search`, running through `seams`. */
export function createAgentSearchCommand(seams: SearchSeams = DEFAULT_SEARCH_SEAMS): RafaCommand {
  return createSearchCommand('agent', seams);
}

export default createAgentSearchCommand();

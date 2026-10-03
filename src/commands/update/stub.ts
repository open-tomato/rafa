/**
 * The `rafa update` actions that are not built yet (#713): each is
 * registered so the interface exists, and each refuses with exit code 1
 * in one line saying it is in development and naming its issue. Nothing
 * is read or written. `update current` is the one built (`./current.ts`).
 *
 * `rafa` and `port` are hidden spellings of `project`, so the roster
 * lists `project` once while all three are dispatched.
 */
import type { RafaCommand } from '../../cli/command.js';

import { CommandExit } from '../../cli/command.js';

/** Where the issues live. */
const ISSUES_URL = 'https://github.com/open-tomato/rafa/issues';

/** What a stub is made from. */
export interface UpdateStubSpec {
  readonly action: string;
  readonly summary: string;
  /** The issue the action is specified in. */
  readonly issue: number;
  readonly hidden?: boolean;
}

/** The line a stub refuses with. */
export function stubMessage(action: string, issue: number): string {
  return `rafa update ${action} is a feature in development, tracked in ${ISSUES_URL}/${String(issue)}.`
    + ' Nothing was changed.';
}

/** A stub `rafa update <action>`; see the module note. */
export function createUpdateStub(spec: UpdateStubSpec): RafaCommand {
  const command: RafaCommand = {
    name: `update ${spec.action}`,
    subject: 'update',
    action: spec.action,
    summary: `${spec.summary} (in development, #${String(spec.issue)})`,
    description: `${spec.summary}. In development: it refuses with exit code 1, naming #${String(spec.issue)},`
      + ' and changes nothing.',
    args: [],
    flags: [],
    examples: [{ cmd: `rafa update ${spec.action}`, note: `Refuses, naming #${String(spec.issue)}; changes nothing.` }],
    outputs: ['text', 'json'],
    ...(spec.hidden === true
      ? { hidden: true }
      : {}),
    run: () => Promise.reject(new CommandExit(1, stubMessage(spec.action, spec.issue))),
  };
  return Object.freeze(command);
}

/**
 * Reads the issues a pull request closes out of what
 * `gh pr view <n> --json closingIssuesReferences` writes, into the port's
 * {@link ClosingIssue}.
 *
 * Split out of `./gh.ts`, which reads every other field of a pull
 * request, so that adapter does not grow past the size it already is;
 * `./gh.ts` asks for the field in its detail fields and hands the value
 * here.
 *
 * ## Recorded
 *
 * Read off `gh` 2.102.0 on 2026-10-05, with `--repo` from a scratch
 * directory:
 *
 *   - A pull request that closes nothing writes
 *     `{"closingIssuesReferences":[]}` (`cli/cli#14354`).
 *   - Each reference is `{"id","number","repository","url"}`, the
 *     repository `{"id","name","owner"}` and its owner `{"id","login"}`
 *     (`cli/cli#14540`, closing `cli/cli#14521`). No key carries the
 *     repository as one `owner/name` string, so this module joins it.
 *   - A reference can name another repository:
 *     `GoogleCloudPlatform/scion#2453` closes eight issues of the fork
 *     `ptone/scion`, each written with `ptone` as the owner's login and
 *     the issue's URL under `ptone/scion`, in the same shape as a
 *     reference to the pull request's own repository.
 *
 * ## What is refused
 *
 * The same rule `./gh.ts` keeps for every field: a reference that is
 * not that shape is REFUSED, naming the key and what was there, rather
 * than dropped. A dropped entry would leave a `closes` list that reads
 * as complete and is short by the one issue a caller was asking about.
 * An empty `name` or `login` is refused too, since it would join into a
 * repository that names nothing. The ids are not read: nothing in the
 * port answers a provider's node id.
 */
import type { ClosingIssue } from './types.js';

import { describeValue, isMapping } from '../config-sections.js';

/** The `--json` field the references are read from. */
export const CLOSING_ISSUES_FIELD = 'closingIssuesReferences';

/** What every refusal opens with: the prefix `./gh.ts` refuses with. */
const PREFIX = 'gh pull requests';

/** Refuses a payload, naming the command, where it went wrong, and what was there. */
function refuse(command: string, problem: string): never {
  throw new Error(`${PREFIX}: ${command} answered ${problem}`);
}

/** The mapping at `where`, or a refusal. */
function readMapping(value: unknown, command: string, where: string): Record<string, unknown> {
  if (!isMapping(value)) refuse(command, `${where} is ${describeValue(value)}, expected a mapping`);
  return value;
}

/** The string at `where`, or a refusal. */
function readString(value: unknown, command: string, where: string): string {
  if (typeof value !== 'string') refuse(command, `${where} is ${describeValue(value)}, expected a string`);
  return value;
}

/** The non-empty string at `where`, or a refusal. */
function readName(value: unknown, command: string, where: string): string {
  const name = readString(value, command, where);
  if (name === '') refuse(command, `${where} is an empty string, expected a name`);
  return name;
}

/** The positive whole number at `where`, or a refusal. */
function readWholeNumber(value: unknown, command: string, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    refuse(command, `${where} is ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

/** One reference as recorded; see the module note. */
function readClosingIssue(value: unknown, command: string, where: string): ClosingIssue {
  const reference = readMapping(value, command, where);
  const repository = readMapping(reference['repository'], command, `${where}.repository`);
  const owner = readMapping(repository['owner'], command, `${where}.repository.owner`);
  const login = readName(owner['login'], command, `${where}.repository.owner.login`);
  const name = readName(repository['name'], command, `${where}.repository.name`);
  return {
    number: readWholeNumber(reference['number'], command, `${where}.number`),
    repository: `${login}/${name}`,
    url: readString(reference['url'], command, `${where}.url`),
  };
}

/**
 * The issues `value` — the `closingIssuesReferences` of a pull request
 * `command` read — names, in the order written. Refuses anything that is
 * not a list of recorded references; see the module note.
 */
export function readClosingIssues(value: unknown, command: string, where: string): ClosingIssue[] {
  if (!Array.isArray(value)) refuse(command, `${where} is ${describeValue(value)}, expected a list`);
  return value.map((reference: unknown, index) => readClosingIssue(reference, command, `${where}[${index}]`));
}

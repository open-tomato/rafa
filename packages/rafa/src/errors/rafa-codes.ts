/**
 * rafa's own cause codes (#949): the list every project starts from,
 * and the tagged view `rafa bug codes` prints.
 *
 * The list has three parts. The first two give a code in the new form to
 * every value of the four per-module unions that existed before it:
 * `ROUTE_REFUSALS` and `DISPATCH_ERROR_CODES` (`src/cli/`), and
 * `SKILL_ISSUE_CODES` with `FailureStringCode` (`src/schema/`). Those
 * unions keep their own spellings, since `--output=json` readers see
 * them in `error.code`; each entry here carries the old spelling in
 * `legacy`. Nothing derives the unions from this list. The test beside
 * this file holds the two together instead: a union value with no entry,
 * or a `legacy` naming no union value, turns it red.
 *
 * The third part seeds the causes behind the largest duplicate clusters
 * the bug audit found, and one common case per shared family. The list
 * grows from fixes: a bug filed as `<family>:new-context` gets its code
 * added here by the change that fixes it.
 *
 * A project's own codes come from `errors.codes`
 * (`src/config-schema-errors.ts`), and {@link listedCodes} puts the two
 * side by side.
 */

import type { ErrorCodeEntry } from './codes.js';

import { defineErrorCodes } from './codes.js';

/** Where a listed code comes from. */
export type CodeSource = 'rafa' | 'project';

/** A code as `rafa bug codes` lists it. */
export interface ListedCode extends ErrorCodeEntry {
  readonly source: CodeSource;
}

/** The issue that seeded the list. */
const SEED = '#949';

/** One line per family rafa's list uses. */
export const FAMILY_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  api: 'a call to a remote service',
  cli: 'routing a command line and running the command',
  config: 'reading the project or user config',
  fs: 'reading or writing files',
  git: 'running git',
  input: 'a value given on the command line or in a file',
  skill: 'a skill file\'s frontmatter',
  spawn: 'starting a child process',
  tracker: 'the issue tracker',
  tsc: 'type-checking',
});

/** rafa's own codes; see the module note. */
export const RAFA_CODES: readonly ErrorCodeEntry[] = defineErrorCodes([
  // ── the dispatcher and the router (legacy: DISPATCH_ERROR_CODES, ROUTE_REFUSALS)
  { code: 'cli:unknown-subject', description: 'the first word names no subject', hint: 'run rafa --help for the subjects', level: 'error', since: SEED, legacy: 'unknown_subject' },
  { code: 'cli:missing-action', description: 'a subject is named with no action after it', hint: 'run rafa <subject> --help for its actions', level: 'error', since: SEED, legacy: 'missing_action' },
  { code: 'cli:unknown-action', description: 'the action names nothing the subject holds', hint: 'run rafa <subject> --help for its actions', level: 'error', since: SEED, legacy: 'unknown_action' },
  { code: 'cli:unknown-module', description: 'a module command names a module that is not mounted', hint: 'run rafa module list for the modules that are mounted', level: 'error', since: SEED, legacy: 'unknown_module' },
  { code: 'cli:unexpected-version', description: '--version is typed beside a command, where it is read alone', hint: 'run rafa --version alone, with no command beside it', level: 'error', since: SEED, legacy: 'unexpected_version' },
  { code: 'cli:invalid-spec', description: 'a command declares a shape the dispatcher refuses', hint: 'fix the command declaration the message names', level: 'error', since: SEED, legacy: 'invalid_spec' },
  { code: 'cli:no-project', description: 'a command that needs a project ran outside one', hint: 'run it inside a project, or run rafa init', level: 'error', since: SEED, legacy: 'no_project' },
  { code: 'cli:command-exit', description: 'a command refused and set its own exit code', hint: 'read the message above it', level: 'error', since: SEED, legacy: 'command_exit' },
  { code: 'cli:command-error', description: 'a command threw an error it did not handle', hint: 'file a bug with the stack', level: 'error', since: SEED, legacy: 'command_error' },
  { code: 'cli:result-unwritable', description: 'the command result cannot be written, as with data JSON refuses', hint: 'file a bug: the command answered data that cannot be written as JSON', level: 'error', since: SEED, legacy: 'result_unwritable' },
  // ── skill frontmatter (legacy: SKILL_ISSUE_CODES, FailureStringCode)
  { code: 'skill:missing-field', description: 'a required frontmatter field is absent or empty', hint: 'add the field the message names', level: 'error', since: SEED, legacy: 'missing-field' },
  { code: 'skill:wrong-type', description: 'a frontmatter field has a type the schema cannot read', hint: 'write the field as the schema expects', level: 'error', since: SEED, legacy: 'wrong-type' },
  { code: 'skill:invalid-name', description: 'a skill name is not kebab-case', hint: 'rename the skill in kebab-case', level: 'error', since: SEED, legacy: 'invalid-name' },
  { code: 'skill:description-too-long', description: 'the description is at or past its limit', hint: 'shorten the description', level: 'error', since: SEED, legacy: 'description-too-long' },
  { code: 'skill:listing-too-long', description: 'description and when_to_use together pass the listing limit', hint: 'shorten when_to_use', level: 'error', since: SEED, legacy: 'listing-too-long' },
  { code: 'skill:unknown-stack', description: 'a stack entry is outside the vocabulary', hint: 'use a stack the schema lists', level: 'error', since: SEED, legacy: 'unknown-stack' },
  { code: 'skill:unpaired-prevents', description: 'prevents is set without signal, or signal without prevents', hint: 'set both or neither', level: 'error', since: SEED, legacy: 'unpaired-prevents' },
  { code: 'skill:unknown-signal', description: 'signal holds a value the schema does not list', hint: 'use a listed signal', level: 'error', since: SEED, legacy: 'unknown-signal' },
  { code: 'skill:unusable-glob', description: 'a paths glob gates on nothing it seems to gate on', hint: 'rewrite the glob', level: 'error', since: SEED, legacy: 'unusable-glob' },
  { code: 'skill:forbidden-field', description: 'an instinct field appears on a skill', hint: 'remove the field', level: 'error', since: SEED, legacy: 'forbidden-field' },
  { code: 'skill:unknown-provenance', description: 'provenance names neither first-party nor a known mapping', hint: 'use first-party or a known mapping', level: 'error', since: SEED, legacy: 'unknown-provenance' },
  { code: 'skill:invalid-reviewed', description: 'provenance.reviewed is not who and a date', hint: 'write <who> <YYYY-MM-DD>', level: 'error', since: SEED, legacy: 'invalid-reviewed' },
  { code: 'skill:empty-failure-string', description: 'a failure_strings entry is blank', hint: 'remove the blank entry', level: 'error', since: SEED, legacy: 'empty-failure-string' },
  { code: 'skill:short-failure-string', description: 'a failure_strings entry is too short to name one failure', hint: 'lengthen the entry', level: 'warn', since: SEED, legacy: 'short-failure-string' },
  // ── causes behind the audit's largest duplicate clusters
  { code: 'git:no-identity', description: 'a git commit runs with no author identity set, often in a scratch home', hint: 'set user.name and user.email where the commit runs', level: 'error', since: SEED },
  { code: 'git:filesystem-boundary', description: 'git prints an extra line when run outside a repository', hint: 'run inside a repository, or read only the first line', level: 'warn', since: SEED },
  { code: 'tsc:tests-excluded', description: 'type errors in test files stay hidden because tsc excludes tests', hint: 'type-check the test files', level: 'error', since: SEED },
  { code: 'fs:gitignored-fixture', description: 'a test reads a gitignored file a fresh checkout lacks', hint: 'plant the file in the test, never read the live one', level: 'error', since: SEED },
  { code: 'fs:live-home', description: 'a test reads the live home directory instead of a planted one', hint: 'point HOME at a scratch folder in the test', level: 'error', since: SEED },
  // ── shared families for common cases
  { code: 'fs:not-found', description: 'a file or folder the step needs is missing', hint: 'create it, or fix the path', level: 'error', since: SEED },
  { code: 'input:missing-param', description: 'a required value was not given', hint: 'pass the value the message names', level: 'error', since: SEED },
  { code: 'input:invalid-value', description: 'a given value is outside what the step accepts', hint: 'pass one of the values the message lists', level: 'error', since: SEED },
  { code: 'api:http-status', description: 'a remote service answered with an error status', hint: 'read the status, then retry or fix the request', level: 'error', since: SEED },
  { code: 'config:invalid-value', description: 'a config key holds a value its reader refuses', hint: 'fix the key the message names', level: 'error', since: SEED },
  { code: 'tracker:unreachable', description: 'the issue tracker could not be reached', hint: 'check the network and gh auth status', level: 'error', since: SEED },
  { code: 'tracker:unavailable', description: 'a tracker kind could not be made or failed its preflight, and the chain passed it over', hint: 'read the reason given, or leave the fallback tracker in use', level: 'warn', since: '#950' },
  { code: 'spawn:nonzero-exit', description: 'a child process exited nonzero', hint: 'read the child\'s stderr above', level: 'error', since: SEED },
]);

/** rafa's codes, then `projectCodes`, each tagged with where it comes from. */
export function listedCodes(projectCodes: readonly ErrorCodeEntry[]): readonly ListedCode[] {
  return Object.freeze([
    ...RAFA_CODES.map((entry): ListedCode => Object.freeze({ ...entry, source: 'rafa' })),
    ...projectCodes.map((entry): ListedCode => Object.freeze({ ...entry, source: 'project' })),
  ]);
}

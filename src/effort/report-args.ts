/**
 * The argv parser of `rafa effort report`, apart from the report in
 * `report.ts` it configures, as `collect-args.ts` is for
 * `rafa effort collect`.
 *
 * Every flag the parser reads is compared against here and nowhere else,
 * and any other argument is refused.
 *
 * `--skills` switches the command to the skills report
 * (`report-skills.ts`), and `--plan=<stub>[,<stub>]` narrows that report
 * to the plans named. `--plan=` narrows nothing else, so it is refused
 * without `--skills`, naming the flag, rather than read as no filter over
 * the session tables. `--kind` and `--entrypoint` narrow the session rows,
 * which the skills report does not read, so each is refused beside
 * `--skills` for the same reason.
 */

import type { SessionKind } from './classify.js';

import { SESSION_KINDS } from './report.js';

/** What the parsed argv asked for. */
export interface ReportArgs {
  json: boolean;
  kinds: readonly SessionKind[] | null;
  entrypoints: readonly string[] | null;
  /** Whether `--skills` asked for the skills report in place of the session tables. */
  skills: boolean;
  /** The plan stubs `--plan=` named, each once, in the order typed; null for every plan. */
  plans: readonly string[] | null;
  /** Every refusal, so all of them are reported and not just the first. */
  errors: string[];
}

/** Splits a comma-separated flag value into its members. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Narrows a string to a session kind, or null when it is not one. */
function asSessionKind(value: string): SessionKind | null {
  return SESSION_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * The refusals of flags that do not combine: `--plan=` without
 * `--skills`, and a session-row filter beside it.
 */
function combinationErrors(
  skills: boolean,
  planTyped: boolean,
  filters: readonly string[],
): string[] {
  if (!skills) {
    return planTyped
      ? ['--plan narrows the skills report and needs --skills']
      : [];
  }
  return filters.map((flag) => `${flag} narrows the session tables, which --skills does not print`);
}

/**
 * Parses the report argv.
 *
 * Every refusal is collected rather than thrown at the first, and an
 * unrecognised argument IS a refusal: a mistyped `--entrypint=sdk-cli`
 * that parsed as "no filter" would print the whole directory's traffic
 * under a command line that reads like the loop's own.
 *
 * A repeated flag UNIONS rather than replacing, because each of these
 * takes a set and `--kind=task --kind=wrap-up` has one obvious meaning;
 * `--plan=a --plan=b` reads both plans as `--plan=a,b` does.
 */
export function parseReportArgs(args: readonly string[]): ReportArgs {
  const errors: string[] = [];
  const kinds: SessionKind[] = [];
  const entrypoints: string[] = [];
  const plans: string[] = [];
  const filters: string[] = [];
  let json = false;
  let skills = false;
  let planTyped = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--skills') {
      skills = true;
    } else if (arg === '--kind' || arg === '--entrypoint' || arg === '--plan') {
      errors.push(`${arg} takes a value, as ${arg}=<value>`);
    } else if (arg.startsWith('--plan=')) {
      planTyped = true;
      const stubs = splitList(arg.slice('--plan='.length));
      if (stubs.length === 0) errors.push(`--plan names no plan stub: ${arg}`);
      for (const stub of stubs) {
        if (!plans.includes(stub)) plans.push(stub);
      }
    } else if (arg.startsWith('--kind=')) {
      if (!filters.includes('--kind')) filters.push('--kind');
      for (const value of splitList(arg.slice('--kind='.length))) {
        const kind = asSessionKind(value);
        if (kind === null) {
          errors.push(
            `--kind value is not a session kind: ${value}`
            + ` (one of ${SESSION_KINDS.join(', ')})`,
          );
        } else if (!kinds.includes(kind)) {
          kinds.push(kind);
        }
      }
    } else if (arg.startsWith('--entrypoint=')) {
      if (!filters.includes('--entrypoint')) filters.push('--entrypoint');
      for (const value of splitList(arg.slice('--entrypoint='.length))) {
        if (!entrypoints.includes(value)) entrypoints.push(value);
      }
    } else {
      errors.push(`unrecognised argument: ${arg}`);
    }
  }
  errors.push(...combinationErrors(skills, planTyped, filters));

  return {
    json,
    kinds: kinds.length === 0
      ? null
      : kinds,
    entrypoints: entrypoints.length === 0
      ? null
      : entrypoints,
    skills,
    plans: plans.length === 0
      ? null
      : plans,
    errors,
  };
}

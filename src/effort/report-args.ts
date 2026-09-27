/**
 * The argv parser of `rafa effort report`, apart from the report in
 * `report.ts` it configures, as `collect-args.ts` is for
 * `rafa effort collect`.
 *
 * Every flag the parser reads is compared against here and nowhere else,
 * and any other argument is refused.
 */

import type { SessionKind } from './classify.js';

import { SESSION_KINDS } from './report.js';

/** What the parsed argv asked for. */
export interface ReportArgs {
  json: boolean;
  kinds: readonly SessionKind[] | null;
  entrypoints: readonly string[] | null;
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
 * Parses the report argv.
 *
 * Every refusal is collected rather than thrown at the first, and an
 * unrecognised argument IS a refusal: a mistyped `--entrypint=sdk-cli`
 * that parsed as "no filter" would print the whole directory's traffic
 * under a command line that reads like the loop's own.
 *
 * A repeated flag UNIONS rather than replacing, because both of these
 * take a set and `--kind=task --kind=wrap-up` has one obvious meaning.
 */
export function parseReportArgs(args: readonly string[]): ReportArgs {
  const errors: string[] = [];
  const kinds: SessionKind[] = [];
  const entrypoints: string[] = [];
  let json = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--kind' || arg === '--entrypoint') {
      errors.push(`${arg} takes a value, as ${arg}=<value>`);
    } else if (arg.startsWith('--kind=')) {
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
      for (const value of splitList(arg.slice('--entrypoint='.length))) {
        if (!entrypoints.includes(value)) entrypoints.push(value);
      }
    } else {
      errors.push(`unrecognised argument: ${arg}`);
    }
  }

  return {
    json,
    kinds: kinds.length === 0
      ? null
      : kinds,
    entrypoints: entrypoints.length === 0
      ? null
      : entrypoints,
    errors,
  };
}

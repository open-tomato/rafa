#!/usr/bin/env bun
/**
 * `stretch`: the readings and checks the stretch operators call instead
 * of writing a parser or a guard mid-stretch. Run it with bun from the
 * installed runtime:
 *
 *   bun "$(dirname "$(readlink -f "$(command -v rafa)")")/bundled/operators/scripts/stretch.ts" <action>
 *
 * Every action takes `--root=<project>` (the working directory when left
 * out) and `--output=json`. Nothing under this directory imports from
 * `src/`: `src/bundled/` ships as it is.
 *
 * @module bundled/operators/scripts/stretch
 */
import type { Args } from './args.js';
import type { Io } from './io.js';

import { flagText, hasFlag, parseArgs } from './args.js';
import { checkRows, formatCheck, readSessionRows } from './data-check.js';
import { formatGroups, groupFilings, parseCauses } from './filings.js';
import { baseCheck, mergeGuard } from './guards.js';
import { realIo } from './io.js';
import { formatItem, readItem } from './readings.js';
import { readStretch } from './stretch-dir.js';
import { readSuspends } from './suspends.js';
import { formatProbe, probe, waitUntil } from './watch.js';

/** What an action hands back: its text, its data and its exit code. */
interface Outcome {
  readonly code: number;
  readonly text: string;
  readonly data: unknown;
}

/** The usage line of every action. */
const USAGE = [
  'stretch <action> [--root=<project>] [--output=json]',
  '  readings --stretch=<n> --item=<issue> [--since=<iso>]',
  '  data-check --stretch=<n> [--since=<iso>] [--store=<effort.sqlite>]',
  '  filings --stretch=<n> --since=<iso> [--causes=<causes.json>]',
  '  base-check <branch> (--stretch=<n> | --base=<branch>) [--fix]',
  '  merge-guard <pr> <head> (--stretch=<n> | --base=<branch>) [--merge] [--skip-checks]',
  '  watch --stretch=<n> [--until] [--every=<seconds>] [--timeout=<minutes>] [--wait=<min>] [--quiet=<min>] [--repeats=<n>]',
].join('\n');

/** A refusal with the usage under it. */
function refuse(message: string): Outcome {
  return { code: 2, text: `${message}\n${USAGE}`, data: { error: message } };
}

/** The `--since` flag, else the stretch's start; `undefined` when neither reads. */
function since(args: Args, fallback: number | undefined): number | undefined {
  const flag = flagText(args, 'since');
  const parsed = flag === undefined
    ? fallback
    : Date.parse(flag);

  return parsed === undefined || Number.isNaN(parsed)
    ? undefined
    : parsed;
}

/** A positive number flag, else `fallback`. */
function numberFlag(args: Args, name: string, fallback: number): number {
  const value = Number(flagText(args, name));

  return Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** `readings`, `data-check`, `filings` and `watch` all read a stretch first. */
function stretchAction(io: Io, args: Args, root: string): Outcome {
  const n = flagText(args, 'stretch');

  if (n === undefined) {
    return refuse(`${args.action} needs --stretch=<n>`);
  }
  const stretch = readStretch(io, root, n);
  const from = since(args, stretch.startedAt);

  if (args.action === 'watch') {
    const thresholds = { waitMinutes: numberFlag(args, 'wait', 5), quietMinutes: numberFlag(args, 'quiet', 30), repeats: numberFlag(args, 'repeats', 3) };

    if (!hasFlag(args, 'until')) {
      const seen = probe(io, stretch);

      return { code: 0, text: formatProbe(seen), data: seen };
    }
    const waited = waitUntil(io, stretch, thresholds, numberFlag(args, 'every', 30) * 1000, numberFlag(args, 'timeout', 25) * 60_000);

    return waited.reasons.length > 0
      ? { code: 0, text: waited.reasons.join('\n'), data: waited }
      : { code: 3, text: 'no signal before the timeout', data: waited };
  }
  if (from === undefined) {
    return refuse(`${args.action} needs --since=<iso>, or a startedAt in agent.json`);
  }

  return readAction(io, args, root, stretch, from);
}

/** The three reading actions, once the stretch and its start are known. */
function readAction(io: Io, args: Args, root: string, stretch: ReturnType<typeof readStretch>, from: number): Outcome {
  if (args.action === 'readings') {
    const item = flagText(args, 'item');

    if (item === undefined) {
      return refuse('readings needs --item=<issue>');
    }
    const reading = readItem(io, stretch, item, from);

    return { code: 0, text: formatItem(reading), data: reading };
  }
  if (args.action === 'data-check') {
    const store = flagText(args, 'store', `${root}/.rafa/effort/effort.sqlite`) ?? '';
    const check = checkRows(readSessionRows(store), io.home(), from);
    const suspends = readSuspends(io, from);
    const label = suspends.known
      ? `${suspends.suspends.length}`
      : `unknown (${suspends.reason})`;

    return { code: check.usable
      ? 0
      : 1, text: formatCheck(check, label), data: { ...check, suspends } };
  }
  const causesText = io.read(flagText(args, 'causes', `${stretch.dir}/causes.json`) ?? '') ?? '[]';
  const iso = new Date(from).toISOString();
  const listed = io.exec(['gh', 'issue', 'list', '--state', 'all', '--limit', '300', '--search', `created:>=${iso}`, '--json', 'number,title,body'], root);

  if (listed.code !== 0) {
    return { code: 2, text: `gh issue list failed: ${listed.stderr.trim()}`, data: { error: listed.stderr } };
  }
  const groups = groupFilings(JSON.parse(listed.stdout) as { number: number; title: string; body: string }[], parseCauses(causesText));

  return { code: 0, text: formatGroups(groups, iso), data: groups };
}

/** The rafa the script runs beside. */
function version(io: Io): Outcome {
  const rafa = io.exec(['rafa', '--version']).stdout.trim();

  return { code: 0, text: `stretch, beside ${rafa || 'no rafa on PATH'}`, data: { rafa } };
}

/** Runs one command line against `io`. */
export function run(argv: readonly string[], io: Io): Outcome {
  const args = parseArgs(argv);
  const root = flagText(args, 'root', process.cwd()) ?? process.cwd();
  const n = flagText(args, 'stretch');
  const base = flagText(args, 'base', n === undefined
    ? undefined
    : `stretch/${n}`);

  if (args.action === undefined && hasFlag(args, 'version')) {
    return version(io);
  }

  switch (args.action) {
    case 'readings':
    case 'data-check':
    case 'filings':
    case 'watch':
      return stretchAction(io, args, root);
    case 'base-check': {
      const [branch] = args.positional;

      if (base === undefined) {
        return refuse('base-check needs --stretch=<n> or --base=<branch>');
      }
      const result = branch === undefined
        ? undefined
        : baseCheck(io, root, branch, base, hasFlag(args, 'fix'));

      return result
        ? { code: result.code, text: result.lines.join('\n'), data: result }
        : refuse('base-check needs <branch>');
    }
    case 'merge-guard': {
      const [pr, head] = args.positional;

      if (base === undefined) {
        return refuse('merge-guard needs --stretch=<n> or --base=<branch>');
      }
      const result = pr === undefined || head === undefined
        ? undefined
        : mergeGuard(io, root, pr, head, base, { merge: hasFlag(args, 'merge'), skipChecks: hasFlag(args, 'skip-checks') });

      return result
        ? { code: result.code, text: result.lines.join('\n'), data: result }
        : refuse('merge-guard needs <pr> <head>');
    }
    case 'version':
      return version(io);
    default:
      return refuse(args.action === undefined
        ? 'no action given'
        : `unknown action ${args.action}`);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const outcome = run(argv, realIo);
  const json = argv.includes('--output=json');

  process.stdout.write(`${json
    ? JSON.stringify(outcome.data)
    : outcome.text}\n`);
  process.exit(outcome.code);
}

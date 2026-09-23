/**
 * The lines text mode writes for the plan's section of `rafa doctor`
 * (`./doctor.ts`): the head naming the plan, or where none was found,
 * and the PREREQUISITES file merged in; one line per check; the line
 * naming the start-only items a resume passed over; the steps that file
 * names and nothing checks; and the verdict with any `known-missing:`
 * lines. A halt has no verdict line: it is the refusal, on stderr.
 *
 * A module of its own so `doctor.ts` stays under the 800-line cap
 * (`context/source.md`) while it grows the plan's risk total. What the
 * lines report and why is `doctor.ts`'s module note; this module only
 * words them.
 */
import type { DoctorPreflight, DoctorStartTier } from './doctor.js';
import type { PreflightCheck, PreflightReport } from '../preflight/run.js';

import { basename, relative, sep } from 'node:path';

import { plural } from './plan/plan-files.js';

/** A path as a line shows it: relative under the root, absolute elsewhere. */
function shownPath(path: string, root: string): string {
  return path.startsWith(`${root}${sep}`)
    ? relative(root, path)
    : path;
}

/**
 * How many items were checked: nothing, `count` of them with `whose`
 * naming where they came from, or, once the pull request provider
 * contributed any, how many of the `count` were its.
 */
function checkedPhrase(count: number, automatic: number, whose: string): string {
  if (count === 0) return 'nothing to check';
  if (automatic === 0) return `${plural(count, 'item')} ${whose}checked`;
  return `${plural(count, 'item')} checked, ${String(automatic)} of them for the pull request provider`;
}

/** The head line: the plan or where none was found, the file merged in, and how many items were checked. */
function headLine(preflight: DoctorPreflight): string {
  const { root, plan, prerequisitesFile, automatic } = preflight;
  const count = preflight.report.checks.length;
  if (plan === null) {
    const where = preflight.lookedFor.map((path) => shownPath(path, root)).join(' or ');
    const checked = checkedPhrase(count, automatic, 'from the config ');
    return `Preflight with no plan, none being at ${where}: ${checked}, no run started.`;
  }
  const merged = prerequisitesFile === null
    ? ''
    : `, with ${basename(prerequisitesFile)} merged in`;
  const checked = checkedPhrase(count, automatic, '');
  return `Preflight for ${shownPath(plan, root)}${merged}: ${checked}, no run started.`;
}

/** One check as a line: its outcome, its tier, the item, how it was checked and how long it took. */
function checkLine(check: PreflightCheck): string {
  const how = check.item.probe === null
    ? 'presence check'
    : `probe \`${check.item.probe}\``;
  const item = `${check.item.kind} ${JSON.stringify(check.item.name)}`;
  return `  ${check.outcome.padEnd(7)} ${check.tier.padEnd(8)} ${item}, ${how}, ${String(check.durationMs)} ms`;
}

/**
 * The line naming how many start-only items this resume passed over and
 * the tracker that made it one; none on a first dispatch, where each
 * such item has a check line of its own.
 */
function skippedStartLines(startTier: DoctorStartTier): readonly string[] {
  const { skipped, tracker } = startTier;
  if (skipped === 0 || tracker === null) return [];
  return [
    `${tracker} already holds a ticked task, so ${plural(skipped, 'start-only item')} of the plan went`
      + ' unchecked: rafa loop start probes that tier on a first dispatch alone.',
  ];
}

/** The steps the PREREQUISITES file names and nothing checks, under a line naming the file. */
function reminderLines(preflight: DoctorPreflight): readonly string[] {
  const { reminders, prerequisitesFile } = preflight;
  if (reminders.length === 0 || prerequisitesFile === null) return [];
  return [
    `${basename(prerequisitesFile)} names ${plural(reminders.length, 'step')} the preflight does not check:`,
    ...reminders.map((reminder) => `  line ${String(reminder.line)}: ${reminder.description}`),
  ];
}

/** The verdict of a preflight that did not halt, with its `known-missing:` lines; none for a halt. */
function verdictLines(report: PreflightReport): readonly string[] {
  if (report.halt !== null) return [];
  if (report.knownMissing.length === 0) return ['Preflight passed: rafa loop start would go on to its first session.'];
  const named = plural(report.knownMissing.length, 'optional item');
  return [
    `Preflight passed: rafa loop start would go on, naming ${named} known-missing in every task prompt:`,
    ...report.knownMissing.map((line) => `  ${line}`),
  ];
}

/** The lines text mode writes for a preflight; see the module note. */
export function renderDoctor(preflight: DoctorPreflight): readonly string[] {
  return [
    headLine(preflight),
    ...preflight.report.checks.map(checkLine),
    ...skippedStartLines(preflight.startTier),
    ...reminderLines(preflight),
    ...verdictLines(preflight.report),
  ];
}

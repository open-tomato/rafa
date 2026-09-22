/**
 * A sweep over the words the ending hint (`src/next/hint.ts`) and the
 * `pr merge` follow-ups (`src/commands/pr/merge-followups.ts`) print:
 * neither may name `git`, `gh` or `bun`, since both are text an
 * operator reads and neither is the tool this session runs.
 *
 * `hintLine` and `nextQuestion` are worded off `state.proposal` alone
 * (`src/next/hint.ts`), and `state.proposal` is what `src/next/state.ts`
 * fills for each of the eight actions {@link actionInvocation} turns
 * into a command; see its module note for the table. This file reads no
 * seam and spawns nothing: the STATES below carry the same proposal
 * text that module's rows fill in, one per action id, so the sweep
 * measures the words a person actually sees rather than a placeholder
 * that would pass regardless of what the wording says. `hint.test.ts`
 * drives the reading, the terminal branch and the timeout; this file
 * drives none of that and reads only the two lines each state prints.
 *
 * The follow-up cases are every combination `readFollowUps` decides
 * between for a version it has read: tagged or not, a rafa checkout or
 * not, the runtime installed or not — the same three booleans
 * `merge-followups.test.ts` drives, read here for their printed
 * `command` and `why` rather than for which ids came back.
 *
 * ## The control
 *
 * {@link PLANTED} is a line built the way {@link hintLine} builds one,
 * naming `bun` where a real proposal never does. The sweep is run twice:
 * once over the real lines alone, which must come back empty, and once
 * with {@link PLANTED} added, which must come back naming it — proving
 * the check is not vacuous, the way `user-facing-spelling.test.ts`
 * plants its own hit for the same reason.
 */
import type { FollowUpReading } from '../commands/pr/merge-followups.js';
import type { NextState } from '../next/state.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { readFollowUps } from '../commands/pr/merge-followups.js';
import { actionInvocation } from '../next/actions.js';
import { hintLine, nextQuestion } from '../next/hint.js';

/** The pull request the pull-request states name. */
const PR = 41;

/** The issue the roadmap states name. */
const ISSUE = 64;

/** The base branch a merge proposal names. */
const BASE = 'main';

/** A state as a row answers one, with the fields a case fills. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'pr-green',
    action: 'merge',
    reading: 'a reading',
    proposal: 'a proposal',
    pullRequest: null,
    issue: null,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/**
 * One state per action id {@link actionInvocation} turns into a
 * command, worded with the exact proposal text `src/next/state.ts`
 * fills for that row — `resume` twice, once per row that proposes it.
 */
const STATES: readonly NextState[] = Object.freeze([
  stateOf({
    id: 'tracker-blocked',
    action: 'resume',
    proposal: 'resume the loop on `rafa-63`, which retries a blocked task first',
    planStub: 'rafa-63',
    planPath: '/repo/.rafa/plans/rafa-63.md',
  }),
  stateOf({
    id: 'tracker-open',
    action: 'resume',
    proposal: 'resume the loop on `rafa-63`',
    planStub: 'rafa-63',
    planPath: '/repo/.rafa/plans/rafa-63.md',
  }),
  stateOf({
    id: 'pr-pending',
    action: 'wait',
    proposal: `wait for the checks on #${PR}`,
    pullRequest: PR,
  }),
  stateOf({
    id: 'pr-red',
    action: 'triage',
    proposal: `triage #${PR}`,
    pullRequest: PR,
  }),
  stateOf({
    id: 'pr-green',
    action: 'merge',
    proposal: `merge #${PR} into \`${BASE}\``,
    pullRequest: PR,
  }),
  stateOf({
    id: 'plan-unstarted',
    action: 'start',
    proposal: 'start the loop on `rafa-64`, creating its branch',
    planStub: 'rafa-64',
    planPath: '/repo/.rafa/plans/rafa-64.md',
  }),
  stateOf({
    id: 'issue-ready',
    action: 'plan',
    proposal: `create the plan for #${ISSUE}`,
    issue: ISSUE,
  }),
  stateOf({
    id: 'issue-blocked',
    action: 'unblock',
    proposal: `re-read the blockers of #${ISSUE} and take \`${SPEC_BLOCKED_LABEL}\` off once they have all closed`,
    issue: ISSUE,
  }),
  stateOf({
    id: 'issue-not-ready',
    action: 'ready',
    proposal: `check the spec of #${ISSUE} and mark it ready`,
    issue: ISSUE,
  }),
]);

/** Every combination `readFollowUps` decides between, for a version it has read. */
const FOLLOW_UP_READINGS: readonly FollowUpReading[] = Object.freeze(
  [true, false].flatMap((tagged) => [true, false].flatMap((rafaCheckout) => [true, false].map((runtimeInstalled) => ({
    version: '0.4.0',
    tagged,
    rafaCheckout,
    runtimeInstalled,
  })))),
);

/** One line the sweep reads, and where it came from, for a hit that names its source. */
interface CapturedLine {
  readonly source: string;
  readonly line: string;
}

/** The question and the printed line of every state in {@link STATES}, each labelled by the state's id. */
function hintLines(): readonly CapturedLine[] {
  return STATES.flatMap((state) => {
    const invocation = actionInvocation(state);
    if (invocation === null) throw new Error(`hint-tool-names: state "${state.id}" names no command`);
    return [
      { source: `hint:${state.id}.command`, line: hintLine(state, invocation) },
      { source: `hint:${state.id}.question`, line: nextQuestion(state) },
    ];
  });
}

/** The `command` and `why` of every follow-up {@link FOLLOW_UP_READINGS} names, each labelled by its combination and id. */
function followUpLines(): readonly CapturedLine[] {
  return FOLLOW_UP_READINGS.flatMap((reading) => {
    const label = `followup:tagged=${String(reading.tagged)},checkout=${String(reading.rafaCheckout)},installed=${String(reading.runtimeInstalled)}`;
    return readFollowUps(reading).flatMap((followUp) => [
      { source: `${label}.${followUp.id}.command`, line: followUp.command },
      { source: `${label}.${followUp.id}.why`, line: followUp.why },
    ]);
  });
}

/** Every line the hint and the follow-ups print, across every case above. */
function capturedLines(): readonly CapturedLine[] {
  return [...hintLines(), ...followUpLines()];
}

/** A line built the way {@link hintLine} builds one, naming `bun` where no real proposal does; the control. */
const PLANTED: CapturedLine = {
  source: 'planted-control',
  line: `👉 Next: run bun test before merging — rafa pr merge ${PR} --yes`,
};

/** Each of `lines` that names `git`, `gh` or `bun` as a whole word, as `<source>: <word>`. */
function toolNameHits(lines: readonly CapturedLine[]): string[] {
  const hits: string[] = [];
  for (const { source, line } of lines) {
    for (const match of line.matchAll(/\b(git|gh|bun)\b/g)) {
      hits.push(`${source}: ${match[1] ?? ''}`);
    }
  }
  return hits;
}

describe('the words a hint or a follow-up prints', () => {
  it('names no tool across every hint case and every follow-up case', () => {
    expect(STATES.length).toBeGreaterThan(0);
    expect(FOLLOW_UP_READINGS.length).toBeGreaterThan(0);
    expect(toolNameHits(capturedLines())).toEqual([]);
  });

  it('catches the planted line naming bun, so the sweep is not vacuous', () => {
    expect(PLANTED.line).toContain('bun');
    expect(toolNameHits([PLANTED])).toEqual(['planted-control: bun']);
    expect(toolNameHits([...capturedLines(), PLANTED])).toEqual(['planted-control: bun']);
  });

  it('reads a word only whole: `GitHub` and `bunch` are no hit', () => {
    const probe: CapturedLine[] = [
      { source: 'probe', line: 'GitHub has not settled whether it merges' },
      { source: 'probe', line: 'a bunch of checks are still running' },
    ];
    expect(toolNameHits(probe)).toEqual([]);
  });
});

/**
 * Tests for the blocked roadmap line (`src/board/blocked-line.ts`): when
 * a line the `--next` walk picked counts as blocked, the sentence that
 * names what it waits on, and the walk for the first line under it that
 * is ready, not blocked and not taken.
 *
 * `./blocked.test.ts` drives the `Blocked by:` parser itself and this
 * file drives none of that again. What only this file can see is the
 * JOIN: that the label is asked before the line, that a blocker still
 * open is what makes a line blocked while every blocker closed does not,
 * that a state nobody read is not a state that says closed, and that the
 * walk after it asks three readings and not two.
 *
 * Every case plants its own issues and readings. Nothing here spawns
 * `gh` or `git`, reads a file or reaches GitHub, because every reading
 * the module takes is a seam.
 *
 * ## The controls
 *
 * - The open-blocker case is paired with the same issue whose blocker
 *   the board holds CLOSED: one answers a reading and the other answers
 *   null. A reading that called every labelled issue blocked would look
 *   right on the first half alone.
 * - The unread-state case is paired with the same line read as closed,
 *   so "a blocker nobody could read holds the line" is held against a
 *   reading that could have cleared it.
 * - The `not-ready` case of the walk is paired with the same roadmap
 *   whose candidate carries `spec:ready`: one is passed over and the
 *   next line is offered, the other is offered itself.
 *
 * ## What passes while wrong
 *
 * Three mutations of `blocked-line.ts` were driven on 2026-09-21, one
 * at a time, over `env -u CLAUDECODE bun test
 * src/board/blocked-line.test.ts src/board/spec-source.test.ts`, the
 * module restored from a scratch copy and verified with `shasum -c`
 * each time, against 64 pass and 0 fail either side:
 *
 *  - a blocker whose state was not read counted as cleared (`unread`
 *    dropped from the sum): 62 pass and 2 fail, the unread pair here and
 *    the `--next` case that plants a blocker the reader has no issue
 *    for. That is the reading which holds "an unreadable dependency is
 *    not a closed one".
 *  - the `spec:ready` reading dropped from `passOf`, so the walk offers
 *    the first line that is merely not blocked and not taken: 60 pass
 *    and 4 fail, the not-ready pair here and the two `--next` cases that
 *    count on the label. Nothing else notices, because every other
 *    candidate is labelled.
 *  - {@link pickPlannableLine} started at the top of the roadmap rather
 *    than under the blocked line: 57 pass and 7 fail, every case of the
 *    walk. The blocked line passes itself as blocked either way, so what
 *    the mutant changes is which EARLIER line is offered — and one case
 *    holds exactly that, that the walk resumes under the line it was
 *    asked about.
 */
import type { SpecIssue } from './issue.js';
import type { RoadmapLine, RoadmapReadings } from './roadmap.js';

import { describe, expect, it } from 'bun:test';

import {
  alternativeQuestion,
  blockedLineSentence,
  blockerStatesOf,
  declinedMessage,
  noAlternativeMessage,
  notReadySentence,
  pickPlannableLine,
  plannableReadings,
  readBlockedLine,
  unaskedMessage,
} from './blocked-line.js';
import { blockedFaultMessage, readBlockedBy, SPEC_BLOCKED_LABEL } from './blocked.js';
import { SPEC_LABEL } from './issue.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { createRoadmapReadings, parseRoadmapBody, skipSentence } from './roadmap.js';

/** The issue every blocked case reads: labelled, and waiting on #24. */
function issueOf(fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number: 57,
    title: 'Issue 57',
    body: '## What you get\n\nThe state reader.\n\nBlocked by: #24\n',
    state: 'OPEN',
    labels: [SPEC_LABEL, SPEC_BLOCKED_LABEL, SPEC_READY_LABEL],
    author: 'maintainer',
    ...fields,
  };
}

/** States answering each planted issue, and null for a number nobody planted. */
function plantedStates(held: Readonly<Record<number, 'OPEN' | 'CLOSED'>>): {
  states: ReturnType<typeof blockerStatesOf>;
  asked: () => readonly number[];
} {
  let asked: readonly number[] = [];
  return {
    states: (issue: number) => {
      asked = [...asked, issue];
      return Promise.resolve(held[issue] ?? null);
    },
    asked: () => asked,
  };
}

/** A reader over planted issues; a number nobody planted is a failed read. */
function plantedIssues(issues: readonly SpecIssue[]): (issue: number) => Promise<SpecIssue> {
  return (issue: number) => {
    const found = issues.find((planted) => planted.number === issue);
    return found === undefined
      ? Promise.reject(new Error(`no issue ${String(issue)} was planted`))
      : Promise.resolve(found);
  };
}

/** The readings a walk case drives: nothing closed, nothing taken. */
function roadmapReadings(issues: readonly SpecIssue[]): RoadmapReadings {
  return createRoadmapReadings({
    issues: plantedIssues(issues),
    branches: { refs: [], problems: [] },
    pullRequests: () => Promise.resolve([]),
  });
}

describe('what makes a roadmap line blocked', () => {
  it('reads an open blocker as a blocked line, and every blocker closed as none', async () => {
    const waiting = await readBlockedLine(issueOf(), plantedStates({ 24: 'OPEN' }).states);
    const cleared = await readBlockedLine(issueOf(), plantedStates({ 24: 'CLOSED' }).states);

    expect(waiting?.open).toEqual([24]);
    expect(waiting?.fault).toBeNull();
    expect(cleared).toBeNull();
  });

  it('reads an issue carrying no spec:blocked label as not blocked, whatever its body says', async () => {
    const planted = plantedStates({ 24: 'OPEN' });
    const read = await readBlockedLine(issueOf({ labels: [SPEC_LABEL] }), planted.states);

    expect(read).toBeNull();
    expect(planted.asked()).toEqual([]);
  });

  it('holds the line on a blocker whose state was not read, where a closed one clears it', async () => {
    const unread = await readBlockedLine(issueOf(), plantedStates({}).states);
    const closed = await readBlockedLine(issueOf(), plantedStates({ 24: 'CLOSED' }).states);

    expect(unread?.unread).toEqual([24]);
    expect(unread?.open).toEqual([]);
    expect(closed).toBeNull();
  });

  it('names every blocker the line named, open and closed alike, in line order', async () => {
    const body = 'Blocked by: #24 #26 #3\n';
    const held = plantedStates({ 24: 'CLOSED', 26: 'OPEN', 3: 'OPEN' });
    const read = await readBlockedLine(issueOf({ body }), held.states);

    expect(read?.blockers).toEqual([24, 26, 3]);
    expect(read?.open).toEqual([26, 3]);
    expect(held.asked()).toEqual([24, 26, 3]);
  });

  it('reads a line it cannot follow as blocked, carrying the fault it is reported with', async () => {
    const body = 'Blocked by: the API work\n';
    const read = await readBlockedLine(issueOf({ body }), plantedStates({}).states);

    expect(read?.fault).toBe(blockedFaultMessage(readBlockedBy(57, body)));
    expect(read?.open).toEqual([]);
  });
});

describe('the sentence a blocked line is named with', () => {
  it('is the spec wording: the issue, what it waits on, and that it is open', async () => {
    const read = await readBlockedLine(issueOf(), plantedStates({ 24: 'OPEN' }).states);

    expect(blockedLineSentence(read!)).toBe('#57 is blocked by #24 (open)');
  });

  it('says which blockers were not read, beside the ones held open', async () => {
    const held = plantedStates({ 26: 'OPEN' });
    const read = await readBlockedLine(issueOf({ body: 'Blocked by: #26 #24\n' }), held.states);

    expect(blockedLineSentence(read!)).toBe('#57 is blocked by #26 (open), #24 (state not read)');
  });

  it('is the fault report for a line that does not read', async () => {
    const body = 'Blocked by: #57\n';
    const read = await readBlockedLine(issueOf({ body }), plantedStates({}).states);

    expect(blockedLineSentence(read!)).toBe(blockedFaultMessage(readBlockedBy(57, body)));
  });
});

/** The roadmap every walk case reads, with the blocked line third. */
const ROADMAP_BODY = [
  '- [x] #17 the port, merged',
  '- [ ] #57 the state reader',
  '- [ ] #58 the ending hint',
  '- [ ] #59 the close-out',
].join('\n');

/** The lines of that roadmap, parsed. */
function roadmapLines(): readonly RoadmapLine[] {
  return parseRoadmapBody(ROADMAP_BODY);
}

/** The line of `ROADMAP_BODY` pointing at `issue`. */
function lineFor(issue: number): RoadmapLine {
  const found = roadmapLines().find((line) => line.issue === issue);
  if (found === undefined) throw new Error(`no roadmap line for #${String(issue)}`);
  return found;
}

/** The board a walk case reads: #57 blocked by an open #24, the rest plannable. */
function walkIssues(fields: Partial<Record<number, Partial<SpecIssue>>> = {}): readonly SpecIssue[] {
  const plain = (number: number): SpecIssue => issueOf({
    number,
    body: `## What you get\n\nIssue ${String(number)}.\n`,
    labels: [SPEC_LABEL, SPEC_READY_LABEL],
    ...fields[number],
  });
  return [
    issueOf({ number: 24, labels: [SPEC_LABEL], state: 'OPEN', ...fields[24] }),
    plain(17),
    issueOf({ ...fields[57] }),
    plain(58),
    plain(59),
  ];
}

/** The three readings over a planted board, as the walk takes them. */
function walkReadings(issues: readonly SpecIssue[]): ReturnType<typeof plannableReadings> {
  return plannableReadings({ issues: plantedIssues(issues), readings: roadmapReadings(issues) });
}

describe('the line offered in place of a blocked one', () => {
  it('is the first under it that is ready, not blocked and not taken', async () => {
    const pick = await pickPlannableLine(roadmapLines(), lineFor(57), walkReadings(walkIssues()));

    expect(pick.line?.issue).toBe(58);
    expect(pick.passed).toEqual([]);
  });

  it('passes over a line carrying no spec:ready label, where a labelled one is offered', async () => {
    const unready = walkIssues({ 58: { labels: [SPEC_LABEL] } });
    const passedOver = await pickPlannableLine(roadmapLines(), lineFor(57), walkReadings(unready));
    const labelled = await pickPlannableLine(roadmapLines(), lineFor(57), walkReadings(walkIssues()));

    expect(passedOver.line?.issue).toBe(59);
    expect(passedOver.passed.map((passed) => passed.sentence)).toEqual([notReadySentence(58)]);
    expect(labelled.line?.issue).toBe(58);
  });

  it('passes over a line that is itself blocked, naming what that one waits on', async () => {
    const blocked = walkIssues({
      58: { labels: [SPEC_LABEL, SPEC_READY_LABEL, SPEC_BLOCKED_LABEL], body: 'Blocked by: #24\n' },
    });
    const pick = await pickPlannableLine(roadmapLines(), lineFor(57), walkReadings(blocked));

    expect(pick.line?.issue).toBe(59);
    expect(pick.passed.map((passed) => passed.reason)).toEqual(['blocked']);
    expect(pick.passed[0]?.sentence).toBe('#58 is blocked by #24 (open)');
  });

  it('passes over a line the roadmap calls done or taken, with that walks own sentence', async () => {
    const issues = walkIssues({ 58: { state: 'CLOSED', labels: [SPEC_LABEL, SPEC_READY_LABEL] } });
    const readings = walkReadings(issues);
    const pick = await pickPlannableLine(roadmapLines(), lineFor(57), readings);
    const skip = await readings.skip(lineFor(58));

    expect(pick.line?.issue).toBe(59);
    expect(pick.passed.map((passed) => passed.sentence)).toEqual([skipSentence(skip!)]);
  });

  it('resumes under the blocked line, leaving every line above it where it is', async () => {
    const pick = await pickPlannableLine(roadmapLines(), lineFor(58), walkReadings(walkIssues()));

    expect(pick.line?.issue).toBe(59);
    expect(pick.passed).toEqual([]);
  });

  it('answers no line at all when every line under the blocked one is passed over', async () => {
    const none = walkIssues({ 58: { labels: [SPEC_LABEL] }, 59: { labels: [SPEC_LABEL] } });
    const pick = await pickPlannableLine(roadmapLines(), lineFor(57), walkReadings(none));

    expect(pick.line).toBeNull();
    expect(pick.passed.map((passed) => passed.line.issue)).toEqual([58, 59]);
  });
});

describe('the blocker states over a walks own reader', () => {
  it('answer each blockers state, and no state for one the board has no issue for', async () => {
    const states = blockerStatesOf(plantedIssues([issueOf({ number: 24, state: 'CLOSED' })]));

    expect(await states(24)).toBe('CLOSED');
    expect(await states(26)).toBeNull();
  });
});

describe('what a run says when it plans nothing', () => {
  it('asks about the alternative by number, the way every question here is spelled', () => {
    expect(alternativeQuestion(58)).toBe('Plan #58 instead? [y/N] ');
  });

  it('names the command that clears the block when the roadmap offers nothing else', () => {
    expect(noAlternativeMessage(57)).toContain('no line under #57 is ready, not blocked and not taken');
    expect(noAlternativeMessage(57)).toContain('rafa issue unblock 57');
  });

  it('names both ways forward when there is nobody to ask', () => {
    expect(unaskedMessage(57, 58)).toContain('#58 takes a yes and this run has nobody to ask');
    expect(unaskedMessage(57, 58)).toContain('rafa plan create --issue=58');
    expect(unaskedMessage(57, 58)).toContain('rafa issue unblock 57');
  });

  it('says the alternative was not planned when the answer was not yes', () => {
    expect(declinedMessage(58)).toBe('#58 was not planned, and nothing was written');
  });
});

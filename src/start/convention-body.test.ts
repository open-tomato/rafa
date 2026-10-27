/**
 * The plan's conventions section, as `start/convention-body.ts` writes it
 * into the open pull request's body after the delivery.
 *
 * Every case hands the plan's `bug_routes` rows in through the
 * `readRows` seam and the pull request port through
 * `createPullRequestsDouble`, which refuses and records any member a
 * case did not name. No case opens `.rafa/effort/` of this checkout or
 * spawns `gh`.
 *
 * The negative readings each carry their control: the body already
 * holding every line is not edited, beside the body lacking one that
 * is; the `none` provider builds no provider at all, beside the `gh`
 * reading that does; the plan with no `pr-body` row reads no provider,
 * beside the plan with one that does.
 */
import type { ConventionBodyInput, ConventionBodySeams } from './convention-body.js';
import type { PullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import type { BugRoute, BugRouteRow } from '@open-tomato/rafa/store/bug-routes';
import type { PrProviderReading, PullRequests } from '@open-tomato/rafa-pr/pr/index';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';

import { detail, PROVIDER_GH, PROVIDER_NONE, SUMMARY } from '../tests/release-stage-fixtures.js';

import {
  bodyWithConventions,
  CONVENTIONS_HEADING,
  conventionLine,
  conventionLines,
  writeConventionLines,
} from './convention-body.js';

afterEach(() => {
  setActiveOutput(null);
});

/** The plan every case writes for. */
const STUB = 'rafa-1077-demo';

/** The checkout every case writes from. */
const CHECKOUT = '/work/rafa';

let rowCount = 0;

/** One `bug_routes` row of the plan. */
function row(what: string, route: BugRoute = 'pr-body'): BugRouteRow {
  rowCount += 1;
  return {
    id: `row-${rowCount}`,
    sessionId: 'session-1',
    planStub: STUB,
    taskLine: 'Wire the loop',
    entryIndex: rowCount,
    what,
    said: 'convention',
    kind: 'convention',
    route,
    collectedAt: '2026-10-14T09:00:00.000Z',
  };
}

/** The lines the active output was handed, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
}

/** Sets a sink output as the active output, answering the lines it takes. */
function captureLines(): Lines {
  const lines: Lines = { info: [], warn: [], error: [] };
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.info.push(message);
    },
    warn: (message) => {
      lines.warn.push(message);
    },
    error: (message) => {
      lines.error.push(message);
    },
  }));
  return lines;
}

/** What one case runs over: the seams handed in, and what they recorded. */
interface World {
  readonly seams: ConventionBodySeams;
  readonly double: PullRequestsDouble;
  /** Every repo root the provider was built for. */
  readonly built: string[];
  /** Every repo root the provider reading was asked for. */
  readonly read: string[];
}

/** Seams over `rows`, a pull request whose body is `body`, and the `provider` reading. */
function world(
  rows: readonly BugRouteRow[],
  body: string,
  provider: PrProviderReading = PROVIDER_GH,
): World {
  const double = createPullRequestsDouble({
    findOpen: () => Promise.resolve(SUMMARY),
    get: () => Promise.resolve(detail(body)),
    editBody: () => Promise.resolve(),
  });
  const built: string[] = [];
  const read: string[] = [];
  const pulls = (repoRoot: string): PullRequests => {
    built.push(repoRoot);
    return double.pulls;
  };
  const readProvider = (repoRoot: string): PrProviderReading => {
    read.push(repoRoot);
    return provider;
  };
  return {
    seams: { readRows: () => rows, pulls, readProvider, env: {}, home: '/home/nobody' },
    double,
    built,
    read,
  };
}

/** What every case's write is handed. */
const INPUT: ConventionBodyInput = {
  repoRoot: CHECKOUT,
  checkout: CHECKOUT,
  branch: 'rafa-1077-demo',
  settings: { prerequisitesRequired: [], prerequisitesOptional: [] },
  planStub: STUB,
};

/** The bodies handed to `editBody`, in order. */
function editedBodies(double: PullRequestsDouble): string[] {
  return double.calls()
    .filter((call) => call.member === 'editBody')
    .map((call) => String(call.args[1]));
}

describe('conventionLines', () => {
  it('keeps the pr-body rows only, one line per text, in row order', () => {
    const rows = [
      row('src/start.ts is 917 lines'),
      row('a follow-up', 'follow-up'),
      row('src/start.ts is 917 lines'),
      row('a name off the pattern'),
    ];

    expect(conventionLines(rows)).toEqual(['- src/start.ts is 917 lines', '- a name off the pattern']);
  });

  it('escapes a line break and a marker so no entry opens a line of its own', () => {
    const line = conventionLine('too long\n## Heading <!-- x -->');

    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain('<!--');
  });

  it('redacts each text before the line is built', () => {
    const lines = conventionLines([row('a secret s3cr3t here')], (text) => text.replace('s3cr3t', '[redacted]'));

    expect(lines).toEqual(['- a secret [redacted] here']);
  });
});

describe('bodyWithConventions', () => {
  it('appends the section below a body that has none', () => {
    const next = bodyWithConventions('Closes #1\n\nSummary.\n', ['- one']);

    expect(next).toBe(`Closes #1\n\nSummary.\n\n${CONVENTIONS_HEADING}\n\n- one\n`);
  });

  it('adds the lines a section lacks below its last line, before the next heading', () => {
    const body = `Summary.\n\n${CONVENTIONS_HEADING}\n\n- one\n\n## Test plan\n\n- run it\n`;

    const next = bodyWithConventions(body, ['- one', '- two']);

    expect(next).toBe(`Summary.\n\n${CONVENTIONS_HEADING}\n\n- one\n- two\n\n## Test plan\n\n- run it\n`);
  });

  it('answers the body itself when the section holds every line', () => {
    const body = `Summary.\n\n${CONVENTIONS_HEADING}\n\n  - one\n- two\n`;

    expect(bodyWithConventions(body, ['- one', '- two'])).toBe(body);
  });

  it('does not take a line held outside the section for one held in it', () => {
    const body = `- one\n\n${CONVENTIONS_HEADING}\n`;

    expect(bodyWithConventions(body, ['- one'])).toBe(`- one\n\n${CONVENTIONS_HEADING}\n\n- one\n`);
  });
});

describe('writeConventionLines', () => {
  it('leaves an unchanged body alone: no edit is sent', async () => {
    const lines = captureLines();
    const body = `Summary.\n\n${CONVENTIONS_HEADING}\n\n- src/start.ts is 917 lines\n`;
    const held = world([row('src/start.ts is 917 lines')], body);

    const result = await writeConventionLines(INPUT, held.seams);

    expect(result.action).toBe('written');
    expect(result.action === 'written' && result.body.already).toBe(true);
    expect(held.double.sent()).toEqual([`findOpen ${INPUT.branch}`, `get ${SUMMARY.number}`]);
    expect(lines.info.join('\n')).toContain('already holds every line');
    expect(lines.warn).toEqual([]);
  });

  it('edits a body lacking the line, the control beside the unchanged one', async () => {
    captureLines();
    const lacking = world([row('src/start.ts is 917 lines')], 'Summary.\n');

    const result = await writeConventionLines(INPUT, lacking.seams);

    expect(result.action === 'written' && result.body.already).toBe(false);
    expect(editedBodies(lacking.double)).toEqual([`Summary.\n\n${CONVENTIONS_HEADING}\n\n- src/start.ts is 917 lines\n`]);
  });

  it('builds no provider under a none reading, and prints the lines', async () => {
    const lines = captureLines();
    const none = world([row('src/start.ts is 917 lines')], 'Summary.\n', PROVIDER_NONE);

    const result = await writeConventionLines(INPUT, none.seams);

    expect(none.read).toEqual([CHECKOUT]);
    expect(none.built).toEqual([]);
    expect(none.double.calls()).toEqual([]);
    expect(result.action === 'written' && result.body.carried).toBe(false);
    expect(lines.info.join('\n')).toContain('- src/start.ts is 917 lines');
    expect(lines.warn).toEqual([]);
  });

  it('builds the provider under a gh reading, the control beside none', async () => {
    captureLines();
    const gh = world([row('src/start.ts is 917 lines')], 'Summary.\n');

    await writeConventionLines(INPUT, gh.seams);

    expect(gh.built).toEqual([CHECKOUT]);
  });

  it('reads no provider and prints nothing for a plan with no pr-body row', async () => {
    const lines = captureLines();
    const empty = world([row('a leftover', 'follow-up'), row('a filed bug', 'filed')], 'Summary.\n');

    const result = await writeConventionLines(INPUT, empty.seams);

    expect(result).toEqual({ action: 'none' });
    expect(empty.read).toEqual([]);
    expect(empty.double.calls()).toEqual([]);
    expect(lines.info).toEqual([]);
    expect(lines.warn).toEqual([]);
  });

  it('reads no rows for a run with no plan stub', async () => {
    captureLines();
    let asked = 0;
    const seams: ConventionBodySeams = {
      ...world([], '').seams,
      readRows: () => {
        asked += 1;
        return [row('x')];
      },
    };

    const result = await writeConventionLines({ ...INPUT, planStub: null }, seams);

    expect(result).toEqual({ action: 'none' });
    expect(asked).toBe(0);
  });

  it('answers a store that cannot be read with one warning line, never a rejection', async () => {
    const lines = captureLines();
    const seams: ConventionBodySeams = {
      ...world([], '').seams,
      readRows: () => {
        throw new Error(`no store at ${CHECKOUT}/.rafa/effort`);
      },
    };

    const result = await writeConventionLines(INPUT, seams);

    expect(result.action).toBe('failed');
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).not.toContain(CHECKOUT);
  });

  it('warns once when no open pull request is found', async () => {
    const lines = captureLines();
    const base = world([row('src/start.ts is 917 lines')], '');
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(null) });

    const result = await writeConventionLines(INPUT, { ...base.seams, pulls: () => double.pulls });

    expect(result.action === 'written' && result.body.problem).toContain('no open pull request');
    expect(lines.warn).toHaveLength(1);
    expect(lines.error).toEqual([]);
  });
});

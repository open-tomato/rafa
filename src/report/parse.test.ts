/**
 * Tests for the task report parser.
 *
 * Every fixture is built from lines joined here, so a block's line
 * number can be counted off the fixture instead of trusted from the
 * module. Field cases put one report body in a short session output and
 * compare issues as `<reason> <field>` pairs, so the fixture spells out
 * which field an issue belongs to. The full text of an issue is pinned
 * only where the value it quotes is the point.
 *
 * Each case where no report is read has a near miss that is read: the
 * same output with only the thing the rule keys on changed. A parser
 * that answered absent for everything would pass each refusal alone and
 * fail its near miss.
 *
 * The CHARACTERIZATION cases pin parser behaviour the module note
 * describes as measured and cannot guard against. A parser change that
 * reddens one also says which sentence of the note went stale.
 *
 * Twenty-three module mutations were driven against this file, run
 * alone once per leg, with the unmutated module green before and after
 * them and restored byte-identical after each, and every one reddened at
 * least one case: the first report block read instead of the last; a
 * block of any kind read as a report; an unclosed block read; a fallback
 * to an earlier block, when the last is unclosed and when it is
 * malformed (one case each); a YAML error rethrown; a list read as a
 * mapping; every output answered absent (62 of 71 red, every near miss
 * among them); `failed` added to the statuses; a closed set accepting
 * any string; `signal` and `security` made optional; missing fields
 * reported only at the top level; a whitespace-only string accepted;
 * strings trimmed; feedback trimmed; numbers turned into strings; a
 * string taken for a boolean; a scalar wrapped into a one-entry list; a
 * non-mapping entry kept as an empty one; identical entries deduped;
 * extras dropped; and keys named after `Object.prototype` members
 * matched as fields. Six rows of the no-block table and the CRLF case
 * went red under none of them: what they pin is the block reader's
 * fence and line rules, which `plan/blocks.test.ts` drives.
 *
 * Seven more were driven on 2026-09-20, when `changes` joined the
 * report: the list never read and `changes` dropped from the key roster
 * (9 of 84 red each, the spec-example case among them, which sees the
 * key land in `extras`), `level` and `summary` each made optional (2
 * red each), `area` made required (1), `none` dropped from
 * `CHANGE_LEVELS` (2), and `changes` read before
 * `out_of_scope_bugs` (1, the issue-order case). The module was green
 * before and after, and restored byte-identical (sha256) after each.
 */
import type { ReportAbsent, ReportFinding, ReportPresent, ReportReading } from './parse.js';

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

import { INSTINCT_DOMAINS } from '../schema/instinct.js';

import {
  CHANGE_LEVELS,
  FINDING_DOMAINS,
  FINDING_KINDS,
  FINDING_SIGNALS,
  parseReport,
  REPORT_STATUSES,
} from './parse.js';

/** A bare backtick fence, spelled once. */
const FENCE = '```';

/** Joins lines into an output ending in a newline, as `claude -p` prints one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** A closed `rafa:report` block around `body`. */
function reportBlock(body: readonly string[]): string[] {
  return [`${FENCE}rafa:report`, ...body, FENCE];
}

/** The report, failing the case with the absence text when there is none. */
function presentOf(reading: ReportReading): ReportPresent {
  if (!reading.present) throw new Error(`expected a report, got ${reading.reason}: ${reading.text}`);
  return reading;
}

/** The absence, failing the case when a report was read instead. */
function absentOf(reading: ReportReading): ReportAbsent {
  if (reading.present) throw new Error('expected no report, but one was read');
  return reading;
}

/** A session output whose final message ends with a report of `body`. */
function reportOf(...body: string[]): ReportPresent {
  return presentOf(parseReport(doc('Done.', '', ...reportBlock(body))));
}

/** A finding's `trigger` and `what`, both required in every entry here. */
function textOf(finding: ReportFinding): readonly [string, string] {
  const { trigger, what } = finding;
  if (trigger === null || what === null) throw new Error('expected trigger and what, got null');
  return [trigger, what];
}

/** Issues as `<reason> <field>` pairs, in the order they were answered. */
function issuePairs(reading: ReportPresent): string[] {
  return reading.issues.map((issue) => `${issue.reason} ${issue.field}`);
}

/** The spec's own example body, which exercises every field once. */
const SPEC_BODY = [
  'status: done',
  'feedback: |',
  '  What was done and how it went, one block.',
  'findings:',
  '  - trigger: "when running bun test under a fresh worktree"',
  '    kind: gotcha',
  '    what: "node_modules is absent after fork"',
  '    cause: "worktree creation does not run bun install"',
  '    resolution: "run bun install before the first test"',
  '    artifact: "Cannot find package"',
  '    signal: loud',
  '    domain: testing',
  'skills_used: [progress-hygiene]',
  'blockers:',
  '  - what: "LINEAR_API_KEY unset"',
  '    artifact: "401 Unauthorized"',
  'out_of_scope_bugs:',
  '  - what: "..."',
  '    artifact: "..."',
  '    security: false',
  'changes:',
  '  - level: minor',
  '    area: "loop"',
  '    summary: "the task report carries change notes"',
];

/** A finding with every required field and nothing else, as body lines. */
function findingLines(trigger: string, what: string, extra: readonly string[] = []): string[] {
  return [
    `  - trigger: "${trigger}"`,
    '    kind: gotcha',
    `    what: "${what}"`,
    '    signal: loud',
    ...extra,
  ];
}

/** A change note with a level, an area and a summary, as body lines. */
function changeLines(level: string, summary: string, extra: readonly string[] = []): string[] {
  return [
    `  - level: ${level}`,
    '    area: "loop"',
    `    summary: "${summary}"`,
    ...extra,
  ];
}

/** A finding holding only its required fields. */
function bareFinding(trigger: string, what: string): ReportFinding {
  return {
    trigger,
    kind: 'gotcha',
    what,
    cause: null,
    resolution: null,
    artifact: null,
    signal: 'loud',
    domain: null,
    extras: [],
  };
}

describe('the report a session output ends with', () => {
  it('reads every field of the spec example, with no issue', () => {
    const output = doc('Implemented the module.', '', ...reportBlock(SPEC_BODY));
    const reading = presentOf(parseReport(output));

    expect(reading.report).toEqual({
      status: 'done',
      feedback: 'What was done and how it went, one block.\n',
      findings: [
        {
          trigger: 'when running bun test under a fresh worktree',
          kind: 'gotcha',
          what: 'node_modules is absent after fork',
          cause: 'worktree creation does not run bun install',
          resolution: 'run bun install before the first test',
          artifact: 'Cannot find package',
          signal: 'loud',
          domain: 'testing',
          extras: [],
        },
      ],
      skillsUsed: ['progress-hygiene'],
      blockers: [{ what: 'LINEAR_API_KEY unset', artifact: '401 Unauthorized', extras: [] }],
      outOfScopeBugs: [{ what: '...', artifact: '...', security: false, extras: [] }],
      changes: [{
        level: 'minor',
        area: 'loop',
        summary: 'the task report carries change notes',
        extras: [],
      }],
      extras: [],
    });
    expect(reading.issues).toEqual([]);
    expect(reading.block.span).toEqual({ first: 3, last: 3 + SPEC_BODY.length + 1 });
  });

  it('reads a CRLF output exactly like its LF twin', () => {
    const lf = doc('Done.', '', ...reportBlock(SPEC_BODY));

    expect(parseReport(lf.replaceAll('\n', '\r\n'))).toEqual(parseReport(lf));
  });

  it('names the closed sets the spec gives', () => {
    expect([...REPORT_STATUSES]).toEqual(['done', 'blocked']);
    expect([...FINDING_KINDS]).toEqual(['gotcha', 'pattern', 'location', 'skill-suggestion']);
    expect([...FINDING_SIGNALS]).toEqual(['loud', 'silent']);
    expect([...CHANGE_LEVELS]).toEqual(['patch', 'minor', 'major', 'none']);
  });
});

describe('an output holding no report block', () => {
  const NO_BLOCK: readonly (readonly [string, string])[] = [
    ['an empty output', ''],
    ['prose only', doc('Done. Nothing to report.')],
    ['a code fence in another language', doc(`${FENCE}yaml`, 'status: done', FENCE)],
    ['a plan block only', doc(`${FENCE}rafa:plan`, 'status: done', FENCE)],
    ['a report fence opened mid-line', doc(`The block goes here: ${FENCE}rafa:report`, 'status: done', FENCE)],
    ['a report fence in the wrong case', doc(`${FENCE}RAFA:report`, 'status: done', FENCE)],
    ['a report illustrated inside a longer fence', doc('````markdown', ...reportBlock(['status: done']), '````')],
  ];

  it.each(NO_BLOCK)('answers no-block for %s, without a block', (_name, output) => {
    const reading = absentOf(parseReport(output));

    expect(reading.reason).toBe('no-block');
    expect(reading.block).toBeNull();
    expect(reading.text).toBe('the session output holds no rafa:report block');
  });

  it('reads the near miss: the same report fence opening its own line', () => {
    const output = doc('The block goes here:', `${FENCE}rafa:report`, 'status: done', FENCE);

    expect(presentOf(parseReport(output)).report.status).toBe('done');
  });
});

describe('an output holding more than one report block', () => {
  const FIRST = reportBlock(['status: blocked']);
  const SECOND = reportBlock(['status: done']);

  it('reads the last block only', () => {
    const reading = presentOf(parseReport(doc('Draft:', ...FIRST, '', 'Final:', ...SECOND)));

    expect(reading.report.status).toBe('done');
    expect(reading.block.span.first).toBe(7);
  });

  it('reads by position, not content: swapped, the other block is last', () => {
    const reading = presentOf(parseReport(doc('Draft:', ...SECOND, '', 'Final:', ...FIRST)));

    expect(reading.report.status).toBe('blocked');
  });

  it('ignores blocks of other kinds after the last report', () => {
    const output = doc(...SECOND, `${FENCE}rafa:plan`, 'stub: x', FENCE);

    expect(presentOf(parseReport(output)).report.status).toBe('done');
  });

  it('answers the last block malformed rather than falling back to an earlier one', () => {
    const output = doc(...FIRST, '', ...reportBlock(['- status: done']));
    const reading = absentOf(parseReport(output));

    expect(reading.reason).toBe('malformed-block');
    expect(reading.block?.span.first).toBe(5);
  });

  it('answers an unclosed last block rather than falling back to an earlier one', () => {
    const output = doc(...SECOND, '', `${FENCE}rafa:report`, 'status: blocked');

    expect(absentOf(parseReport(output)).reason).toBe('unclosed-block');
  });
});

describe('a report block that cannot be read', () => {
  it('answers unclosed-block for a block never closed, carrying its raw body', () => {
    const output = doc('Done.', `${FENCE}rafa:report`, 'status: done', 'findings:');
    const reading = absentOf(parseReport(output));

    expect(reading).toEqual({
      present: false,
      reason: 'unclosed-block',
      block: { kind: 'report', body: 'status: done\nfindings:', span: { first: 2, last: 4 }, closed: false },
      text: 'rafa:report block at line 2 is never closed, so its body may have been cut short and is not read',
    });
  });

  it('reads the near miss: the same block closed', () => {
    const output = doc('Done.', `${FENCE}rafa:report`, 'status: done', 'findings:', FENCE);

    expect(presentOf(parseReport(output)).report.status).toBe('done');
  });

  it('answers malformed-block for a body that is not YAML, naming the line and the parser message', () => {
    const output = doc('Done.', ...reportBlock(['status: done', 'blockers:', '  - what: `bun test` failed']));
    const reading = absentOf(parseReport(output));

    expect(reading.reason).toBe('malformed-block');
    expect(reading.block?.body).toBe('status: done\nblockers:\n  - what: `bun test` failed');
    expect(reading.text).toStartWith('rafa:report block at line 2 is not valid YAML (');
    expect(reading.text).toContain('YAML Parse error');
  });

  it('reads the near miss: the same value quoted', () => {
    const reading = reportOf('status: done', 'blockers:', '  - what: "`bun test` failed"');

    expect(reading.report.blockers).toEqual([{ what: '`bun test` failed', artifact: null, extras: [] }]);
  });

  const NOT_A_MAPPING: readonly (readonly [string, readonly string[], string])[] = [
    ['an empty body', [], 'nothing'],
    ['a comment-only body', ['# nothing to report'], 'nothing'],
    ['a list', ['- status: done'], 'a list'],
    ['a prose sentence', ['All done, no findings.'], '"All done, no findings."'],
    ['a multi-document stream', ['status: done', '---', 'status: blocked'], 'a list'],
  ];

  it.each(NOT_A_MAPPING)('answers malformed-block for %s', (_name, body, described) => {
    const reading = absentOf(parseReport(doc(...reportBlock(body))));

    expect(reading.reason).toBe('malformed-block');
    expect(reading.text).toBe(`rafa:report block at line 1 holds ${described}, not a mapping of report fields`);
  });

  it('answers malformed-block for an alias that never resolves, rather than throwing', () => {
    const reading = absentOf(parseReport(doc(...reportBlock(['status: *done']))));

    expect(reading.reason).toBe('malformed-block');
  });
});

describe('the status and feedback fields', () => {
  it.each([...REPORT_STATUSES])('reads status %s', (status) => {
    const reading = reportOf(`status: ${status}`);

    expect(reading.report.status).toBe(status);
    expect(reading.issues).toEqual([]);
  });

  it('reports a missing status and still reads the rest', () => {
    const reading = reportOf('feedback: "Went fine."');

    expect(reading.report).toMatchObject({ status: null, feedback: 'Went fine.' });
    expect(reading.issues).toEqual([
      { reason: 'missing-field', field: 'status', text: 'status is missing' },
    ]);
  });

  it('reports a status key with no value as missing', () => {
    expect(issuePairs(reportOf('status:'))).toEqual(['missing-field status']);
  });

  it.each(['failed', 'done | blocked', 'Done'])('refuses status %s, leaving it null', (status) => {
    const reading = reportOf(`status: ${status}`);

    expect(reading.report.status).toBeNull();
    expect(reading.issues).toEqual([{
      reason: 'unusable-field',
      field: 'status',
      text: `status is ${JSON.stringify(status)}, not one of done, blocked`,
    }]);
  });

  it('keeps feedback as parsed, trailing newline of a literal block included', () => {
    const reading = reportOf('status: done', 'feedback: |', '  Line one.', '  Line two.');

    expect(reading.report.feedback).toBe('Line one.\nLine two.\n');
  });

  it('refuses feedback that is not a string', () => {
    const reading = reportOf('status: done', 'feedback: [one, two]');

    expect(reading.report.feedback).toBeNull();
    expect(reading.issues.map((issue) => issue.text)).toEqual(['feedback is a list, not a string; quote it']);
  });
});

describe('the findings list', () => {
  it('reads an absent or null findings key as empty, without an issue', () => {
    expect(reportOf('status: done').report.findings).toEqual([]);
    expect(reportOf('status: done', 'findings:').report.findings).toEqual([]);
    expect(reportOf('status: done', 'findings:').issues).toEqual([]);
  });

  it.each([
    ['a scalar', 'findings: node_modules is absent after fork', '"node_modules is absent after fork"'],
    ['a mapping', 'findings: { trigger: x }', 'a mapping'],
  ])('reads findings holding %s as empty, and reports it', (_name, line, described) => {
    const reading = reportOf('status: done', line);

    expect(reading.report.findings).toEqual([]);
    expect(reading.issues).toEqual([{
      reason: 'unusable-field',
      field: 'findings',
      text: `findings is ${described}, not a list`,
    }]);
  });

  it('carries every entry in order, identical and same-artifact entries included', () => {
    const artifact = ['    artifact: "Cannot find package"'];
    const reading = reportOf(
      'status: done',
      'findings:',
      ...findingLines('a', 'first'),
      ...findingLines('a', 'first'),
      ...findingLines('b', 'second', artifact),
      ...findingLines('c', 'third', artifact),
    );

    expect(reading.report.findings.map((finding) => [finding.trigger, finding.what, finding.artifact])).toEqual([
      ['a', 'first', null],
      ['a', 'first', null],
      ['b', 'second', 'Cannot find package'],
      ['c', 'third', 'Cannot find package'],
    ]);
    expect(reading.issues).toEqual([]);
  });

  it('drops an entry that is not a mapping, keeping its neighbours in order', () => {
    const reading = reportOf(
      'status: done',
      'findings:',
      ...findingLines('a', 'first'),
      '  - "node_modules is absent"',
      '  -',
      ...findingLines('b', 'second'),
    );

    expect(reading.report.findings).toEqual([bareFinding('a', 'first'), bareFinding('b', 'second')]);
    expect(reading.issues).toEqual([
      {
        reason: 'unusable-field',
        field: 'findings[1]',
        text: 'findings[1] is "node_modules is absent", not a mapping of '
          + 'trigger, kind, what, cause, resolution, artifact, signal, domain; dropped',
      },
      {
        reason: 'unusable-field',
        field: 'findings[2]',
        text: 'findings[2] is nothing, not a mapping of '
          + 'trigger, kind, what, cause, resolution, artifact, signal, domain; dropped',
      },
    ]);
  });

  it('reports each missing required field in field order, and no optional one', () => {
    const reading = reportOf('status: done', 'findings:', '  - cause: "only a cause"');

    expect(reading.report.findings).toEqual([{
      trigger: null,
      kind: null,
      what: null,
      cause: 'only a cause',
      resolution: null,
      artifact: null,
      signal: null,
      domain: null,
      extras: [],
    }]);
    expect(issuePairs(reading)).toEqual([
      'missing-field findings[0].trigger',
      'missing-field findings[0].kind',
      'missing-field findings[0].what',
      'missing-field findings[0].signal',
    ]);
  });

  it.each([...FINDING_KINDS])('reads kind %s', (kind) => {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w').map((line) => line.replace('gotcha', kind)));

    expect(reading.report.findings[0]?.kind).toBe(kind);
    expect(reading.issues).toEqual([]);
  });

  it.each([...FINDING_SIGNALS])('reads signal %s', (signal) => {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w').map((line) => line.replace('loud', signal)));

    expect(reading.report.findings[0]?.signal).toBe(signal);
    expect(reading.issues).toEqual([]);
  });

  it('refuses a kind and a signal outside their sets, keeping the entry', () => {
    const lines = findingLines('t', 'w')
      .map((line) => line.replace('gotcha', 'antipattern').replace('loud', 'quiet'));
    const reading = reportOf('status: done', 'findings:', ...lines);

    expect(reading.report.findings[0]).toMatchObject({ trigger: 't', kind: null, what: 'w', signal: null });
    expect(reading.issues.map((issue) => issue.text)).toEqual([
      'findings[0].kind is "antipattern", not one of gotcha, pattern, location, skill-suggestion',
      'findings[0].signal is "quiet", not one of loud, silent',
    ]);
  });

  it.each([...FINDING_DOMAINS])('reads domain %s', (domain) => {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w', [`    domain: ${domain}`]));

    expect(reading.report.findings[0]?.domain).toBe(domain);
    expect(reading.issues).toEqual([]);
  });

  it('reads an absent domain as null, with no issue', () => {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w'));

    expect(reading.report.findings[0]?.domain).toBeNull();
    expect(reading.report.findings[0]?.extras).toEqual([]);
    expect(reading.issues).toEqual([]);
  });

  it.each([
    ['a word outside the set', 'general', '"general"'],
    ['a domain in another case', 'Testing', '"Testing"'],
    ['a number', '42', 'the number 42'],
  ])('refuses %s as a domain, keeping the entry', (_label, value, quoted) => {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w', [`    domain: ${value}`]));

    expect(reading.report.findings[0]).toMatchObject({ trigger: 't', what: 'w', signal: 'loud', domain: null });
    expect(reading.report.findings[0]?.extras).toEqual([]);
    expect(reading.issues).toEqual([{
      reason: 'unusable-field',
      field: 'findings[0].domain',
      text: `findings[0].domain is ${quoted}, not one of ${INSTINCT_DOMAINS.join(', ')}`,
    }]);
  });

  it('reads findings against the same domains an instinct record takes', () => {
    expect(FINDING_DOMAINS).toBe(INSTINCT_DOMAINS);
  });
});

describe('string fields', () => {
  /** The artifact the body's single finding answers, and the issues. */
  function artifactOf(line: string): readonly [string | null, string[]] {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w', [`    artifact: ${line}`]));
    return [reading.report.findings[0]?.artifact ?? null, reading.issues.map((issue) => issue.text)];
  }

  it('keeps a string exactly as written, surrounding spaces included', () => {
    expect(artifactOf('"  Cannot find package  "')).toEqual(['  Cannot find package  ', []]);
  });

  it('reads an explicit null as absent, without an issue', () => {
    expect(artifactOf('null')).toEqual([null, []]);
  });

  it.each([
    ['a blank string', '"   "', 'findings[0].artifact is blank'],
    ['an unquoted number', '404', 'findings[0].artifact is the number 404, not a string; quote it'],
    ['a number written with a leading zero', '0042', 'findings[0].artifact is the number 42, not a string; quote it'],
    ['a boolean', 'true', 'findings[0].artifact is the boolean true, not a string; quote it'],
  ])('refuses %s, leaving it null', (_name, line, text) => {
    expect(artifactOf(line)).toEqual([null, [text]]);
  });

  it('reads the near miss: the number quoted', () => {
    expect(artifactOf('"0042"')).toEqual(['0042', []]);
  });

  it('CHARACTERIZATION: a # after a space silently cuts an unquoted value short', () => {
    expect(artifactOf('error #42 happened')).toEqual(['error', []]);
    expect(artifactOf('"error #42 happened"')).toEqual(['error #42 happened', []]);
  });
});

describe('the skills_used list', () => {
  it('reads each skill in order', () => {
    const reading = reportOf('status: done', 'skills_used: [progress-hygiene, dev-planner]');

    expect(reading.report.skillsUsed).toEqual(['progress-hygiene', 'dev-planner']);
    expect(reading.issues).toEqual([]);
  });

  it('reads a scalar as empty, and reports it', () => {
    const reading = reportOf('status: done', 'skills_used: progress-hygiene');

    expect(reading.report.skillsUsed).toEqual([]);
    expect(issuePairs(reading)).toEqual(['unusable-field skills_used']);
  });

  it('drops an entry that is no usable string, keeping the rest', () => {
    const reading = reportOf('status: done', 'skills_used: [dev-planner, 42, "  ", git-workflow]');

    expect(reading.report.skillsUsed).toEqual(['dev-planner', 'git-workflow']);
    expect(reading.issues.map((issue) => issue.text)).toEqual([
      'skills_used[1] is the number 42, not a string; quote it; dropped',
      'skills_used[2] is blank; dropped',
    ]);
  });
});

describe('the blockers and out_of_scope_bugs lists', () => {
  it('reads a blocker without an artifact, and reports one without what', () => {
    const reading = reportOf(
      'status: blocked',
      'blockers:',
      '  - what: "LINEAR_API_KEY unset"',
      '  - artifact: "401 Unauthorized"',
    );

    expect(reading.report.blockers).toEqual([
      { what: 'LINEAR_API_KEY unset', artifact: null, extras: [] },
      { what: null, artifact: '401 Unauthorized', extras: [] },
    ]);
    expect(issuePairs(reading)).toEqual(['missing-field blockers[1].what']);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['False', false],
  ])('reads security %s as a boolean', (written, expected) => {
    const reading = reportOf('status: done', 'out_of_scope_bugs:', '  - what: "bug"', `    security: ${written}`);

    expect(reading.report.outOfScopeBugs[0]?.security).toBe(expected);
    expect(reading.issues).toEqual([]);
  });

  it.each([
    ['"false"', '"false"'],
    ['yes', '"yes"'],
    ['0', 'the number 0'],
  ])('refuses security %s rather than guessing a boolean', (written, described) => {
    const reading = reportOf('status: done', 'out_of_scope_bugs:', '  - what: "bug"', `    security: ${written}`);

    expect(reading.report.outOfScopeBugs[0]?.security).toBeNull();
    expect(reading.issues.map((issue) => issue.text)).toEqual([
      `out_of_scope_bugs[0].security is ${described}, not true or false; write it unquoted`,
    ]);
  });

  it('reports a missing security flag instead of defaulting it to false', () => {
    const reading = reportOf('status: done', 'out_of_scope_bugs:', '  - what: "bug"');

    expect(reading.report.outOfScopeBugs).toEqual([{ what: 'bug', artifact: null, security: null, extras: [] }]);
    expect(issuePairs(reading)).toEqual(['missing-field out_of_scope_bugs[0].security']);
  });

  it('drops an entry that is not a mapping from either list', () => {
    const reading = reportOf('status: done', 'blockers: [unset key]', 'out_of_scope_bugs: [a bug]');

    expect(reading.report).toMatchObject({ blockers: [], outOfScopeBugs: [] });
    expect(issuePairs(reading)).toEqual(['unusable-field blockers[0]', 'unusable-field out_of_scope_bugs[0]']);
  });
});

describe('the changes list', () => {
  it.each([...CHANGE_LEVELS])('reads level %s, with the area and summary beside it', (level) => {
    const reading = reportOf('status: done', 'changes:', ...changeLines(level, 'loop pause waits for a commit'));

    expect(reading.report.changes).toEqual([
      { level, area: 'loop', summary: 'loop pause waits for a commit', extras: [] },
    ]);
    expect(reading.issues).toEqual([]);
  });

  it('reads a note with no area, leaving it null and reporting nothing', () => {
    const reading = reportOf(
      'status: done',
      'changes:',
      '  - level: patch',
      '    summary: "rafa release tag prints the publish line"',
    );

    expect(reading.report.changes).toEqual([{
      level: 'patch',
      area: null,
      summary: 'rafa release tag prints the publish line',
      extras: [],
    }]);
    expect(reading.issues).toEqual([]);
  });

  it('carries every entry in order, identical entries included', () => {
    const reading = reportOf(
      'status: done',
      'changes:',
      ...changeLines('patch', 'first'),
      ...changeLines('patch', 'first'),
      ...changeLines('major', 'second'),
      ...changeLines('none', 'third'),
    );

    expect(reading.report.changes.map((change) => [change.level, change.summary])).toEqual([
      ['patch', 'first'],
      ['patch', 'first'],
      ['major', 'second'],
      ['none', 'third'],
    ]);
    expect(reading.issues).toEqual([]);
  });

  it('reports a missing level and summary in field order, keeping the entry', () => {
    const reading = reportOf('status: done', 'changes:', '  - area: "loop"');

    expect(reading.report.changes).toEqual([{ level: null, area: 'loop', summary: null, extras: [] }]);
    expect(issuePairs(reading)).toEqual([
      'missing-field changes[0].level',
      'missing-field changes[0].summary',
    ]);
  });

  it('reads an absent or null changes key as empty, without an issue', () => {
    expect(reportOf('status: done').report.changes).toEqual([]);
    expect(reportOf('status: done', 'changes:').report.changes).toEqual([]);
    expect(reportOf('status: done', 'changes:').issues).toEqual([]);
  });

  it.each([
    ['a scalar', 'changes: the loop waits for a commit', '"the loop waits for a commit"'],
    ['a mapping', 'changes: { level: patch }', 'a mapping'],
  ])('reads changes holding %s as empty, and reports it', (_name, line, described) => {
    const reading = reportOf('status: done', line);

    expect(reading.report.changes).toEqual([]);
    expect(reading.issues).toEqual([{
      reason: 'unusable-field',
      field: 'changes',
      text: `changes is ${described}, not a list`,
    }]);
  });

  it('drops an entry that is not a mapping, keeping its neighbours in order', () => {
    const reading = reportOf(
      'status: done',
      'changes:',
      ...changeLines('patch', 'first'),
      '  - "the loop waits for a commit"',
      '  -',
      ...changeLines('minor', 'second'),
    );

    expect(reading.report.changes).toEqual([
      { level: 'patch', area: 'loop', summary: 'first', extras: [] },
      { level: 'minor', area: 'loop', summary: 'second', extras: [] },
    ]);
    expect(reading.issues).toEqual([
      {
        reason: 'unusable-field',
        field: 'changes[1]',
        text: 'changes[1] is "the loop waits for a commit", not a mapping of level, area, summary; dropped',
      },
      {
        reason: 'unusable-field',
        field: 'changes[2]',
        text: 'changes[2] is nothing, not a mapping of level, area, summary; dropped',
      },
    ]);
  });

  it('refuses a level outside the closed set, keeping the entry', () => {
    const reading = reportOf('status: done', 'changes:', '  - level: breaking', '    summary: "big change"');

    expect(reading.report.changes[0]).toMatchObject({ level: null, summary: 'big change' });
    expect(reading.issues.map((issue) => issue.text)).toEqual([
      'changes[0].level is "breaking", not one of patch, minor, major, none',
    ]);
  });

  it('refuses a blank summary, leaving it null', () => {
    const reading = reportOf('status: done', 'changes:', '  - level: patch', '    summary: "   "');

    expect(reading.report.changes[0]?.summary).toBeNull();
    expect(reading.issues.map((issue) => issue.text)).toEqual(['changes[0].summary is blank']);
  });

  it('retains an unknown key inside a change entry as its extra', () => {
    const reading = reportOf('status: done', 'changes:', ...changeLines('patch', 'first', ['    pr: 42']));

    expect(reading.report.changes[0]?.extras).toEqual([{ key: 'pr', value: 42 }]);
    expect(reading.issues).toEqual([]);
  });

  it('answers its issues after the lists written above it', () => {
    const reading = reportOf(
      'status: done',
      'changes:',
      '  - area: "loop"',
      'out_of_scope_bugs:',
      '  - artifact: "401 Unauthorized"',
    );

    expect(issuePairs(reading)).toEqual([
      'missing-field out_of_scope_bugs[0].what',
      'missing-field out_of_scope_bugs[0].security',
      'missing-field changes[0].level',
      'missing-field changes[0].summary',
    ]);
  });
});

describe('keys the parser does not know', () => {
  it('retains an unknown key at every level, in extras, without an issue', () => {
    const reading = reportOf(
      'status: done',
      'confidence: 0.9',
      'findings:',
      ...findingLines('t', 'w', ['    seen: [2, 3]']),
      'blockers:',
      '  - what: "stuck"',
      '    owner: ops',
      'out_of_scope_bugs:',
      '  - what: "bug"',
      '    security: false',
      '    severity: low',
    );

    expect(reading.report.extras).toEqual([{ key: 'confidence', value: 0.9 }]);
    expect(reading.report.findings[0]?.extras).toEqual([{ key: 'seen', value: [2, 3] }]);
    expect(reading.report.blockers[0]?.extras).toEqual([{ key: 'owner', value: 'ops' }]);
    expect(reading.report.outOfScopeBugs[0]?.extras).toEqual([{ key: 'severity', value: 'low' }]);
    expect(reading.issues).toEqual([]);
  });

  it('retains keys named after Object.prototype members as extras, never matching them', () => {
    const reading = reportOf('status: done', '__proto__: 1', 'constructor: 2', 'toString: 3');

    expect(reading.report.extras).toEqual([
      { key: '__proto__', value: 1 },
      { key: 'constructor', value: 2 },
      { key: 'toString', value: 3 },
    ]);
    expect(reading.issues).toEqual([]);
  });

  it('reads a misspelled required key as an extra and the field as missing', () => {
    const reading = reportOf('status: done', 'findings:', ...findingLines('t', 'w').map((line) => line.replace('signal', 'signl')));

    expect(reading.report.findings[0]).toMatchObject({ signal: null, extras: [{ key: 'signl', value: 'loud' }] });
    expect(issuePairs(reading)).toEqual(['missing-field findings[0].signal']);
  });
});

describe('the final message a real session ended with', () => {
  /**
   * A real `claude -p --dangerously-skip-permissions` invocation's raw
   * stdout, captured once and frozen at `testdata/live-session-report.txt`
   * — not a fixture built by hand like every block above. The prompt
   * asked for seven distinct findings and told the model not to merge or
   * summarise any of them into fewer entries. What follows reads that
   * answer back through the real parser and checks the whole findings
   * list survived, entry for entry, against the raw text rather than
   * against a copy of what the parser itself already says.
   */
  const output = readFileSync(new URL('./testdata/live-session-report.txt', import.meta.url), 'utf8');
  const reading = presentOf(parseReport(output));

  const EXPECTED_FINDINGS: ReportFinding[] = [
    {
      trigger: 'Running bun test in a freshly created git worktree',
      kind: 'gotcha',
      what: 'bun test fails in a fresh worktree because node_modules is missing',
      cause: 'Creating a git worktree does not run an install step',
      resolution: 'Run `bun install` in the worktree before `bun test`',
      artifact: 'Cannot find package',
      signal: 'loud',
      domain: null,
      extras: [],
    },
    {
      trigger: 'Writing boolean values into a column guarded by a CHECK constraint',
      kind: 'gotcha',
      what: 'bun:sqlite binds JS true/false as 1/0, so `CHECK (x IN (0, 1))` accepts a boolean never validated as one in app code',
      cause: 'bun:sqlite coerces JavaScript booleans to the integers 1 and 0 when binding',
      resolution: 'Validate boolean inputs in application code; do not rely on the CHECK constraint',
      artifact: null,
      signal: 'loud',
      domain: null,
      extras: [],
    },
    {
      trigger: 'Reading update functions across the codebase',
      kind: 'pattern',
      what: 'Existing objects are never mutated; every update function returns a new object via spread syntax',
      cause: null,
      resolution: null,
      artifact: null,
      signal: 'silent',
      domain: null,
      extras: [],
    },
    {
      trigger: 'Exiting a `Statement.iterate()` loop early with break',
      kind: 'gotcha',
      what: 'Breaking out of `Statement.iterate()` early in bun:sqlite leaves the cached statement broken for the next call',
      cause: null,
      resolution: null,
      artifact: 'bad parameter or other API misuse',
      signal: 'loud',
      domain: null,
      extras: [],
    },
    {
      trigger: 'Locating the code under test for the report parser',
      kind: 'location',
      what: 'Task report parser is at `src/report/parse.ts`, with colocated tests in `src/report/parse.test.ts`',
      cause: null,
      resolution: null,
      artifact: null,
      signal: 'silent',
      domain: null,
      extras: [],
    },
    {
      trigger: 'Scoping which fixtures the characterization tests should use',
      kind: 'skill-suggestion',
      what: 'A skill for writing characterization tests against real model-generated fixtures, not only hand-authored ones, would have scoped this task faster',
      cause: null,
      resolution: null,
      artifact: null,
      signal: 'silent',
      domain: null,
      extras: [],
    },
    {
      trigger: 'Writing this YAML report with inline code references',
      kind: 'gotcha',
      what: 'A string containing a backtick, such as an inline reference to `bun test`, must be double-quoted in YAML',
      cause: 'An unquoted backtick is a reserved YAML indicator',
      resolution: 'Wrap any value containing a backtick, colon, or other special character in double quotes',
      artifact: null,
      signal: 'silent',
      domain: null,
      extras: [],
    },
  ];

  it('reads the block cleanly, with no issue', () => {
    expect(reading.report.status).toBe('done');
    expect(reading.issues).toEqual([]);
  });

  it('counts the same number of findings the raw block lists, by an independent count of trigger lines', () => {
    const triggerLines = output.match(/^ {2}- trigger:/gm) ?? [];

    expect(triggerLines).toHaveLength(EXPECTED_FINDINGS.length);
    expect(reading.report.findings).toHaveLength(triggerLines.length);
  });

  it('carries every finding entry for entry, in order, none merged and none dropped', () => {
    expect(reading.report.findings).toEqual(EXPECTED_FINDINGS);
  });

  it('keeps every finding exactly as written, not paraphrased or shortened', () => {
    for (const finding of EXPECTED_FINDINGS) {
      const [trigger, what] = textOf(finding);
      expect(output).toContain(trigger);
      expect(output).toContain(what);
    }
  });

  it('reads the skills, the empty blockers list and the out-of-scope bug the block carries', () => {
    expect(reading.report.skillsUsed).toEqual([
      'superpowers:test-driven-development',
      'superpowers:verification-before-completion',
    ]);
    expect(reading.report.blockers).toEqual([]);
    expect(reading.report.outOfScopeBugs).toEqual([
      {
        what: 'Early break from a `Statement.iterate()` loop in an existing query helper poisons its cached statement',
        artifact: 'bad parameter or other API misuse',
        security: false,
        extras: [],
      },
    ]);
  });
});

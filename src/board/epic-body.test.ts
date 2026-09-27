/**
 * Tests for the epic body reader (`src/board/epic-body.ts`): the
 * acceptance criteria, the estimate, the date, the `Owns:` folders and
 * the ordered checklist, and the problems a badly written body answers.
 *
 * Every case is a pure call over a literal body; the module spawns
 * nothing and opens nothing.
 *
 * ## The controls
 *
 * Three readings the task names could pass while wrong, so each is paired
 * with one that must read the other way:
 *
 *  - The fenced example checklist is planted beside a real checklist in
 *    one body and alone in another. A reader that ignored fences would
 *    answer the example's lines in both; the real-only reading and the
 *    fenced-only body's empty list are the pair.
 *  - The malformed dates are read beside a well-formed one, so a reader
 *    that refused every date, or answered null always, fails the control.
 *  - The missing criteria section is read beside the full body, which
 *    must carry no problem at all; a reader that always reported the
 *    section would pass the missing case alone.
 */
import { describe, expect, it } from 'bun:test';

import {
  epicBodyProblemMessage,
  readEpicBody,
} from './epic-body.js';

/** A body carrying every part, as the module note shows it. */
const FULL = [
  '## Acceptance criteria',
  '',
  '- `rafa roadmap` lists epics grouped by horizon.',
  '- No command but `--full` mixes two epics.',
  '',
  '## Plan',
  '',
  'Estimate: two weeks',
  'Date: 2026-10-31',
  'Owns: src/board/, src/commands/epics.ts',
  '',
  '- [ ] #245 the listing',
  '- [x] #246 the model',
].join('\n');

describe('readEpicBody', () => {
  it('reads every part of a full body and reports no problem', () => {
    const read = readEpicBody(FULL);

    expect(read.criteria).toBe('- `rafa roadmap` lists epics grouped by horizon.\n- No command but `--full` mixes two epics.');
    expect(read.estimate).toBe('two weeks');
    expect(read.date).toBe('2026-10-31');
    expect(read.owns).toEqual(['src/board/', 'src/commands/epics.ts']);
    expect(read.lines.map((line) => [line.issue, line.ticked, line.why])).toEqual([
      [245, false, 'the listing'],
      [246, true, 'the model'],
    ]);
    expect(read.problems).toEqual([]);
  });

  it('keeps the checklist line numbers parseRoadmapBody gives', () => {
    expect(readEpicBody(FULL).lines.map((line) => line.lineNumber)).toEqual([12, 13]);
  });
});

describe('a missing section', () => {
  it('reads no criteria and reports it when the heading is absent', () => {
    const read = readEpicBody(FULL.replace('## Acceptance criteria', '## Why'));

    expect(read.criteria).toBeNull();
    expect(read.problems).toEqual([{ kind: 'no-criteria', line: null, text: null }]);
    expect(read.estimate).toBe('two weeks');
    expect(read.lines).toHaveLength(2);
  });

  it('reports a heading with nothing under it, naming its line', () => {
    const read = readEpicBody('Estimate: a day\n\n## Acceptance criteria\n\n## Specs\n- [ ] #3');

    expect(read.criteria).toBeNull();
    expect(read.problems).toEqual([{ kind: 'no-criteria', line: 3, text: '' }]);
  });

  it('reports every part absent from an empty body, date and owns not among them', () => {
    const read = readEpicBody('');

    expect(read.problems.map((problem) => problem.kind)).toEqual(['no-criteria', 'no-estimate']);
    expect(read.date).toBeNull();
    expect(read.owns).toEqual([]);
    expect(read.lines).toEqual([]);
  });

  it('reads a blank estimate as none, keeping its line', () => {
    const read = readEpicBody(FULL.replace('Estimate: two weeks', 'Estimate:   '));

    expect(read.estimate).toBeNull();
    expect(read.problems).toEqual([{ kind: 'no-estimate', line: 8, text: '' }]);
  });
});

describe('the criteria section', () => {
  it('ends at the next heading of its level or higher, and runs through a deeper one', () => {
    const body = '## Acceptance criteria:\nfirst\n### Detail\nsecond\n# Top\nafter';

    expect(readEpicBody(body).criteria).toBe('first\n### Detail\nsecond');
  });

  it('runs to the end of the body when no heading follows', () => {
    expect(readEpicBody('text\n### acceptance CRITERIA\n\nonly this\n').criteria).toBe('only this');
  });

  it('keeps a fenced heading inside the criteria and never starts at one', () => {
    const body = [
      '```markdown',
      '## Acceptance criteria',
      'the example',
      '```',
      '## Acceptance criteria',
      'real',
      '```',
      '## Not a heading',
      '```',
      'still real',
      '## Next',
    ].join('\n');

    expect(readEpicBody(body).criteria).toBe('real\n```\n## Not a heading\n```\nstill real');
  });
});

describe('the date', () => {
  it('reads a well-formed day', () => {
    const read = readEpicBody(FULL.replace('2026-10-31', '2024-02-29'));

    expect(read.date).toBe('2024-02-29');
    expect(read.problems).toEqual([]);
  });

  it.each([
    ['2026-02-30'],
    ['2025-02-29'],
    ['2026-13-01'],
    ['2026-10-1'],
    ['31/10/2026'],
    ['next week'],
    [''],
  ])('reads %p as no date and reports it by line', (written) => {
    const read = readEpicBody(FULL.replace('2026-10-31', written));

    expect(read.date).toBeNull();
    expect(read.problems).toEqual([{ kind: 'malformed-date', line: 9, text: written }]);
  });

  it('reports nothing when the optional date is absent', () => {
    const read = readEpicBody(FULL.replace('Date: 2026-10-31\n', ''));

    expect(read.date).toBeNull();
    expect(read.problems).toEqual([]);
  });
});

describe('the field lines', () => {
  it('reads a dressed, bulleted, case-folded field', () => {
    const read = readEpicBody('- **estimate:** three days\n* _Date_: 2026-01-05\n   OWNS: `src/a/`,`src/b/` src/a/');

    expect(read.estimate).toBe('three days');
    expect(read.date).toBe('2026-01-05');
    expect(read.owns).toEqual(['src/a/', 'src/b/']);
  });

  it('reads the first field line and leaves a second alone', () => {
    const read = readEpicBody('Estimate: first\nEstimate: second\nDate: 2026-01-01\nDate: soon');

    expect(read.estimate).toBe('first');
    expect(read.date).toBe('2026-01-01');
  });

  it('skips a field line inside a fence', () => {
    const read = readEpicBody('```\nEstimate: example\nDate: 2000-01-01\nOwns: src/x/\n```\nEstimate: real');

    expect(read.estimate).toBe('real');
    expect(read.date).toBeNull();
    expect(read.owns).toEqual([]);
  });

  it('never reads a longer word as the field', () => {
    const read = readEpicBody('Dated: 2026-01-01\nEstimated: soon\nOwnsership: src/');

    expect(read.date).toBeNull();
    expect(read.estimate).toBeNull();
    expect(read.owns).toEqual([]);
  });

  it('reads an empty Owns line as no folders and no problem', () => {
    const read = readEpicBody(FULL.replace('Owns: src/board/, src/commands/epics.ts', 'Owns:'));

    expect(read.owns).toEqual([]);
    expect(read.problems).toEqual([]);
  });

  it('reads CRLF bodies line for line, the criteria rejoined with \\n', () => {
    const read = readEpicBody(FULL.replaceAll('\n', '\r\n'));

    expect(read.date).toBe('2026-10-31');
    expect(read.criteria).toBe('- `rafa roadmap` lists epics grouped by horizon.\n- No command but `--full` mixes two epics.');
    expect(read.problems).toEqual([]);
  });
});

describe('a fenced example checklist', () => {
  const example = ['```markdown', '- [ ] #1 an example', '- [ ] #2 another', '```'].join('\n');

  it('is not read beside the real checklist', () => {
    const read = readEpicBody(`${example}\n${FULL}`);

    expect(read.lines.map((line) => line.issue)).toEqual([245, 246]);
  });

  it('is not read when it is the only checklist', () => {
    expect(readEpicBody(example).lines).toEqual([]);
  });

  it('is read once the fence is gone, which is the control', () => {
    const unfenced = example.split('\n').slice(1, -1)
      .join('\n');

    expect(readEpicBody(unfenced).lines.map((line) => line.issue)).toEqual([1, 2]);
  });
});

describe('epicBodyProblemMessage', () => {
  it('names a malformed date by line and text', () => {
    expect(epicBodyProblemMessage(12, { kind: 'malformed-date', line: 9, text: '2026-02-30' })).toBe(
      'epic #12 has a "Date:" line on line 9 reading "2026-02-30", which is not a YYYY-MM-DD day;'
      + ' it is read as having no date until the line is fixed',
    );
  });

  it('names a missing and an empty criteria section apart', () => {
    expect(epicBodyProblemMessage(3, { kind: 'no-criteria', line: null, text: null }))
      .toBe('epic #3 carries no "## Acceptance criteria" section; add one holding what makes the feature finished');
    expect(epicBodyProblemMessage(3, { kind: 'no-criteria', line: 4, text: '' }))
      .toBe('epic #3 has a "Acceptance criteria" heading on line 4 with nothing under it; write what makes the feature finished');
  });

  it('names a missing and an empty estimate apart', () => {
    expect(epicBodyProblemMessage(5, { kind: 'no-estimate', line: null, text: null }))
      .toBe('epic #5 carries no "Estimate:" line; add one in free text');
    expect(epicBodyProblemMessage(5, { kind: 'no-estimate', line: 2, text: '' }))
      .toBe('epic #5 has an "Estimate:" line on line 2 with nothing after it; write the estimate in free text');
  });
});

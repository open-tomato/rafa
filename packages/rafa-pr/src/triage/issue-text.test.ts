/**
 * Tests for the record's sections in a filed body and a recurrence's
 * comment (`packages/rafa-pr/src/triage/issue-text.ts`, #991): where they go, how each is
 * written, and that the sections above them, `What`, `Artifact` and
 * `Recurrence key` among them, keep their text byte for byte, so
 * `issueTextOf` (`./similarity.ts`) reads a new body as it reads an old one.
 * Then the `Possible duplicates` section's lines over the ranked list: the
 * rank, the bonus signals each names, and the sentence for an empty list.
 */
import type { BugValues } from './issue-text.js';
import type { MatchedSignal, RankedIssue } from './similarity.js';
import type { BugRecord } from '@open-tomato/rafa/bugs/record';
import type { OpenIssue } from '@open-tomato/rafa/ports';

import { EMPTY_BUG_RECORD, parseBugRecord } from '@open-tomato/rafa/bugs/record';
import { describe, expect, it } from 'bun:test';

import {
  COMMENT_OPENING,
  ISSUE_OPENING,
  issueText,
  NO_DUPLICATES,
  possibleDuplicatesSection,
  recordSections,
} from './issue-text.js';
import { issueTextOf, sectionValueOf } from './similarity.js';

/** A redactor that changes nothing. */
const asIs = (text: string): string => text;

/** A redactor that takes the word `SECRET` out. */
const noSecret = (text: string): string => text.replaceAll('SECRET', '[redacted]');

/** The values of a body filed before the record: no record, no reported words, no versions. */
const OLD_VALUES: BugValues = {
  what: 'the merge drops a row with `ticks`',
  artifact: 'src/effort/merge.test.ts > merge > keeps rows\nexpected 2, got 1',
  key: 'src/effort/merge.test.ts: merge > keeps rows',
  refs: '## Refs\n\n- `src/effort/merge.ts`',
  planStub: 'my-plan',
  taskText: 'Merge the rows',
  feedback: 'went fine apart from the red test',
};

/** A record holding every field `issueText` writes after `Feedback`, and ones it leaves out. */
const RECORD: BugRecord = {
  ...EMPTY_BUG_RECORD,
  summary: 'the merge drops a row',
  what: 'the record\'s own description, never written by issueText',
  reproduce: 'seen while running task Merge the rows of plan my-plan',
  rerun: 'bun test src/effort/merge.test.ts -t "merge keeps rows"',
  errorLine: 'expected N, got N',
  artifact: 'the record\'s own artifact, never written by issueText',
  cause: 'unknown:new-context',
  proposed: 'row-drop',
  suspected: 'the merge reads the `old` side twice',
  module: 'unknown',
  action: 'merge',
  environment: 'local',
  versions: 'rafa: 0.0.0\ncode: abc1234\npackage: @open-tomato/rafa@0.0.0',
};

/** The values of a body filed with the record. */
const NEW_VALUES: BugValues = {
  ...OLD_VALUES,
  record: RECORD,
  reported: { module: 'Loop Start', action: null },
};

/** The `## <heading>` lines of `text`, in order. */
function headingsOf(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('## '));
}

/** The section of `body` headed `heading`, up to the next heading, as written. */
function sectionOf(body: string, heading: string): string {
  const start = body.indexOf(`## ${heading}\n`);
  const next = body.indexOf('\n## ', start + 1);
  return body.slice(start, next === -1
    ? undefined
    : next);
}

describe('issueText with the record', () => {
  it('writes the record\'s sections after Feedback in BUG_FIELDS order, the reported words fenced last', () => {
    // Act
    const body = issueText(ISSUE_OPENING, NEW_VALUES, asIs);

    // Assert
    expect(headingsOf(body)).toEqual([
      '## What',
      '## Artifact',
      '## Refs',
      '## Recurrence key',
      '## Plan',
      '## Task',
      '## Feedback',
      '## Reproduce',
      '## Rerun',
      '## Cause',
      '## Proposed cause',
      '## Suspected cause',
      '## Module',
      '## Action',
      '## Environment',
      '## Versions',
      '## Reported module',
    ]);
    expect(sectionOf(body, 'Cause')).toBe('## Cause\n\nunknown:new-context\n');
    expect(sectionOf(body, 'Module')).toBe('## Module\n\nunknown\n');
    expect(sectionOf(body, 'Suspected cause')).toBe('## Suspected cause\n\n```\nthe merge reads the `old` side twice\n```\n');
    expect(body.endsWith('## Reported module\n\n```\nLoop Start\n```\n')).toBe(true);
  });

  it('keeps the opening and every section through Feedback byte for byte', () => {
    // Arrange
    const old = issueText(ISSUE_OPENING, OLD_VALUES, asIs);

    // Act
    const body = issueText(ISSUE_OPENING, NEW_VALUES, asIs);

    // Assert
    expect(body.startsWith(`${old.trimEnd()}\n\n## Reproduce\n`)).toBe(true);
    for (const heading of ['What', 'Artifact', 'Recurrence key']) {
      expect(sectionOf(body, heading)).toBe(sectionOf(old, heading));
      expect(sectionValueOf(body, heading)).toBe(sectionValueOf(old, heading));
    }
    expect(sectionValueOf(body, 'Recurrence key')).toBe(OLD_VALUES.key);
    // Control: the comparison sees a change to one of those sections.
    const changed = issueText(ISSUE_OPENING, { ...NEW_VALUES, key: `${String(OLD_VALUES.key)}!` }, asIs);
    expect(sectionOf(changed, 'Recurrence key')).not.toBe(sectionOf(old, 'Recurrence key'));
  });

  it('is read by issueTextOf as an old body is, never from the record\'s own what and artifact', () => {
    // Arrange
    const old = issueText(ISSUE_OPENING, OLD_VALUES, asIs);

    // Act
    const read = issueTextOf(issueText(ISSUE_OPENING, NEW_VALUES, asIs));

    // Assert
    expect(read).toEqual(issueTextOf(old));
    expect(read).toEqual({ what: OLD_VALUES.what, artifact: OLD_VALUES.artifact });
  });

  it('is read back by parseBugRecord as the record it was written from, past the loop\'s own sections', () => {
    // Act
    const parsed = parseBugRecord(issueText(ISSUE_OPENING, NEW_VALUES, asIs));

    // Assert
    expect(parsed).toEqual({
      ...RECORD,
      summary: null,
      what: OLD_VALUES.what,
      artifact: OLD_VALUES.artifact,
      errorLine: null,
    });
  });

  it('writes no section for a field holding null and none for reported words left out', () => {
    // Arrange
    const record: BugRecord = { ...RECORD, rerun: null, proposed: null, suspected: null };

    // Act
    const body = issueText(ISSUE_OPENING, { ...OLD_VALUES, record }, asIs);

    // Assert
    expect(headingsOf(body).slice(7)).toEqual([
      '## Reproduce',
      '## Cause',
      '## Module',
      '## Action',
      '## Environment',
      '## Versions',
    ]);
  });

  it('writes both reported words, fenced, after Versions and before Possible duplicates', () => {
    // Act
    const body = issueText(ISSUE_OPENING, {
      ...NEW_VALUES,
      reported: { module: 'Loop Start', action: 'run `it`' },
      duplicates: { threshold: 0.5, nearest: [] },
    }, asIs);

    // Assert
    expect(headingsOf(body).slice(-4)).toEqual([
      '## Versions',
      '## Reported module',
      '## Reported action',
      '## Possible duplicates',
    ]);
    expect(sectionOf(body, 'Reported action')).toBe('## Reported action\n\n```\nrun `it`\n```\n');
  });

  it('redacts every record value it writes', () => {
    // Arrange
    const record: BugRecord = { ...RECORD, reproduce: 'run with SECRET', versions: 'rafa: SECRET' };

    // Act
    const body = issueText(ISSUE_OPENING, {
      ...OLD_VALUES,
      record,
      reported: { module: 'SECRET module', action: null },
    }, noSecret);

    // Assert
    expect(body).not.toContain('SECRET');
    expect(sectionValueOf(body, 'Reproduce')).toBe('run with [redacted]');
    expect(sectionValueOf(body, 'Reported module')).toBe('[redacted] module');
  });
});

describe('recordSections', () => {
  it('answers nothing for a record holding nothing and no reported words', () => {
    expect(recordSections(EMPTY_BUG_RECORD, undefined, asIs)).toEqual([]);
    // Control: one field holding a value is written.
    expect(recordSections({ ...EMPTY_BUG_RECORD, environment: 'ci' }, undefined, asIs))
      .toEqual(['## Environment\n\nci']);
  });
});

describe('a recurrence\'s comment', () => {
  it('gains Versions after Feedback and no other record field', () => {
    // Arrange
    const old = issueText(COMMENT_OPENING, OLD_VALUES, asIs);

    // Act
    const comment = issueText(COMMENT_OPENING, { ...OLD_VALUES, versions: 'rafa: 0.0.1\ncode: def5678' }, asIs);

    // Assert
    expect(comment).toBe(`${old}\n## Versions\n\n\`\`\`\nrafa: 0.0.1\ncode: def5678\n\`\`\`\n`);
    expect(headingsOf(comment).at(-2)).toBe('## Feedback');
    expect(issueTextOf(comment)).toEqual(issueTextOf(old));
  });

  it('writes no Versions section without versions', () => {
    expect(headingsOf(issueText(COMMENT_OPENING, OLD_VALUES, asIs))).not.toContain('## Versions');
  });

  it('writes the record\'s Versions and not the comment\'s when a record is given beside them', () => {
    // Act
    const body = issueText(ISSUE_OPENING, { ...NEW_VALUES, versions: 'rafa: other' }, asIs);

    // Assert
    expect(headingsOf(body).filter((heading) => heading === '## Versions')).toHaveLength(1);
    expect(sectionValueOf(body, 'Versions')).toBe(RECORD.versions);
  });
});

/** An open bug of the local tracker numbered `id`, with no URL, so a line names it by kind and id. */
function openIssueOf(id: number): OpenIssue {
  return { ref: { kind: 'local', externalId: String(id), opt: id, url: null }, title: `bug ${String(id)}`, body: '', createdAt: null };
}

/** A ranked line for open bug `id`. */
function rankedOf(id: number, score: number, matched: readonly MatchedSignal[]): RankedIssue {
  return { issue: openIssueOf(id), score, words: score, matched };
}

/** The list lines of a `Possible duplicates` section. */
function listLinesOf(section: string): string[] {
  return section.split('\n').filter((line) => line.startsWith('- '));
}

describe('possibleDuplicatesSection', () => {
  it('names the bonus signals each line matched, joined by commas, after its rank', () => {
    // Arrange
    const nearest = [
      rankedOf(1, 0.31, ['words', 'cause', 'boundary']),
      rankedOf(2, 0.15, ['cause']),
      rankedOf(3, 0.08, ['words', 'cause-family']),
    ];

    // Act
    const section = possibleDuplicatesSection({ threshold: 0.5, nearest }, asIs);

    // Assert
    expect(listLinesOf(section)).toEqual([
      '- local issue 1 (score 0.31; same cause, same module and action)',
      '- local issue 2 (score 0.15; same cause)',
      '- local issue 3 (score 0.08; same cause family)',
    ]);
  });

  it('writes a line matched on words alone with its rank and no signal', () => {
    // Act
    const section = possibleDuplicatesSection({ threshold: 0.5, nearest: [rankedOf(4, 0.2, ['words'])] }, asIs);

    // Assert
    expect(listLinesOf(section)).toEqual(['- local issue 4 (score 0.20)']);
  });

  it('opens with the threshold and writes the sentence for an empty list, and no line', () => {
    // Act
    const section = possibleDuplicatesSection({ threshold: 0.3, nearest: [] }, asIs);

    // Assert
    expect(section).toBe('## Possible duplicates\n\n'
      + 'No open bug scored at or above the similarity threshold of 0.3.\n\n'
      + 'No open bug shares a word, a cause or a module and action with this one.');
    expect(NO_DUPLICATES).toBe('No open bug shares a word, a cause or a module and action with this one.');
    expect(listLinesOf(section)).toEqual([]);
  });

  it('names an issue with a URL by its URL and redacts the lines', () => {
    // Arrange
    const issue: OpenIssue = {
      ref: { kind: 'github', externalId: '7', opt: 7, url: 'https://example.test/SECRET/7' },
      title: 'bug 7',
      body: '',
      createdAt: null,
    };

    // Act
    const section = possibleDuplicatesSection({ threshold: 0.5, nearest: [{ issue, score: 0.4, words: 0.25, matched: ['words', 'cause'] }] }, noSecret);

    // Assert
    expect(listLinesOf(section)).toEqual(['- https://example.test/[redacted]/7 (score 0.40; same cause)']);
  });
});

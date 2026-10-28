/**
 * Tests for the released-history audit (`audit.ts`): the heading reader,
 * each of the four findings, the sentences and the cell, and the
 * planted `CHANGELOG.md`.
 *
 * The planted changelog is audited with no tag at all, the worst
 * reading a fresh clone can give, and two controls keep that pass from
 * passing while wrong: the same text with its second section's version
 * dropped must answer a gap, and with a receipt planted under its newest
 * heading must answer that version untagged.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  auditCell,
  auditChangelog,
  auditHeadings,
  auditLines,
  auditSentence,
  readAudit,
  successorsOf,
} from './audit.js';

/** A changelog of `headings`, each with one note under it. */
function changelog(...headings: readonly string[]): string {
  return ['# Changelog', '', ...headings.flatMap((heading) => [heading, '', '- a note', ''])].join('\n');
}

/** Versions of the planted changelog, newest first: 0.22.0 down to 0.1.0, one release a day. */
const PLANTED_VERSIONS = Array.from({ length: 22 }, (_, index) => `0.${22 - index}.0`);

/** A planted stand-in for the repository's changelog: 22 unreceipted sections, in step and dated in order. */
const PLANTED_CHANGELOG = changelog(
  ...PLANTED_VERSIONS.map((version, index) => `## ${version} — 2026-09-${String(30 - index).padStart(2, '0')}, release`),
);

describe('auditHeadings', () => {
  it('keeps every heading naming a version, repeats included, with its date', () => {
    const text = changelog('## 0.2.0 — 2026-09-02, two', '## 0.2.0 — 2026-09-01, again', '## 0.1.0, undated');

    expect(auditHeadings(text)).toEqual([
      { version: '0.2.0', date: '2026-09-02' },
      { version: '0.2.0', date: '2026-09-01' },
      { version: '0.1.0', date: null },
    ]);
  });

  it('reads no heading inside a fenced code block, and none that names no version', () => {
    const text = ['# Changelog', '## Unreleased', '```', '## 9.9.9 — 2026-01-01', '```', '## 0.1.0'].join('\n');

    expect(auditHeadings(text).map((heading) => heading.version)).toEqual(['0.1.0']);
  });
});

describe('successorsOf', () => {
  it('answers the next patch, minor and major', () => {
    expect(successorsOf('0.9.2')).toEqual(['0.9.3', '0.10.0', '1.0.0']);
  });

  it('answers null for a prerelease and for no version', () => {
    expect(successorsOf('1.0.0-rc.1')).toBeNull();
    expect(successorsOf('one')).toBeNull();
  });
});

describe('auditChangelog', () => {
  it('finds nothing in a history in step, dated in order and tagged', () => {
    const text = changelog('## 0.2.0 — 2026-09-03, b', '## 0.1.1 — 2026-09-02, a', '## 0.1.0 — 2026-09-01, first');

    expect(auditChangelog(text, ['0.2.0', '0.1.1', '0.1.0'])).toEqual([]);
  });

  it('finds a version two headings name once, and not also as a gap', () => {
    const text = changelog('## 0.2.0 — 2026-09-02, b', '## 0.2.0 — 2026-09-02, b again', '## 0.1.0 — 2026-09-01, a');

    expect(auditChangelog(text, [])).toEqual([{ kind: 'duplicate', version: '0.2.0', count: 2 }]);
  });

  it('finds a skipped number as a gap, naming the successors it expected', () => {
    const text = changelog('## 0.12.0 — 2026-09-02, b', '## 0.10.0 — 2026-09-01, a');

    expect(auditChangelog(text, [])).toEqual([
      { kind: 'gap', version: '0.12.0', previous: '0.10.0', successors: ['0.10.1', '0.11.0', '1.0.0'] },
    ]);
  });

  it('finds a version lower than the one below it as a gap', () => {
    const text = changelog('## 0.1.0 — 2026-09-02, b', '## 0.2.0 — 2026-09-01, a');

    expect(auditChangelog(text, []).map((finding) => finding.kind)).toEqual(['gap']);
  });

  it('judges no pair where either side is a prerelease', () => {
    const text = changelog('## 1.1.0-beta.1', '## 1.0.0', '## 1.0.0-rc.1', '## 0.9.0');

    expect(auditChangelog(text, [])).toEqual([]);
    expect(auditChangelog(text, PLANTED_VERSIONS)).toEqual([]);
  });

  it('finds a heading dated before the one below it', () => {
    const text = changelog('## 0.2.0 — 2026-09-01, b', '## 0.1.0 — 2026-09-05, a');

    expect(auditChangelog(text, [])).toEqual([
      { kind: 'date-order', version: '0.2.0', date: '2026-09-01', previous: '0.1.0', previousDate: '2026-09-05' },
    ]);
  });

  it('leaves a pair undated on either side unjudged for its dates', () => {
    const text = changelog('## 0.2.0, b', '## 0.1.0 — 2026-09-05, a');

    expect(auditChangelog(text, [])).toEqual([]);
  });

  it('reports no untagged heading while no section carries a receipt, since all are legacy', () => {
    const text = changelog('## 0.2.0 — 2026-09-02, b', '## 0.1.0 — 2026-09-01, a');

    expect(auditChangelog(text, [])).toEqual([]);
  });

  it('reports an untagged heading above the adoption boundary, and none at or below it', () => {
    const text = [
      '# Changelog',
      '## 0.3.0 — 2026-09-03, c',
      '<!-- rafa:fragments rafa-3 -->',
      '## 0.2.0 — 2026-09-02, b',
      '<!-- rafa:fragments rafa-2 -->',
      '## 0.1.0 — 2026-09-01, a',
    ].join('\n');

    expect(auditChangelog(text, ['0.2.0'])).toEqual([{ kind: 'untagged', version: '0.3.0' }]);
  });

  it('orders its findings duplicate, gap, date-order, untagged', () => {
    const text = [
      '## 0.5.0 — 2026-09-01, e',
      '<!-- rafa:fragments rafa-5 -->',
      '## 0.3.0 — 2026-09-02, c',
      '## 0.3.0 — 2026-09-02, c',
    ].join('\n');

    expect(auditChangelog(text, []).map((finding) => finding.kind))
      .toEqual(['duplicate', 'gap', 'date-order', 'untagged']);
  });
});

describe('a planted CHANGELOG.md', () => {
  it('passes the audit, even with no tag read at all', () => {
    const text = PLANTED_CHANGELOG;

    expect(auditHeadings(text).length).toBeGreaterThan(20);
    expect(auditChangelog(text, [])).toEqual([]);
  });

  it('fails the audit once a section is dropped, so the pass above is a reading', () => {
    const text = PLANTED_CHANGELOG;
    const [newest, second] = auditHeadings(text);
    if (newest === undefined || second === undefined) throw new Error('the planted changelog names under two versions');
    const secondLine = text.split('\n').find((line) => line.startsWith(`## ${second.version} `)) ?? '';
    const dropped = text.replace(secondLine, '## a section with no version');

    expect(auditChangelog(dropped, []).map((finding) => finding.kind)).toContain('gap');
  });

  it('fails the audit once its newest section is receipted and untagged', () => {
    const text = PLANTED_CHANGELOG;
    const [newest] = auditHeadings(text);
    if (newest === undefined) throw new Error('the changelog names no version');
    const headingLine = text.split('\n').find((line) => line.startsWith(`## ${newest.version} `)) ?? '';
    const receipted = text.replace(headingLine, `${headingLine}\n\n<!-- rafa:fragments rafa-1 -->`);

    expect(auditChangelog(receipted, [])).toEqual([{ kind: 'untagged', version: newest.version }]);
  });
});

describe('the sentences and the cell', () => {
  it('says each finding in one sentence', () => {
    expect(auditSentence({ kind: 'duplicate', version: '0.2.0', count: 2 }))
      .toBe('0.2.0 is named by 2 headings');
    expect(auditSentence({ kind: 'gap', version: '0.12.0', previous: '0.10.0', successors: ['0.10.1', '0.11.0', '1.0.0'] }))
      .toBe('0.12.0 follows 0.10.0, which is not the next patch, minor or major (0.10.1, 0.11.0 or 1.0.0)');
    expect(auditSentence({
      kind: 'date-order',
      version: '0.2.0',
      date: '2026-09-01',
      previous: '0.1.0',
      previousDate: '2026-09-05',
    })).toBe('0.2.0 is dated 2026-09-01, before 0.1.0 below it, dated 2026-09-05');
    expect(auditSentence({ kind: 'untagged', version: '0.3.0' }))
      .toBe('0.3.0 has a heading and no tag, and is newer than the releases made before settle');
  });

  it('says clean with the section count, or the finding count, and nothing when unread', () => {
    const clean = { path: 'CHANGELOG.md', read: true, sections: 1, findings: [] };
    const found = { ...clean, sections: 3, findings: [{ kind: 'untagged', version: '0.3.0' } as const] };

    expect(auditCell(clean)).toBe('clean, 1 section of CHANGELOG.md');
    expect(auditCell(found)).toBe('1 finding in 3 sections of CHANGELOG.md');
    expect(auditLines(found)).toEqual(['0.3.0 has a heading and no tag, and is newer than the releases made before settle']);
    expect(auditCell({ ...clean, read: false })).toBeNull();
  });
});

describe('readAudit', () => {
  it('reads the changelog under the root, and says unread when there is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'rafa-audit-'));
    try {
      writeFileSync(join(root, 'CHANGELOG.md'), changelog('## 0.3.0 — 2026-09-02, b', '## 0.1.0 — 2026-09-01, a'));

      expect(readAudit(root, 'CHANGELOG.md', [])).toEqual({
        path: 'CHANGELOG.md',
        read: true,
        sections: 2,
        findings: [{ kind: 'gap', version: '0.3.0', previous: '0.1.0', successors: ['0.1.1', '0.2.0', '1.0.0'] }],
      });
      expect(readAudit(root, 'MISSING.md', [])).toEqual({ path: 'MISSING.md', read: false, sections: 0, findings: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

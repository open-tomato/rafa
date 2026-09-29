import type { ReleaseStatusReading } from './status.js';
import type { AuditReading } from '../../release/audit.js';

import { describe, expect, it } from 'bun:test';

import { renderStatus, UNREADABLE } from './status.js';

/** A reading with every other cell readable and quiet, carrying `audit`. */
function reading(audit: AuditReading): ReleaseStatusReading {
  return {
    versionFile: { path: 'package.json', version: '0.3.0', problem: null },
    tags: { tags: [], latest: null, problem: null },
    untagged: { path: 'CHANGELOG.md', released: ['0.3.0'], versions: ['0.3.0'], problem: null },
    plan: { stub: null, source: 'none', branch: 'main', notes: [], level: null, problem: null },
    waiting: { ref: 'origin/main', read: true, baseVersion: '0.3.0', fragments: [], malformed: 0, forecast: null, problems: [] },
    audit,
  };
}

describe('the audit line of rafa release status', () => {
  it('comes last, saying clean with the section count', () => {
    const text = renderStatus(reading({ path: 'CHANGELOG.md', read: true, sections: 2, findings: [] }));

    expect(text.split('\n').at(-1)).toBe('  audit         clean, 2 sections of CHANGELOG.md');
  });

  it('lists each finding under its line', () => {
    const text = renderStatus(reading({
      path: 'CHANGELOG.md',
      read: true,
      sections: 3,
      findings: [
        { kind: 'duplicate', version: '0.2.0', count: 2 },
        { kind: 'untagged', version: '0.3.0' },
      ],
    }));

    expect(text.split('\n').slice(-3)).toEqual([
      '  audit         2 findings in 3 sections of CHANGELOG.md',
      '                0.2.0 is named by 2 headings',
      '                0.3.0 has a heading and no tag, and is newer than the releases made before settle',
    ]);
  });

  it('marks the cell unreadable and adds no sentence of its own when the changelog was not read', () => {
    const text = renderStatus(reading({ path: 'CHANGELOG.md', read: false, sections: 0, findings: [] }));

    expect(text.split('\n').at(-1)).toBe(`  audit         ${UNREADABLE}`);
  });
});

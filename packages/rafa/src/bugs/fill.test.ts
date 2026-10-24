import type { BugRecord, BugRules } from './record.js';
import type { GitResult, GitRunner } from '../core/git/index.js';
import type { IssueDraft } from '../ports/index.js';

import { describe, expect, test } from 'bun:test';

import {
  ARTIFACT_MAX_LINES,
  bodyOf,
  cappedArtifact,
  checkoutOf,
  draftOf,
  FREE_TEXT_FIELDS,
  redacted,
  settled,
} from './fill.js';
import { EMPTY_BUG_RECORD, renderBugBody } from './record.js';
import { DEFAULT_BUG_TITLE, UNKNOWN_VALUE } from './title.js';

/** A runner answering `result` to every call, and recording each call's arguments. */
function gitAnswering(result: GitResult): { readonly git: GitRunner; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const git: GitRunner = (args) => {
    calls.push(args);
    return result;
  };
  return { git, calls };
}

/** `count` artifact lines, numbered from 1. */
function artifactLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}

const RULES: BugRules = {
  template: DEFAULT_BUG_TITLE,
  summaryMax: 80,
  environments: ['local', 'ci'],
  modules: [],
  actions: [],
  codes: [],
};

const BASE: IssueDraft = {
  opt: 0,
  title: '',
  body: '',
  type: 'bug',
  module: 'unassigned',
  priority: null,
  project: null,
  blockedBy: [],
};

const RECORD: BugRecord = {
  ...EMPTY_BUG_RECORD,
  module: 'triage',
  action: 'file',
  summary: 'files a bug twice',
  what: 'the same bug is filed twice',
  environment: 'local',
};

describe('checkoutOf', () => {
  test('answers the top level git names when it is a worktree apart from the root', () => {
    const { git, calls } = gitAnswering({ ok: true, stdout: '/work/tree\n', stderr: '' });
    expect(checkoutOf(git, '/main/project')).toBe('/work/tree');
    expect(calls).toEqual([['rev-parse', '--show-toplevel']]);
  });

  test('answers the root when the top level holds it', () => {
    const { git } = gitAnswering({ ok: true, stdout: '/main\n', stderr: '' });
    expect(checkoutOf(git, '/main/project')).toBe('/main/project');
  });

  test('answers the root when the top level is the root itself', () => {
    const { git } = gitAnswering({ ok: true, stdout: '/main/project\n', stderr: '' });
    expect(checkoutOf(git, '/main/project')).toBe('/main/project');
  });

  test('answers the root outside a repository, and for a blank answer', () => {
    expect(checkoutOf(gitAnswering({ ok: false, stdout: '', stderr: 'not a git repository' }).git, '/p')).toBe('/p');
    expect(checkoutOf(gitAnswering({ ok: true, stdout: '  \n', stderr: '' }).git, '/p')).toBe('/p');
  });
});

describe('redacted', () => {
  test('passes every free text through the redactor and leaves every other field alone', () => {
    const record: BugRecord = {
      ...RECORD,
      reproduce: 'run it',
      rerun: 'bun test',
      errorLine: 'Error: boom',
      artifact: 'stack',
      suspected: 'a guess',
      project: 'rafa',
      cause: 'triage:dup',
      proposed: 'triage:twice',
    };
    const result = redacted(record, (text) => `<${text}>`);
    for (const field of FREE_TEXT_FIELDS) {
      expect(result[field]).toBe(`<${record[field]}>`);
    }
    expect(FREE_TEXT_FIELDS.length).toBe(8);
    expect(result.module).toBe('triage');
    expect(result.action).toBe('file');
    expect(result.environment).toBe('local');
    expect(result.cause).toBe('triage:dup');
    expect(result.proposed).toBe('triage:twice');
  });

  test('keeps a null free text null, never handing it to the redactor', () => {
    const seen: string[] = [];
    const result = redacted(EMPTY_BUG_RECORD, (text) => {
      seen.push(text);
      return text;
    });
    expect(seen).toEqual([]);
    expect(result).toEqual(EMPTY_BUG_RECORD);
  });

  test('leaves the record it was handed as it was', () => {
    const record = { ...RECORD };
    redacted(record, () => 'x');
    expect(record).toEqual(RECORD);
  });
});

describe('cappedArtifact', () => {
  test('keeps an artifact at the cap whole', () => {
    const artifact = artifactLines(ARTIFACT_MAX_LINES);
    expect(cappedArtifact(artifact)).toBe(artifact);
  });

  test('cuts an artifact past the cap, a last line saying how many were left out', () => {
    const capped = cappedArtifact(artifactLines(ARTIFACT_MAX_LINES + 3));
    const lines = capped.split('\n');
    expect(lines).toHaveLength(ARTIFACT_MAX_LINES + 1);
    expect(lines[ARTIFACT_MAX_LINES - 1]).toBe(`line ${ARTIFACT_MAX_LINES}`);
    expect(lines[ARTIFACT_MAX_LINES]).toBe('… 3 more lines cut');
  });

  test('counts CRLF lines as lines', () => {
    const capped = cappedArtifact(artifactLines(ARTIFACT_MAX_LINES + 1).replaceAll('\n', '\r\n'));
    expect(capped.split('\n').at(-1)).toBe('… 1 more lines cut');
  });
});

describe('settled', () => {
  test('caps the artifact and reads the error line off its first line', () => {
    const result = settled({ ...RECORD, artifact: `\nError: boom\n${artifactLines(ARTIFACT_MAX_LINES)}` });
    expect(result.artifact?.split('\n').at(-1)).toBe('… 2 more lines cut');
    expect(result.errorLine).toBe('Error: boom');
  });

  test('keeps an error line already given', () => {
    expect(settled({ ...RECORD, artifact: 'Error: boom', errorLine: 'given' }).errorLine).toBe('given');
  });

  test('leaves the artifact and the error line null with no artifact', () => {
    const result = settled(RECORD);
    expect(result.artifact).toBeNull();
    expect(result.errorLine).toBeNull();
  });

  test('takes the summary as the description when none was given', () => {
    expect(settled({ ...RECORD, what: null }).what).toBe('files a bug twice');
    expect(settled(RECORD).what).toBe('the same bug is filed twice');
  });

  test('reads module unassigned as unknown, and keeps any other', () => {
    expect(settled({ ...RECORD, module: 'unassigned' }).module).toBe(UNKNOWN_VALUE);
    expect(settled(RECORD).module).toBe('triage');
    expect(settled({ ...RECORD, module: null }).module).toBeNull();
  });
});

describe('bodyOf', () => {
  test('is the record\'s sections alone for a body with no section', () => {
    expect(bodyOf(RECORD, 'just a description', (text) => text)).toBe(renderBugBody(RECORD));
  });

  test('adds the body\'s sections that are no field after the record\'s own, redacted', () => {
    const typed = '## What\n\nthe same bug\n\n## Expected\n\nfiled once at /home/me\n';
    const body = bodyOf(RECORD, typed, (text) => text.replaceAll('/home/me', '~'));
    expect(body.startsWith(`${renderBugBody(RECORD)}\n`)).toBe(true);
    expect(body).toContain('## Expected');
    expect(body).toContain('filed once at ~');
    expect(body).not.toContain('/home/me');
  });

  test('adds nothing for a body whose sections are all fields', () => {
    expect(bodyOf(RECORD, '## What\n\nthe same bug\n', (text) => text)).toBe(renderBugBody(RECORD));
  });
});

describe('draftOf', () => {
  test('renders the title from the fields and files the body, the module and the cause', () => {
    const draft = draftOf(BASE, { ...RECORD, cause: 'triage:dup' }, RULES, 'the body');
    expect(draft.title).toBe('triage - file: files a bug twice');
    expect(draft.body).toBe('the body');
    expect(draft.module).toBe('triage');
    expect(draft.cause).toBe('triage:dup');
    expect(draft.type).toBe('bug');
  });

  test('files module unknown and no module as unassigned', () => {
    expect(draftOf(BASE, { ...RECORD, module: UNKNOWN_VALUE }, RULES, '').module).toBe('unassigned');
    expect(draftOf(BASE, { ...RECORD, module: null }, RULES, '').module).toBe('unassigned');
  });

  test('carries no cause key for a record with no cause', () => {
    expect('cause' in draftOf(BASE, RECORD, RULES, '')).toBe(false);
  });
});

import type { BugRecord, BugRules } from './record.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { RAFA_CODES } from '@open-tomato/rafa/errors/rafa-codes';

import { ISSUE_OPENING } from '../triage/issue-text.js';
import { issueTextOf } from '../triage/similarity.js';

import {
  BUG_FIELDS,
  bugProblems,
  bugTitle,
  EMPTY_BUG_RECORD,
  hasBugSections,
  otherSections,
  parseBugRecord,
  renderBugBody,
} from './record.js';
import { DEFAULT_BUG_TITLE } from './title.js';

/** The rules of a project that sets nothing. */
const RULES: BugRules = {
  template: DEFAULT_BUG_TITLE,
  summaryMax: 80,
  environments: ['local', 'ci', 'prod'],
  modules: [],
  actions: [],
  codes: RAFA_CODES,
};

/** A code rafa ships in the `git` family, read from the list so the case cannot drift from it. */
const GIT_CODE = RAFA_CODES.find((entry) => entry.code.startsWith('git:'))!.code;

/** A record that passes the check. */
const FULL: BugRecord = {
  ...EMPTY_BUG_RECORD,
  summary: 'resume does not find the worktree branch',
  what: 'resume does not find the worktree branch',
  reproduce: 'rafa loop start --continue after a stop',
  module: 'loop',
  action: 'start',
  environment: 'local',
  cause: 'git:new-context',
  proposed: 'git:branch-not-found',
  versions: 'rafa: 0.42.0\ncode: 2bdad97',
};

/** `FULL`'s body, byte for byte. */
const BODY = [
  '## What', '', '```', 'resume does not find the worktree branch', '```', '',
  '## Reproduce', '', '```', 'rafa loop start --continue after a stop', '```', '',
  '## Cause', '', 'git:new-context', '',
  '## Proposed cause', '', 'git:branch-not-found', '',
  '## Module', '', 'loop', '',
  '## Action', '', 'start', '',
  '## Environment', '', 'local', '',
  '## Versions', '', '```', 'rafa: 0.42.0', 'code: 2bdad97', '```', '',
].join('\n');

/** The problems of `FULL` with `changes` laid over it. */
function problemsOf(changes: Partial<BugRecord>, rules: Partial<BugRules> = {}): readonly string[] {
  return bugProblems({ ...FULL, ...changes }, { ...RULES, ...rules });
}

describe('the check of a bug record', () => {
  it('finds nothing wrong with a full record, and renders its title', () => {
    expect(bugProblems(FULL, RULES)).toEqual([]);
    expect(bugTitle(FULL, RULES)).toBe('loop - start: resume does not find the worktree branch');
  });

  it.each(['module', 'action', 'summary', 'environment', 'cause', 'reproduce'] as const)(
    'names %s, and nothing else, when it is missing',
    (field) => {
      const problems = problemsOf({ [field]: null, proposed: null });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toStartWith(`${field} is missing`);
    },
  );

  it('names every missing field of an empty record, each once', () => {
    const opening = bugProblems(EMPTY_BUG_RECORD, RULES).map((problem) => problem.split(' ')[0]);
    expect(opening).toEqual(['summary', 'reproduce', 'cause', 'module', 'action', 'environment']);
  });

  it.each(['unknown', '  ', 'Unknown'])('refuses a reproduce of %p, which is never unknown', (reproduce) => {
    expect(problemsOf({ reproduce })).toEqual([
      'reproduce is missing: pass --reproduce=<the steps, or the condition that revealed it>; it is never unknown',
    ]);
  });

  it('accepts unknown for the module, the action and the place', () => {
    expect(problemsOf({ module: 'unknown', action: 'unknown', environment: 'unknown' })).toEqual([]);
  });

  it('holds a module and an action to their shapes, an action taking spaces', () => {
    expect(problemsOf({ module: 'Loop' })).toEqual(['module is "Loop", expected lower-case letters, digits, ".", "_" and "-"']);
    expect(problemsOf({ module: 'my loop' })).toEqual(['module is "my loop", expected lower-case letters, digits, ".", "_" and "-"']);
    expect(problemsOf({ action: 'pr show' })).toEqual([]);
    expect(problemsOf({ action: 'PR show' })).toEqual([
      'action is "PR show", expected lower-case letters, digits, ".", "_" and "-", spaces allowed',
    ]);
  });

  it('refuses a name outside a vocabulary that is set, showing the closest', () => {
    const rules = { modules: ['auth', 'billing'], actions: ['login'] };
    expect(problemsOf({ module: 'bilin', action: 'login' }, rules)).toEqual([
      'module "bilin" is not in issues.vocabulary.modules; closest: billing',
    ]);
    expect(problemsOf({ module: 'auth', action: 'zzzzzzzz' }, rules)).toEqual([
      'action "zzzzzzzz" is not in issues.vocabulary.actions',
    ]);
    expect(problemsOf({ module: 'auth', action: 'login' }, rules)).toEqual([]);
    expect(problemsOf({ module: 'unknown', action: 'unknown' }, rules)).toEqual([]);
  });

  it('refuses a place the project does not name', () => {
    expect(problemsOf({ environment: 'staging' })).toEqual(['environment is "staging", expected one of: local, ci, prod, unknown']);
    expect(problemsOf({ environment: 'staging' }, { environments: ['local', 'ci', 'prod', 'staging'] })).toEqual([]);
  });

  it('caps the summary in characters, and holds it to one line', () => {
    expect(problemsOf({ summary: 'é'.repeat(80) })).toEqual([]);
    expect(problemsOf({ summary: 'é'.repeat(81) })).toEqual(['summary is 81 characters, at most 80 (issues.titles.summaryMax)']);
    expect(problemsOf({ summary: 'one\ntwo' })).toEqual(['summary holds a line break']);
  });

  it('accepts a listed code and a new-context of a family the list has or of none known', () => {
    expect(problemsOf({ cause: GIT_CODE, proposed: null })).toEqual([]);
    expect(problemsOf({ cause: 'git:new-context', proposed: null })).toEqual([]);
    expect(problemsOf({ cause: 'unknown:new-context', proposed: null })).toEqual([]);
  });

  it('refuses a cause the list lacks, saying how to file it', () => {
    expect(problemsOf({ cause: 'git:branch-missing', proposed: null })).toEqual([
      'cause "git:branch-missing" is not a code of rafa bug codes: pass --cause=git:new-context --proposed=git:branch-missing',
    ]);
    expect(problemsOf({ cause: 'nope:branch-missing', proposed: null })).toEqual([
      'cause "nope:branch-missing" is not a code of rafa bug codes: pass --cause=unknown:new-context --proposed=nope:branch-missing',
    ]);
    expect(problemsOf({ cause: 'nope:new-context', proposed: null })).toEqual([
      'cause names the family "nope", which no code has: pass unknown:new-context',
    ]);
    expect(problemsOf({ cause: 'Git:X', proposed: null })).toEqual(['cause is "Git:X", expected <family>:<leaf> in kebab-case']);
  });

  it('reads a proposal only beside a new-context cause, of its family, and never a code already listed', () => {
    expect(problemsOf({ cause: GIT_CODE })).toEqual(['proposed is only read beside a cause ending in :new-context']);
    expect(problemsOf({ proposed: GIT_CODE })).toEqual([`proposed "${GIT_CODE}" is already a code: pass it as --cause`]);
    expect(problemsOf({ proposed: 'tsc:x' })).toEqual(['proposed "tsc:x" is of family "tsc", and the cause of family "git"']);
    expect(problemsOf({ cause: 'unknown:new-context', proposed: 'tsc:x' })).toEqual([]);
    expect(problemsOf({ proposed: 'git:new-context' })).toEqual(['proposed "git:new-context" ends in new-context, which names no leaf']);
    expect(problemsOf({ proposed: 'Git X' })).toEqual(['proposed is "Git X", expected <family>:<leaf> in kebab-case']);
  });

  it('refuses a summary that reads as a module in the title it renders', () => {
    expect(problemsOf({ module: 'unknown', summary: 'error: x failed' })).toEqual([
      'summary reads as another field in the title "error: x failed": name the module or reword the summary',
    ]);
    expect(problemsOf({ module: 'unknown', summary: 'Error: x failed' })).toEqual([]);
  });
});

describe('the body of a bug record', () => {
  it('writes a section per field that holds a value, in the fixed order, free text fenced', () => {
    expect(renderBugBody(FULL)).toBe(BODY);
  });

  it('writes nothing for an empty record', () => {
    expect(renderBugBody(EMPTY_BUG_RECORD)).toBe('');
  });

  it('reads its own body back, the summary aside, which the title holds', () => {
    expect(parseBugRecord(BODY)).toEqual({ ...FULL, summary: null });
  });

  it('reads every field back from a record that fills them all', () => {
    const every: BugRecord = {
      ...FULL,
      rerun: 'bun test src/a.test.ts',
      errorLine: 'TypeError: x is not a function',
      artifact: 'TypeError: x is not a function\n    at run (src/a.ts:1:1)',
      suspected: 'the branch name is read before the worktree exists',
      project: 'api',
    };
    expect(parseBugRecord(renderBugBody(every))).toEqual({ ...every, summary: null });
  });

  it('is read by triage\'s similarity step as a triage body is', () => {
    const body = renderBugBody({ ...FULL, artifact: 'TypeError: x' });
    expect(issueTextOf(body)).toEqual({ what: FULL.what, artifact: 'TypeError: x' });
  });

  it('reads the ### headings and plain values a web form writes, a field left empty as none', () => {
    const form = '### Module\n\nloop\n\n### Reproduce\n\nrun it\ntwice\n\n### Rerun\n\n_No response_\n\n### Summary\n\nx fails\n';
    expect(parseBugRecord(form)).toEqual({ ...EMPTY_BUG_RECORD, module: 'loop', reproduce: 'run it\ntwice', rerun: null, summary: 'x fails' });
  });

  it('reads a fence that names a language, as a form\'s rendered field writes it', () => {
    expect(parseBugRecord('### Artifact\n\n```text\nTypeError: x\n    at run\n```\n').artifact).toBe('TypeError: x\n    at run');
  });

  it('reads a heading inside a fence as text, never as a section', () => {
    const artifact = '## What\n```\nnot the description\n```';
    const body = renderBugBody({ ...FULL, artifact });
    expect(parseBugRecord(body).what).toBe(FULL.what);
    expect(parseBugRecord(body).artifact).toBe(artifact);
  });

  it('takes the text ahead of the first heading as the description when no What section holds one', () => {
    const body = 'Intro paragraph.\nSecond line.\n\n## Reproduce\n\nrun it\n';

    expect(parseBugRecord(body)).toMatchObject({ what: 'Intro paragraph.\nSecond line.', reproduce: 'run it' });
    expect(otherSections(body)).toBe('');
  });

  it('keeps the text ahead of the first heading beside a What section, ahead of the other sections', () => {
    const body = 'Intro.\n\n## What\n\nx\n\n## Expected\n\ny\n';

    expect(parseBugRecord(body).what).toBe('x');
    expect(otherSections(body)).toBe('Intro.\n\n## Expected\n\ny\n');
  });

  it('keeps a section named twice: the first is the field, the second is kept as written', () => {
    const body = '## Reproduce\n\na\n\n## Notes\n\nn\n\n## Reproduce\n\nb\n';

    expect(parseBugRecord(body).reproduce).toBe('a');
    expect(otherSections(body)).toBe('## Notes\n\nn\n\n## Reproduce\n\nb\n');
  });

  it('reads a tilde fence, an indented fence and a closing fence longer than its opener as fences', () => {
    expect(parseBugRecord('## Artifact\n\n~~~\n## What\nnot it\n~~~\n\n## What\n\nreal\n'))
      .toMatchObject({ what: 'real', artifact: '## What\nnot it' });
    expect(parseBugRecord('## Artifact\n\n  ```\n## What\n  ```\n')).toMatchObject({ what: null, artifact: '## What' });
    expect(parseBugRecord('## Artifact\n\n```\nx\n````\n\n## Module\n\nloop\n')).toMatchObject({ artifact: 'x', module: 'loop' });
  });

  it('reads a fence of backticks as still open at a line of tildes', () => {
    expect(parseBugRecord('## Artifact\n\n```\n~~~\n## What\n```\n').artifact).toBe('~~~\n## What');
  });

  it('reads a long body in one pass: a hundred thousand lines in well under two seconds', () => {
    const body = `## Artifact\n\n\`\`\`\n${'a line of output\n'.repeat(100_000)}\`\`\`\n\n## Module\n\nloop\n`;
    const started = performance.now();

    const record = parseBugRecord(body);

    expect(record.module).toBe('loop');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('reads a heading in any case, and the first of two', () => {
    expect(parseBugRecord('## MODULE\n\nloop\n\n## module\n\nboard\n').module).toBe('loop');
  });

  it('says whether a body holds a section of the record', () => {
    expect(hasBugSections('Seen twice.')).toBe(false);
    expect(hasBugSections('## Notes\n\nSeen twice.\n')).toBe(false);
    expect(hasBugSections(BODY)).toBe(true);
    expect(hasBugSections(`${ISSUE_OPENING}\n\n## What\n\n\`\`\`\nx\n\`\`\`\n`)).toBe(true);
  });

  it('keeps the sections that are no field of the record, as written and in order', () => {
    const body = '## What\n\nx\n\n## Expected\n\nit files\n\n### Refs\n\n- `src/a.ts`\n\n## Module\n\nloop\n';
    expect(otherSections(body)).toBe('## Expected\n\nit files\n\n### Refs\n\n- `src/a.ts`\n');
    expect(otherSections(BODY)).toBe('');
    expect(otherSections('Seen twice.')).toBe('');
  });

  it('is what the web form writes: every field of the form is a heading of the record, the required ones required', () => {
    const form = Bun.YAML.parse(readFileSync(join(import.meta.dir, '..', '..', '.github', 'ISSUE_TEMPLATE', 'bug.yml'), 'utf8')) as {
      readonly labels: readonly string[];
      readonly body: readonly { readonly type: string; readonly attributes: { readonly label?: string }; readonly validations?: { readonly required?: boolean } }[];
    };
    const fields = form.body.filter((field) => field.type !== 'markdown');
    const labels = fields.map((field) => field.attributes.label ?? '');
    const headings = BUG_FIELDS.filter((field) => field.shape !== 'unwritten').map((field) => field.heading);
    const required = fields.filter((field) => field.validations?.required === true).map((field) => field.attributes.label);

    expect(labels.filter((label) => !headings.includes(label))).toEqual([]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(required).toEqual(['What', 'Reproduce', 'Cause', 'Module', 'Action', 'Environment']);
    expect(form.labels).toEqual(['type:bug', 'needs-triage']);
  });

  it('prefills no title on the web form: GitHub would file an unedited one as the title', () => {
    const form = Bun.YAML.parse(readFileSync(join(import.meta.dir, '..', '..', '.github', 'ISSUE_TEMPLATE', 'bug.yml'), 'utf8')) as object;

    expect(form).not.toHaveProperty('title');
    expect(form).toHaveProperty('name', 'Bug');
  });

  it('names each field once, under a heading of its own', () => {
    const headings = BUG_FIELDS.map((field) => field.heading.toLowerCase());
    expect(new Set(headings).size).toBe(headings.length);
    expect(BUG_FIELDS.map((field): string => field.key).sort()).toEqual(Object.keys(EMPTY_BUG_RECORD).sort());
  });
});

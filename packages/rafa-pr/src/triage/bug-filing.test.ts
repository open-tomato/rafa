import type { BugFilingContext, BugFilingInput } from './bug-filing.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { ReportBug } from '@open-tomato/rafa/report/parse';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { bugTitle } from '@open-tomato/rafa/bugs/record';
import { RAFA_VERSION } from '@open-tomato/rafa/core/command';
import { RAFA_CODES } from '@open-tomato/rafa/errors/rafa-codes';
import { redactSecrets } from '@open-tomato/rafa/triage/filed-text';
import { localPathRedactor } from '@open-tomato/rafa/triage/local-paths';

import { bugFilingOf, DEFAULT_BUG_RULES, reproduceOf, rerunOf } from './bug-filing.js';

/** A home that holds the checkout, as a developer's does. */
const home = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-filing-')));

/** The checkout the task ran in: a root package and a workspace package beside it. */
const checkout = join(home, 'work', 'project');

/** A secret the run names. */
const SECRET = 'sk-test-0123456789abcdef';

mkdirSync(join(checkout, 'src'), { recursive: true });
mkdirSync(join(checkout, 'packages', 'hub', 'src'), { recursive: true });
writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'root-pkg', version: '0.4.0' }));
writeFileSync(join(checkout, 'packages', 'hub', 'package.json'), JSON.stringify({ name: '@scope/hub', version: '1.2.0' }));
writeFileSync(join(checkout, 'src', 'a.ts'), '');
writeFileSync(join(checkout, 'packages', 'hub', 'src', 'b.ts'), '');

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

const local = localPathRedactor([checkout], home);
const redact = (text: string): string => redactSecrets(local(text), [{ name: 'GITHUB_TOKEN', value: SECRET }]);

/** A git runner answering one commit, with tracked changes or none. */
function fakeGit(commit: string, dirty: boolean): GitRunner {
  return (args) => args[0] === 'rev-parse'
    ? { ok: true, stdout: `${commit}\n`, stderr: '' }
    : { ok: true, stdout: dirty
      ? ' M src/a.ts\n'
      : '', stderr: '' };
}

/** The context every case runs in unless it says otherwise. */
const CONTEXT: BugFilingContext = {
  checkout,
  git: fakeGit('abc1234', false),
  env: {},
  bugRules: { ...DEFAULT_BUG_RULES, codes: RAFA_CODES },
};

/** A bug with none of the four keys. */
function bugOf(fields: Partial<ReportBug> = {}): ReportBug {
  return {
    what: 'the worktree branch is read before it exists',
    artifact: null,
    security: false,
    kind: 'bug',
    module: null,
    action: null,
    reproduce: null,
    cause: null,
    extras: [],
    ...fields,
  };
}

/** The input for `bug` under the default dispatch and context. */
function inputOf(bug: ReportBug, fields: Partial<BugFilingInput> = {}): BugFilingInput {
  return {
    bug,
    what: bug.what ?? '',
    dispatch: { sessionId: 'session-1', planStub: 'my-plan', taskLine: 'Add the widget' },
    feedback: 'it went fine',
    key: 'the key',
    refs: '## Refs\n\nnone',
    context: CONTEXT,
    local,
    redact,
    ...fields,
  };
}

/** A known code of the `git` family, and the family itself. */
const GIT_CODE = RAFA_CODES.find((entry) => entry.code.startsWith('git:'))!.code;
const GIT_FAMILY = GIT_CODE.slice(0, GIT_CODE.indexOf(':'));

describe('the record built from a four-key entry', () => {
  it('carries every key it was handed, and renders the template title', () => {
    // Arrange
    const bug = bugOf({ module: 'loop', action: 'start', reproduce: 'rafa loop start --continue', cause: GIT_CODE });

    // Act
    const { record, reported } = bugFilingOf(inputOf(bug));

    // Assert
    expect(record).toMatchObject({
      what: bug.what,
      summary: bug.what,
      reproduce: 'rafa loop start --continue',
      cause: GIT_CODE,
      proposed: null,
      suspected: null,
      module: 'loop',
      action: 'start',
      environment: 'local',
    });
    expect(reported).toEqual({ module: null, action: null });
    expect(bugTitle(record, CONTEXT.bugRules!)).toBe(`loop - start: ${bug.what}`);
  });

  it('leaves the error line and the project out, and keeps the artifact whole', () => {
    // Arrange: past the record's 60-line cap, which triage does not apply
    const artifact = Array.from({ length: 70 }, (_, at) => `line ${String(at)}`).join('\n');

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ artifact })));

    // Assert
    expect(record.artifact).toBe(artifact);
    expect(record.errorLine).toBeNull();
    expect(record.project).toBeNull();
  });
});

describe('the fills, in order', () => {
  it('1. takes the reported what as the description, redacted', () => {
    // Arrange
    const what = `the token ${SECRET} leaks from ${join(checkout, 'src', 'a.ts')}`;

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ what })));

    // Assert
    expect(record.what).toBe('the token [redacted: GITHUB_TOKEN] leaks from src/a.ts');
  });

  it('2. cuts the redacted what to the summary cap on one line', () => {
    // Arrange
    const what = `first line ${SECRET}\nsecond line that runs on well past the cap of the summary field here`;
    const context = { ...CONTEXT, bugRules: { ...CONTEXT.bugRules!, summaryMax: 40 } };

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ what }), { context }));

    // Assert
    expect(record.summary).toBe('first line [redacted: GITHUB_TOKEN] s...');
    expect(Array.from(record.summary!).length).toBeLessThanOrEqual(40);
    expect(record.what).toContain('second line');
  });

  it('2. cuts to the default cap when no rules are handed', () => {
    // Arrange
    const what = 'x'.repeat(200);
    const context: BugFilingContext = { checkout, env: {} };

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ what }), { context }));

    // Assert
    expect(DEFAULT_BUG_RULES.summaryMax).toBe(80);
    expect(record.summary).toBe(`${'x'.repeat(77)}...`);
  });

  it('3. keeps the session\'s reproduce, redacted', () => {
    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ reproduce: `GITHUB_TOKEN=${SECRET} rafa loop start` })));

    // Assert
    expect(record.reproduce).toBe('GITHUB_TOKEN=[redacted: GITHUB_TOKEN] rafa loop start');
  });

  it('3. fills a reproduce left out from the task and the plan', () => {
    // Act
    const { record } = bugFilingOf(inputOf(bugOf()));

    // Assert
    expect(record.reproduce).toBe('seen while running task Add the widget of plan my-plan');
  });

  it('3. names the command for a dispatch with no plan stub', () => {
    expect(reproduceOf(null, { sessionId: 's', planStub: null, taskLine: 'rafa epic close 7' }))
      .toBe('seen while running `rafa epic close 7`');
  });

  it('3. reads a blank reproduce and the word unknown as left out', () => {
    // Arrange
    const dispatch = { sessionId: 's', planStub: 'p', taskLine: 't' };

    // Act and assert
    for (const reproduce of ['', '   ', 'unknown', ' Unknown ']) {
      expect(reproduceOf(reproduce, dispatch)).toBe('seen while running task t of plan p');
    }
  });

  it('4. files a cause left out as unknown:new-context', () => {
    // Act
    const { record } = bugFilingOf(inputOf(bugOf()));

    // Assert
    expect(record).toMatchObject({ cause: 'unknown:new-context', proposed: null, suspected: null });
  });

  it('4. files an unlisted leaf of a listed family under its family, the code kept as proposed', () => {
    // Arrange
    const code = `${GIT_FAMILY}:no-such-leaf-here`;

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ cause: code })));

    // Assert
    expect(record).toMatchObject({ cause: `${GIT_FAMILY}:new-context`, proposed: code, suspected: null });
  });

  it('4. files a cause in words as the suspected cause, redacted', () => {
    // Arrange
    const words = `the branch name is read before ${join(checkout, 'src', 'a.ts')} runs`;

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ cause: words })));

    // Assert
    expect(record).toMatchObject({
      cause: 'unknown:new-context',
      proposed: null,
      suspected: 'the branch name is read before src/a.ts runs',
    });
  });

  it('5. files a module it cannot use as unknown, the session\'s word kept and redacted', () => {
    // Act
    const { record, reported } = bugFilingOf(inputOf(bugOf({ module: 'Loop Start', action: `run ${SECRET}!` })));

    // Assert
    expect(record.module).toBe('unknown');
    expect(record.action).toBe('unknown');
    expect(reported).toEqual({ module: 'Loop Start', action: 'run [redacted: GITHUB_TOKEN]!' });
  });

  it('5. lower-cases a usable module and holds it to the vocabulary that is set', () => {
    // Arrange
    const context = { ...CONTEXT, bugRules: { ...CONTEXT.bugRules!, modules: ['loop'] } };

    // Act
    const listed = bugFilingOf(inputOf(bugOf({ module: ' Loop ' }), { context }));
    const unlisted = bugFilingOf(inputOf(bugOf({ module: 'board' }), { context }));

    // Assert
    expect(listed.record.module).toBe('loop');
    expect(listed.reported.module).toBeNull();
    expect(unlisted.record.module).toBe('unknown');
    expect(unlisted.reported.module).toBe('board');
  });

  it('5. renders the summary alone for a keyless entry', () => {
    // Act
    const { record } = bugFilingOf(inputOf(bugOf()));

    // Assert
    expect(bugTitle(record, CONTEXT.bugRules!)).toBe(record.summary!);
  });

  it('6. suggests ci when the CI variable is set, and local otherwise', () => {
    // Act
    const ci = bugFilingOf(inputOf(bugOf(), { context: { ...CONTEXT, env: { CI: 'true' } } }));
    const off = bugFilingOf(inputOf(bugOf(), { context: { ...CONTEXT, env: { CI: 'false' } } }));

    // Assert
    expect(ci.record.environment).toBe('ci');
    expect(off.record.environment).toBe('local');
  });

  it('7. reads the package of the first file of the checkout the artifact names, before paths are taken out', () => {
    // Arrange: a frame outside the checkout comes first, and is passed over
    const artifact = [
      'TypeError: x is not a function',
      '    at far (/elsewhere/x.ts:2:2)',
      `    at near (${join(checkout, 'packages', 'hub', 'src', 'b.ts')}:3:1)`,
    ].join('\n');

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ artifact })));

    // Assert
    expect(record.versions).toContain('package: @scope/hub@1.2.0\npath: packages/hub/src/b.ts');
    expect(record.artifact).toContain('at near (packages/hub/src/b.ts:3:1)');
  });

  it('7. reads the checkout\'s own package for an artifact naming none of its files', () => {
    // Act
    const named = bugFilingOf(inputOf(bugOf({ artifact: 'error at /elsewhere/x.ts:1:1' })));
    const none = bugFilingOf(inputOf(bugOf()));

    // Assert
    for (const { record } of [named, none]) {
      expect(record.versions).toContain('package: root-pkg@0.4.0');
      expect(record.versions).not.toContain('path:');
    }
  });

  it('8. writes the rafa version, the code version and the package', () => {
    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ artifact: 'error at src/a.ts:3:1' }), {
      context: { ...CONTEXT, git: fakeGit('abc1234', true) },
    }));

    // Assert
    expect(record.versions).toBe(`rafa: ${RAFA_VERSION}\ncode: abc1234-dirty\npackage: root-pkg@0.4.0\npath: src/a.ts`);
  });

  it('8. writes the code version as unknown with no git runner', () => {
    // Act
    const { record } = bugFilingOf(inputOf(bugOf(), { context: { ...CONTEXT, git: undefined } }));

    // Assert
    expect(record.versions).toBe(`rafa: ${RAFA_VERSION}\ncode: unknown\npackage: root-pkg@0.4.0`);
  });
});

describe('the Rerun line of a test failure', () => {
  it('names the file and the case of a bun failure, the file with local paths out', () => {
    // Arrange
    const artifact = [
      `${join(checkout, 'src', 'a.test.ts')}:`,
      'error: expect(received).toBe(expected)',
      '(fail) outer > inner > reads the case [0.19ms]',
    ].join('\n');

    // Act
    const { record } = bugFilingOf(inputOf(bugOf({ artifact })));

    // Assert
    expect(record.rerun).toBe('bun test src/a.test.ts -t "outer inner reads the case"');
  });

  it('reads a file > case line', () => {
    expect(rerunOf({ what: 'src/b.test.ts > the group > the case', artifact: null }))
      .toBe('bun test src/b.test.ts -t "the group the case"');
  });

  it('matches the case literally and quotes it for a shell', () => {
    expect(rerunOf({ what: 'red', artifact: 'src/c.test.ts > a (case) [1] "q" $x' }))
      .toBe('bun test src/c.test.ts -t "a \\\\(case\\\\) \\\\[1\\\\] \\"q\\" \\\\\\$x"');
  });

  it('writes nothing for a bug naming no case, and for a case naming no file', () => {
    // Act
    const noCase = bugFilingOf(inputOf(bugOf({ artifact: 'src/a.test.ts:246 failed' })));
    const noFile = rerunOf({ what: 'red', artifact: '(fail) outer > a case [1ms]' });

    // Assert
    expect(noCase.record.rerun).toBeNull();
    expect(noFile).toBeNull();
  });

  it('selects the failing case when a shell runs it, where the ` > ` form selects none', () => {
    // Arrange: a test file whose case name holds what a regex and a shell read
    const dir = mkdtempSync(join(home, 'rerun-'));
    writeFileSync(join(dir, 'x.test.ts'), [
      'import { describe, expect, it } from \'bun:test\';',
      'describe(\'outer\', () => {',
      '  it(\'a (case) [1] "q" $x\', () => { expect(1).toBe(2); });',
      '  it(\'other\', () => {});',
      '});',
    ].join('\n'));
    const rerun = rerunOf({ what: 'red', artifact: 'x.test.ts:\n(fail) outer > a (case) [1] "q" $x [0.10ms]' })!;
    const run = (line: string): string => {
      const result = Bun.spawnSync(['sh', '-c', line.replace(/^bun /, '"$BUN" ')], {
        cwd: dir,
        env: { ...process.env, BUN: process.execPath },
      });
      return `${result.stdout.toString()}${result.stderr.toString()}`;
    };

    // Act
    const selected = run(rerun);
    const control = run('bun test x.test.ts -t "outer > a (case) [1]"');

    // Assert
    expect(selected).toContain('1 filtered out');
    expect(selected).toContain('1 fail');
    expect(control).toContain('matched 0 tests');
  });
});

describe('the values a body is rendered from', () => {
  it('keeps issue-text\'s contract: the what as reported, the artifact with local paths out', () => {
    // Arrange
    const what = `seen with ${SECRET}`;
    const artifact = `error at ${join(checkout, 'src', 'a.ts')}:3:1`;

    // Act
    const { values } = bugFilingOf(inputOf(bugOf({ what, artifact })));

    // Assert
    expect(values).toEqual({
      what,
      artifact: 'error at src/a.ts:3:1',
      key: 'the key',
      refs: '## Refs\n\nnone',
      planStub: 'my-plan',
      taskText: 'Add the widget',
      feedback: 'it went fine',
    });
  });
});

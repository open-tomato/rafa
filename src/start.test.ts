/**
 * Where `start.ts` hands the wrap-up over, and where it points each call.
 *
 * The wrap-up branch of the loop, the release stage around the session
 * and the CI gate after it, lives in `start/wrap-up-run.ts`, and the
 * order of its calls is read beside that module. This file's first claim
 * is the hand-over: the `if (!taskInfo)` branch calls `runWrapUp` and
 * nothing else, with the run's own root, checkout, config, plan and
 * serving, and then ends the loop.
 *
 * A second claim is where each call is pointed: at the project root,
 * which holds `.rafa/`, or at the checkout git and the sessions run in
 * (`start/checkout.ts`, settled in `start/run-checkout.ts`), and which
 * root every session is served from. The same reader, walked over the
 * whole file, answers each call's arguments as written, and a planted
 * source that hands a dispatch no checkout is its control.
 *
 * `start()` itself is not driven, for the reason
 * `tests/plan-injection.test.ts` gives for not driving it either: it
 * spawns the real CLI with no seam, and reaching its wrap-up branch
 * means a real config, a real session record, a real preflight and a
 * real Claude session. So the wiring is read off the source instead,
 * and read STRUCTURALLY: `start.ts` is parsed with TypeScript, the
 * `if (!taskInfo)` branch is located, and every call inside it is
 * collected in source order with its arguments as written.
 *
 * ## The controls
 *
 * A reader that found nothing would pass a "calls nothing else" claim on
 * no source at all, and one that stopped at the first call would pass it
 * on any. So a PLANTED branch that still makes a release call of its own
 * beside the hand-over is read as making both.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

/** One call inside the branch, as the source writes it. */
interface BranchCall {
  /** The function's name: an identifier, or the member of a property access. */
  readonly name: string;
  /** Each argument as it is written, so a case reads what was handed over. */
  readonly args: readonly string[];
  /** The `const` the call's value was bound to, or null when it was not. */
  readonly bound: string | null;
}

/** The name a callee expression carries, or null for a shape with none. */
function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** The `if (!taskInfo)` branch of a source, as its then-statement. */
function wrapUpBranch(file: ts.SourceFile): ts.Statement {
  const branches: ts.Statement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && node.expression.getText(file) === '!taskInfo') {
      branches.push(node.thenStatement);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  const [branch] = branches;
  if (branch === undefined) throw new Error('the source holds no `if (!taskInfo)` branch');
  return branch;
}

/**
 * Every call the wrap-up branch of `source` makes, in source order.
 *
 * The walk goes into nested statements, so a call made inside a block
 * of the branch, or inside an argument, is read as well.
 */
function wrapUpCalls(source: string): readonly BranchCall[] {
  const file = ts.createSourceFile('start.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: BranchCall[] = [];
  const visit = (node: ts.Node, bound: string | null): void => {
    const binding = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      ? node.name.text
      : bound;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name !== null) {
        found.push({ name, args: node.arguments.map((argument) => argument.getText(file)), bound: binding });
      }
    }
    ts.forEachChild(node, (child) => visit(child, binding));
  };
  visit(wrapUpBranch(file), null);
  return found;
}

/** Every call `source` makes, in source order, wherever it sits. */
function everyCall(source: string): readonly BranchCall[] {
  const file = ts.createSourceFile('start.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: BranchCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name !== null) found.push({ name, args: node.arguments.map((argument) => argument.getText(file)), bound: null });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The bindings a source imports from `module`, sorted. */
function importedFrom(source: string, module: string): readonly string[] {
  const file = ts.createSourceFile('start.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== module) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) names.push(element.name.text);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/** `start.ts` as it stands, the source every case below reads. */
const START = readFileSync(new URL('./start.ts', import.meta.url), 'utf8');

/** Its wrap-up branch, and the names it calls in order. */
const CALLS = wrapUpCalls(START);
const NAMES = CALLS.map((call) => call.name);

/** The first call named `name`, or a failure naming what was found instead. */
function callTo(calls: readonly BranchCall[], name: string): BranchCall {
  const found = calls.find((call) => call.name === name);
  if (found === undefined) {
    throw new Error(`the branch makes no call to ${name}; it calls ${calls.map((call) => call.name).join(', ')}`);
  }
  return found;
}

/**
 * A source holding one wrap-up branch made of `body`, for a control to
 * read: the same shape `start.ts` carries, with the statements a case
 * wants to see the reader report.
 */
function plantedStart(body: readonly string[]): string {
  return [
    'async function run(): Promise<void> {',
    '  while (true) {',
    '    if (!taskInfo) {',
    ...body.map((line) => `      ${line}`),
    '    }',
    '  }',
    '}',
  ].join('\n');
}

describe('the wrap-up branch of start.ts', () => {
  it('hands the whole wrap-up to runWrapUp and calls nothing else', () => {
    expect(NAMES).toEqual(['runWrapUp']);
    expect(importedFrom(START, './start/wrap-up-run.js')).toEqual(['runWrapUp']);
  });

  it('reads a branch making a release call of its own beside the hand-over as making both', () => {
    // The control for the case above: the same reader over a branch that
    // still prepares the release itself names both calls, so the claim
    // that the branch calls nothing else could have failed.
    const branch = plantedStart(['const release = prepareReleaseStage({ repoRoot });', 'await runWrapUp({ repoRoot });', 'break;']);

    expect(wrapUpCalls(branch).map((call) => call.name)).toEqual(['prepareReleaseStage', 'runWrapUp']);
  });

  it('hands it the run\'s session, root, checkout, config, plan, serving, lessons, expectation and CI flags', () => {
    const [input] = callTo(CALLS, 'runWrapUp').args;
    const fields = [
      'session,',
      'repoRoot,',
      'checkout,',
      'settings: runConfig.config,',
      'planStub,',
      'planContent,',
      'settingSources,',
      'serving,',
      'wrapUpLearning,',
      'expected,',
      'ciWait,',
      'ciTimeoutMin,',
      'ciAttempts,',
    ];

    for (const field of fields) expect(input).toContain(field);
  });

  it('ends the loop once runWrapUp returns', () => {
    const file = ts.createSourceFile('start.ts', START, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const branch = wrapUpBranch(file);
    if (!ts.isBlock(branch)) throw new Error('the wrap-up branch is not a block');
    const statements = branch.statements.map((statement) => statement.getText(file));

    expect(statements.at(-1)).toBe('break;');
  });
});

describe('the two directories start.ts points each call at', () => {
  const EVERY = everyCall(START);

  /** The first argument of the first call to `name`, as written. */
  const firstArgument = (name: string): string => callTo(EVERY, name).args[0] ?? '';

  it('settles the checkout and its branch from the project root and the configured worktree directory', () => {
    // Which checkout, the started one or the worktree `--as-worktree`
    // adds, is `start/run-checkout.ts`'s, and its suite drives both.
    const input = firstArgument('settleRunCheckout');

    expect(START).toContain('const { checkout, branch } = await settleRunCheckout({');
    expect(input).toContain('projectRoot: repoRoot,');
    expect(input).toContain('worktreeDir: runConfig.config.loopWorktreeDir,');
    expect(input).toContain('args,');
    expect(input).not.toContain('checkout');
  });

  it('reads no directory or branch of its own beside that settling', () => {
    // A second reading here would let the guard and the record name a
    // branch the worktree does not hold.
    for (const name of ['resolveRunDirs', 'getCurrentBranch', 'resolveRunBranch', 'addRunWorktree']) {
      expect(EVERY.some((call) => call.name === name)).toBe(false);
    }
  });

  it('guards and records the branch that settling answered, and commits in the checkout', () => {
    expect(callTo(EVERY, 'guardRunBranch').args).toEqual(['planStub', 'branch', 'args']);
    expect(firstArgument('openRunSession')).toContain('branch,');
    expect(callTo(EVERY, 'announceRunDirs').args).toEqual(['{ projectRoot: repoRoot, checkout }']);
    expect(firstArgument('finishCleanExit')).toContain('repoRoot: checkout,');
  });

  it('serves every session from the project root while spawning it in the checkout', () => {
    // The served directory is `.rafa/runs/<id>/served/` under this root
    // (`start/serving.ts`), so a worktree run's sessions are served the
    // main checkout's `.rafa/`, and the same `serving` reaches both doors.
    expect(START).toContain('const serving: SessionServing = { root: repoRoot, run: session.id,');
    expect(firstArgument('dispatchTask')).toContain('serving,');
    // The wrap-up is handed that `serving` too, and hands it to its
    // session (`start/wrap-up-run.test.ts`).
    expect(firstArgument('runWrapUp')).toContain('serving,');
  });

  it('dispatches each task with the project root and the checkout both', () => {
    const input = firstArgument('dispatchTask');

    expect(input).toContain('repoRoot,');
    expect(input).toContain('checkout,');
    expect(callTo(EVERY, 'renderProgressForDispatch').args).toEqual(['repoRoot', 'planStub', 'checkout']);
  });

  it('dispatches each task with the HEAD the checkout is held to as its base', () => {
    // `expected.head` is the task's base: `advanceExpectation` moves it on
    // to each task's commit, so the next task is handed the commit it sits
    // on. It is read once, before the dispatch, since the task step after
    // the commit needs the base the expectation no longer holds.
    expect(START).toContain('const base = expected.head;');
    expect(firstArgument('dispatchTask')).toMatch(/^\s*base,$/m);
  });

  it('reads a dispatch handed no base as handed none', () => {
    // The control for the case above: a literal without the field reads without it.
    const planted = everyCall('async function run() {\n  await dispatchTask({\n    taskInfo,\n    repoRoot,\n  });\n}');

    expect(callTo(planted, 'dispatchTask').args[0]).not.toMatch(/^\s*base,$/m);
  });

  it('reads a dispatch handed no checkout as handed none', () => {
    // The control for the case above: the reader answers what is written,
    // so a dispatch literal without the field reads without it.
    const planted = everyCall('async function run() { await dispatchTask({ taskInfo, repoRoot, home }); }');

    expect(callTo(planted, 'dispatchTask').args[0]).not.toContain('checkout');
  });

  it('hands the wrap-up the project root and the checkout both', () => {
    // Which of the two each release, session and CI gate call inside it is
    // pointed at is read beside `start/wrap-up-run.ts`.
    const input = firstArgument('runWrapUp');

    expect(input).toContain('repoRoot,');
    expect(input).toContain('checkout,');
    expect(input).not.toContain('repoRoot: checkout');
  });

  it('keeps the config, the plan, the session record, the preflight, the pause and triage at the project root', () => {
    expect(firstArgument('loadRunConfig')).toContain('root: repoRoot');
    expect(firstArgument('resolvePlanPath')).toBe('repoRoot');
    expect(firstArgument('openRunSession')).toContain('repoRoot,');
    expect(firstArgument('runStartPreflight')).toContain('repoRoot,');
    expect(firstArgument('holdWhilePaused')).toContain('repoRoot,');
    expect(firstArgument('createStartTriage')).toContain('repoRoot,');
    for (const name of ['loadRunConfig', 'runStartPreflight', 'holdWhilePaused', 'createStartTriage']) {
      expect(firstArgument(name)).not.toContain('checkout');
    }
    // The session record is written at the project root, and handed the
    // checkout only to record it as the run's `worktree` (`start/session.ts`).
    expect(firstArgument('openRunSession')).not.toContain('repoRoot: checkout');
    expect(firstArgument('openRunSession')).toMatch(/\bcheckout \}$/);
  });
});

describe('where start.ts takes the suite steps', () => {
  const EVERY = everyCall(START);

  /** The index of the first call to `name`, failing when there is none. */
  const indexOf = (calls: readonly BranchCall[], name: string): number => calls.indexOf(callTo(calls, name));

  it('makes them once, over the run\'s root, checkout, tracker, session, config, plan and SIGINT flag', () => {
    const input = callTo(EVERY, 'createRunSuiteSteps').args[0] ?? '';

    expect(EVERY.filter((call) => call.name === 'createRunSuiteSteps')).toHaveLength(1);
    for (const field of ['repoRoot,', 'checkout,', 'trackerPath,', 'sessionId: session.id,', 'settings: runConfig.config,', 'planContent,', 'isInterrupted: () => interrupted,']) {
      expect(input).toContain(field);
    }
  });

  it('takes the steps before a session past the loop guard, ahead of progress.txt and of the wrap-up', () => {
    // The baseline, the stage steps and the pre-wrap-up step all sit in
    // this one call: `start/suite-steps-run.test.ts` reads which runs when.
    expect(callTo(EVERY, 'beforeSession').args).toEqual(['taskInfo']);
    const before = indexOf(EVERY, 'beforeSession');
    expect(indexOf(EVERY, 'haltIfWrapUpMoved')).toBeLessThan(before);
    expect(before).toBeLessThan(indexOf(EVERY, 'renderProgressForDispatch'));
    expect(before).toBeLessThan(indexOf(EVERY, 'runWrapUp'));
    expect(before).toBeLessThan(indexOf(EVERY, 'dispatchTask'));
  });

  it('stops the run when a step before a session is red, and breaks on an interrupt it ran through', () => {
    expect(START).toContain('if (!(await suiteSteps.beforeSession(taskInfo))) return;\n      if (interrupted) break;');
  });

  it('takes the task step from the task\'s base once its commit is stored, before the usage check', () => {
    expect(callTo(EVERY, 'afterTask').args).toEqual(['taskInfo', 'base']);
    const after = indexOf(EVERY, 'afterTask');
    expect(indexOf(EVERY, 'finishCleanExit')).toBeLessThan(after);
    expect(indexOf(EVERY, 'advanceExpectation')).toBeLessThan(after);
    expect(after).toBeLessThan(indexOf(EVERY, 'checkUsage'));
    expect(START).toContain('if (!(await suiteSteps.afterTask(taskInfo, base))) return;');
  });

  it('reads a task step taken before the commit as taken before it', () => {
    // The control for the ordering above: the reader answers the order
    // written, so a planted loop taking the step first reads that way.
    const planted = everyCall([
      'async function run() {',
      '  if (!(await suiteSteps.afterTask(taskInfo, base))) return;',
      '  const finished = finishCleanExit({ trackerPath });',
      '}',
    ].join('\n'));

    expect(indexOf(planted, 'afterTask')).toBeLessThan(indexOf(planted, 'finishCleanExit'));
  });

  it('keeps the wrap-up branch free of the pre-wrap-up step', () => {
    // It runs in `beforeSession(null)` ahead of the branch, which still
    // hands the whole wrap-up to `runWrapUp` alone (the first describe).
    expect(NAMES).not.toContain('beforeSession');
    expect(NAMES).not.toContain('runPreWrapUpStep');
  });
});

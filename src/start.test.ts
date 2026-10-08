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
 * `start()` is not driven in process, for the reason
 * `tests/plan-injection.test.ts` gives for not driving it either: it
 * spawns the real CLI with no seam, and reaching its wrap-up branch
 * means a real config, a real session record, a real preflight and a
 * real Claude session. So the wiring is read off the source instead,
 * and read STRUCTURALLY: `start.ts` is parsed with TypeScript, the
 * `if (!taskInfo)` branch is located, and every call inside it is
 * collected in source order with its arguments as written.
 *
 * ## The one driven run
 *
 * The last describe spawns the CLI instead, twice over one scratch
 * repository, to prove what the structural reading cannot: the order a
 * red task step and a restart leave behind. Run 1's first task breaks a
 * test its own diff reaches, so its task step is red; the run halts with
 * one `[BLOCKED]` repair line inserted above the first open plan task,
 * under that task's stage heading. Run 2 finds the first stage's own
 * step still due, since the halt came before it, and must still start a
 * task session for the repair ahead of it: no suite step runs before
 * that session, so none is recorded and the stand-in is called once more.
 *
 * ## The retried run
 *
 * One more describe spawns a run under `--retry=1` whose first session
 * exits 1 and whose second blocks its task in its report, and reads the
 * run's events file: the granted retry emits `retry` and no
 * `task-blocked`, which only the stop the run halts on emits, so
 * `rafa loop wait --until=blocked` never answers a run still going.
 * A second run there commits in its first session before exiting 1: the
 * checkout has moved from the loop's last commit, so no retry is granted
 * and the task keeps its own stop, never the guard's {@link CHECKOUT_MOVED}.
 *
 * ## The controls
 *
 * A reader that found nothing would pass a "calls nothing else" claim on
 * no source at all, and one that stopped at the first call would pass it
 * on any. So a PLANTED branch that still makes a release call of its own
 * beside the hand-over is read as making both.
 */
import type { EventLine } from './loop/events-file.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { eventsFileOf, readEventsFrom } from './loop/events-file.js';
import { readSessions } from './loop/sessions.js';
import { CHECKOUT_MOVED } from './start/checkout-guard.js';
import { BLOCKER_PROMPT_PREFIX } from './start/dispatch.js';
import { plantProjectConfig } from './tests/cli-capture.js';
import { gitIdentityEnv } from './tests/git-identity.js';
import { scratchHomeEnv } from './tests/scratch-home-env.js';
import { hostToolDirs } from './tests/stand-in-gh.js';
import { findNextTask } from './utils/tracker.js';

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
    // The wrap-up branch is the braced one: a bare `if (!taskInfo) emitLoopEvent(...)`
    // announcing the tests phase ahead of it is a statement, not the branch.
    if (ts.isIfStatement(node) && node.expression.getText(file) === '!taskInfo' && ts.isBlock(node.thenStatement)) {
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
/** The one call besides the hand-over the branch may make: the loop's event line. */
const ALLOWED_BESIDE_HAND_OVER = new Set(['emitLoopEvent']);
const NAMES = CALLS.map((call) => call.name).filter((name) => !ALLOWED_BESIDE_HAND_OVER.has(name));

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

  it('hands it the run\'s session, root, checkout, config, plan, serving, lessons, expectation, CI flags and passed-over tasks', () => {
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
      'passedOver,',
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

  it('stops the run when a step before a session is red, unless it retries or a decision goes on, and breaks on an interrupt it ran through', () => {
    expect(START).toContain(
      'const suiteGate = decisions.gateForcedWrapUp(await suiteSteps.beforeSession(taskInfo), passedOver, suiteSteps.lastPreWrapUp());\n'
      + '      if (suiteGate === \'stop\') {\n'
      + '        if (!suiteSteps.stoppedOnSignal() && retries.retry(\'suite step red\')) continue;\n'
      + '        if (!suiteSteps.stoppedOnSignal() && await decisions.atStop({ kind: \'suite-red\' })) continue;\n'
      + '        emitLoopEvent({ kind: \'halt\', reason: \'suite step red\' });\n        return;\n      }\n      if (interrupted) break;',
    );
  });

  it('turns back to findNextTask on a pre-wrap-up repair, ahead of progress.txt and the wrap-up', () => {
    // `continue` re-reads the tracker, where `findNextTask` answers the
    // blocked repair first; `start/suite-steps-run.test.ts` reads when
    // `beforeSession` answers `repair`.
    expect(START).toContain('      if (interrupted) break;\n      if (suiteGate === \'repair\') continue;\n');
    const turn = START.indexOf('if (suiteGate === \'repair\') continue;');
    expect(turn).toBeGreaterThan(START.indexOf('const taskInfo = findNextTask(trackerContent, { skipLines: decisions.skipLines(trackerContent) });'));
    expect(START.indexOf('const taskInfo = findNextTask(trackerContent, { skipLines: decisions.skipLines(trackerContent) });')).not.toBe(-1);
    expect(turn).toBeLessThan(START.indexOf('renderProgressForDispatch(repoRoot'));
    expect(turn).toBeLessThan(START.indexOf('await runWrapUp('));
  });

  it('takes the task step from the task\'s base once its commit is stored', () => {
    expect(callTo(EVERY, 'afterTask').args).toEqual(['taskInfo', 'base']);
    const after = indexOf(EVERY, 'afterTask');
    expect(indexOf(EVERY, 'finishCleanExit')).toBeLessThan(after);
    expect(indexOf(EVERY, 'advanceExpectation')).toBeLessThan(after);
    expect(START).toContain(
      'if (!(await suiteSteps.afterTask(taskInfo, base))) {\n'
      + '        if (!suiteSteps.stoppedOnSignal() && retries.retry(\'suite step red\')) continue;\n'
      + '        if (!suiteSteps.stoppedOnSignal() && await decisions.atStop({ kind: \'suite-red\' })) continue;\n'
      + '        emitLoopEvent({ kind: \'halt\', reason: \'suite step red\' });\n        return;\n      }',
    );
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

describe('where start.ts retries a stop', () => {
  const EVERY = everyCall(START);

  it('makes the run\'s retries once, from --retry over the configured count, on the SIGINT flag and the checkout as the guard reads it', () => {
    const made = EVERY.filter((call) => call.name === 'createRunRetries');

    expect(made).toHaveLength(1);
    expect(made[0]?.args[0]).toContain('retries: resolveRunRetries(retry, configuredRetries(runConfig.config, continueRun.on)),');
    expect(made[0]?.args[0]).toContain('isInterrupted: () => interrupted,');
    expect(made[0]?.args[0]).toContain('isCheckoutHeld: () => guardCheckout(expected).held,');
  });

  it('asks for a retry at the four retry-safe stops alone, in loop order', () => {
    // Each `retries.retry(...)` is a stop that may `continue`; a fifth
    // would retry a stop the module note of `start/retry-budget.ts`
    // never names, such as a moved checkout or a report that blocks.
    expect(EVERY.filter((call) => call.name === 'retry').map((call) => call.args)).toEqual([
      ['\'suite step red\''],
      ['`session exited ${exitCode}`'],
      ['\'left neither a report nor a commit\''],
      ['\'suite step red\''],
    ]);
  });

  it('guards each retry with the reading that tells its stop apart, continues on a grant, and emits task-blocked only on a refusal', () => {
    expect(START).toContain('        await storeReport(\'failed\');\n'
      + '        const failed = { kind: \'task-blocked\', position, reason: `session exited ${exitCode}` } as const;\n'
      + '        if (retries.retry(`session exited ${exitCode}`)) continue;\n'
      + '        if (await decisions.atStop({ kind: \'session-exit\', taskInfo, exitCode, stopEvent: failed })) continue;\n'
      + '        activeOutput().error(`\\n❌ Task failed (exit ${exitCode}). Marked as blocked. Run again to retry.`);\n'
      + '        emitLoopEvent(failed);\n        return;\n');
    // The line telling the operator to run again is printed only once the
    // run really stops: never ahead of a retry or a decision that goes on.
    expect(START.match(/Run again to retry\./g)).toHaveLength(1);
    expect(START).toContain('        const held = { kind: \'task-blocked\', position, reason: finished.holds[0] ?? \'held by its report\' } as const;\n'
      + '        if (heldOnNothingLeftBehind(finished) && retries.retry(\'left neither a report nor a commit\')) continue;\n'
      + '        if (await decisions.atStop({ kind: \'clean-exit\', taskInfo, finished, stopEvent: held })) continue;\n'
      + '        emitLoopEvent(held);\n        return;\n');
    expect(START.match(/if \(!suiteSteps\.stoppedOnSignal\(\) && retries\.retry\('suite step red'\)\) continue;/g)).toHaveLength(2);
  });

  it('retries no exit on its budget and no interrupted task, which end before the nonzero exit', () => {
    const budget = START.indexOf('if (isBudgetExit(dispatch)) {');
    const interrupt = START.indexOf('if (interrupted) {\n        updateTrackerLine(');
    const failed = START.indexOf('if (exitCode !== 0) {');

    expect([budget, interrupt].every((at) => at !== -1 && at < failed)).toBe(true);
    const budgetBranch = START.slice(budget, START.indexOf('}', START.indexOf('return;', budget)));
    expect(budgetBranch).not.toContain('retries.retry(');
  });

  it('reads a planted fifth retry as one more, so the list above can fail', () => {
    const planted = everyCall([
      'async function run() {',
      '  if (retries.retry(\'suite step red\')) continue;',
      '  if (retries.retry(\'checkout moved\')) continue;',
      '}',
    ].join('\n'));

    expect(planted.filter((call) => call.name === 'retry')).toHaveLength(2);
  });
});

describe('where start.ts hands a stop to a --continue decision', () => {
  const EVERY = everyCall(START);

  it('makes the run\'s decisions once, after its retries, seeded from the plan\'s last stopped run under --continue alone', () => {
    const made = EVERY.filter((call) => call.name === 'createRunDecisions');

    expect(made).toHaveLength(1);
    for (const field of ['continueArgs: continueRun,', 'retries,', 'session,', 'isInterrupted: () => interrupted,']) {
      expect(made[0]?.args[0]).toContain(field);
    }
    expect(made[0]?.args[0]).toContain('seed: continueRun.on\n        ? readPreviousPassOver(repoRoot, { planPath, planStub, branch, checkout })\n        : [],');
    expect(EVERY.indexOf(callTo(EVERY, 'createRunRetries'))).toBeLessThan(EVERY.indexOf(callTo(EVERY, 'createRunDecisions')));
  });

  it('asks at the four stops a retry is asked at, each right after its retry, and at the held report', () => {
    expect(EVERY.filter((call) => call.name === 'atStop').map((call) => call.args[0])).toEqual([
      '{ kind: \'suite-red\' }',
      '{ kind: \'session-exit\', taskInfo, exitCode, stopEvent: failed }',
      '{ kind: \'clean-exit\', taskInfo, finished, stopEvent: held }',
      '{ kind: \'suite-red\' }',
    ]);
  });

  it('asks at no budget exit, interrupt or moved checkout', () => {
    for (const from of ['if (isBudgetExit(dispatch)) {', 'if (interrupted) {\n        updateTrackerLine(', 'if (dispatch.halted) {']) {
      const at = START.indexOf(from);
      expect(at).not.toBe(-1);
      expect(START.slice(at, START.indexOf('return;', at))).not.toContain('decisions.atStop(');
    }
  });

  it('ends at the plan\'s end on passed-over tasks before the loop guard, and releases defers once a task is done', () => {
    expect(START).toContain('      const passedOver = taskInfo\n        ? []\n        : decisions.atPlanEnd(trackerContent);\n');
    expect(START).toContain('      if (await decisions.atFirstTask(taskInfo, trackerContent)) continue;\n');
    expect(START.indexOf('decisions.atFirstTask(')).toBeLessThan(START.indexOf('haltIfCheckoutMoved({ expected, trackerPath, taskInfo })'));
    expect(START.indexOf('decisions.atPlanEnd(')).toBeLessThan(START.indexOf('haltIfWrapUpMoved({ expected, before: \'dispatch\' })'));
    expect(START.indexOf('decisions.taskDone(taskInfo);')).toBeGreaterThan(START.indexOf('emitLoopEvent(held);'));
    expect(START.indexOf('decisions.taskDone(taskInfo);')).toBeLessThan(START.indexOf('emitLoopEvent({ kind: \'task-done\''));
  });
});

/** The statements around the run's session record, as `start.ts` writes them. */
interface SessionStatements {
  /** The statement straight after `const session = openRunSession(...)`, as written. */
  readonly next: string;
  /** The `try` the session record's statements open, or null when none follows. */
  readonly run: ts.TryStatement | null;
  /** The file, for each node's text. */
  readonly file: ts.SourceFile;
}

/**
 * The statement after `const session = openRunSession(...)` in `source`,
 * and the first `try` after it in the same block: the run whose
 * `finally` writes the session's end.
 */
function sessionStatements(source: string): SessionStatements {
  const file = ts.createSourceFile('start.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: SessionStatements | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isBlock(node)) {
      const index = node.statements.findIndex((statement) => statement.getText(file).startsWith('const session = openRunSession('));
      if (index !== -1) {
        const after = node.statements.slice(index + 1);
        found = {
          next: after[0]?.getText(file) ?? '',
          run: after.find((statement) => ts.isTryStatement(statement)) ?? null,
          file,
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (found === null) throw new Error('the source opens no session with `const session = openRunSession(...)`');
  return found;
}

/** The run's `catch`: its variable's name and its statements as written, or null when it has none. */
function catchOf(statements: SessionStatements): { readonly name: string; readonly body: readonly string[] } | null {
  const clause = statements.run?.catchClause;
  if (clause === undefined) return null;
  const declaration = clause.variableDeclaration;
  return {
    name: declaration === undefined
      ? ''
      : declaration.name.getText(statements.file),
    body: clause.block.statements.map((statement) => statement.getText(statements.file)),
  };
}

/** The statements of the run's `finally`, as written, or none when it has none. */
function finallyOf(statements: SessionStatements): readonly string[] {
  return statements.run?.finallyBlock?.statements.map((statement) => statement.getText(statements.file)) ?? [];
}

/** A source opening a session and a run around `between` and `rest`, for a control to read. */
function plantedRun(between: readonly string[], rest: readonly string[]): string {
  return [
    'async function start(): Promise<void> {',
    '  const session = openRunSession({ repoRoot });',
    ...between.map((line) => `  ${line}`),
    ...rest.map((line) => `  ${line}`),
    '}',
  ].join('\n');
}

describe('the events file start.ts binds around the run', () => {
  const STATEMENTS = sessionStatements(START);

  it('binds the run\'s events file under the project root straight after opening the session record', () => {
    expect(STATEMENTS.next).toBe('bindEventsFile(repoRoot, session.id);');
    expect(importedFrom(START, './start/loop-events.js')).toEqual(expect.arrayContaining(['bindEventsFile', 'unbindEventsFile']));
  });

  it('unbinds it in the run\'s finally, beside the session\'s end', () => {
    expect(finallyOf(STATEMENTS)).toEqual(['unbindEventsFile();', 'session.end();']);
  });

  it('emits an error event carrying what the run threw from its catch, but for a LoopEnd, then rethrows it', () => {
    const caught = catchOf(STATEMENTS);

    // A `LoopEnd` is the end a `--continue` run chose, its own events
    // emitted before it was thrown (`start/continue-exits.ts`).
    expect(caught).toEqual({
      name: 'error',
      body: [
        'if (!(error instanceof LoopEnd)) emitLoopEvent({ kind: \'error\', message: messageOf(error) });',
        'throw error;',
      ],
    });
  });

  it('reads a bind made after the run as no bind straight after the session record', () => {
    const planted = sessionStatements(plantedRun(['try {', '  run();', '} finally {', '  session.end();', '}'], ['bindEventsFile(repoRoot, session.id);']));

    expect(planted.next).not.toBe('bindEventsFile(repoRoot, session.id);');
    expect(finallyOf(planted)).toEqual(['session.end();']);
  });

  it('reads a catch that swallows what the run threw as one without the rethrow', () => {
    const planted = sessionStatements(plantedRun(
      ['bindEventsFile(repoRoot, session.id);'],
      ['try {', '  run();', '} catch (error) {', '  emitLoopEvent({ kind: \'error\', message: messageOf(error) });', '} finally {', '  unbindEventsFile();', '}'],
    ));

    expect(planted.next).toBe('bindEventsFile(repoRoot, session.id);');
    expect(catchOf(planted)?.body).not.toContain('throw error;');
  });

  it('reads a run with no catch as one emitting no error event', () => {
    const planted = sessionStatements(plantedRun(['bindEventsFile(repoRoot, session.id);'], ['try {', '  run();', '} finally {', '  unbindEventsFile();', '}']));

    expect(catchOf(planted)).toBeNull();
  });
});

/** The plan stub the driven run's scratch repository runs. */
const STUB = 'start-red-task-step';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first stage's only task: breaks a test its own diff reaches, so its task step is red. */
const BREAKING_TASK = 'Change the greeting, breaking the test that reads it';

/** The second stage's only task: the first open plan task once the first is done. */
const LATER_TASK = 'Use the greeting somewhere else';

/** The second stage's heading, which the repair line must sit under. */
const LATER_HEADING = '# Stage: second';

/** The plan: one task per stage, so the first stage's own step is due the moment its task is done. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: first',
  '',
  `- [ ] ${BREAKING_TASK}`,
  '',
  LATER_HEADING,
  '',
  `- [ ] ${LATER_TASK}`,
  '',
].join('\n');

/** The module the first task changes, and the test importing it. */
const GREETING_FILE = 'greeting.ts';
const GREETING_TEST_FILE = 'greeting.test.ts';

/** How long one spawned `loop start` run may take: a few real `bun test` runs of a tiny project. */
const RUN_TIMEOUT_MS = 90_000;

/** This describe's own test timeout: two spawned runs. */
const CASE_TIMEOUT_MS = 150_000;

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-start-red-task-step-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  /** Where the stand-in keeps each call's count, arguments and prompt. */
  readonly calls: string;
  /** The PATH a spawned run gets: the stand-in's `bin/`, git's own directory and the system tools' (`hostToolDirs`), then bun's own. */
  readonly path: string;
}

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** `printf '%s\n' <line>` for each of `lines`, one per shell statement, each a single-quoted word. */
function printLines(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `printf '%s\\n' '${line.replace(/'/g, '\'\\\'\'')}'`);
}

/** The `rafa:report` block a call answers with, `status` and `feedback` its own. */
function reportLines(status: 'done' | 'blocked', feedback: string): readonly string[] {
  return [
    `${feedback}.`,
    '',
    `${FENCE}rafa:report`,
    `status: ${status}`,
    `feedback: "${feedback}"`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
    '',
  ];
}

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number.
 * Call 1 rewrites {@link GREETING_FILE} so {@link GREETING_TEST_FILE}
 * fails, and answers `done`. Every later call touches nothing and answers
 * `blocked`, so the repair session of run 2 ends the run at once and no
 * step after it muddies what ran before it.
 */
function standInScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$calls/$n.args"',
    '/bin/cat > "$calls/$n.prompt"',
    'if [ "$n" -eq 1 ]; then',
    `  printf '%s\\n' 'export function greeting(): string { return "goodbye"; }' > ${GREETING_FILE}`,
    ...printLines(reportLines('done', 'changed the greeting')),
    'else',
    ...printLines(reportLines('blocked', 'read the blocker the repair prompt carried')),
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH} holding {@link PLAN}, and in
 * its seed commit a green {@link GREETING_TEST_FILE} over
 * {@link GREETING_FILE}. `.plans/`, `.rafa/` and `progress.txt` are
 * gitignored, as a real project's are.
 */
function plant(script: (calls: string) => string = standInScript): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');

  const claude = join(bin, 'claude');
  writeFileSync(claude, script(calls), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, GREETING_FILE), 'export function greeting(): string { return \'hello\'; }\n', 'utf8');
  writeFileSync(join(repo, GREETING_TEST_FILE), [
    'import { expect, test } from \'bun:test\';',
    'import { greeting } from \'./greeting\';',
    '',
    'test(\'greets\', () => {',
    '  expect(greeting()).toBe(\'hello\');',
    '});',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo);

  return { repo, home, calls, path: [bin, ...hostToolDirs(), dirname(bunBinary)].join(delimiter) };
}

/** Runs `rafa loop start` over the planted plan in `scratch`'s repository, with `flags` after its own, waiting for it to finish. */
function runLoopStart(scratch: Scratch, flags: readonly string[] = []): number | null {
  const entry = fileURLToPath(new URL('./rafa.ts', import.meta.url));
  const run = Bun.spawnSync([process.execPath, entry, 'loop', 'start', `--plan=.plans/PLAN-${STUB}.md`, '--no-ci-wait', '--inject=full', ...flags], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: RUN_TIMEOUT_MS,
  });
  return run.exitCode;
}

/** The call count the stand-in has recorded so far, or `0` before any call. */
function callCount(scratch: Scratch): number {
  try {
    return Number(readFileSync(join(scratch.calls, 'count'), 'utf8').trim());
  } catch {
    return 0;
  }
}

/**
 * A stand-in `claude` whose first call runs `first`, shell lines run in
 * the checkout, and exits 1, and whose every later call touches nothing
 * and answers `blocked`: a run that retries the first call stops on the
 * second, a report that blocks its task, which no retry is asked for.
 */
function failingFirstStandIn(first: readonly string[]): (calls: string) => string {
  return (calls) => [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    '/bin/cat > /dev/null',
    'if [ "$n" -eq 1 ]; then',
    ...first.map((line) => `  ${line}`),
    '  exit 1',
    'fi',
    ...printLines(reportLines('blocked', 'read the blocked line the retry dispatched')),
    'exit 0',
    '',
  ].join('\n');
}

/** Every loop event the scratch repository's runs wrote, in run order and then file order. */
function runEvents(scratch: Scratch): readonly EventLine[] {
  return readSessions(scratch.repo).flatMap((record) => {
    const read = readEventsFrom(eventsFileOf(scratch.repo, record), 0);
    return read.kind === 'read'
      ? read.events
      : [];
  });
}

/** The kinds of every suite step recorded for the scratch repository's runs, in order. */
function stepKinds(scratch: Scratch): readonly string[] {
  return readSessions(scratch.repo).flatMap((record) => (record.steps ?? []).map((step) => step.kind));
}

describe('a run whose task step goes red, over a real bun test', () => {
  it('halts with one repair line above the first open task, and restarts on a session for it before any suite step', () => {
    const scratch = plant();
    const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);

    // Run 1: the first task breaks the test its diff reaches, so its task
    // step is red and the run halts before the second task is dispatched.
    expect(runLoopStart(scratch)).toBe(0);
    expect(callCount(scratch)).toBe(1);
    expect(stepKinds(scratch)).toEqual(['baseline', 'task']);

    const tracker = readFileSync(trackerPath, 'utf8');
    const lines = tracker.split('\n');
    expect(lines.filter((line) => line.startsWith('- [BLOCKED] '))).toHaveLength(1);
    expect(tracker).toContain(`- [x] ${BREAKING_TASK}`);
    expect(tracker).toContain(`- [ ] ${LATER_TASK}`);

    // The repair sits directly above the first open task, under that
    // task's own stage heading, and the task itself is left as it was.
    const repairLine = lines.findIndex((line) => line.startsWith('- [BLOCKED] '));
    const laterLine = lines.indexOf(`- [ ] ${LATER_TASK}`);
    expect(lines.indexOf(LATER_HEADING)).toBeLessThan(repairLine);
    expect(repairLine).toBeLessThan(laterLine);

    const repair = findNextTask(tracker);
    expect(repair?.status).toBe('blocked');
    expect(repair?.task).toMatch(/^Repair the red task step at commit [0-9a-f]{12} {2}\{agent=build-error-resolver\}$/);
    expect(repair?.blocker).toContain(GREETING_TEST_FILE);

    // Run 2: the first stage's step is due now (its task is done and the
    // ledger holds nothing for it), yet the repair gets its session first.
    // The stand-in is called a second time, with the blocker in its prompt
    // and the repair's agent in its arguments, and no step is recorded
    // after run 1's: none ran before that session.
    expect(runLoopStart(scratch)).toBe(0);
    expect(callCount(scratch)).toBe(2);
    expect(readFileSync(join(scratch.calls, '2.prompt'), 'utf8')).toContain(`${BLOCKER_PROMPT_PREFIX}${repair?.blocker ?? ''}`);
    expect(readFileSync(join(scratch.calls, '2.args'), 'utf8')).toContain('--agent\nbuild-error-resolver\n');
    expect(stepKinds(scratch)).not.toContain('stage');
    expect(stepKinds(scratch).filter((kind) => kind === 'task')).toHaveLength(1);
  }, CASE_TIMEOUT_MS);
});

describe('a run that retries a session that exited nonzero, over a real loop', () => {
  it('emits only the retry for the stop it retries, and task-blocked once, for the stop it halts on', () => {
    const scratch = plant(failingFirstStandIn([]));

    // The first session exits 1 and is retried; the second blocks its
    // task in its report, a stop no retry is asked for, and the run halts.
    expect(runLoopStart(scratch, ['--retry=1'])).toBe(0);
    expect(callCount(scratch)).toBe(2);

    const told = runEvents(scratch)
      .filter((event) => ['task-start', 'task-blocked', 'retry', 'halt'].includes(event.name))
      .map((event) => [event.name, event.data['reason'] ?? null]);
    expect(told).toEqual([
      ['task-start', null],
      ['retry', 'session exited 1'],
      ['task-start', null],
      ['task-blocked', 'status: blocked'],
    ]);
  }, CASE_TIMEOUT_MS);

  it('grants no retry when the session committed before it exited, so the task keeps its own stop', () => {
    const scratch = plant(failingFirstStandIn([
      'printf \'%s\\n\' \'export const extra = 1;\' > extra.ts',
      'git add -A',
      'git commit -q --no-verify -m \'a commit the session made\'',
    ]));

    // The session's commit moved HEAD past the loop's expectation, which
    // only the loop's own commits advance, so a retry would halt at the
    // loop guard and overwrite the task's blocker: none is granted.
    expect(runLoopStart(scratch, ['--retry=1'])).toBe(0);
    expect(callCount(scratch)).toBe(1);

    const told = runEvents(scratch)
      .filter((event) => ['task-start', 'task-blocked', 'retry', 'halt'].includes(event.name))
      .map((event) => [event.name, event.data['reason'] ?? null]);
    expect(told).toEqual([
      ['task-start', null],
      ['task-blocked', 'session exited 1'],
    ]);

    const task = findNextTask(readFileSync(join(scratch.repo, '.plans', TRACKER_NAME), 'utf8'));
    expect(task?.status).toBe('blocked');
    expect(task?.task).toBe(BREAKING_TASK);
    expect(task?.blocker ?? '').not.toContain(CHECKOUT_MOVED);
  }, CASE_TIMEOUT_MS);
});

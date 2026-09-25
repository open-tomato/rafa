/**
 * The release stage as `start.ts` wires it into the wrap-up branch.
 *
 * `release/prepare.ts`, `release/verify.ts` and `start/release-stage.ts`
 * are each driven through their own seams beside their own module, and
 * every one of those suites answers what the stage DOES. None of them
 * can answer where the loop runs it, which is this file's one claim:
 * step 1 before the wrap-up session, the record handed to that session,
 * step 3 after it returns, and all three BEFORE the CI gate.
 *
 * `start()` itself is not driven, for the reason
 * `tests/plan-injection.test.ts` gives for not driving it either: it
 * spawns the real CLI with no seam, and reaching its wrap-up branch
 * means a real config, a real session record, a real preflight and a
 * real Claude session. So the wiring is read off the source instead,
 * and read STRUCTURALLY: `start.ts` is parsed with TypeScript, the
 * `if (!taskInfo)` branch is located, and every call inside it is
 * collected in source order with its arguments as written. A substring
 * check could not tell a finish that runs after the CI gate from one
 * that runs before it, since both spell the same call; the order this
 * reader answers can.
 *
 * ## The controls
 *
 * A reader that found nothing, or that answered a fixed order, would
 * pass every assertion below on any source at all. So each ordering
 * claim is paired with a PLANTED branch of the same shape that breaks
 * it — the finish moved above the session, the finish moved below the
 * CI gate, the session handed no record — and the case asserts the
 * reader reports the planted order, which is what makes its reading of
 * `start.ts` a reading rather than a coincidence.
 *
 * ## The mutation grid
 *
 * Three mutations of the branch were driven against this file on
 * 2026-09-20, one run each, 8 pass before and after and `start.ts`
 * restored sha256-identical (`00417b78…`) after every one:
 *
 *   - the finish moved below the `ciWait` block: 1 case, the CI-gate
 *     ordering, and the planted control beside it stayed green.
 *   - the record dropped from the `preserveProgress` call: 1 case here,
 *     and one in `tests/plan-injection.test.ts`, which pins the same
 *     call as a literal.
 *   - the preparation moved below the session: 1 case, the first
 *     ordering.
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
 * The walk goes into nested statements, so the CI gate's call inside
 * `if (ciWait)` is read in the position it really runs in, and a call
 * moved into or out of that block moves in the answer.
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

/** Step 1, as a planted branch writes it. */
const PREPARE = 'const release = prepareReleaseStage({ repoRoot, settings: runConfig.config, planStub, planContent });';

/** The wrap-up session, handed the record step 1 answered. */
const SESSION = 'await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning);';

/** Step 3, over that same record. */
const FINISH = 'await finishRelease({ repoRoot, preparation: release });';

/** The CI gate, inside the `ciWait` block it really sits in. */
const GATE: readonly string[] = [
  'if (ciWait) {',
  '  await verifyPullRequest(timeout, attempts, settingSources);',
  '}',
];

/** The calls a planted branch made of `body` makes, in source order. */
function planted(body: readonly string[]): readonly BranchCall[] {
  return wrapUpCalls(plantedStart(body));
}

describe('the wrap-up branch of start.ts', () => {
  it('prepares the release before the wrap-up session and finishes it after', () => {
    expect(NAMES).toContain('prepareReleaseStage');
    expect(NAMES.indexOf('prepareReleaseStage')).toBeLessThan(NAMES.indexOf('preserveProgress'));
    expect(NAMES.indexOf('preserveProgress')).toBeLessThan(NAMES.indexOf('finishRelease'));
  });

  it('reads a finish moved above the session as being above it', () => {
    // The control for the case above: the same reader over a branch
    // that finishes the release before the session answers that order,
    // so the claim it makes about `start.ts` could have failed.
    const names = planted([PREPARE, FINISH, SESSION, ...GATE]).map((call) => call.name);

    expect(names.indexOf('finishRelease')).toBeLessThan(names.indexOf('preserveProgress'));
  });

  it('finishes the release before the CI gate', () => {
    expect(NAMES).toContain('verifyPullRequest');
    expect(NAMES.indexOf('finishRelease')).toBeLessThan(NAMES.indexOf('verifyPullRequest'));
  });

  it('reads a finish moved below the CI gate as being below it', () => {
    // The control for the case above: a release pushed after the wait
    // started is the mistake that ordering exists to prevent, and the
    // reader reports it where it is.
    const names = planted([PREPARE, SESSION, ...GATE, FINISH]).map((call) => call.name);

    expect(names.indexOf('verifyPullRequest')).toBeLessThan(names.indexOf('finishRelease'));
  });

  it('hands the session and the finish the very record the preparation answered', () => {
    expect(callTo(CALLS, 'prepareReleaseStage').bound).toBe('release');
    expect(callTo(CALLS, 'preserveProgress').args).toEqual(['planContent', 'settingSources', 'release', 'serving', 'wrapUpLearning']);
    expect(callTo(CALLS, 'finishRelease').args[0]).toContain('preparation: release');
  });

  it('reads a session handed no record as being handed none', () => {
    // The control for the case above: a `preserveProgress` call whose
    // third argument is gone reads as two arguments, so the assertion
    // on `start.ts` is about what is written there.
    const calls = planted([PREPARE, 'await preserveProgress(planContent, settingSources);', FINISH, ...GATE]);

    expect(callTo(calls, 'preserveProgress').args).toEqual(['planContent', 'settingSources']);
  });

  it('builds step 1 from the run\'s own root, config, plan stub and plan', () => {
    const [input] = callTo(CALLS, 'prepareReleaseStage').args;

    expect(input).toContain('repoRoot');
    expect(input).toContain('settings: runConfig.config');
    expect(input).toContain('planStub');
    expect(input).toContain('planContent');
  });

  it('takes both halves of the stage from start/release-stage.ts', () => {
    expect(importedFrom(START, './start/release-stage.js')).toEqual(['finishRelease', 'prepareReleaseStage']);

    // The control: the reader answers the module asked for and not any
    // import at all, so the list above is that module's own.
    expect(importedFrom(START, './start/wrap-up.js')).toEqual(['preserveProgress', 'WrapUpLearning']);
  });
});

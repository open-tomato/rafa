/**
 * The release stage as `start/wrap-up-run.ts` wires it around the
 * wrap-up session.
 *
 * `release/prepare.ts`, `release/verify.ts` and `start/release-stage.ts`
 * are each driven through their own seams beside their own module, and
 * every one of those suites answers what the stage DOES. None of them
 * can answer where the loop runs it, which is this file's one claim:
 * step 1 before the wrap-up session, the record handed to that session,
 * step 3 after it returns, and all three BEFORE the CI gate. A second
 * claim is which directory each of those calls is pointed at.
 *
 * `runWrapUp` itself is not driven: it spawns a real Claude session, a
 * real `git push` and the real CI gate with no seam, as the wrap-up
 * branch did while it sat in `start.ts`, whose suite explains the same
 * choice. So the wiring is read off the source instead, and read
 * STRUCTURALLY: the module is parsed with TypeScript, `runWrapUp`'s body
 * is located, and every call inside it is collected in source order
 * with its arguments as written. A substring check could not tell a
 * finish that runs after the CI gate from one that runs before it,
 * since both spell the same call; the order this reader answers can.
 * `start.test.ts` holds the other half: that `start.ts`'s `if
 * (!taskInfo)` branch calls `runWrapUp` and nothing else.
 *
 * ## The controls
 *
 * A reader that found nothing, or that answered a fixed order, would
 * pass every assertion below on any source at all. So each ordering
 * claim is paired with a PLANTED `runWrapUp` of the same shape that
 * breaks it — the finish moved above the session, the finish moved
 * below the CI gate, the session handed no record — and the case
 * asserts the reader reports the planted order, which is what makes its
 * reading of the module a reading rather than a coincidence.
 *
 * ## The mutation grid
 *
 * The same three mutations were first driven on 2026-09-20 against the
 * branch as it then sat in `start.ts`. They were driven again on
 * 2026-09-30 against this module, one run each over this file,
 * `tests/plan-injection.test.ts` and `start/pr-lifecycle.test.ts`, with
 * this file's 12 cases green before and after and the module restored
 * byte-identical (`cmp`) after every one:
 *
 *   - the finish moved below the `ciWait` block: 1 case, the CI-gate
 *     ordering, and the planted control beside it stayed green.
 *   - the record handed to `preserveProgress` replaced by `null`: 1 case
 *     here, and one in `tests/plan-injection.test.ts`, which pins the
 *     same call as a literal. The serving and checkout cases stayed
 *     green, as they read other positions of that call.
 *   - the preparation moved below the session: 1 case, the first
 *     ordering.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

/** One call inside `runWrapUp`, as the source writes it. */
interface BodyCall {
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

/** The body of the `runWrapUp` function a source declares. */
function runWrapUpBody(file: ts.SourceFile): ts.Block {
  const declaration = file.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'runWrapUp',
  );
  if (declaration?.body === undefined) throw new Error('the source declares no `runWrapUp` with a body');
  return declaration.body;
}

/**
 * Every call `runWrapUp` in `source` makes, in source order.
 *
 * The walk goes into nested statements, so the CI gate's call inside
 * `if (ciWait)` is read in the position it really runs in, and a call
 * moved into or out of that block moves in the answer.
 */
function wrapUpCalls(source: string): readonly BodyCall[] {
  const file = ts.createSourceFile('wrap-up-run.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: BodyCall[] = [];
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
  visit(runWrapUpBody(file), null);
  return found;
}

/** The bindings a source imports from `module`, sorted. */
function importedFrom(source: string, module: string): readonly string[] {
  const file = ts.createSourceFile('wrap-up-run.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

/** `start/wrap-up-run.ts` as it stands, the source every case below reads. */
const WRAP_UP_RUN = readFileSync(new URL('./wrap-up-run.ts', import.meta.url), 'utf8');

/** Its `runWrapUp` body, and the names it calls in order. */
const CALLS = wrapUpCalls(WRAP_UP_RUN);
const NAMES = CALLS.map((call) => call.name);

/** The first call named `name`, or a failure naming what was found instead. */
function callTo(calls: readonly BodyCall[], name: string): BodyCall {
  const found = calls.find((call) => call.name === name);
  if (found === undefined) {
    throw new Error(`the body makes no call to ${name}; it calls ${calls.map((call) => call.name).join(', ')}`);
  }
  return found;
}

/**
 * A source declaring one `runWrapUp` made of `body`, for a control to
 * read: the same shape the module carries, with the statements a case
 * wants to see the reader report.
 */
function plantedModule(body: readonly string[]): string {
  return [
    'export async function runWrapUp(input: WrapUpRunInput): Promise<void> {',
    ...body.map((line) => `  ${line}`),
    '}',
  ].join('\n');
}

/** Step 1, as a planted body writes it. */
const PREPARE = 'const release = prepareReleaseStage({ repoRoot, settings, planStub, planContent });';

/** The wrap-up session, handed the record step 1 answered. */
const SESSION = 'await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning, checkout);';

/** Step 3, over that same record. */
const FINISH = 'await finishRelease({ repoRoot, preparation: release });';

/** The CI gate, inside the `ciWait` block it really sits in. */
const GATE: readonly string[] = [
  'if (ciWait) {',
  '  await verifyPullRequest(timeout, attempts, settingSources);',
  '}',
];

/** The calls a planted body made of `body` makes, in source order. */
function planted(body: readonly string[]): readonly BodyCall[] {
  return wrapUpCalls(plantedModule(body));
}

describe('the release stage as runWrapUp wires it', () => {
  it('prepares the release before the wrap-up session and finishes it after', () => {
    expect(NAMES).toContain('prepareReleaseStage');
    expect(NAMES.indexOf('prepareReleaseStage')).toBeLessThan(NAMES.indexOf('preserveProgress'));
    expect(NAMES.indexOf('preserveProgress')).toBeLessThan(NAMES.indexOf('finishRelease'));
  });

  it('reads a finish moved above the session as being above it', () => {
    // The control for the case above: the same reader over a body that
    // finishes the release before the session answers that order, so
    // the claim it makes about the module could have failed.
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
    expect(callTo(CALLS, 'preserveProgress').args).toEqual(['planContent', 'settingSources', 'release', 'serving', 'wrapUpLearning', 'checkout']);
    expect(callTo(CALLS, 'finishRelease').args[0]).toContain('preparation: release');
  });

  it('reads a session handed no record as being handed none', () => {
    // The control for the case above: a `preserveProgress` call whose
    // third argument is gone reads as two arguments, so the assertion
    // on the module is about what is written there.
    const calls = planted([PREPARE, 'await preserveProgress(planContent, settingSources);', FINISH, ...GATE]);

    expect(callTo(calls, 'preserveProgress').args).toEqual(['planContent', 'settingSources']);
  });

  it('builds step 1 from the run\'s own root, config, plan stub and plan', () => {
    const [input] = callTo(CALLS, 'prepareReleaseStage').args;

    expect(input).toContain('repoRoot');
    expect(input).toContain('settings');
    expect(input).toContain('planStub');
    expect(input).toContain('planContent');
  });

  it('takes both halves of the stage from start/release-stage.ts', () => {
    expect(importedFrom(WRAP_UP_RUN, './release-stage.js')).toEqual(['finishRelease', 'prepareReleaseStage']);

    // The control: the reader answers the module asked for and not any
    // import at all, so the list above is that module's own.
    expect(importedFrom(WRAP_UP_RUN, './wrap-up.js')).toEqual(['openPullRequestNumber', 'preserveProgress', 'WrapUpLearning']);
  });
});

describe('the two directories runWrapUp points each call at', () => {
  it('serves the wrap-up session from what start() hands it', () => {
    // `serving` is built at the project root in `start.ts`, so a worktree
    // run's wrap-up is served the main checkout's `.rafa/`.
    expect(callTo(CALLS, 'preserveProgress').args).toContain('serving');
  });

  it('runs the release, the wrap-up and the CI gate in the checkout', () => {
    expect(callTo(CALLS, 'prepareReleaseStage').args[0]).toContain('checkout,');
    expect(callTo(CALLS, 'preserveProgress').args.at(-1)).toBe('checkout');
    expect(callTo(CALLS, 'finishRelease').args[0]).toContain('repoRoot: checkout');
    expect(callTo(CALLS, 'prLifecycleSeamsIn').args).toEqual(['checkout']);
  });

  it('guards the release commit against the HEAD the wrap-up session\'s commits left', () => {
    expect(callTo(CALLS, 'haltIfWrapUpMoved').args).toEqual(['{ expected: expectWrapUpCommits(expected), before: \'release\' }']);
    expect(NAMES.indexOf('preserveProgress')).toBeLessThan(NAMES.indexOf('haltIfWrapUpMoved'));
    expect(NAMES.indexOf('haltIfWrapUpMoved')).toBeLessThan(NAMES.indexOf('finishRelease'));
  });

  it('marks the session record at the wrap-up\'s start and, last of all, its finish', () => {
    expect(NAMES[0]).toBe('wrapUpStarted');
    expect(NAMES.at(-1)).toBe('finished');
  });
});

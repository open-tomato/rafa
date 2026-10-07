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
 *
 * ## The delivered pull request
 *
 * The delivery (`deliverPullRequest`) is the one part of the branch
 * that IS driven: it reaches the provider, the retry session and the
 * runner's attempt only through `PullRequestDeliverySeams`, so its cases
 * run stand-ins that record each call and answer each reading in turn,
 * with no `gh`, no session and no git. Where it sits in `runWrapUp`, and
 * that a blocked delivery ends the run before `finished()`, is read off
 * the source as the release's order is, beside a planted control.
 *
 * ## The retarget
 *
 * Where `runWrapUp` retargets the delivered pull request — after a
 * delivery that was neither blocked nor interrupted, before the CI gate,
 * over the one `base` it resolved — is read off the source too, beside a
 * planted control. What reaches `gh` for each of the three openers is
 * driven: the delivery runs over the stand-ins below, reading pull
 * requests the recorded `gh` fake (`pr/gh-fake.ts`) holds, and the pull
 * request it answers is handed to `retargetPullRequest` over the real
 * `gh` adapter on that fake, as `runWrapUp` hands it.
 *
 * ## The release written into a late pull request
 *
 * Where `runWrapUp` writes the release's forecast or sentence again —
 * after a delivered delivery, before the retarget and the CI gate — is
 * read off the source, beside a planted control. What reaches the body
 * is driven over one recorded `gh` fake: a real `finishRelease` (its
 * git, push and forecast stubbed by `tests/release-stage-fixtures.ts`)
 * writes through the fake's adapter, the delivery reads the same fake,
 * a retry or runner stand-in plants the pull request it opens there,
 * and `carryReleaseIntoPullRequest` writes through it once more, so the
 * `gh pr edit --body` calls the fake recorded are every body write the
 * run made.
 */
import type { ReleaseFinish } from './release-stage.js';
import type { PullRequestDelivery, PullRequestDeliverySeams, RunnerAttempt } from './wrap-up-run.js';
import type { CliEvent } from '../ports/index.js';
import type { FakePrGh } from '../pr/gh-fake.js';
import type { PullRequests, PullRequestSummary } from '../pr/index.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { setActiveOutput } from '../adapters/output/active.js';
import { assumptionsHeading } from '../board/review-stamp.js';
import { createFakePrGh } from '../pr/gh-fake.js';
import { createGhPullRequests } from '../pr/gh.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { COMMITTED, FORECAST_LINE, prepared, PROVIDER_GH, SETTINGS, stub, VERIFIED } from '../tests/release-stage-fixtures.js';

import { bindEventsFile, unbindEventsFile } from './loop-events.js';
import { retargetPullRequest } from './pr-retarget.js';
import { carryReleaseIntoPullRequest } from './release-body.js';
import { finishRelease } from './release-stage.js';
import { DELIVERY_BLOCKED_TAIL, deliverPullRequest, emitPullRequestEvent, planIssueNumber, runnerPrInputFor } from './wrap-up-run.js';

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
const SESSION = 'await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning, base, checkout);';

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
    expect(callTo(CALLS, 'preserveProgress').args).toEqual(['planContent', 'settingSources', 'release', 'serving', 'wrapUpLearning', 'base', 'checkout']);
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
    // `planTitleIn` is the title the runner-opened pull request is given,
    // read as the fragment's is; it is no third half of the stage.
    expect(importedFrom(WRAP_UP_RUN, './release-stage.js')).toEqual(['finishRelease', 'planTitleIn', 'prepareReleaseStage']);

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

  it('writes the pull-request phase just before the CI gate, inside its block, and hands the gate the session', () => {
    const gate = callTo(CALLS, 'verifyPullRequest');

    expect(NAMES.indexOf('finishRelease')).toBeLessThan(NAMES.indexOf('pullRequestStarted'));
    expect(NAMES.indexOf('pullRequestStarted') + 1).toBe(NAMES.indexOf('verifyPullRequest'));
    expect(WRAP_UP_RUN).toMatch(/if \(ciWait\) \{\n\s*emitLoopEvent\(\{ kind: 'wrap-up', phase: 'ci' \}\);\n\s*session\.pullRequestStarted\(\);/);
    expect(gate.args.at(-1)).toBe('session');
  });

  it('reads a phase written after the gate, and a gate handed no session, as such', () => {
    // The control for the case above: the same reader over a body that
    // writes the phase once the gate is over, and hands the gate no
    // session, answers that order and that last argument.
    const calls = planted([PREPARE, SESSION, FINISH, ...GATE, 'session.pullRequestStarted();']);
    const names = calls.map((call) => call.name);

    expect(names.indexOf('verifyPullRequest')).toBeLessThan(names.indexOf('pullRequestStarted'));
    expect(callTo(calls, 'verifyPullRequest').args.at(-1)).toBe('settingSources');
  });
});

describe('where runWrapUp delivers the pull request', () => {
  it('delivers it after the release is finished and before the CI gate', () => {
    expect(NAMES).toContain('deliverPullRequest');
    expect(NAMES.indexOf('finishRelease')).toBeLessThan(NAMES.indexOf('deliverPullRequest'));
    expect(NAMES.indexOf('deliverPullRequest')).toBeLessThan(NAMES.indexOf('pullRequestStarted'));
    expect(NAMES.indexOf('deliverPullRequest')).toBeLessThan(NAMES.indexOf('verifyPullRequest'));
  });

  it('reads a delivery planted after the CI gate as being after it', () => {
    // The control for the case above.
    const names = planted([PREPARE, SESSION, FINISH, ...GATE, 'await deliverPullRequest(delivery, seams);']).map((call) => call.name);

    expect(names.indexOf('verifyPullRequest')).toBeLessThan(names.indexOf('deliverPullRequest'));
  });

  it('hands the delivery the first session\'s final message, the run\'s branch and loop.wrapUp.retries', () => {
    const [delivery] = callTo(CALLS, 'deliverPullRequest').args;

    expect(callTo(CALLS, 'preserveProgress').bound).toBe('finalMessage');
    expect(delivery).toContain('previousMessage: finalMessage');
    expect(delivery).toContain('branch: expected.branch');
    expect(delivery).toContain('retries: settings.loopWrapUpRetries');
  });

  it('delivers only under a provider other than none', () => {
    expect(WRAP_UP_RUN).toMatch(/if \(readProvider\(\)\.provider !== 'none'\) \{\n\s*const delivery = await deliverPullRequest\(/);
  });

  it('ends a blocked delivery with exit 1 before the session is marked finished', () => {
    const blocked = WRAP_UP_RUN.indexOf('if (delivery.kind === \'blocked\') throw new CommandExit(1, delivery.message);');
    const interrupted = WRAP_UP_RUN.indexOf('if (delivery.kind === \'interrupted\') return;');

    expect(blocked).toBeGreaterThan(-1);
    expect(interrupted).toBeGreaterThan(-1);
    expect(blocked).toBeLessThan(WRAP_UP_RUN.indexOf('session.finished();'));
    expect(interrupted).toBeLessThan(WRAP_UP_RUN.indexOf('session.finished();'));
  });
});

describe('where runWrapUp retargets the delivered pull request', () => {
  it('retargets it after the delivery and before the CI gate, over the base resolved once', () => {
    const retarget = callTo(CALLS, 'retargetPullRequest');

    expect(NAMES.indexOf('deliverPullRequest')).toBeLessThan(NAMES.indexOf('retargetPullRequest'));
    expect(NAMES.indexOf('retargetPullRequest')).toBeLessThan(NAMES.indexOf('pullRequestStarted'));
    expect(NAMES.indexOf('retargetPullRequest')).toBeLessThan(NAMES.indexOf('verifyPullRequest'));
    expect(retarget.args.slice(0, 2)).toEqual(['delivery.pull', 'base']);
    expect(NAMES.filter((name) => name === 'resolveBaseBranch')).toHaveLength(1);
    expect(callTo(CALLS, 'resolveBaseBranch').bound).toBe('base');
  });

  it('retargets only after a blocked or interrupted delivery has left', () => {
    const retarget = WRAP_UP_RUN.indexOf('await retargetPullRequest(delivery.pull, base,');

    expect(retarget).toBeGreaterThan(WRAP_UP_RUN.indexOf('if (delivery.kind === \'interrupted\') return;'));
    expect(retarget).toBeGreaterThan(WRAP_UP_RUN.indexOf('if (delivery.kind === \'blocked\') throw new CommandExit(1, delivery.message);'));
    expect(retarget).toBeLessThan(WRAP_UP_RUN.indexOf('if (ciWait) {'));
  });

  it('reads a retarget planted after the CI gate as being after it', () => {
    // The control for the first case: the same reader over a body that
    // retargets once the gate is over answers that order.
    const names = planted([
      PREPARE,
      SESSION,
      FINISH,
      'const delivery = await deliverPullRequest(input, seams);',
      ...GATE,
      'await retargetPullRequest(delivery.pull, base, seams);',
    ]).map((call) => call.name);

    expect(names.indexOf('verifyPullRequest')).toBeLessThan(names.indexOf('retargetPullRequest'));
  });
});

/** The run's branch in every delivery case. */
const BRANCH = 'feat/rafa-579-loop-run-ends-delivered';

/** An open pull request as the provider answers it. */
function pull(number: number): PullRequestSummary {
  return {
    number,
    title: 'rafa-579: A loop run ends delivered',
    url: `https://github.com/o/r/pull/${String(number)}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'rafa', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

/** What a stand-in's readings answer, one per lookup, the last repeated. */
type Reading = PullRequestSummary | null | Error;

/** Stand-in seams recording every call, in order. */
function standIn(answers: {
  readonly readings: readonly Reading[];
  readonly runner?: RunnerAttempt;
  readonly interruptedAfter?: number;
}): { readonly seams: PullRequestDeliverySeams; readonly calls: string[]; readonly handed: string[] } {
  const calls: string[] = [];
  const handed: string[] = [];
  let lookups = 0;
  let retries = 0;
  const seams: PullRequestDeliverySeams = {
    findOpen: (branch) => {
      calls.push(`findOpen ${branch}`);
      const answer = answers.readings[Math.min(lookups, answers.readings.length - 1)] ?? null;
      lookups += 1;
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    retry: (previousMessage) => {
      retries += 1;
      calls.push(`retry ${String(retries)}`);
      handed.push(previousMessage);
      return Promise.resolve(`retry ${String(retries)} final message`);
    },
    openRunnerPullRequest: () => {
      calls.push('runner');
      return Promise.resolve(answers.runner ?? { kind: 'opened', pull: pull(601), warnings: [] });
    },
    isInterrupted: () => answers.interruptedAfter !== undefined && retries >= answers.interruptedAfter,
  };
  return { seams, calls, handed };
}

describe('deliverPullRequest', () => {
  const warned: string[] = [];
  const informed: string[] = [];

  beforeEach(() => {
    warned.length = 0;
    informed.length = 0;
    setActiveOutput(sinkOutput({ warn: (line) => warned.push(line), info: (line) => informed.push(line) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** One delivery over `retries` from the message `first`. */
  function deliver(seams: PullRequestDeliverySeams, retries: number | false = 1): Promise<PullRequestDelivery> {
    return deliverPullRequest({ branch: BRANCH, retries, previousMessage: 'first final message' }, seams);
  }

  it('answers the pull request the wrap-up opened, spending no retry and no runner attempt', async () => {
    const { seams, calls } = standIn({ readings: [pull(600)] });

    const delivery = await deliver(seams);

    expect(delivery).toEqual({ kind: 'delivered', pull: pull(600), by: 'wrap-up', retriesSpent: 0 });
    expect(calls).toEqual([`findOpen ${BRANCH}`]);
    expect(warned).toEqual([]);
  });

  it('spends one retry handed the first session\'s message, and answers the pull request it opened', async () => {
    const { seams, calls, handed } = standIn({ readings: [null, pull(600)] });

    const delivery = await deliver(seams);

    expect(delivery).toEqual({ kind: 'delivered', pull: pull(600), by: 'retry', retriesSpent: 1 });
    expect(calls).toEqual([`findOpen ${BRANCH}`, 'retry 1', `findOpen ${BRANCH}`]);
    expect(handed).toEqual(['first final message']);
    expect(warned[0]).toContain(`No open pull request for ${BRANCH} after the wrap-up session: running retry wrap-up session 1 of 1`);
  });

  it('opens the pull request itself after the last retry left none, reading again after each', async () => {
    const { seams, calls, handed } = standIn({ readings: [null] });

    const delivery = await deliver(seams, 2);

    expect(delivery).toEqual({ kind: 'delivered', pull: pull(601), by: 'runner', retriesSpent: 2 });
    expect(calls).toEqual([
      `findOpen ${BRANCH}`,
      'retry 1',
      `findOpen ${BRANCH}`,
      'retry 2',
      `findOpen ${BRANCH}`,
      'runner',
    ]);
    // Each retry quotes the session just before it, not the first one.
    expect(handed).toEqual(['first final message', 'retry 1 final message']);
    expect(warned.at(-1)).toContain('after retry 2 of 2: the loop opens it itself.');
    expect(informed).toEqual([`\n✅ The loop opened pull request #601 for ${BRANCH}: https://github.com/o/r/pull/601`]);
  });

  it('spends no retry under loop.wrapUp.retries false and goes straight to the runner', async () => {
    const { seams, calls } = standIn({ readings: [null] });

    const delivery = await deliver(seams, false);

    expect(delivery.kind).toBe('delivered');
    expect(delivery.retriesSpent).toBe(0);
    expect(calls).toEqual([`findOpen ${BRANCH}`, 'runner']);
  });

  it('warns each project refresh line of the runner\'s pull request after the opened line, still delivered', async () => {
    const line = 'The project was not updated: run `gh auth refresh -s project`.';
    const { seams } = standIn({ readings: [null], runner: { kind: 'opened', pull: pull(601), warnings: [line] } });

    const delivery = await deliver(seams, false);

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'runner' });
    expect(informed).toHaveLength(1);
    expect(warned.at(-1)).toBe(line);
    expect(warned.filter((warning) => warning === line)).toHaveLength(1);
  });

  it('answers a blocked runner attempt with its report and the stopped-record tail', async () => {
    const report = `❌ The run is blocked: the loop could not open the pull request for ${BRANCH} at the push step.\n   ! [rejected]`;
    const { seams } = standIn({ readings: [null], runner: { kind: 'blocked', message: report } });

    const delivery = await deliver(seams);

    expect(delivery).toEqual({ kind: 'blocked', message: `${report}\n${DELIVERY_BLOCKED_TAIL}`, retriesSpent: 1 });
  });

  it('blocks on a provider that could not be asked, with no retry and no runner attempt', async () => {
    const { seams, calls } = standIn({ readings: [new Error('gh: not logged in')] });

    const delivery = await deliver(seams);

    expect(delivery.kind).toBe('blocked');
    expect(calls).toEqual([`findOpen ${BRANCH}`]);
    if (delivery.kind !== 'blocked') return;
    expect(delivery.message).toContain(`could not read whether a pull request is open for ${BRANCH}`);
    expect(delivery.message).toContain('gh: not logged in');
    expect(delivery.message.endsWith(DELIVERY_BLOCKED_TAIL)).toBe(true);
  });

  it('spawns nothing more and opens nothing once the run is interrupted', async () => {
    const { seams, calls } = standIn({ readings: [null], interruptedAfter: 1 });

    const delivery = await deliver(seams, 3);

    expect(delivery).toEqual({ kind: 'interrupted', retriesSpent: 1 });
    expect(calls).toEqual([`findOpen ${BRANCH}`, 'retry 1', `findOpen ${BRANCH}`]);
    expect(warned.at(-1)).toContain('Interrupted');
  });

  it('is interrupted before the runner when no retry is left', async () => {
    // The control for the case above: the same interruption with the
    // retries spent stops the runner too, so the check is not only on
    // the retry path.
    const { seams, calls } = standIn({ readings: [null], interruptedAfter: 1 });

    const delivery = await deliver(seams, 1);

    expect(delivery.kind).toBe('interrupted');
    expect(calls).not.toContain('runner');
  });
});

/** The run's base in the retarget cases, as `pr.base` names it. */
const RUN_BASE = 'stretch/1';

/** A fake holding each of `planted`, opened into its base, the provider over it, and the lines written. */
function retargetFixture(planted: readonly { readonly number: number; readonly base: string }[]): {
  readonly fake: FakePrGh;
  readonly pulls: PullRequests;
  readonly info: string[];
  readonly warn: string[];
} {
  const fake = createFakePrGh();
  for (const { number, base } of planted) fake.plant({ number, headRefName: BRANCH, baseRefName: base });
  return { fake, pulls: createGhPullRequests({ gh: fake.run }), info: [], warn: [] };
}

/** The branch's open pull request as the adapter reads it back from the fake, as a delivery finds it. */
async function readBack(pulls: PullRequests, number: number): Promise<PullRequestSummary> {
  const found = await pulls.findOpen(BRANCH);
  if (found?.number !== number) throw new Error(`the fake answered no open pull request #${String(number)} for ${BRANCH}`);
  return found;
}

/** The `gh pr edit` commands the fake was handed. */
function edits(fake: FakePrGh): readonly (readonly string[])[] {
  return fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'edit');
}

describe('the retarget of each delivered pull request', () => {
  beforeEach(() => {
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** Delivers over `seams`, then retargets what was delivered onto {@link RUN_BASE}, as `runWrapUp` does. */
  async function deliverAndRetarget(
    seams: PullRequestDeliverySeams,
    fixture: ReturnType<typeof retargetFixture>,
  ): Promise<PullRequestDelivery> {
    const delivery = await deliverPullRequest({ branch: BRANCH, retries: 1, previousMessage: 'first final message' }, seams);
    if (delivery.kind !== 'delivered') throw new Error(`the delivery answered ${delivery.kind}`);
    const output = { info: (line: string) => { fixture.info.push(line); }, warn: (line: string) => { fixture.warn.push(line); } };
    await retargetPullRequest(delivery.pull, RUN_BASE, { pulls: fixture.pulls, output });
    return delivery;
  }

  it('retargets the pull request the wrap-up session opened into main', async () => {
    const fixture = retargetFixture([{ number: 627, base: 'main' }]);
    const { seams } = standIn({ readings: [await readBack(fixture.pulls, 627)] });

    const delivery = await deliverAndRetarget(seams, fixture);

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'wrap-up' });
    expect(edits(fixture.fake)).toEqual([['pr', 'edit', '627', '--base', RUN_BASE]]);
    expect(fixture.fake.pull(627)?.baseRefName).toBe(RUN_BASE);
    expect(fixture.info).toEqual([`↪ Retargeted pull request #627 from main to ${RUN_BASE} (pr.base).`]);
  });

  it('retargets the pull request a retry session opened into main', async () => {
    const fixture = retargetFixture([{ number: 628, base: 'main' }]);
    const { seams } = standIn({ readings: [null, await readBack(fixture.pulls, 628)] });

    const delivery = await deliverAndRetarget(seams, fixture);

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'retry' });
    expect(edits(fixture.fake)).toEqual([['pr', 'edit', '628', '--base', RUN_BASE]]);
    expect(fixture.info).toEqual([`↪ Retargeted pull request #628 from main to ${RUN_BASE} (pr.base).`]);
  });

  it('sends no edit for the pull request the runner opened into the run\'s base', async () => {
    // The control on the two cases above: the runner opens with
    // `--base <base>`, so its pull request is already into the run's
    // base and the same path sends no `gh pr edit` and prints nothing.
    const fixture = retargetFixture([{ number: 629, base: RUN_BASE }]);
    const opened = await readBack(fixture.pulls, 629);
    const { seams } = standIn({ readings: [null], runner: { kind: 'opened', pull: opened, warnings: [] } });

    const delivery = await deliverAndRetarget(seams, fixture);

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'runner' });
    expect(edits(fixture.fake)).toEqual([]);
    expect(fixture.info).toEqual([]);
    expect(fixture.warn).toEqual([]);
  });
});

/** A plan whose header names `issue`, or carries no header with null. */
function plan(issue: string | null): string {
  const header = issue === null
    ? []
    : ['```rafa:plan', 'stub: some-plan', `issue: "${issue}"`, '```', ''];
  return ['# Plan: A loop run ends delivered', '', ...header, '# Stage: One', '', '- [x] A task', ''].join('\n');
}

describe('the runner\'s pull request input', () => {
  it('reads the issue from the plan\'s rafa:plan block first', () => {
    expect(planIssueNumber(plan('579'), 'rafa-12-other', 'feat/rafa-13-other')).toBe(579);
  });

  it('falls back to the stub, then the branch, when the block names none', () => {
    expect(planIssueNumber(plan(null), 'rafa-12-other', 'feat/rafa-13-other')).toBe(12);
    expect(planIssueNumber(plan(null), 'some-plan', 'feat/rafa-13-other')).toBe(13);
  });

  it('answers null when nothing names a number, and reads a non-number issue as none', () => {
    expect(planIssueNumber(plan(null), 'some-plan', 'feat/some-plan')).toBeNull();
    expect(planIssueNumber(plan('OPT-123'), 'some-plan', 'feat/some-plan')).toBeNull();
  });

  it('titles the pull request from the plan heading with its Plan: label off', () => {
    const input = runnerPrInputFor({ branch: BRANCH, base: 'main', planContent: plan('579'), planStub: 'some-plan', notes: ['- one'] });

    expect(input).toEqual({ branch: BRANCH, base: 'main', issue: 579, planTitle: 'A loop run ends delivered', notes: ['- one'] });
  });

  it('titles the pull request of a plan created under assumptions from its Plan: heading', () => {
    const assumed = `${assumptionsHeading([{ heading: 'Design', what: 'the store backend is not named', blocking: false, assumption: 'the SQLite backend' }])}${plan('579')}`;
    const input = runnerPrInputFor({ branch: BRANCH, base: 'main', planContent: assumed, planStub: 'some-plan', notes: [] });

    expect(input?.planTitle).toBe('A loop run ends delivered');
  });

  it('answers no input for a plan that names no issue number', () => {
    expect(runnerPrInputFor({ branch: 'feat/some-plan', base: 'main', planContent: plan(null), planStub: 'some-plan', notes: [] })).toBeNull();
  });
});

describe('the pull request event in each output mode', () => {
  /** The session the events file is bound under, a valid session id. */
  const RUN_ID = 'c3a1e0d2-7b4f-4e8a-9d61-5f2b8c0e7a14';
  const events: CliEvent[] = [];
  let lookups = 0;
  let root = '';

  /** A lookup stand-in counting each reading and answering `number`. */
  function lookup(number: number | string | null): () => Promise<number | string | null> {
    return () => {
      lookups += 1;
      return Promise.resolve(number);
    };
  }

  /** The `name` and `data` of each event emitted, in order. */
  function emitted(): readonly unknown[] {
    return events.map((event) => event.type === 'event'
      ? { name: event.name, data: event.data }
      : event.type);
  }

  beforeEach(() => {
    events.length = 0;
    lookups = 0;
    root = mkdtempSync(join(tmpdir(), 'rafa-wrap-up-run-pr-event-'));
  });

  afterEach(() => {
    unbindEventsFile();
    setActiveOutput(null);
    rmSync(root, { recursive: true, force: true });
  });

  /** Delivers over `seams` in the current mode, then emits over what was delivered, as `runWrapUp` does. */
  async function deliverAndEmit(seams: PullRequestDeliverySeams, after: number | string | null): Promise<PullRequestDelivery> {
    const delivery = await deliverPullRequest({ branch: BRANCH, retries: 1, previousMessage: 'first final message' }, seams);
    await emitPullRequestEvent(BRANCH, delivery.kind === 'delivered'
      ? delivery.pull.number
      : null, lookup(after));
    return delivery;
  }

  it('emits nothing at the old session point of a json-mode run: no emit sits between the session and the guard', () => {
    const emits = CALLS.filter((call) => call.name === 'emitPullRequestEvent');

    expect(emits).toHaveLength(3);
    expect(NAMES.indexOf('preserveProgress')).toBeGreaterThan(-1);
    expect(NAMES.indexOf('haltIfWrapUpMoved')).toBeGreaterThan(NAMES.indexOf('preserveProgress'));
    expect(NAMES.indexOf('emitPullRequestEvent')).toBeGreaterThan(NAMES.indexOf('haltIfWrapUpMoved'));
    // No mode is read to pick a place: json, events and text emit at the same one.
    expect(WRAP_UP_RUN).not.toContain('activeOutputMode');
    expect(WRAP_UP_RUN).not.toContain('\'session\', expected.branch');
  });

  it('reads an emit planted right after the session as being before the guard', () => {
    // The control for the case above: the old session-point emit, planted back.
    const names = planted([
      PREPARE,
      SESSION,
      'await emitPullRequestEvent(branch, null, lookup);',
      'if (haltIfWrapUpMoved({ expected, before: \'release\' })) return;',
      FINISH,
      ...GATE,
    ]).map((call) => call.name);

    expect(names.indexOf('emitPullRequestEvent')).toBeLessThan(names.indexOf('haltIfWrapUpMoved'));
  });

  it('emits the same event in json and text mode, from the number it is handed, with no lookup', async () => {
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'json');
    await emitPullRequestEvent(BRANCH, 612, lookup(null));
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'text');
    await emitPullRequestEvent(BRANCH, 612, lookup(null));

    expect(emitted()).toEqual([{ name: 'pr', data: { number: 612 } }, { name: 'pr', data: { number: 612 } }]);
    expect(lookups).toBe(0);
  });

  it('reads the pull request when it is handed no number', async () => {
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'json');

    await emitPullRequestEvent(BRANCH, null, lookup(null));
    await emitPullRequestEvent(BRANCH, null, lookup(613));

    expect(emitted()).toEqual([
      { name: 'no-pr', data: { reason: `no open pull request for ${BRANCH}` } },
      { name: 'pr', data: { number: 613 } },
    ]);
    expect(lookups).toBe(2);
  });

  it('emits one pr event with the number a retry opened, and no no-pr, in json mode', async () => {
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'json');
    const { seams } = standIn({ readings: [null, pull(628)] });

    const delivery = await deliverAndEmit(seams, null);

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'retry' });
    expect(emitted()).toEqual([{ name: 'pr', data: { number: 628 } }]);
    expect(lookups).toBe(0);
  });

  it('emits one pr event with the number the runner opened, in json mode', async () => {
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'json');
    const { seams } = standIn({ readings: [null], runner: { kind: 'opened', pull: pull(629) } });

    const delivery = await deliverAndEmit(seams, null);

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'runner' });
    expect(emitted()).toEqual([{ name: 'pr', data: { number: 629 } }]);
  });

  it('emits one no-pr event for a moved checkout, read at the delivery\'s place', async () => {
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'json');

    await emitPullRequestEvent(BRANCH, null, lookup(null));

    expect(emitted()).toEqual([{ name: 'no-pr', data: { reason: `no open pull request for ${BRANCH}` } }]);
    expect(lookups).toBe(1);
  });

  it('emits one no-pr event under a none provider, its reason as the lookup answers it', async () => {
    setActiveOutput(sinkOutput({ event: (event) => events.push(event) }), 'json');

    await emitPullRequestEvent(BRANCH, null, lookup('no pull request provider is configured'));

    expect(emitted()).toEqual([{ name: 'no-pr', data: { reason: 'no pull request provider is configured' } }]);
  });

  it('writes a text run\'s pr line to its events file', async () => {
    setActiveOutput(sinkOutput({}), 'text');
    const file = bindEventsFile(root, RUN_ID);

    await emitPullRequestEvent(BRANCH, 615, lookup(null));

    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { name: string; data: unknown });
    expect(lines.map((line) => [line.name, line.data])).toEqual([['pr', { number: 615 }]]);
  });

  it('emits over the delivery\'s number in runWrapUp, right after the delivery', () => {
    expect(WRAP_UP_RUN).toMatch(/const delivery = await deliverPullRequest\([\s\S]*?\);\n\s*await emitPullRequestEvent\(expected\.branch, delivery\.kind === 'delivered'\n\s*\? delivery\.pull\.number\n\s*: null, lookup\);/);
  });

  it('emits once on every path out of runWrapUp: a moved checkout, each delivery outcome and a none provider', () => {
    const halt = WRAP_UP_RUN.indexOf('emitLoopEvent({ kind: \'halt\', reason: \'checkout moved\' });');
    const interrupted = WRAP_UP_RUN.indexOf('if (delivery.kind === \'interrupted\') return;');
    const delivered = WRAP_UP_RUN.indexOf('await emitPullRequestEvent(expected.branch, delivery.kind');

    expect(WRAP_UP_RUN.lastIndexOf('await emitPullRequestEvent(expected.branch, null, lookup);', halt)).toBeGreaterThan(-1);
    expect(delivered).toBeGreaterThan(-1);
    expect(delivered).toBeLessThan(interrupted);
    expect(WRAP_UP_RUN).toMatch(/\} else \{\n(?:\s*\/\/[^\n]*\n)*\s*await emitPullRequestEvent\(expected\.branch, null, lookup\);\n\s*\}\n\s*if \(ciWait\)/);
  });
});

describe('where runWrapUp writes the release into a pull request opened after it', () => {
  it('writes it after a delivered delivery and before the retarget and the CI gate', () => {
    const carry = WRAP_UP_RUN.indexOf('await carryReleaseIntoPullRequest(');

    expect(NAMES.indexOf('deliverPullRequest')).toBeLessThan(NAMES.indexOf('carryReleaseIntoPullRequest'));
    expect(NAMES.indexOf('carryReleaseIntoPullRequest')).toBeLessThan(NAMES.indexOf('retargetPullRequest'));
    expect(NAMES.indexOf('carryReleaseIntoPullRequest')).toBeLessThan(NAMES.indexOf('verifyPullRequest'));
    expect(NAMES.filter((name) => name === 'carryReleaseIntoPullRequest')).toHaveLength(1);
    expect(carry).toBeGreaterThan(WRAP_UP_RUN.indexOf('if (delivery.kind === \'interrupted\') return;'));
    expect(carry).toBeGreaterThan(WRAP_UP_RUN.indexOf('if (delivery.kind === \'blocked\') throw new CommandExit(1, delivery.message);'));
  });

  it('hands it the finish, the run\'s checkout and branch, and the run\'s provider reading', () => {
    expect(callTo(CALLS, 'finishRelease').bound).toBe('finish');
    expect(callTo(CALLS, 'carryReleaseIntoPullRequest').args).toEqual([
      'finish',
      '{ repoRoot: checkout, branch: expected.branch }',
      '{ readProvider }',
    ]);
  });

  it('reads a write planted before the delivery as being before it', () => {
    // The control for the first case: the same reader over a body that
    // writes before the delivery answers that order.
    const names = planted([
      PREPARE,
      SESSION,
      FINISH,
      'await carryReleaseIntoPullRequest(finish, target, seams);',
      'const delivery = await deliverPullRequest(input, seams);',
      ...GATE,
    ]).map((call) => call.name);

    expect(names.indexOf('carryReleaseIntoPullRequest')).toBeLessThan(names.indexOf('deliverPullRequest'));
  });
});

/** The body every planted pull request opens with. */
const OPENING_BODY = 'Closes #579';

/** What one run over the fake left: the finish, the delivery, and the pull request's body. */
interface CarriedRun {
  readonly finish: ReleaseFinish;
  readonly delivery: PullRequestDelivery;
  readonly fake: FakePrGh;
}

/** Who opens the pull request in a {@link runOverFake} run, and when. */
interface Opening {
  /** A pull request open before the release step, by the first session. */
  readonly beforeRelease?: number;
  /** A pull request the one retry session opens. */
  readonly byRetry?: number;
  /** A pull request the runner opens, or `blocked` for an attempt that stops. */
  readonly byRunner?: number | 'blocked';
}

/**
 * Finishes the release over the fake, delivers over it with one retry,
 * and writes the release again when the delivery answered `delivered`,
 * as `runWrapUp` does.
 */
async function runOverFake(opening: Opening): Promise<CarriedRun> {
  const fake = createFakePrGh();
  const pulls = createGhPullRequests({ gh: fake.run });
  const plantOpen = (number: number): void => {
    fake.plant({ number, headRefName: BRANCH, baseRefName: 'main', body: OPENING_BODY });
  };
  if (opening.beforeRelease !== undefined) plantOpen(opening.beforeRelease);
  const world = stub({ git: COMMITTED });
  const bodySeams = { pulls: () => pulls, readProvider: () => PROVIDER_GH };
  const finish = await finishRelease(
    { repoRoot: '/repo', branch: BRANCH, settings: SETTINGS, preparation: prepared() },
    { ...world.seams, ...bodySeams, verify: () => VERIFIED },
  );
  const seams: PullRequestDeliverySeams = {
    findOpen: (branch) => pulls.findOpen(branch),
    retry: (previousMessage) => {
      if (opening.byRetry !== undefined) plantOpen(opening.byRetry);
      return Promise.resolve(`after ${previousMessage}`);
    },
    openRunnerPullRequest: async () => {
      const runner = opening.byRunner;
      if (runner === undefined || runner === 'blocked') return { kind: 'blocked', message: '❌ the push was refused' };
      plantOpen(runner);
      return { kind: 'opened', pull: await readBack(pulls, runner) };
    },
    isInterrupted: () => false,
  };
  const delivery = await deliverPullRequest({ branch: BRANCH, retries: 1, previousMessage: 'first final message' }, seams);
  if (delivery.kind === 'delivered') {
    await carryReleaseIntoPullRequest(finish, { repoRoot: '/repo', branch: BRANCH }, bodySeams);
  }
  return { finish, delivery, fake };
}

/** The `gh pr edit <n> --body` commands the fake was handed, as `<n>`. */
function bodyEdits(fake: FakePrGh): readonly string[] {
  return edits(fake)
    .filter((call) => call.includes('--body'))
    .map((call) => call[2] ?? '');
}

/** How many times `text` occurs in `body`. */
function occurrences(body: string | undefined, text: string): number {
  return (body ?? '').split(text).length - 1;
}

describe('the release written into the delivered pull request', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('writes a pull request open before the release step once, from the finish alone', async () => {
    const { finish, delivery, fake } = await runOverFake({ beforeRelease: 630 });

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'wrap-up' });
    expect(finish.body?.number).toBe(630);
    expect(bodyEdits(fake)).toEqual(['630']);
    expect(occurrences(fake.pull(630)?.body, FORECAST_LINE)).toBe(1);
  });

  it('writes the forecast into the pull request the runner opened, after the delivery', async () => {
    const { finish, delivery, fake } = await runOverFake({ byRunner: 631 });

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'runner' });
    // The finish found none to write to: the one write is the carry's.
    expect(finish.body?.number).toBeNull();
    expect(bodyEdits(fake)).toEqual(['631']);
    expect(fake.pull(631)?.body).toBe(`${OPENING_BODY}\n\n${finish.written?.block ?? ''}`);
    expect(occurrences(fake.pull(631)?.body, FORECAST_LINE)).toBe(1);
  });

  it('writes the forecast into the pull request a retry opened, after the delivery', async () => {
    const { finish, delivery, fake } = await runOverFake({ byRetry: 632 });

    expect(delivery).toMatchObject({ kind: 'delivered', by: 'retry' });
    expect(finish.body?.number).toBeNull();
    expect(bodyEdits(fake)).toEqual(['632']);
    expect(occurrences(fake.pull(632)?.body, FORECAST_LINE)).toBe(1);
  });

  it('writes nothing after a blocked delivery', async () => {
    const { finish, delivery, fake } = await runOverFake({ byRunner: 'blocked' });

    expect(delivery.kind).toBe('blocked');
    // The control: the finish holds a forecast its own write found no
    // pull request for, so a carry made here would have had one to write.
    expect(finish.written?.block).toContain(FORECAST_LINE);
    expect(finish.body?.number).toBeNull();
    expect(bodyEdits(fake)).toEqual([]);
  });
});

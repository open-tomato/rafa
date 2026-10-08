/**
 * `rafa loop start --continue` driven end to end: the CLI spawned over
 * a scratch repository (`./loop-scratch.ts`) whose stand-in `claude`
 * answers each task session and each decision session from a script,
 * and the run's exit code, its events file, its tracker and its record
 * read afterwards.
 *
 * The stand-in tells a decision session from a task session by its
 * arguments: a decision session alone is spawned with `--tools
 * Read,Grep,Glob` (`src/start/decision-session.ts`). It counts each kind
 * apart, keeps each prompt, and answers the n-th call of a kind with the
 * n-th answer scripted for it; a task call past its script answers
 * `blocked`, and a decision call past its script answers nothing, which
 * the parser reads as `stop`, so a run that spawns more than a case
 * planned ends rather than loops.
 *
 * The plan holds two tasks: a gate on a file a person writes, and a task
 * after it. Each case reads which events the run wrote, in order, so a
 * run that skipped the decision, or emitted a stop's event it did not
 * stop on, fails on the list.
 */
import type { Scratch } from './loop-scratch.js';
import type { EventLine } from '../loop/events-file.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { eventsFileOf, readEventsFrom } from '../loop/events-file.js';
import { readSessions } from '../loop/sessions.js';
import { BLOCKER_PROMPT_PREFIX } from '../start/dispatch.js';

import { expectExit } from './cli-capture.js';
import { runLoopStart, scratchPlanter, SESSION_FLAGS, STUB } from './loop-scratch.js';

/** The gate the first task is. */
const GATE = 'Check the env file a person writes';

/** The task after it. */
const LATER = 'Use the greeting';

/** The plan: the gate on line 3, the later task on line 4. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${GATE}\n- [ ] ${LATER}\n`;

/** A fence, kept out of the shell lines below. */
const FENCE = '```';

/** How long one case may take: up to three spawned runs, each a few `bun test` steps. */
const CASE_TIMEOUT_MS = 150_000;

const planter = scratchPlanter('rafa-loop-continue-');
afterAll(() => {
  planter.remove();
});

/** A `rafa:report` whose status is `status`. */
function report(status: 'done' | 'blocked'): readonly string[] {
  return [
    `The task is ${status}.`,
    '',
    `${FENCE}rafa:report`,
    `status: ${status}`,
    `feedback: "the task is ${status}"`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
  ];
}

/** A `rafa:decision` block holding `fields`. */
function decision(...fields: readonly string[]): readonly string[] {
  return ['I read the plan and the blocker.', '', `${FENCE}rafa:decision`, ...fields, FENCE];
}

/** One answer as shell lines printing it. */
function printed(lines: readonly string[]): string {
  return lines.map((line) => `printf '%s\\n' '${line.replace(/'/g, '\'\\\'\'')}'`).join('; ');
}

/** What the stand-in answers, call by call, for each kind. */
interface Script {
  readonly tasks: readonly (readonly string[])[];
  readonly decisions: readonly (readonly string[])[];
}

/** The stand-in's body for `script`; see the module note. */
function standIn(script: Script): (paths: { readonly callLog: string }) => readonly string[] {
  const branches = (kind: string, answers: readonly (readonly string[])[], fallback: string): readonly string[] => [
    '  case "$n" in',
    ...answers.map((answer, index) => `    ${index + 1}) ${printed(answer)} ;;`),
    `    *) ${fallback} ;;`,
    '  esac',
  ].map((line) => line.replace('$kind', kind));
  return ({ callLog }) => [
    `log='${callLog}'`,
    'case " $* " in *" Read,Grep,Glob "*) kind=decision ;; *) kind=task ;; esac',
    'n=$(/usr/bin/grep -c "^$kind$" "$log" 2>/dev/null)',
    'n=$(( ${n:-0} + 1 ))',
    'echo "$kind" >> "$log"',
    '/bin/cat > "$log.$kind.$n.prompt"',
    'if [ "$kind" = decision ]; then',
    ...branches('decision', script.decisions, 'printf \'%s\\n\' \'no decision\''),
    'else',
    ...branches('task', script.tasks, printed(report('blocked'))),
    'fi',
    'exit 0',
  ];
}

/** A scratch repository over {@link PLAN} whose stand-in answers `script`. */
function plant(script: Script): Scratch {
  return planter.plant({ branch: `feat/${STUB}`, plan: PLAN, claudeBody: standIn(script) });
}

/** The kinds of call the stand-in answered, in order. */
function callsOf(scratch: Scratch): readonly string[] {
  try {
    return readFileSync(scratch.callLog, 'utf8').trim()
      .split('\n')
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** The prompt of the n-th call of `kind`. */
function promptOf(scratch: Scratch, kind: 'task' | 'decision', n: number): string {
  return readFileSync(`${scratch.callLog}.${kind}.${n}.prompt`, 'utf8');
}

/** Every event the scratch repository's runs wrote, in run order and then file order. */
function eventsOf(scratch: Scratch): readonly EventLine[] {
  return readSessions(scratch.repo).flatMap((record) => {
    const read = readEventsFrom(eventsFileOf(scratch.repo, record), 0);
    return read.kind === 'read'
      ? read.events
      : [];
  });
}

/** The events a case reads, each as its name and the field that tells it apart. */
function told(scratch: Scratch): readonly (readonly [string, unknown])[] {
  const names = ['task-start', 'task-done', 'task-blocked', 'decision', 'decision-needed', 'retry', 'passed-over', 'halt', 'error'];
  return eventsOf(scratch)
    .filter((event) => names.includes(event.name))
    .map((event) => [event.name, event.data['strategy'] ?? event.data['reason'] ?? null]);
}

/** The planted tracker's path. */
function trackerPath(scratch: Scratch): string {
  return join(scratch.repo, '.plans', `PLAN_TRACKER-${STUB}.md`);
}

/** The planted tracker's text. */
function trackerOf(scratch: Scratch): string {
  return readFileSync(trackerPath(scratch), 'utf8');
}

describe('loop start --continue over a real loop', () => {
  it('jumps the gate its report held, runs the task after it, and ends with exit 22 on the gate left passed over', () => {
    const scratch = plant({
      tasks: [report('blocked'), report('done')],
      decisions: [decision('strategy: jump', 'reason: "A person writes the env file, and no later task reads it."')],
    });

    const run = runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']);

    expectExit(run, 22, { ...scratch });
    expect(callsOf(scratch)).toEqual(['task', 'decision', 'task']);
    expect(promptOf(scratch, 'decision', 1)).toContain('The task stopped at tracker line 3.');
    expect(told(scratch)).toEqual([
      ['task-start', null],
      ['decision', 'jump'],
      ['task-start', null],
      ['task-done', null],
      ['passed-over', null],
      ['halt', 'passed over 1 task(s)'],
    ]);
    expect(trackerOf(scratch)).toContain(`- [BLOCKED] ${GATE}`);
    expect(trackerOf(scratch)).toContain(`- [x] ${LATER}`);
    expect(run.stderr).toContain('passed-over task(s) left [BLOCKED]');
    expect(run.stderr).toContain('mark its tracker line - [ ]');
    expect(readSessions(scratch.repo)[0]?.decisions?.map((entry) => [entry.task.task, entry.strategy])).toEqual([[GATE, 'jump']]);

    // A second --continue run opens with that list: the gate stays passed
    // over, no session is spawned, and the run ends on it again.
    expectExit(runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']), 22, { ...scratch });
    expect(callsOf(scratch)).toHaveLength(3);

    // The gate's line put back to `- [ ]` is the person's "try again": a
    // third --continue run drops it from the list and dispatches it, its
    // stand-in holding it again, and its decision unreadable reads as stop.
    writeFileSync(trackerPath(scratch), trackerOf(scratch).replace(`- [BLOCKED] ${GATE}`, `- [ ] ${GATE}`), 'utf8');
    expectExit(runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']), 20, { ...scratch });
    expect(callsOf(scratch)).toEqual(['task', 'decision', 'task', 'task', 'decision']);
  }, CASE_TIMEOUT_MS);

  it('stops with exit 20 on a stop decision, emitting the decision and then the task\'s own blocked event, and no error', () => {
    const scratch = plant({
      tasks: [report('blocked')],
      decisions: [decision('strategy: stop', 'reason: "The task text is contradicted by the code."')],
    });

    const run = runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']);

    expectExit(run, 20, { ...scratch });
    expect(run.stderr).toContain('The task text is contradicted by the code.');
    expect(told(scratch)).toEqual([
      ['task-start', null],
      ['decision', 'stop'],
      ['task-blocked', 'status: blocked'],
    ]);
  }, CASE_TIMEOUT_MS);

  it('retries with the decision\'s approach handed to the task\'s next session, then stops on the next held task', () => {
    const scratch = plant({
      tasks: [report('blocked'), report('done'), report('blocked')],
      decisions: [
        decision('strategy: retry', 'reason: "The fixture holds the env file."', 'approach: "Read the env file from the fixture."'),
        decision('strategy: stop', 'reason: "A design decision is needed."'),
      ],
    });

    const run = runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']);

    expectExit(run, 20, { ...scratch });
    expect(callsOf(scratch)).toEqual(['task', 'decision', 'task', 'task', 'decision']);
    expect(promptOf(scratch, 'task', 2)).toContain(`${BLOCKER_PROMPT_PREFIX}Read the env file from the fixture.`);
    expect(told(scratch)).toEqual([
      ['task-start', null],
      ['retry', 'the decision chose retry'],
      ['decision', 'retry'],
      ['task-start', null],
      ['task-done', null],
      ['task-start', null],
      ['decision', 'stop'],
      ['task-blocked', 'status: blocked'],
    ]);
  }, CASE_TIMEOUT_MS);

  it('under --output=json ends with exit 21 and the prompt, then applies --decide=jump on the next run before any session', () => {
    const scratch = plant({ tasks: [report('blocked'), report('done')], decisions: [] });

    const first = runLoopStart(scratch, 'json', [...SESSION_FLAGS, '--continue']);

    expectExit(first, 21, { ...scratch });
    expect(callsOf(scratch)).toEqual(['task']);
    const needed = first.stdout.split('\n')
      .filter((line) => line.includes('"decision-needed"'))
      .map((line) => JSON.parse(line) as { data: Record<string, unknown> });
    expect(needed).toHaveLength(1);
    expect(needed[0]?.data).toMatchObject({ task: GATE, line: 3, holds: ['status: blocked'], retriesLeft: 1 });
    expect(needed[0]?.data['prompt']).toContain('# Loop continue decision instructions');
    expect(trackerOf(scratch)).toContain(`- [BLOCKED] ${GATE}`);

    // The caller decides: the gate is jumped before anything is spawned,
    // the later task runs, and the run ends on the gate passed over.
    const second = runLoopStart(scratch, 'json', [...SESSION_FLAGS, '--continue', '--decide=jump']);

    expectExit(second, 22, { ...scratch });
    expect(callsOf(scratch)).toEqual(['task', 'task']);
    expect(told(scratch)).toEqual([
      ['task-start', null],
      ['decision-needed', null],
      ['task-blocked', 'status: blocked'],
      ['decision', 'jump'],
      ['task-start', null],
      ['task-done', null],
      ['passed-over', null],
      ['halt', 'passed over 1 task(s)'],
    ]);
  }, CASE_TIMEOUT_MS);

  it('with --force-wrap-up, takes the pre-wrap-up step and wraps up past the gate it passed over', () => {
    const scratch = plant({
      tasks: [report('blocked'), report('done'), ['The wrap-up is done.']],
      decisions: [decision('strategy: jump', 'reason: "A person writes the env file, and no later task reads it."')],
    });

    const run = runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue', '--force-wrap-up']);

    expect(callsOf(scratch)).toEqual(['task', 'decision', 'task', 'task']);
    expect(promptOf(scratch, 'task', 3)).not.toContain('Loop continue decision instructions');
    expect(told(scratch).slice(0, 5)).toEqual([
      ['task-start', null],
      ['decision', 'jump'],
      ['task-start', null],
      ['task-done', null],
      ['passed-over', null],
    ]);
    expect(eventsOf(scratch).filter((event) => event.name === 'wrap-up')
      .map((event) => event.data['phase'])).toContain('session');
    expect(readSessions(scratch.repo).flatMap((record) => (record.steps ?? []).map((step) => step.kind))).toContain('pre-wrap-up');
    expect(run.stdout).toContain('Wrapping up with 1 passed-over task(s) left open (--force-wrap-up)');
    // The scratch project has no pull request provider, so there is no pull request to mark a draft.
    expect(run.stdout + run.stderr).toContain('the forced wrap-up has no pull request to mark as a draft');
    expectExit(run, 0, { ...scratch });

    // The forced run ended done, with its list on its record: the next
    // --continue run reads it, passes the gate over again with no session
    // spawned, and ends on it.
    expect(readSessions(scratch.repo).map((record) => [record.state, record.decisions?.length ?? 0])).toEqual([['done', 1]]);
    expectExit(runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']), 22, { ...scratch });
    expect(callsOf(scratch)).toHaveLength(4);
  }, CASE_TIMEOUT_MS);

  it('halts as it always did without --continue, spawning no decision session', () => {
    const scratch = plant({ tasks: [report('blocked')], decisions: [] });

    expectExit(runLoopStart(scratch, 'text', SESSION_FLAGS), 0, { ...scratch });
    expect(callsOf(scratch)).toEqual(['task']);
    expect(told(scratch)).toEqual([['task-start', null], ['task-blocked', 'status: blocked']]);
  }, CASE_TIMEOUT_MS);
});

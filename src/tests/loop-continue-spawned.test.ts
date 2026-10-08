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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { eventsFileOf, readEventsFrom } from '../loop/events-file.js';
import { readSessions } from '../loop/sessions.js';
import { BLOCKER_PROMPT_PREFIX } from '../start/dispatch.js';

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

/** The planted tracker's text. */
function trackerOf(scratch: Scratch): string {
  return readFileSync(join(scratch.repo, '.plans', `PLAN_TRACKER-${STUB}.md`), 'utf8');
}

describe('loop start --continue over a real loop', () => {
  it('jumps the gate its report held, runs the task after it, and ends with exit 22 on the gate left passed over', () => {
    const scratch = plant({
      tasks: [report('blocked'), report('done')],
      decisions: [decision('strategy: jump', 'reason: "A person writes the env file, and no later task reads it."')],
    });

    const run = runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']);

    expect(run.exitCode).toBe(22);
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
    expect(run.stderr).toContain('passed-over task(s) left open');
    expect(readSessions(scratch.repo)[0]?.decisions?.map((entry) => [entry.task.task, entry.strategy])).toEqual([[GATE, 'jump']]);

    // A second --continue run opens with that list: the gate stays passed
    // over, no session is spawned, and the run ends on it again.
    expect(runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']).exitCode).toBe(22);
    expect(callsOf(scratch)).toHaveLength(3);
  }, CASE_TIMEOUT_MS);

  it('stops with exit 20 on a stop decision, emitting the decision and then the task\'s own blocked event, and no error', () => {
    const scratch = plant({
      tasks: [report('blocked')],
      decisions: [decision('strategy: stop', 'reason: "The task text is contradicted by the code."')],
    });

    const run = runLoopStart(scratch, 'text', [...SESSION_FLAGS, '--continue']);

    expect(run.exitCode).toBe(20);
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

    expect(run.exitCode).toBe(20);
    expect(callsOf(scratch)).toEqual(['task', 'decision', 'task', 'task', 'decision']);
    expect(promptOf(scratch, 'task', 2)).toContain(`${BLOCKER_PROMPT_PREFIX}Read the env file from the fixture.`);
    expect(told(scratch)).toEqual([
      ['task-start', null],
      ['decision', 'retry'],
      ['retry', 'the decision chose retry'],
      ['task-start', null],
      ['task-done', null],
      ['task-start', null],
      ['decision', 'stop'],
      ['task-blocked', 'status: blocked'],
    ]);
  }, CASE_TIMEOUT_MS);

  it('halts as it always did without --continue, spawning no decision session', () => {
    const scratch = plant({ tasks: [report('blocked')], decisions: [] });

    expect(runLoopStart(scratch, 'text', SESSION_FLAGS).exitCode).toBe(0);
    expect(callsOf(scratch)).toEqual(['task']);
    expect(told(scratch)).toEqual([['task-start', null], ['task-blocked', 'status: blocked']]);
  }, CASE_TIMEOUT_MS);
});

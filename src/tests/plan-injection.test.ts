/**
 * A run's injection mode, from the command line to the prompt.
 *
 * `config.ts` ranks a setting's layers and `plan/inject.ts` renders a
 * mode, and each is tested beside its own module. `start.ts` is where
 * the two meet: through `start/run-config.ts` it hands `--inject=` to
 * the config as the command-line layer, hands the mode that comes back
 * to `start/dispatch.ts`, which
 * renders every task prompt in it, and hands the wrap-up the plan with
 * no mode at all, for `start/wrap-up.ts` to build its prompt from. The
 * cases here drive those seams through the real resolver over a real
 * `.rafa/config.yaml`, and through `dispatchTask` with only the session
 * spawn stubbed.
 *
 * ## Controls
 *
 * Every exclusion is paired with the inclusion that makes it a reading.
 * A `stage` prompt lacking another stage's context says nothing unless
 * the `full` prompt of the same dispatch carries it, so the `full` case
 * asserts every marker the narrower modes are asserted to drop. The
 * wrap-up's containment of the whole plan is paired with a `stage`
 * rendering of the same plan that does not contain it, and each
 * precedence case reads the same root with and without the flag.
 *
 * ## What is not driven
 *
 * `start()` itself is not: it spawns the real CLI with no seam, and
 * neither does `preserveProgress`. What they thread is pinned instead,
 * by reading each literal in the file it lives in: `start.ts` for the
 * two calls that carry the mode to the dispatch and the plan to the
 * wrap-up, and `start/wrap-up.ts` for the plan reaching its prompt.
 */
import type { ConfigRoots } from '../config-load.js';
import type { InjectMode } from '../config.js';
import type { TaskDispatch, TaskSessionRunner } from '../start/dispatch.js';
import type { TaskInfo } from '../utils/tracker.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CONFIG_DEFAULTS, ConfigError } from '../config.js';
import { classifyPromptContent } from '../effort/classify.js';
import { renderInjection } from '../plan/index.js';
import { dispatchTask } from '../start/dispatch.js';
import { announcePlanIssues, injectSourceLabel, loadRunConfig } from '../start/run-config.js';
import { buildWrapUpPrompt } from '../start/wrap-up.js';
import { planStubFromPrompt, stampPrompt } from '../utils/plan-stamp.js';
import { findNextTask } from '../utils/tracker.js';

import { sinkOutput } from './output-sinks.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** The plan-wide context's marker. */
const PLAN_CONTEXT = 'PLAN-WIDE CONTEXT: every task reads this.';

/** The first stage's context marker. */
const SCHEMA_CONTEXT = 'SCHEMA CONTEXT: only schema tasks read this.';

/** The second stage's context marker. */
const ROUTES_CONTEXT = 'ROUTES CONTEXT: only route tasks read this.';

/** The first task, which carries a declaration. */
const FIRST_TASK = 'Add the schema for the job request';

/** The declaration the first task carries. */
const FIRST_DECLARATION = '{agent=loop-implementer}';

/** The task every mode case dispatches: the second in its stage. */
const DISPATCHED_TASK = 'Add the schema for the job response';

/** The one task in the other stage. */
const OTHER_STAGE_TASK = 'Add the route that creates a job';

/** A plan with a context, two stages, their contexts and three tasks. */
const PLAN = [
  '# Plan: an injection fixture',
  '',
  `${FENCE}rafa:context`,
  PLAN_CONTEXT,
  FENCE,
  '',
  '# Stage: Schema',
  '',
  `${FENCE}rafa:stage-context`,
  SCHEMA_CONTEXT,
  FENCE,
  '',
  `- [ ] ${FIRST_TASK}  ${FIRST_DECLARATION}`,
  `- [ ] ${DISPATCHED_TASK}`,
  '',
  '# Stage: Routes',
  '',
  `${FENCE}rafa:stage-context`,
  ROUTES_CONTEXT,
  FENCE,
  '',
  `- [ ] ${OTHER_STAGE_TASK}`,
  '',
].join('\n');

/** A stand-in for `PROMPT.md`. */
const PROMPT_CONTENT = 'The loop stages and commits on your behalf.';

/** The line the loop writes above every task prompt. */
const DISPATCHED_HEAD = `Your scoped task is: ${DISPATCHED_TASK}`;

/** The branch a wrap-up is told to push to. */
const BRANCH = 'feat/an-injection-fixture';

/** A mode the file names, distinct from the default and from the flag. */
const FILE_MODE: InjectMode = 'task';

/** The mode the flag names. */
const FLAG_MODE: InjectMode = 'full';

/** A config naming {@link FILE_MODE}. */
const FILE_CONFIG = `plan:\n  inject: ${FILE_MODE}\n`;

/**
 * The task the loop dispatches once `done` tasks are ticked, read by
 * the loop's own reader over the plan used as its tracker.
 */
function nextTaskAfter(done: number): TaskInfo {
  let tracker = PLAN;
  for (let ticked = 0; ticked < done; ticked += 1) {
    tracker = tracker.replace('- [ ] ', '- [x] ');
  }
  const task = findNextTask(tracker);
  if (task === null) throw new Error(`no task left after ${done} ticked`);
  return task;
}

/** The first line of a prompt. */
function headOf(prompt: string): string {
  return prompt.split('\n')[0] ?? '';
}

/** Lines the loop reported to the operator. */
let logs: string[] = [];

/** Lines it reported as a problem. */
let warnings: string[] = [];

/**
 * Captures what the loop told the operator, by level. `start/run-config.ts`
 * and `start/dispatch.ts` both write through the active output, read
 * through a `sinkOutput` set for each case and put back to the default
 * after it. The one case asking whether a line reached `console` spies on
 * `console.warn` itself.
 */
beforeEach(() => {
  logs = [];
  warnings = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      logs.push(message);
    },
    warn: (message) => {
      warnings.push(message);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
  mock.restore();
});

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-inject-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let roots = 0;

/** A fresh repo root, with `.rafa/config.yaml` holding `text` if given. */
function rootWith(text: string | null): string {
  roots += 1;
  const root = join(tempRoot, `root-${roots}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  if (text !== null) writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

/** A home of this file's own, holding no config, that a run reads under. */
const HOME = join(tempRoot, 'home');

/** The roots a run resolves under: `root`, with {@link HOME} as its home. */
function scopesOf(root: string): ConfigRoots {
  return { root, home: HOME };
}

describe('the injection mode a run resolves', () => {
  it('names three different modes, so each layer is a reading', () => {
    expect(new Set([FILE_MODE, FLAG_MODE]).size).toBe(2);
    expect(FILE_MODE).not.toBe(CONFIG_DEFAULTS.inject);
  });

  it('answers the default with no flag and no file', () => {
    const resolved = loadRunConfig(scopesOf(rootWith(null)), ['--plan=PLAN-x.md']);

    expect(resolved.config.inject).toBe(CONFIG_DEFAULTS.inject);
    expect(resolved.sources.inject).toBe('default');
    expect(resolved.path).toBeNull();
  });

  it('takes the file over the default', () => {
    const resolved = loadRunConfig(scopesOf(rootWith(FILE_CONFIG)), ['--plan=PLAN-x.md']);

    expect(resolved.config.inject).toBe(FILE_MODE);
    expect(resolved.sources.inject).toBe('file');
  });

  it('lets --inject= outrank the file', () => {
    const root = rootWith(FILE_CONFIG);
    const flagged = loadRunConfig(scopesOf(root), ['--plan=PLAN-x.md', `--inject=${FLAG_MODE}`]);
    const unflagged = loadRunConfig(scopesOf(root), ['--plan=PLAN-x.md']);

    expect(flagged.config.inject).toBe(FLAG_MODE);
    expect(flagged.sources.inject).toBe('cli');

    // The same root without the flag: the file is read and answers.
    expect(unflagged.config.inject).toBe(FILE_MODE);
    expect(unflagged.sources.inject).toBe('file');
  });

  it('leaves the store to the file when the flag names the mode', () => {
    const root = rootWith(`store: ndjson\n${FILE_CONFIG}`);
    const resolved = loadRunConfig(scopesOf(root), [`--inject=${FLAG_MODE}`]);

    expect(resolved.config.store).toBe('ndjson');
    expect(resolved.sources.store).toBe('file');
    expect(resolved.sources.inject).toBe('cli');
  });

  it('reads the user file under the home, and labels each layer the mode came from', () => {
    const home = rootWith(FILE_CONFIG);
    const projectRoot = rootWith(FILE_CONFIG);
    const fromUser = loadRunConfig({ root: rootWith(null), home }, []);
    const fromFile = loadRunConfig({ root: projectRoot, home }, []);
    const fromFlag = loadRunConfig({ root: rootWith(null), home }, [`--inject=${FLAG_MODE}`]);
    const fromDefault = loadRunConfig(scopesOf(rootWith(null)), []);

    expect(fromUser.config.inject).toBe(FILE_MODE);
    expect(fromUser.sources.inject).toBe('user');
    expect(injectSourceLabel(fromUser)).toBe(join(home, '.rafa', 'config.yaml'));
    expect(fromFile.sources.inject).toBe('file');
    expect(injectSourceLabel(fromFile)).toBe(join(projectRoot, '.rafa', 'config.yaml'));
    expect(injectSourceLabel(fromFlag)).toBe('--inject');
    expect(injectSourceLabel(fromDefault)).toBe('the default');
  });

  it('refuses a flag value no mode answers to', () => {
    const root = rootWith(FILE_CONFIG);

    expect(() => loadRunConfig(scopesOf(root), ['--inject=stages'])).toThrow(ConfigError);
    expect(() => loadRunConfig(scopesOf(root), ['--inject=stages'])).toThrow('command line: inject is "stages"');
  });

  it('refuses a bare --inject rather than reading it as absent', () => {
    const root = rootWith(FILE_CONFIG);

    expect(() => loadRunConfig(scopesOf(root), ['--inject'])).toThrow(ConfigError);
    expect(loadRunConfig(scopesOf(root), []).config.inject).toBe(FILE_MODE);
  });

  it('hands a warning per unknown key to the sink it is given', () => {
    const seen: string[] = [];
    const root = rootWith(`${FILE_CONFIG}nonesuch: linear\n`);
    const resolved = loadRunConfig(scopesOf(root), [], (message) => {
      seen.push(message);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('"nonesuch"');
    expect(resolved.config.inject).toBe(FILE_MODE);
    expect(warnings).toEqual([]);
  });

  it('writes a warning per unknown key through the active output when it is given no sink', () => {
    const routed: string[] = [];
    const consoleWarned: string[] = [];
    const root = rootWith(`${FILE_CONFIG}nonesuch: linear\n`);
    spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleWarned.push(args.map(String).join(' '));
    });
    setActiveOutput(sinkOutput({
      warn: (message) => {
        routed.push(message);
      },
    }));

    const resolved = loadRunConfig(scopesOf(root), []);

    expect(routed).toHaveLength(1);
    expect(routed[0]).toContain('"nonesuch"');
    expect(resolved.config.inject).toBe(FILE_MODE);

    // The console spy read nothing: the warning went through the active
    // output alone, as `loadConfig` handed no sink writes it too.
    expect(consoleWarned).toEqual([]);
  });
});

/** What one driven dispatch produced. */
interface DispatchRun {
  result: TaskDispatch;
  prompts: readonly string[];
}

/** Dispatches one task under `mode`, recording the spawn's prompt. */
async function dispatchIn(mode: InjectMode, taskInfo: TaskInfo): Promise<DispatchRun> {
  const prompts: string[] = [];
  const run: TaskSessionRunner = (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ exitCode: 0, stdout: '' });
  };

  const result = await dispatchTask({
    taskInfo,
    promptContent: PROMPT_CONTENT,
    planContent: PLAN,
    inject: mode,
    repoRoot: tempRoot,
    home: join(tempRoot, 'home'),
    settingSources: ['project', 'local'],
    serving: null,
    run,
  });
  return { result, prompts };
}

describe('a task dispatched under each mode', () => {
  it('dispatches the second task of the first stage', () => {
    const task = nextTaskAfter(1);

    expect(task.task).toBe(DISPATCHED_TASK);
    expect(PLAN.split('\n')[task.lineNum]).toBe(`- [ ] ${DISPATCHED_TASK}`);
  });

  it('hands `full` the plan byte for byte, every marker in it', async () => {
    const { result, prompts } = await dispatchIn('full', nextTaskAfter(1));

    expect(prompts).toEqual([result.prompt]);
    expect(result.injection).toEqual({
      requested: 'full',
      mode: 'full',
      text: PLAN,
      fallback: null,
    });
    expect(result.prompt.endsWith(`\n${PROMPT_CONTENT}\n${PLAN}`)).toBe(true);

    // The inclusions every narrower mode below is asserted to drop.
    for (const marker of [ROUTES_CONTEXT, OTHER_STAGE_TASK, FIRST_DECLARATION]) {
      expect(result.prompt).toContain(marker);
    }
  });

  it('hands `stage` its own stage and nothing of another', async () => {
    const { result, prompts } = await dispatchIn('stage', nextTaskAfter(1));
    const prompt = result.prompt;

    expect(prompts).toEqual([prompt]);
    expect(result.injection.mode).toBe('stage');
    expect(result.injection.fallback).toBeNull();
    expect(prompt.endsWith(`\n${PROMPT_CONTENT}\n${result.injection.text}`)).toBe(true);

    expect(prompt).toContain(PLAN_CONTEXT);
    expect(prompt).toContain(SCHEMA_CONTEXT);
    expect(prompt).toContain(`- [x] ${FIRST_TASK}\n- [ ] ${DISPATCHED_TASK}`);
    expect(prompt).toContain('1. Schema (current stage)\n2. Routes');

    expect(prompt).not.toContain(ROUTES_CONTEXT);
    expect(prompt).not.toContain(OTHER_STAGE_TASK);
    expect(prompt).not.toContain(FIRST_DECLARATION);
    expect(prompt).not.toContain(PLAN);
  });

  it('hands `task` the task line and its contexts alone', async () => {
    const { result } = await dispatchIn('task', nextTaskAfter(1));
    const prompt = result.prompt;

    expect(result.injection.mode).toBe('task');
    expect(result.injection.fallback).toBeNull();
    expect(prompt).toContain(PLAN_CONTEXT);
    expect(prompt).toContain(SCHEMA_CONTEXT);
    expect(prompt).toContain(`- [ ] ${DISPATCHED_TASK}`);

    expect(prompt).not.toContain(FIRST_TASK);
    expect(prompt).not.toContain(ROUTES_CONTEXT);
    expect(prompt).not.toContain(OTHER_STAGE_TASK);
    expect(prompt).not.toContain('## Stages');
  });

  it('writes the same classifiable head in every mode', async () => {
    for (const mode of ['full', 'stage', 'task'] as const) {
      const { result } = await dispatchIn(mode, nextTaskAfter(1));

      expect(headOf(result.prompt)).toBe(DISPATCHED_HEAD);
      expect(classifyPromptContent(result.prompt)).toBe('task');
    }
  });

  it('hands over the whole plan, and says why, when the task has moved', async () => {
    const task = nextTaskAfter(1);
    const moved = { ...task, lineNum: task.lineNum + 1 };
    const { result } = await dispatchIn('stage', moved);

    expect(result.injection.requested).toBe('stage');
    expect(result.injection.mode).toBe('full');
    expect(result.injection.fallback?.reason).toBe('no-task-at-line');
    expect(result.prompt.endsWith(`\n${PLAN}`)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('`stage` not rendered');
    expect(warnings[0]).toContain(`line ${moved.lineNum + 1} of the plan`);

    // The same dispatch at the task's own line renders and says nothing.
    warnings = [];
    const inPlace = await dispatchIn('stage', task);
    expect(inPlace.result.injection.mode).toBe('stage');
    expect(warnings).toEqual([]);
  });

  it('warns about nothing under `full`, which locates no task', async () => {
    const task = nextTaskAfter(1);
    const { result } = await dispatchIn('full', { ...task, lineNum: task.lineNum + 1 });

    expect(result.injection.fallback).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe('the wrap-up session', () => {
  it('is handed the whole plan, which a stage rendering is not', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN);
    const stage = renderInjection({ mode: 'stage', plan: PLAN, task: nextTaskAfter(1) });

    expect(prompt.endsWith(`\n${PLAN}`)).toBe(true);
    expect(prompt).toContain(BRANCH);

    // The control: the narrower rendering really is narrower, so the
    // containment above could have failed.
    expect(stage.mode).toBe('stage');
    expect(stage.text.includes(PLAN)).toBe(false);
  });

  it('keeps its classifier key first, the plan and the stamp after it', () => {
    const stub = 'an-injection-fixture';
    const stamped = stampPrompt(stub, buildWrapUpPrompt(BRANCH, PLAN));

    expect(classifyPromptContent(stamped)).toBe('wrap-up');
    expect(planStubFromPrompt(stamped)).toBe(stub);

    // The plan written ABOVE the instructions buckets as nothing.
    const prepended = `${PLAN}\n${buildWrapUpPrompt(BRANCH, '')}`;
    expect(classifyPromptContent(prepended)).toBe('other');
  });

  it('is started with the plan and never with a rendering', () => {
    const start = readFileSync(new URL('../start.ts', import.meta.url), 'utf8');
    const wrapUp = readFileSync(new URL('../start/wrap-up.ts', import.meta.url), 'utf8');

    expect(start).toContain('await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning);');
    expect(wrapUp).toContain('buildWrapUpPrompt(branch, planContent, openPullRequest, release, lessons)');
    expect(start).toContain('inject: injectMode,');
    expect(start).not.toContain('await preserveProgress(injection');
  });
});

describe('the plan issues named at start', () => {
  it('names each part the parser did not read, by line', () => {
    const unclosed = `${PLAN}\n${FENCE}rafa:notes\n- [ ] A task inside a block never closed\n`;
    const issues = announcePlanIssues(unclosed);
    const reasons = issues.map((issue) => issue.reason);

    expect(reasons).toContain('unclosed-block');
    expect(reasons).toContain('task-in-block');
    expect(warnings[0]).toContain(`${issues.length} part(s)`);
    for (const issue of issues) {
      expect(warnings).toContain(`   line ${issue.line}: ${issue.text}`);
    }
    expect(warnings).toHaveLength(issues.length + 1);
  });

  it('says nothing about a plan it read whole', () => {
    expect(announcePlanIssues(PLAN)).toEqual([]);
    expect(warnings).toEqual([]);
    expect(logs).toEqual([]);
  });
});

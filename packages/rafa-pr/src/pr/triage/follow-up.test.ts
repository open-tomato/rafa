/**
 * Tests for the follow-up prompt (`src/pr/triage/follow-up.ts`).
 *
 * The module is a pure function from one reading to one string, so
 * nothing here plants a repository, spawns `gh` or `git`, or reads a
 * fixture: every case is a literal pull request, a literal assessment
 * and a literal log reading.
 *
 * What the cases are FOR, given the module writes prose and prose is
 * easy to assert nothing about:
 *
 *  - The promise in the task — "so a session started with it assesses
 *    nothing again" — is measured as a property rather than as a
 *    sentence: {@link everyEvidenceToken} lists every value a session
 *    would otherwise have to run a command to learn (the class, each
 *    conflicting file, the step name, each excerpt line, the head
 *    commit, both branch names), and one case asserts the prompt
 *    carries all of them. A section dropped from the prompt fails it.
 *  - Every section is present whatever was read, so each of the three
 *    empty readings is paired with its control: the same section with
 *    something in it, asserted to carry the content and NOT the
 *    apology.
 *  - The class set stays closed through {@link FOLLOW_UP_TASKS} the way
 *    `./classify.test.ts` holds it closed through the classifier: its
 *    keys are compared against `TRIAGE_CLASSES` from both ends, and
 *    every class is built into a prompt whose "What to do" section is
 *    that class's own line.
 *  - The cap and the fence are the two places a wrong reading would be
 *    silent rather than loud, so each has a control: an already-capped
 *    evidence that must come through untouched, and an ordinary log
 *    that must keep the three-backtick fence a log holding a fence of
 *    its own widens.
 *
 * Six mutations of `follow-up.ts` were driven against this file on
 * 2026-09-18, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each, 26 pass either side:
 *
 *  - the excerpt cap dropped, showing every line the evidence held:
 *    2 fail, the capping case and the caller-cap case.
 *  - the two omission counts no longer added, the reading reporting
 *    only its own drop: 2 fail, the capping case and the already-capped
 *    control, which is why that control gives its evidence an `omitted`
 *    of 611 rather than of zero.
 *  - the fence fixed at three backticks: 2 fail, the fenced-log case
 *    and the `fencedBlock` case over a four-backtick run.
 *  - the `Failing step` section dropped when no step was named: 2 fail,
 *    the always-present case and the no-step case.
 *  - `filesSection` answering the conflict apology for a mergeable pull
 *    request as well: 1 fail, the clean-merge control.
 *  - the "do not assess again" sentence written with a count of the
 *    commands instead of their names: 1 fail, the named-commands case.
 */
import type { TriageAssessment } from './classify.js';
import type { FailedLogEvidence, FailedStep } from './evidence.js';
import type { FollowUpInput, FollowUpPullRequest } from './follow-up.js';

import { describe, expect, it } from 'bun:test';

import { TRIAGE_CLASSES } from './classes.js';
import { FAILED_LOG_TAIL_LINES } from './evidence.js';
import {
  buildFollowUpPrompt,
  excerptCaption,
  excerptLines,
  fencedBlock,
  FOLLOW_UP_EXCERPT_LINES,
  FOLLOW_UP_TASKS,
  NO_EXCERPT,
  NO_FILES,
  NO_STEP,
  REASSESS_COMMANDS,
} from './follow-up.js';

/** A pull request, same-repository unless a case says otherwise. */
function pull(overrides: Partial<FollowUpPullRequest> = {}): FollowUpPullRequest {
  return {
    number: 21,
    title: 'chore(deps): bump bun-types from 1.3.0 to 1.3.1',
    url: 'https://github.com/open-tomato/rafa/pull/21',
    headRefName: 'dependabot/npm_and_yarn/bun-types-1.3.1',
    baseRefName: 'main',
    headRefOid: '9f2c1ab4e7d0c3b5a6f8091d2e3c4b5a6f708192',
    isCrossRepository: false,
    ...overrides,
  };
}

/** One assessment, green and clean unless a case says otherwise. */
function assess(overrides: Partial<TriageAssessment> = {}): TriageAssessment {
  return {
    triageClass: 'green',
    simple: false,
    dependencyBump: false,
    verdict: 'green',
    conflicting: false,
    files: [],
    step: undefined,
    failing: [],
    reason: 'the head merges cleanly and all 2 checks passed',
    ...overrides,
  };
}

/** A failing step as the group-marker reading infers one. */
function step(name: string): FailedStep {
  return { name, source: 'group-marker' };
}

/** One log reading over `lines`, already capped unless a case says otherwise. */
function evidenceOf(
  lines: readonly string[],
  overrides: Partial<FailedLogEvidence> = {},
): FailedLogEvidence {
  return {
    jobs: ['gates'],
    step: step('bun test'),
    lines,
    omitted: 0,
    total: lines.length,
    ...overrides,
  };
}

/** `count` numbered log lines, so a case can tell which survived a cap. */
function numberedLines(count: number): readonly string[] {
  return Array.from({ length: count }, (_unused, index) => `log line ${index + 1}`);
}

/** The full reading: a conflicting, red pull request with everything read. */
function fullInput(overrides: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    pr: pull(),
    assessment: assess({
      triageClass: 'ci-test',
      simple: false,
      verdict: 'red',
      step: step('bun test'),
      failing: [],
      reason: '1 check failing, the failing step being "bun test"',
    }),
    evidence: evidenceOf(['12 pass, 1 fail', 'error: expected 3 to be 4']),
    ...overrides,
  };
}

/** The body of one `## <heading>` section, up to the next heading. */
function section(prompt: string, heading: string): string {
  const opener = `## ${heading}\n\n`;
  const start = prompt.indexOf(opener);
  if (start === -1) return '';
  const rest = prompt.slice(start + opener.length);
  const end = rest.indexOf('\n## ');
  return end === -1
    ? rest.trimEnd()
    : rest.slice(0, end).trimEnd();
}

/** Every heading the prompt is required to carry, in its own order. */
const SECTIONS: readonly string[] = [
  'Pull request',
  'Class',
  'Conflicting files',
  'Failing step',
  'Log excerpt',
  'What to do',
];

/**
 * Every value a session would have to run a command to learn again.
 * The self-sufficiency case reads the prompt for all of them.
 */
function everyEvidenceToken(input: FollowUpInput): readonly string[] {
  const { assessment, evidence, pr } = input;
  return [
    assessment.triageClass,
    assessment.reason,
    pr.headRefOid,
    pr.headRefName,
    pr.baseRefName,
    `#${pr.number}`,
    ...assessment.files,
    ...assessment.step === undefined
      ? []
      : [assessment.step.name],
    ...evidence?.lines ?? [],
  ];
}

describe('the class set', () => {
  it('carries a task line for every class the vocabulary declares, and no other', () => {
    expect(Object.keys(FOLLOW_UP_TASKS).sort()).toEqual([...TRIAGE_CLASSES].sort());
  });

  it('writes each class its own task line into the What to do section', () => {
    for (const triageClass of TRIAGE_CLASSES) {
      const prompt = buildFollowUpPrompt({
        pr: pull(),
        assessment: assess({ triageClass }),
      });

      expect(section(prompt, 'What to do')).toBe(FOLLOW_UP_TASKS[triageClass]);
    }
  });

  it('gives every class a non-empty line, green and pending included', () => {
    for (const triageClass of TRIAGE_CLASSES) {
      expect(FOLLOW_UP_TASKS[triageClass].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('a prompt that assesses nothing again', () => {
  it('carries every reading a session would otherwise run a command for', () => {
    const input = fullInput({
      assessment: assess({
        triageClass: 'conflict-manifest',
        simple: true,
        dependencyBump: true,
        verdict: 'none',
        conflicting: true,
        files: ['package.json', 'bun.lock'],
        step: step('bun install --frozen-lockfile'),
        reason: 'the head conflicts with the base on package.json, bun.lock',
      }),
    });

    const prompt = buildFollowUpPrompt(input);

    for (const token of everyEvidenceToken(input)) expect(prompt).toContain(token);
  });

  it('names each command whose answer is already in it', () => {
    const prompt = buildFollowUpPrompt(fullInput());

    for (const command of REASSESS_COMMANDS) expect(prompt).toContain(command);
    expect(prompt).toContain('ALREADY been assessed');
  });

  it('writes every section whatever was read', () => {
    const bare = buildFollowUpPrompt({ pr: pull(), assessment: assess() });
    const full = buildFollowUpPrompt(fullInput());

    for (const heading of SECTIONS) {
      expect(bare).toContain(`## ${heading}`);
      expect(full).toContain(`## ${heading}`);
    }
  });

  it('writes the sections in the order the reader needs them', () => {
    const prompt = buildFollowUpPrompt(fullInput());
    const positions = SECTIONS.map((heading) => prompt.indexOf(`## ${heading}`));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((position) => position > 0)).toBe(true);
  });
});

describe('the pull request section', () => {
  it('warns that a cross-repository head is on a fork', () => {
    const forked = buildFollowUpPrompt({
      pr: pull({ isCrossRepository: true }),
      assessment: assess(),
    });
    const same = buildFollowUpPrompt({ pr: pull(), assessment: assess() });

    expect(section(forked, 'Pull request')).toContain('FORK');
    expect(section(same, 'Pull request')).not.toContain('FORK');
  });
});

describe('the class section', () => {
  it('says a simple class is covered by a pinned plan, and a hard one is not', () => {
    const simple = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({ triageClass: 'conflict-lockfile', simple: true, conflicting: true }),
    });
    const hard = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({ triageClass: 'ci-test', simple: false }),
    });

    expect(section(simple, 'Class')).toContain('pinned resolve plan');
    expect(section(hard, 'Class')).not.toContain('pinned resolve plan');
  });
});

describe('the conflicting files section', () => {
  it('lists the conflicting paths it was given', () => {
    const prompt = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({
        triageClass: 'conflict-lockfile',
        conflicting: true,
        files: ['bun.lock', 'packages/cli/bun.lock'],
      }),
    });

    const body = section(prompt, 'Conflicting files');
    expect(body).toContain('bun.lock');
    expect(body).toContain('packages/cli/bun.lock');
    expect(body).not.toContain(NO_FILES);
  });

  it('says the list is unknown when a conflicting head read no files', () => {
    const prompt = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({ triageClass: 'conflict-other', conflicting: true, files: [] }),
    });

    expect(section(prompt, 'Conflicting files')).toBe(NO_FILES);
  });

  it('says the head merges cleanly when it does, rather than that the list is unknown', () => {
    const prompt = buildFollowUpPrompt({ pr: pull(), assessment: assess() });

    const body = section(prompt, 'Conflicting files');
    expect(body).toContain('merges cleanly');
    expect(body).not.toContain(NO_FILES);
  });
});

describe('the failing step section', () => {
  it('says a group-marker name is the command the step ran', () => {
    const prompt = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({ triageClass: 'ci-test', step: step('bun test') }),
    });

    const body = section(prompt, 'Failing step');
    expect(body).toContain('bun test');
    expect(body).toContain('COMMAND');
  });

  it('says a step-column name is the name the workflow gave the step', () => {
    const prompt = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({
        triageClass: 'ci-install',
        step: { name: 'Install dependencies', source: 'step-column' },
      }),
    });

    const body = section(prompt, 'Failing step');
    expect(body).toContain('Install dependencies');
    expect(body).not.toContain('COMMAND');
  });

  it('says no step was named when no log named one', () => {
    const prompt = buildFollowUpPrompt({
      pr: pull(),
      assessment: assess({ triageClass: 'ci-other', step: undefined }),
    });

    expect(section(prompt, 'Failing step')).toBe(NO_STEP);
  });
});

describe('the log excerpt', () => {
  it('shows the tail and counts what it dropped, both caps together', () => {
    const lines = numberedLines(100);
    const reading = excerptLines(evidenceOf(lines, { omitted: 7, total: 107 }));

    expect(reading.lines.length).toBe(FOLLOW_UP_EXCERPT_LINES);
    expect(reading.lines[0]).toBe(`log line ${100 - FOLLOW_UP_EXCERPT_LINES + 1}`);
    expect(reading.lines.at(-1)).toBe('log line 100');
    expect(reading.omitted).toBe(7 + (100 - FOLLOW_UP_EXCERPT_LINES));
    expect(reading.total).toBe(107);
  });

  it('leaves an already-capped reading exactly as it was', () => {
    const lines = numberedLines(FAILED_LOG_TAIL_LINES);
    const reading = excerptLines(evidenceOf(lines, { omitted: 611, total: 651 }));

    expect(reading.lines).toEqual([...lines]);
    expect(reading.omitted).toBe(611);
  });

  it('honours a caller cap, and ignores one that is not a positive whole number', () => {
    const evidence = evidenceOf(numberedLines(10));

    expect(excerptLines(evidence, 3).lines).toEqual(['log line 8', 'log line 9', 'log line 10']);
    for (const bad of [0, -4, 2.5, Number.NaN]) {
      expect(excerptLines(evidence, bad).lines.length).toBe(10);
    }
  });

  it('captions a whole log differently from a cut one', () => {
    const whole = excerptCaption({ lines: numberedLines(3), omitted: 0, total: 3 });
    const cut = excerptCaption({ lines: numberedLines(3), omitted: 9, total: 12 });

    expect(whole).toContain('all 3 lines');
    expect(cut).toContain('The last 3 lines');
    expect(cut).toContain('9 earlier lines');
    expect(cut).toContain('12 in all');
  });

  it('widens the fence past a fence the log itself printed', () => {
    const prompt = buildFollowUpPrompt(fullInput({
      evidence: evidenceOf(['error: in this snippet', '```ts', 'const x = 1;', '```']),
    }));

    expect(prompt).toContain('````text');
    expect(section(prompt, 'Log excerpt')).toContain('const x = 1;');
  });

  it('keeps a three-backtick fence for a log that prints none', () => {
    const prompt = buildFollowUpPrompt(fullInput());

    expect(prompt).toContain('```text');
    expect(prompt).not.toContain('````');
  });

  it('names the failing jobs above the excerpt', () => {
    const prompt = buildFollowUpPrompt(fullInput({
      evidence: evidenceOf(['boom'], { jobs: ['gates', 'snapshot'] }),
    }));

    const body = section(prompt, 'Log excerpt');
    expect(body).toContain('`gates`');
    expect(body).toContain('`snapshot`');
    expect(body).toContain('2 failing jobs');
  });

  it('says no log was read when there was none, and when it held no lines', () => {
    const none = buildFollowUpPrompt({ pr: pull(), assessment: assess() });
    const empty = buildFollowUpPrompt(fullInput({
      evidence: evidenceOf([], { jobs: [], step: undefined, total: 0 }),
    }));

    expect(section(none, 'Log excerpt')).toBe(NO_EXCERPT);
    expect(section(empty, 'Log excerpt')).toBe(NO_EXCERPT);
  });
});

describe('fencedBlock', () => {
  it('opens and closes on the same fence and ends the body with a newline', () => {
    const block = fencedBlock('one\ntwo', 'text');

    expect(block).toBe('```text\none\ntwo\n```');
  });

  it('grows the fence one backtick past the longest run the body holds', () => {
    expect(fencedBlock('a ```` b', 'text').startsWith('`````text')).toBe(true);
  });
});

describe('the prompt as a whole', () => {
  it('never throws, however empty the reading', () => {
    const emptied: FollowUpInput = {
      pr: pull({ title: '', url: '', headRefName: '', baseRefName: '', headRefOid: '' }),
      assessment: assess({ reason: '' }),
      evidence: undefined,
    };

    expect(() => buildFollowUpPrompt(emptied)).not.toThrow();
    expect(buildFollowUpPrompt(emptied).endsWith('\n')).toBe(true);
  });
});

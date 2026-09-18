/**
 * Tests for the demotion classifier and the skill-to-instinct
 * conversion.
 *
 * Every classification case is a whole file built by {@link skillFile},
 * because two of the seven rules read the frontmatter and the rest read
 * the body, and a fixture that skipped the fences would not exercise
 * the reader the pass actually uses. Each refusal is written beside the
 * nearly-identical file that passes, so a case is a reading about ONE
 * rule rather than about a file being broken in general: the numbered
 * procedure sits beside a two-step list, the fenced list sits beside
 * the same list unfenced, the script reference sits beside a body that
 * names a source file, and the anchored heading match sits beside the
 * heading from the corpus that carries the word `problem` in a
 * sentence.
 *
 * {@link PROVOKED} closes the set in both directions against
 * {@link CLASSIFICATION_RULES} and {@link RULE_VERDICTS}: a rule
 * nothing here provokes and a rule produced by nothing named here are
 * both red, and so is a verdict no rule answers.
 *
 * ## The usage_count reading, and its control
 *
 * The plan asks for `usage_count: 0` on a demoted record and
 * `../schema/instinct.ts` refuses 0. The pair under `the fields the
 * schema requires` measures both halves rather than asserting the
 * constant: the converted record passes `checkInstinctFrontmatter`
 * clean, and the SAME frontmatter with `usage_count: 0` comes back
 * refused with `invalid-usage-count`. Without the second reading the
 * first would pass just as happily on a schema that checked nothing.
 *
 * The conversion cases assert against the record read back out of the
 * rendered text rather than against a draft, so every one of them is
 * also a reading that the file the pass would write parses.
 */
import type { ClassificationRule, SkillSource } from './classify.js';

import { describe, expect, test } from 'bun:test';

import { renderFrontmatter } from '../schema/frontmatter.js';
import {
  INSTINCT_DOMAINS,
  checkInstinctFrontmatter,
  instinctFrontmatter,
  parseInstinct,
} from '../schema/instinct.js';

import {
  CLASSIFICATION_RULES,
  DEFAULT_DOMAIN,
  DEMOTED_CONFIDENCE,
  DEMOTED_KIND,
  DEMOTED_SOURCE,
  DEMOTED_USAGE_COUNT,
  DEMOTION_VERDICTS,
  PROCEDURE_STEP_MINIMUM,
  RULE_VERDICTS,
  bodySections,
  classifySkill,
  convertToInstinct,
  errorString,
  extractedDate,
  firstSentence,
  inferDomain,
  isScriptPath,
  numberedRuns,
  referencedScript,
  slugifyId,
  uniqueInstinctId,
} from './classify.js';

/** The frontmatter every fixture carries unless it says otherwise. */
const FRONTMATTER = {
  name: 'assert-the-stub-was-hit',
  description: 'Stub-backed tests can hit the real API when a base URL override is missed',
  origin: 'auto-extracted',
} as const;

/** The path a directory skill is found at. */
const SKILL_PATH = 'assert-the-stub-was-hit/SKILL.md';

/** The path a `/learn` single-file skill is found at. */
const LEARNED_PATH = 'learned/assert-the-stub-was-hit.md';

/** The Problem section of every fixture that has one. */
const PROBLEM = 'A stub-backed test can reach the live API when the base URL override is missed.';

/** The Solution section of every fixture that has one. */
const SOLUTION = 'Assert that the stub received the request before asserting on behaviour.';

/** The When to Use section of every fixture that has one. */
const WHEN_TO_USE = 'Writing any test with an in-process HTTP stub. Also when reviewing one.';

/** `data` with `changes` applied, an `undefined` change removing its key. */
function withFields(
  data: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...data, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

/** A whole file: {@link FRONTMATTER} plus `changes`, then `body`. */
function skillFile(body: string, changes: Readonly<Record<string, unknown>> = {}): string {
  return `---\n${renderFrontmatter(withFields(FRONTMATTER, changes))}\n---\n${body}`;
}

/** A body carrying `problem`, `solution` and a When to Use section. */
function shapedBody(problem: string, solution: string): string {
  return [
    '',
    '# Assert the stub was hit',
    '',
    '**Extracted:** 2026-08-15',
    '',
    problem,
    '',
    solution,
    '',
    '## When to Use',
    '',
    WHEN_TO_USE,
    '',
  ].join('\n');
}

/** A Problem section under `heading`. */
function problemSection(heading = '## Problem'): string {
  return `${heading}\n\n${PROBLEM}`;
}

/** A Solution section under `heading`, carrying `extra` after its prose. */
function solutionSection(heading = '## Solution', extra = ''): string {
  return `${heading}\n\n${SOLUTION}${extra}`;
}

/** The observation-shaped file every control is a mutation of. */
const OBSERVATION = skillFile(shapedBody(problemSection(), solutionSection()));

/** A source at `path`, carrying `text` and owning `entries`. */
function source(text: string, path = SKILL_PATH, entries: readonly string[] = []): SkillSource {
  return { path, text, entries };
}

describe('the observation shape', () => {
  const result = classifySkill(source(OBSERVATION));

  test('reads one Problem section and one Solution section as an observation', () => {
    expect(result.verdict).toBe('observation');
    expect(result.rule).toBe('observation-shape');
  });

  test('answers a one-line reason naming the rule that decided it', () => {
    expect(result.reason).not.toContain('\n');
    expect(result.reason).toContain('one Problem section and one Solution section');
    expect(result.reason).toContain(`${PROCEDURE_STEP_MINIMUM} or more consecutive steps`);
    expect(result.reason).toContain('no referenced script');
  });

  test('reads the pair at any heading level', () => {
    const deep = skillFile(shapedBody(
      problemSection('### Problem'),
      solutionSection('#### Solution'),
    ));

    expect(classifySkill(source(deep)).verdict).toBe('observation');
  });

  test('reads The Problem and a Solution with a trailing clause', () => {
    const tail = skillFile(shapedBody(
      problemSection('## The Problem'),
      solutionSection('## Solution — pin the subject, not the behaviour'),
    ));

    expect(classifySkill(source(tail)).verdict).toBe('observation');
  });

  test('reads a learned file carrying an origin', () => {
    expect(classifySkill(source(OBSERVATION, LEARNED_PATH)).verdict).toBe('observation');
  });

  test('reads a directory skill carrying no origin, which is not the learned rule', () => {
    const bare = skillFile(
      shapedBody(problemSection(), solutionSection()),
      { origin: undefined },
    );

    expect(classifySkill(source(bare)).verdict).toBe('observation');
  });
});

describe('the procedure shape', () => {
  /** Three numbered steps, which is the minimum that decides. */
  const steps = [
    '',
    '',
    '1. Assert the stub received traffic.',
    '2. Assert the request shape rather than only the parsed result.',
    '3. Block the network in the test runner.',
  ].join('\n');

  test('refuses a numbered procedure of three consecutive steps', () => {
    const file = skillFile(shapedBody(problemSection(), solutionSection('## Solution', steps)));
    const result = classifySkill(source(file));

    expect(result.verdict).toBe('procedure');
    expect(result.rule).toBe('numbered-procedure');
    expect(result.reason).toContain('3 consecutive steps');
  });

  test('accepts two steps, which is one short of the rule', () => {
    const two = steps.split('\n')
      .slice(0, -1)
      .join('\n');
    const file = skillFile(shapedBody(problemSection(), solutionSection('## Solution', two)));

    expect(classifySkill(source(file)).verdict).toBe('observation');
  });

  test('accepts three numbered lines that unindented prose breaks apart', () => {
    const split = [
      '',
      '',
      '1. Assert the stub received traffic.',
      '',
      'That much is one line of setup.',
      '',
      '2. Assert the request shape.',
      '',
      'A live service will not match a synthetic offset.',
      '',
      '3. Block the network in the test runner.',
    ].join('\n');
    const file = skillFile(shapedBody(problemSection(), solutionSection('## Solution', split)));

    expect(classifySkill(source(file)).verdict).toBe('observation');
  });

  test('accepts numbered lines inside a fenced block', () => {
    const fenced = ['', '', '```text', '1. one', '2. two', '3. three', '```'].join('\n');
    const file = skillFile(shapedBody(problemSection(), solutionSection('## Solution', fenced)));

    expect(classifySkill(source(file)).verdict).toBe('observation');
  });

  test('refuses more than one Problem section', () => {
    const file = skillFile([
      '',
      problemSection('## Problem 1 — the stub is never called'),
      '',
      problemSection('## Problem 2 — the assertion cannot tell'),
      '',
      solutionSection(),
      '',
    ].join('\n'));
    const result = classifySkill(source(file));

    expect(result.verdict).toBe('procedure');
    expect(result.rule).toBe('repeated-section');
    expect(result.reason).toContain('2 Problem sections');
  });

  test('refuses more than one Solution section', () => {
    const file = skillFile([
      '',
      problemSection(),
      '',
      solutionSection('## Solution — one command per property'),
      '',
      solutionSection('## Solution — two pins'),
      '',
    ].join('\n'));
    const result = classifySkill(source(file));

    expect(result.rule).toBe('repeated-section');
    expect(result.reason).toContain('2 Solution sections');
  });

  /** A file whose Solution names `scripts/check-stub.sh`. */
  const naming = skillFile(shapedBody(
    problemSection(),
    solutionSection('## Solution', '\n\nRun `scripts/check-stub.sh` before the suite.'),
  ));

  test('refuses a body naming a script the skill directory holds', () => {
    const result = classifySkill(source(naming, SKILL_PATH, ['SKILL.md', 'scripts']));

    expect(result.verdict).toBe('procedure');
    expect(result.rule).toBe('referenced-script');
    expect(result.reason).toContain('scripts/check-stub.sh');
  });

  test('accepts the same body when the skill directory holds no such entry', () => {
    expect(classifySkill(source(naming, SKILL_PATH, ['SKILL.md'])).verdict).toBe('observation');
    expect(classifySkill(source(naming)).verdict).toBe('observation');
  });

  test('accepts a body naming the scripts of the project it illustrates', () => {
    const named = '\n\nRun `scripts/build.mjs`, then `./dist/index.js`.';
    const file = skillFile(shapedBody(problemSection(), solutionSection('## Solution', named)));

    expect(classifySkill(source(file, SKILL_PATH, ['SKILL.md'])).verdict).toBe('observation');
  });
});

describe('the unclassified shape', () => {
  test('refuses a file opening with no frontmatter', () => {
    const result = classifySkill(source(shapedBody(problemSection(), solutionSection())));

    expect(result.verdict).toBe('unclassified');
    expect(result.rule).toBe('no-frontmatter');
  });

  test('refuses a learned file whose frontmatter carries no origin', () => {
    const file = skillFile(
      shapedBody(problemSection(), solutionSection()),
      { origin: undefined },
    );
    const result = classifySkill(source(file, LEARNED_PATH));

    expect(result.verdict).toBe('unclassified');
    expect(result.rule).toBe('learned-without-origin');
    expect(result.reason).toContain('origin');
  });

  test('refuses a learned file whose origin is empty', () => {
    const file = skillFile(shapedBody(problemSection(), solutionSection()), { origin: '' });

    expect(classifySkill(source(file, LEARNED_PATH)).rule).toBe('learned-without-origin');
  });

  test('refuses a body with a Problem and no Solution', () => {
    const file = skillFile(`\n${problemSection()}\n`);
    const result = classifySkill(source(file));

    expect(result.verdict).toBe('unclassified');
    expect(result.rule).toBe('no-section-pair');
    expect(result.reason).toContain('no Solution section');
  });

  test('refuses a body with a Solution and no Problem', () => {
    const file = skillFile(`\n${solutionSection()}\n`);
    const result = classifySkill(source(file));

    expect(result.rule).toBe('no-section-pair');
    expect(result.reason).toContain('no Problem section');
  });

  test('refuses a body with neither section', () => {
    const file = skillFile('\n## Context\n\nNothing shaped like a pair.\n');
    const result = classifySkill(source(file));

    expect(result.rule).toBe('no-section-pair');
    expect(result.reason).toContain('no Problem section and no Solution section');
  });

  test('refuses a heading carrying the word problem inside a sentence', () => {
    const file = skillFile([
      '',
      '## Fitting a doc-dense module under a line cap is a DELETION problem',
      '',
      PROBLEM,
      '',
      solutionSection(),
      '',
    ].join('\n'));

    expect(classifySkill(source(file)).rule).toBe('no-section-pair');
  });

  test('refuses a pair written inside a fenced block', () => {
    const file = skillFile([
      '',
      '```md',
      '## Problem',
      '',
      PROBLEM,
      '',
      '## Solution',
      '',
      SOLUTION,
      '```',
      '',
    ].join('\n'));

    expect(classifySkill(source(file)).rule).toBe('no-section-pair');
  });
});

/** One file per rule, so the rule set can be closed in both directions. */
const PROVOKED: Readonly<Record<ClassificationRule, SkillSource>> = {
  'no-frontmatter': source(shapedBody(problemSection(), solutionSection())),
  'learned-without-origin': source(
    skillFile(shapedBody(problemSection(), solutionSection()), { origin: undefined }),
    LEARNED_PATH,
  ),
  'no-section-pair': source(skillFile(`\n${problemSection()}\n`)),
  'repeated-section': source(skillFile(
    `\n${problemSection()}\n\n${problemSection('## Problem 2')}\n\n${solutionSection()}\n`,
  )),
  'numbered-procedure': source(skillFile(shapedBody(
    problemSection(),
    solutionSection('## Solution', '\n\n1. One.\n2. Two.\n3. Three.'),
  ))),
  'referenced-script': source(
    skillFile(shapedBody(
      problemSection(),
      solutionSection('## Solution', '\n\nRun `scripts/check.sh`.'),
    )),
    SKILL_PATH,
    ['scripts'],
  ),
  'observation-shape': source(OBSERVATION),
};

describe('the rule set', () => {
  test('holds every rule a fixture provokes, and no rule none does', () => {
    expect(Object.keys(PROVOKED).sort()).toEqual([...CLASSIFICATION_RULES].sort());
    expect(Object.keys(RULE_VERDICTS).sort()).toEqual([...CLASSIFICATION_RULES].sort());
  });

  test('answers each rule with the verdict its table names', () => {
    for (const [rule, fixture] of Object.entries(PROVOKED)) {
      const result = classifySkill(fixture);
      expect(result.rule).toBe(rule as ClassificationRule);
      expect(result.verdict).toBe(RULE_VERDICTS[rule as ClassificationRule]);
    }
  });

  test('answers every verdict from at least one rule, and no other verdict', () => {
    const answered = new Set(Object.values(RULE_VERDICTS));

    expect([...answered].sort()).toEqual([...DEMOTION_VERDICTS].sort());
  });
});

describe('bodySections', () => {
  const sections = bodySections([
    '## Solution',
    '',
    SOLUTION,
    '',
    '### Step one',
    '',
    'Record the requests in the stub.',
    '',
    '## When to Use',
    '',
    WHEN_TO_USE,
  ].join('\n'));

  test('keeps a subsection inside the section that opened it', () => {
    expect(sections.map((section) => section.title))
      .toEqual(['Solution', 'Step one', 'When to Use']);
    expect(sections[0]?.text).toContain('### Step one');
    expect(sections[0]?.text).toContain('Record the requests in the stub.');
    expect(sections[0]?.text).not.toContain(WHEN_TO_USE);
  });

  test('reads the heading level and the 1-based line of each heading', () => {
    expect(sections.map((section) => section.level)).toEqual([2, 3, 2]);
    expect(sections.map((section) => section.line)).toEqual([1, 5, 9]);
  });
});

describe('numberedRuns', () => {
  test('counts a run and names the line its first step is on', () => {
    expect(numberedRuns('intro\n\n1. one\n2. two\n3. three\n'))
      .toEqual([{ steps: 3, line: 3 }]);
  });

  test('keeps a run across a blank line, an indented line and a fence', () => {
    const body = [
      '1. one',
      '',
      '   a continuation of the first step',
      '```sh',
      'echo hi',
      '```',
      '2. two',
    ].join('\n');

    expect(numberedRuns(body)).toEqual([{ steps: 2, line: 1 }]);
  });

  test('breaks a run on unindented prose and on a heading', () => {
    const body = ['1. one', 'prose', '2. two', '## Heading', '3. three'].join('\n');

    expect(numberedRuns(body)).toEqual([
      { steps: 1, line: 1 },
      { steps: 1, line: 3 },
      { steps: 1, line: 5 },
    ]);
  });
});

describe('referencedScript', () => {
  test('reads a relative path ending in a script extension', () => {
    expect(isScriptPath('scripts/check.sh')).toBe(true);
    expect(isScriptPath('./check.py')).toBe(true);
    expect(isScriptPath('setup.py')).toBe(true);
    expect(isScriptPath('/usr/local/bin/tool.sh')).toBe(false);
    expect(isScriptPath('scripts/notes.md')).toBe(false);
  });

  test('answers the reference it found, with its line', () => {
    const found = referencedScript('prose\n\nRun `scripts/check.sh` first.\n', ['scripts']);

    expect(found?.text).toBe('scripts/check.sh');
    expect(found?.line).toBe(3);
  });

  test('answers nothing for a path the skill directory does not own', () => {
    expect(referencedScript('Run `scripts/check.sh`.')).toBeNull();
    expect(referencedScript('Run `scripts/check.sh`.', ['src'])).toBeNull();
  });

  test('answers nothing for an owned path that is not a script', () => {
    expect(referencedScript('See `docs/notes.md`.', ['docs'])).toBeNull();
  });

  test('answers nothing for a bare filename, which the reader calls a command', () => {
    expect(referencedScript('See `probe.awk`.', ['probe.awk'])).toBeNull();
  });
});

describe('firstSentence', () => {
  test('cuts at the first full stop that a space follows', () => {
    expect(firstSentence(WHEN_TO_USE))
      .toBe('Writing any test with an in-process HTTP stub.');
  });

  test('drops a list marker and the emphasis around the lead', () => {
    expect(firstSentence('- **Writing** any test with a stub. Also reviewing one.'))
      .toBe('Writing any test with a stub.');
  });

  test('does not cut at an abbreviation', () => {
    expect(firstSentence('Use a fake, e.g. a stub server, before the run. Then assert.'))
      .toBe('Use a fake, e.g. a stub server, before the run.');
  });

  test('joins a wrapped lead and answers a paragraph with no terminator whole', () => {
    expect(firstSentence('Writing any test\nwith an in-process stub'))
      .toBe('Writing any test with an in-process stub');
  });

  test('skips a fenced block and answers the prose under it', () => {
    expect(firstSentence('```sh\nbun test\n```\n\nWriting any test. And more.'))
      .toBe('Writing any test.');
  });
});

describe('the converted record', () => {
  const converted = convertToInstinct(source(OBSERVATION), {
    scope: 'user',
    now: '2026-09-18T10:00:00Z',
    mtime: '2026-01-01',
  });

  test('is accepted by the schema and read back out of the text it renders', () => {
    expect(converted.issues).toEqual([]);
    expect(converted.instinct).not.toBeNull();
    expect(parseInstinct(converted.text ?? '').instinct).toEqual(converted.instinct);
  });

  test('takes its trigger from the first sentence of the When to Use section', () => {
    expect(converted.instinct?.trigger).toBe('Writing any test with an in-process HTTP stub.');
  });

  test('takes its action from the Solution and its cause from the Problem', () => {
    expect(converted.instinct?.action).toBe(SOLUTION);
    expect(converted.instinct?.cause).toBe(PROBLEM);
  });

  test('takes its id from the skill name and the fields the plan fixes', () => {
    expect(converted.instinct).toMatchObject({
      id: FRONTMATTER.name,
      kind: DEMOTED_KIND,
      confidence: DEMOTED_CONFIDENCE,
      source: DEMOTED_SOURCE,
      artifact: null,
      scope: 'user',
      projectId: null,
      createdAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T10:00:00Z',
    });
  });

  test('holds evidence naming the original path and the extracted date', () => {
    expect(converted.instinct?.evidence).toEqual([{
      path: SKILL_PATH,
      extracted: '2026-08-15',
    }]);
  });

  test('falls back to the file mtime when the body stamps no extracted date', () => {
    const undated = skillFile([
      '',
      problemSection(),
      '',
      solutionSection(),
      '',
    ].join('\n'));
    const result = convertToInstinct(source(undated), {
      scope: 'user',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    });

    expect(extractedDate(undated)).toBeNull();
    expect(result.instinct?.evidence).toEqual([{ path: SKILL_PATH, extracted: '2026-01-01' }]);
  });

  test('carries the scope and the project id it was given', () => {
    const project = convertToInstinct(source(OBSERVATION), {
      scope: 'project',
      projectId: '8f2c1a9d3e4b',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    });

    expect(project.instinct?.scope).toBe('project');
    expect(project.instinct?.projectId).toBe('8f2c1a9d3e4b');
  });
});

describe('the fields the schema requires', () => {
  const converted = convertToInstinct(source(OBSERVATION), {
    scope: 'user',
    now: '2026-09-18T10:00:00Z',
    mtime: '2026-01-01',
  });

  /** The record as the file would carry it. */
  const written = converted.instinct === null
    ? {}
    : instinctFrontmatter(converted.instinct);

  test('writes a usage_count the schema accepts, where 0 is refused', () => {
    expect(written['usage_count']).toBe(DEMOTED_USAGE_COUNT);
    expect(checkInstinctFrontmatter(written)).toEqual([]);

    const zeroed = checkInstinctFrontmatter({ ...written, usage_count: 0 });
    expect(zeroed.map((entry) => entry.code)).toEqual(['invalid-usage-count']);
  });

  test('writes a domain from the closed vocabulary', () => {
    expect(INSTINCT_DOMAINS).toContain(converted.instinct?.domain ?? 'absent');
  });
});

describe('the trigger fallback', () => {
  /** A file with no When to Use section at all. */
  function withoutWhenToUse(changes: Readonly<Record<string, unknown>> = {}): string {
    return skillFile(`\n${problemSection()}\n\n${solutionSection()}\n`, changes);
  }

  test('falls back to the description when there is no When to Use section', () => {
    const result = convertToInstinct(source(withoutWhenToUse()), {
      scope: 'user',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    });

    expect(result.instinct?.trigger).toBe(FRONTMATTER.description);
  });

  test('falls back to the first sentence of the Problem when there is neither', () => {
    const result = convertToInstinct(source(withoutWhenToUse({ description: undefined })), {
      scope: 'user',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    });

    expect(result.instinct?.trigger).toBe(PROBLEM);
  });
});

describe('the converted signal', () => {
  /** `extra` appended to the Solution of an otherwise plain file. */
  function withExtra(extra: string): string {
    return skillFile(shapedBody(problemSection(), solutionSection('## Solution', extra)));
  }

  test('is silent when the body names no error string', () => {
    expect(errorString(OBSERVATION)).toBeNull();
    expect(convertToInstinct(source(OBSERVATION), {
      scope: 'user',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    }).instinct?.signal).toBe('silent');
  });

  test('is loud when a code span names one', () => {
    const file = withExtra('\n\nThe run ends in `Error: cannot find package`.');
    const result = convertToInstinct(source(file), {
      scope: 'user',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    });

    expect(errorString(file)).toBe('Error: cannot find package');
    expect(result.instinct?.signal).toBe('loud');
  });

  test('ignores an error word written in prose', () => {
    expect(errorString('The run cannot find the package, which is an error.')).toBeNull();
  });
});

describe('the converted id', () => {
  const options = { scope: 'user', now: '2026-09-18T10:00:00Z', mtime: '2026-01-01' } as const;

  test('takes a numeric suffix when the id is already taken', () => {
    const result = convertToInstinct(source(OBSERVATION), {
      ...options,
      takenIds: [FRONTMATTER.name, `${FRONTMATTER.name}-2`],
    });

    expect(result.instinct?.id).toBe(`${FRONTMATTER.name}-3`);
    expect(uniqueInstinctId('a', [])).toBe('a');
  });

  test('is slugified when the frontmatter name is not slug-shaped', () => {
    const file = skillFile(
      shapedBody(problemSection(), solutionSection()),
      { name: 'Assert The Stub' },
    );

    expect(slugifyId('Assert The Stub')).toBe('assert-the-stub');
    expect(convertToInstinct(source(file), options).instinct?.id).toBe('assert-the-stub');
  });

  test('falls back to the directory name when the frontmatter names none', () => {
    const file = skillFile(
      shapedBody(problemSection(), solutionSection()),
      { name: undefined },
    );

    expect(convertToInstinct(source(file), options).instinct?.id)
      .toBe('assert-the-stub-was-hit');
  });

  test('falls back to the file stem for a learned file', () => {
    const file = skillFile(
      shapedBody(problemSection(), solutionSection()),
      { name: undefined },
    );

    expect(convertToInstinct(source(file, 'learned/bash-shim-forward-args.md'), options)
      .instinct?.id).toBe('bash-shim-forward-args');
  });
});

describe('inferDomain', () => {
  test('reads the name before the body', () => {
    expect(inferDomain('git-worktree-fork', 'a body about testing and stubs')).toBe('git');
  });

  test('reads the body when the name says nothing', () => {
    expect(inferDomain('opaque', 'the assertion and the stub disagree')).toBe('testing');
  });

  test('answers the default when neither says anything', () => {
    expect(inferDomain('opaque', 'nothing in particular')).toBe(DEFAULT_DOMAIN);
  });
});

describe('a conversion the schema refuses', () => {
  test('answers no record and no text, with the schema issues beside it', () => {
    const file = skillFile(`\n${problemSection()}\n`);
    const result = convertToInstinct(source(file), {
      scope: 'user',
      now: '2026-09-18T10:00:00Z',
      mtime: '2026-01-01',
    });

    expect(result.instinct).toBeNull();
    expect(result.text).toBeNull();
    expect(result.issues.map((entry) => entry.code)).toContain('missing-section');
  });
});

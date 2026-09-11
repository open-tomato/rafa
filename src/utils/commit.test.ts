/**
 * Tests for the loop's staging-and-committing helper.
 *
 * Two populations, and the split is deliberate. Most cases drive an
 * INJECTED runner, which is what lets a failing hook, a broken index
 * and a `rev-parse` that answers nothing all be exercised
 * deterministically and in milliseconds. But an all-injected suite is
 * evidence about a stub: it cannot tell {@link spawnGit} from a
 * function that returns plausible objects, and every outcome here is
 * ultimately a claim about what `git` does. So the last describe
 * builds a REAL repository under a temporary directory and drives the
 * DEFAULT runner through all three outcomes, hooks included.
 *
 * The real repository sets `core.hooksPath` to a directory of its
 * own. Without that it inherits this clone's `.githooks`, and the
 * control-byte gate would run against an index it knows nothing
 * about; with it, the rejecting-hook case plants its own hook and the
 * refusal is the suite's rather than the environment's.
 *
 * Twenty-two module mutations were driven against this file and ALL
 * TWENTY-TWO reddened at least one case, with the module restored
 * byte-identical and green either side: staging without `-A`,
 * inspecting without `--cached`, committing with `--no-verify`,
 * committing under git's default cleanup, inverting the
 * nothing-to-commit branch, accepting any `diff` exit code,
 * mislabelling which step failed, taking the sha whether or not the
 * read succeeded, raising the subject cap, cutting mid-word, leaving
 * a code span hanging open, keeping the opening capital, stripping a
 * period off a dotted name, putting the docs rule ahead of the test
 * rule, widening the test-noun window, changing the default type,
 * always writing a body, ordering stdout ahead of stderr, never
 * marking a cut message, trimming instead of collapsing whitespace,
 * ignoring the caller's `cwd`, and emptying the fallback description.
 *
 * Three of those reached the module cleanly and stayed GREEN on the
 * first pass, and all three are recorded because they are the shape
 * that is easiest to write by accident. Two were CONSTANT ECHOES —
 * a case asserting `subject.length <= MAX_SUBJECT_LENGTH`, or
 * building the fallback subject out of `DEFAULT_COMMIT_TYPE` and
 * `FALLBACK_DESCRIPTION`, moves with the constant and cannot tell 72
 * from 120. The third was a FIXTURE that never reached the code
 * under test: a code span containing no space cannot be cut between
 * its backticks, so the balancing case passed against a module with
 * the balancing removed. All three are closed against literals or a
 * fixture that reaches the branch.
 */
import type {
  CommitType,
  CommitTypeRule,
  GitRunResult,
  GitRunner,
} from './commit.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  buildCommitMessage,
  COMMIT_TYPE_RULES,
  commitArgs,
  commitTaskWork,
  DEFAULT_COMMIT_TYPE,
  deriveCommitSubject,
  FALLBACK_DESCRIPTION,
  headShaArgs,
  inferCommitType,
  MAX_MESSAGE_CHARS,
  MAX_SUBJECT_LENGTH,
  normaliseTaskText,
  spawnGit,
  stageAllArgs,
  stagedChangesArgs,
} from './commit.js';

/** A task sentence of the shape this loop's plans actually carry. */
const LONG_TASK = [
  'Add `tools/ralph/utils/commit.ts` staging with `git add -A` and',
  'committing with a subject derived from the task text, returning a',
  'distinct outcome for nothing-to-commit and for a hook or commit',
  'failure, plus its TSDoc and colocated unit tests',
].join(' ');

/** A sha shaped like git's, so a test cannot pass on a short string. */
const FAKE_SHA = '9291eab75364503b5003a7c4592fb93d9d176159';

/** git's own answer to "nothing is staged". */
const NO_DIFF: GitRunResult = { status: 0, stdout: '', stderr: '' };

/** git's own answer to "something is staged". */
const HAS_DIFF: GitRunResult = { status: 1, stdout: '', stderr: '' };

/** A clean run of a command whose output nobody reads. */
const OK: GitRunResult = { status: 0, stdout: '', stderr: '' };

/** Which git command an argv is, which is how stubs are keyed. */
type GitCommand = 'add' | 'commit' | 'diff' | 'rev-parse';

/** What one stubbed runner did, so a test can read the sequence. */
interface StubbedGit {
  run: GitRunner;
  calls: string[][];
}

/**
 * A runner answering per COMMAND rather than per position.
 *
 * Keying on position would let a module that ran the three
 * invocations in the wrong order still receive the answers it
 * expected, so the order is asserted explicitly from `calls` instead
 * of being baked into the stub.
 */
type GitStubs = Partial<Record<GitCommand, GitRunResult>>;

function stubGit(responses: GitStubs): StubbedGit {
  const calls: string[][] = [];
  const defaults: Record<GitCommand, GitRunResult> = {
    add: OK,
    diff: HAS_DIFF,
    commit: OK,
    'rev-parse': { status: 0, stdout: `${FAKE_SHA}\n`, stderr: '' },
  };

  const run: GitRunner = (args) => {
    calls.push(args);
    const command = (args[0] ?? '') as GitCommand;
    return responses[command] ?? defaults[command] ?? OK;
  };

  return { run, calls };
}

/** The first word of each recorded invocation, in order. */
function commandsOf(calls: string[][]): string[] {
  return calls.map((args) => args[0] ?? '');
}

describe('normaliseTaskText', () => {
  it('collapses every whitespace run to one space', () => {
    expect(normaliseTaskText('  add\n  a  thing\t now \n'))
      .toBe('add a thing now');
  });

  it('answers an empty string for whitespace only', () => {
    expect(normaliseTaskText('  \n\t ')).toBe('');
  });
});

describe('inferCommitType', () => {
  /** One fixture per claim, with the rule each is meant to reach. */
  const FIXTURES: ReadonlyArray<{ text: string; type: CommitType }> = [
    { text: 'Add a test driving `findNextTask` over it', type: 'test' },
    { text: 'Add unit tests for the parser refusal paths', type: 'test' },
    { text: 'Add `context/tooling.md` carrying a section', type: 'docs' },
    { text: 'Fix the tracker index going stale on append', type: 'fix' },
    { text: 'Remove the commit lines from the prompt', type: 'refactor' },
    { text: 'Add `utils/declaration.ts` parsing a block', type: 'feat' },
    { text: 'Capture the gates into per-run `/tmp` files', type: 'chore' },
    { text: 'Nobody wrote this one with a verb', type: DEFAULT_COMMIT_TYPE },
  ];

  for (const fixture of FIXTURES) {
    it(`reads "${fixture.text.slice(0, 28)}" as ${fixture.type}`, () => {
      expect(inferCommitType(fixture.text)).toBe(fixture.type);
    });
  }

  it('exercises every rule in the table', () => {
    function ruleIndexFor(text: string): number {
      const normalised = normaliseTaskText(text);
      function matches(rule: CommitTypeRule): boolean {
        return rule.pattern.test(normalised);
      }

      return COMMIT_TYPE_RULES.findIndex(matches);
    }

    const reached = new Set(FIXTURES
      .map((fixture) => ruleIndexFor(fixture.text))
      .filter((index) => index >= 0));

    expect(reached.size).toBe(COMMIT_TYPE_RULES.length);
  });

  it('reads a test task naming a doc file as a test', () => {
    const text = 'Add a test asserting `context/workflow.md` names an agent';

    expect(inferCommitType(text)).toBe('test');
  });

  it('reads a doc task opening on a code verb as docs', () => {
    const text = 'Split `packages/web/AGENTS.md` into pages plus a map';

    expect(inferCommitType(text)).toBe('docs');
  });

  it('does not read trailing test boilerplate as a test task', () => {
    expect(inferCommitType(LONG_TASK)).toBe('feat');
  });

  it('ignores case and leading whitespace', () => {
    expect(inferCommitType('  ADD a thing')).toBe('feat');
  });
});

describe('deriveCommitSubject', () => {
  // The cap is asserted against its LITERAL and not against the
  // exported constant: a case reading the constant on both sides
  // moves with it, and a mutation raising 72 to 120 stayed green
  // through every length assertion in this file.
  it('caps a subject at git\'s own 72 characters', () => {
    expect(MAX_SUBJECT_LENGTH).toBe(72);
  });

  it('keeps a whole short task and marks it untruncated', () => {
    const derived = deriveCommitSubject('Add a small thing');

    expect(derived.subject).toBe('feat: add a small thing');
    expect(derived.truncated).toBe(false);
    expect(derived.type).toBe('feat');
  });

  it('fits the cap and says it truncated', () => {
    const derived = deriveCommitSubject(LONG_TASK);

    expect(derived.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
    expect(derived.truncated).toBe(true);
    expect(LONG_TASK).toContain('colocated unit tests');
    expect(derived.subject).not.toContain('colocated unit tests');
  });

  it('cuts at a word boundary, never inside a word', () => {
    const derived = deriveCommitSubject(LONG_TASK);
    const tail = derived.subject.split(' ').pop() ?? '';

    expect(LONG_TASK.split(/\s+/)).toContain(tail);
  });

  // The span has to contain a SPACE, or a word-boundary cut can never
  // land between its two backticks and the case asserts nothing: a
  // fixture spanning `a/path/with/no/spaces.ts` stayed green against a
  // module with the balancing removed.
  it('leaves no code span hanging open', () => {
    const text = 'Add a thing with `git add -A` now and more';
    const derived = deriveCommitSubject(text, { maxLength: 30 });
    const backticks = derived.subject.split('`').length - 1;

    expect(derived.subject).toBe('feat: add a thing with');
    expect(backticks).toBe(0);
    expect(derived.subject.length).toBeLessThanOrEqual(30);
  });

  it('drops punctuation the cut left dangling', () => {
    const text = 'Capture one, two, three and four into a file';
    const derived = deriveCommitSubject(text, { maxLength: 24 });

    expect(derived.subject).toBe('chore: capture one, two');
    expect(derived.subject).not.toMatch(/[\s,;:-]$/);
  });

  it('lowercases the opening word', () => {
    expect(deriveCommitSubject('Register a thing').subject)
      .toBe('feat: register a thing');
  });

  it('leaves an all-caps opening word alone', () => {
    expect(deriveCommitSubject('CI runs the gate').subject)
      .toBe('chore: CI runs the gate');
  });

  it('strips a sentence period', () => {
    expect(deriveCommitSubject('Add a thing.').subject)
      .toBe('feat: add a thing');
  });

  it('keeps a period that ends a dotted name', () => {
    expect(deriveCommitSubject('Add support for v1.2.').subject)
      .toBe('feat: add support for v1.2.');
  });

  it('falls back when the task text has no words', () => {
    const derived = deriveCommitSubject('   \n  ');

    const spelled = `${DEFAULT_COMMIT_TYPE}: ${FALLBACK_DESCRIPTION}`;

    expect(derived.subject).toBe('chore: complete the scoped task');
    expect(derived.subject).toBe(spelled);
    expect(derived.truncated).toBe(false);
  });

  it('renders a scope inside the prefix', () => {
    expect(deriveCommitSubject('Add a thing', { scope: 'ralph' }).subject)
      .toBe('feat(ralph): add a thing');
  });

  it('counts the scope against the same cap', () => {
    const withScope = deriveCommitSubject(LONG_TASK, { scope: 'ralph' });

    expect(withScope.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
    expect(withScope.subject.length)
      .toBeLessThan(deriveCommitSubject(LONG_TASK).subject.length + 8);
  });

  it('answers the same subject twice for one text', () => {
    expect(deriveCommitSubject(LONG_TASK))
      .toEqual(deriveCommitSubject(LONG_TASK));
  });
});

describe('buildCommitMessage', () => {
  it('carries the whole task text when the subject was cut', () => {
    const message = buildCommitMessage(LONG_TASK);

    expect(message.truncated).toBe(true);
    expect(message.body).toBe(normaliseTaskText(LONG_TASK));
    expect(message.body).toContain('colocated unit tests');
  });

  it('omits the body when the subject already says it', () => {
    const message = buildCommitMessage('Add a small thing');

    expect(message.truncated).toBe(false);
    expect(message.body).toBe('');
  });
});

describe('the argv builders', () => {
  it('stages the whole worktree', () => {
    expect(stageAllArgs()).toEqual(['add', '-A']);
  });

  it('asks for staged changes by exit code', () => {
    expect(stagedChangesArgs()).toEqual(['diff', '--cached', '--quiet']);
  });

  it('reads the sha from HEAD', () => {
    expect(headShaArgs()).toEqual(['rev-parse', 'HEAD']);
  });

  it('passes the subject as its own -m', () => {
    expect(commitArgs('feat: a thing'))
      .toEqual(['commit', '--cleanup=whitespace', '-m', 'feat: a thing']);
  });

  it('passes a body as a second -m', () => {
    expect(commitArgs('feat: a thing', 'the whole sentence'))
      .toEqual([
        'commit',
        '--cleanup=whitespace',
        '-m',
        'feat: a thing',
        '-m',
        'the whole sentence',
      ]);
  });

  it('keeps hooks armed', () => {
    expect(commitArgs('feat: a thing')).not.toContain('--no-verify');
    expect(commitArgs('feat: a thing')).not.toContain('-n');
  });

  it('keeps a # line out of the cleanup mode', () => {
    expect(commitArgs('feat: a thing')).toContain('--cleanup=whitespace');
  });
});

describe('commitTaskWork over a stubbed git', () => {
  it('stages, inspects, commits and reads the sha', () => {
    const git = stubGit({});
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('committed');
    expect(result.sha).toBe(FAKE_SHA);
    expect(result.failedStep).toBeNull();
    expect(result.message).toBe('');
    expect(commandsOf(git.calls))
      .toEqual(['add', 'diff', 'commit', 'rev-parse']);
  });

  it('commits with the derived subject and body', () => {
    const git = stubGit({});
    commitTaskWork({ taskText: LONG_TASK, runGit: git.run });
    const message = buildCommitMessage(LONG_TASK);

    expect(git.calls[2]).toEqual(commitArgs(message.subject, message.body));
  });

  it('answers nothing-to-commit on an unchanged tree', () => {
    const git = stubGit({ diff: NO_DIFF });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('nothing-to-commit');
    expect(result.sha).toBeNull();
    expect(result.failedStep).toBeNull();
    expect(commandsOf(git.calls)).toEqual(['add', 'diff']);
  });

  it('still derives a subject when nothing was committed', () => {
    const git = stubGit({ diff: NO_DIFF });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.subject).toBe(deriveCommitSubject(LONG_TASK).subject);
  });

  it('reports a rejected hook as a commit failure', () => {
    const git = stubGit({
      commit: { status: 1, stdout: '', stderr: 'gate says no' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('failed');
    expect(result.failedStep).toBe('commit');
    expect(result.exitCode).toBe(1);
    expect(result.message).toBe('gate says no');
    expect(commandsOf(git.calls)).toEqual(['add', 'diff', 'commit']);
  });

  it('reports a failed stage without inspecting anything', () => {
    const git = stubGit({
      add: { status: 128, stdout: '', stderr: 'fatal: index.lock exists' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('failed');
    expect(result.failedStep).toBe('stage');
    expect(result.exitCode).toBe(128);
    expect(commandsOf(git.calls)).toEqual(['add']);
  });

  it('reads a diff exit above one as an inspect failure', () => {
    const git = stubGit({
      diff: { status: 129, stdout: '', stderr: 'usage: git diff' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('failed');
    expect(result.failedStep).toBe('inspect');
    expect(commandsOf(git.calls)).toEqual(['add', 'diff']);
  });

  it('reads a killed process as a failure with no code', () => {
    const git = stubGit({
      add: { status: null, stdout: '', stderr: 'spawn ENOENT' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('failed');
    expect(result.exitCode).toBeNull();
  });

  it('keeps the commit when only the sha read failed', () => {
    const git = stubGit({
      'rev-parse': { status: 128, stdout: '', stderr: 'fatal: bad HEAD' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.outcome).toBe('committed');
    expect(result.sha).toBeNull();
    expect(result.failedStep).toBeNull();
  });

  it('carries a hook that printed on stdout', () => {
    const git = stubGit({
      commit: { status: 1, stdout: 'blocked by policy', stderr: '' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.message).toBe('blocked by policy');
  });

  it('puts stderr ahead of stdout in one message', () => {
    const git = stubGit({
      commit: { status: 1, stdout: 'second', stderr: 'first' },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.message).toBe('first\nsecond');
  });

  it('marks a message it had to cut', () => {
    const git = stubGit({
      commit: {
        status: 1,
        stdout: '',
        stderr: 'x'.repeat(MAX_MESSAGE_CHARS + 500),
      },
    });
    const result = commitTaskWork({ taskText: LONG_TASK, runGit: git.run });

    expect(result.message).toContain('[truncated]');
    expect(result.message.length)
      .toBeLessThan(MAX_MESSAGE_CHARS + '\n[truncated]'.length + 1);
  });

  it('passes the scope through to the subject', () => {
    const git = stubGit({});
    const result = commitTaskWork({
      taskText: 'Add a thing',
      scope: 'ralph',
      runGit: git.run,
    });

    expect(result.subject).toBe('feat(ralph): add a thing');
  });
});

describe('commitTaskWork over a real repository', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-commit-'));

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  let planted = 0;

  /** A repository with its own hooks directory and one commit in it. */
  function plantRepo(): string {
    planted += 1;
    const dir = join(tempRoot, `repo-${planted}`);
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    function git(...args: string[]): string {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    }

    git('init', '-q', '.');
    git('config', 'user.email', 'loop@example.test');
    git('config', 'user.name', 'Ralph Loop');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', 'hooks');
    writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    return dir;
  }

  /** Reads back from the repository, never through the module. */
  function inRepo(dir: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  }

  it('commits a change through the default runner', () => {
    const dir = plantRepo();
    writeFileSync(join(dir, 'work.txt'), 'done\n', 'utf8');

    const result = commitTaskWork({ taskText: LONG_TASK, cwd: dir });

    expect(result.outcome).toBe('committed');
    expect(result.sha).toBe(inRepo(dir, 'rev-parse', 'HEAD'));
    expect(inRepo(dir, 'log', '-1', '--format=%s')).toBe(result.subject);
    expect(inRepo(dir, 'rev-list', '--count', 'HEAD')).toBe('2');
  });

  it('writes the whole task text into the body', () => {
    const dir = plantRepo();
    writeFileSync(join(dir, 'work.txt'), 'done\n', 'utf8');
    commitTaskWork({ taskText: LONG_TASK, cwd: dir });

    expect(inRepo(dir, 'log', '-1', '--format=%b'))
      .toBe(normaliseTaskText(LONG_TASK));
  });

  it('stages an untracked file, not only a modified one', () => {
    const dir = plantRepo();
    writeFileSync(join(dir, 'brand-new.txt'), 'new\n', 'utf8');
    commitTaskWork({ taskText: 'Add a brand new file', cwd: dir });

    expect(inRepo(dir, 'show', '--name-only', '--format=', 'HEAD'))
      .toBe('brand-new.txt');
  });

  it('answers nothing-to-commit on a clean tree', () => {
    const dir = plantRepo();

    const result = commitTaskWork({ taskText: LONG_TASK, cwd: dir });

    expect(result.outcome).toBe('nothing-to-commit');
    expect(inRepo(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('reports a real rejecting hook and commits nothing', () => {
    const dir = plantRepo();
    const hook = join(dir, 'hooks', 'pre-commit');
    const script = '#!/bin/sh\necho "gate says no" >&2\nexit 1\n';
    writeFileSync(hook, script, 'utf8');
    chmodSync(hook, 0o755);
    writeFileSync(join(dir, 'work.txt'), 'done\n', 'utf8');

    const result = commitTaskWork({ taskText: LONG_TASK, cwd: dir });

    expect(result.outcome).toBe('failed');
    expect(result.failedStep).toBe('commit');
    expect(result.message).toContain('gate says no');
    expect(inRepo(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('answers a failure rather than throwing outside a repo', () => {
    const outside = join(tempRoot, 'not-a-repo');
    mkdirSync(outside, { recursive: true });

    const result = commitTaskWork({ taskText: 'Add a thing', cwd: outside });

    expect(result.outcome).toBe('failed');
    expect(result.failedStep).toBe('stage');
  });

  it('runs git in the directory it was given', () => {
    const dir = plantRepo();
    const run = spawnGit(dir);
    const result = run(['rev-parse', '--show-toplevel']);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toContain('repo-');
  });
});

/**
 * Tests for the branch decision (`start/branch-decision.ts`): which
 * question `rafa loop start` asks when it is started on the base, which
 * refusal follows an answer, and which git steps a yes turns into.
 *
 * Everything here is decided from a literal, which is the point of the
 * module: the fixtures are what git 2.50.1 (Apple Git-155) actually
 * wrote under `LC_ALL=C` in a clone of a bare remote on 2026-09-20, and
 * they are named for the state that produced them. The porcelain lines
 * go through `parseWorkingTree`, the seam the run reads them with, so a
 * refusal is asserted over the same shape the command builds rather than
 * over a hand-made one.
 *
 * Each refusal case varies one axis of an otherwise clean situation, and
 * the clean situation is asserted beside it, so a reader that refused
 * everything and a reader that refused nothing both redden.
 */
import type {
  BranchOffer,
  BranchPlan,
  BranchSituation,
  BranchStep,
  BranchStepId,
  StepOutcome,
} from './branch-decision.js';
import type { GitResult } from '../pr/index.js';

import { describe, expect, it } from 'bun:test';

import { parseWorkingTree } from '../pr/index.js';

import {
  answeredYes,
  branchNameFor,
  branchSteps,
  BRANCH_PREFIX,
  hasDiverged,
  localRef,
  parseBaseStanding,
  questionFor,
  readBranchOffer,
  readStepOutcome,
  REMOTE,
  remoteTrackingRef,
  trackedChanges,
  treeRefusal,
  YES_ANSWERS,
} from './branch-decision.js';

/** The plan every case runs for, and the base it was started on. */
const PLAN: BranchPlan = { branch: 'feat/rafa-49', base: 'main' };

/** A run on the base with nothing in the way: a terminal, no flags, no such branch anywhere. */
function situation(over: Partial<BranchSituation> = {}): BranchSituation {
  return {
    planStub: 'rafa-49',
    base: 'main',
    anyBranch: false,
    createBranch: false,
    canAsk: true,
    localBranch: false,
    remoteBranch: false,
    ...over,
  };
}

/** What git answered, a failure with nothing said unless a case says otherwise. */
function answered(over: Partial<GitResult> = {}): GitResult {
  return { ok: false, stdout: '', stderr: '', ...over };
}

/** The offer as a question, throwing on any other reading; see `context/verification.md`. */
function asked(offer: BranchOffer): { branch: string; route: string; question: string } {
  if (offer.kind !== 'ask') throw new Error(`expected a question, got ${offer.kind}`);
  return { branch: offer.branch, route: offer.route, question: offer.question };
}

/** The offer as a branch taken without a question, throwing on any other reading. */
function taken(offer: BranchOffer): { branch: string; route: string } {
  if (offer.kind !== 'take') throw new Error(`expected a branch taken, got ${offer.kind}`);
  return { branch: offer.branch, route: offer.route };
}

/** Why the offer stood aside, throwing on any other reading. */
function stoodAside(offer: BranchOffer): string {
  if (offer.kind !== 'stand-aside') throw new Error(`expected no offer, got ${offer.kind}`);
  return offer.why;
}

/** The refusal an outcome carries, throwing when it let the run go on. */
function refusalOf(outcome: StepOutcome): string {
  if (outcome.kind !== 'refuse') throw new Error(`expected a refusal, got ${outcome.kind}`);
  return outcome.message;
}

/** One step of a route, by its id. */
function stepOf(route: 'create' | 'switch-local' | 'switch-remote', id: BranchStepId): BranchStep {
  const step = branchSteps(route, PLAN).find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`the ${route} route has no ${id} step`);
  return step;
}

/** What `git status --porcelain` wrote for a modified file, a staged path with a space, and an untracked one. */
const MEASURED_PORCELAIN = ' M a.txt\nA  "sp ace.txt"\n?? untracked.txt\n';

/** What a fetch of a remote that is no repository wrote to standard error, exit 128. */
const FETCH_FATAL = 'fatal: \'/tmp/nothing.git\' does not appear to be a git repository\n'
  + 'fatal: Could not read from remote repository.';

/** What `git merge --ff-only origin/main` wrote on a diverged base, exit 128. */
const FF_FATAL = 'hint: Diverging branches can\'t be fast-forwarded, you need to either:\n'
  + 'fatal: Not possible to fast-forward, aborting.';

describe('the branch a plan runs on', () => {
  it('is feat/ and the stub, and the refs it is read at', () => {
    expect(BRANCH_PREFIX).toBe('feat/');
    expect(branchNameFor('rafa-49')).toBe('feat/rafa-49');
    expect(localRef('feat/rafa-49')).toBe('refs/heads/feat/rafa-49');
    expect(remoteTrackingRef('feat/rafa-49')).toBe('refs/remotes/origin/feat/rafa-49');
    expect(REMOTE).toBe('origin');
  });
});

describe('questionFor', () => {
  it('spells the create question as the spec does', () => {
    expect(questionFor('create', PLAN))
      .toBe('Create feat/rafa-49 from the latest origin/main and run there? [y/N] ');
  });

  it('spells the switch question as the spec does, for either branch that exists', () => {
    expect(questionFor('switch-local', PLAN)).toBe('Switch to the existing feat/rafa-49? [y/N] ');
    expect(questionFor('switch-remote', PLAN)).toBe('Switch to the existing feat/rafa-49? [y/N] ');
  });
});

describe('readBranchOffer', () => {
  it('asks to create the branch when neither side has it', () => {
    expect(asked(readBranchOffer(situation()))).toEqual({
      branch: 'feat/rafa-49',
      route: 'create',
      question: 'Create feat/rafa-49 from the latest origin/main and run there? [y/N] ',
    });
  });

  it('asks to switch to a branch already held locally', () => {
    expect(asked(readBranchOffer(situation({ localBranch: true })))).toEqual({
      branch: 'feat/rafa-49',
      route: 'switch-local',
      question: 'Switch to the existing feat/rafa-49? [y/N] ',
    });
  });

  it('asks to switch to a branch held only as a remote-tracking ref', () => {
    expect(asked(readBranchOffer(situation({ remoteBranch: true })))).toEqual({
      branch: 'feat/rafa-49',
      route: 'switch-remote',
      question: 'Switch to the existing feat/rafa-49? [y/N] ',
    });
  });

  it('reads the local branch over the remote-tracking one when both are there', () => {
    const offer = readBranchOffer(situation({ localBranch: true, remoteBranch: true }));
    expect(asked(offer).route).toBe('switch-local');
  });

  it('takes the branch without asking under --create-branch, on every route', () => {
    expect(taken(readBranchOffer(situation({ createBranch: true }))))
      .toEqual({ branch: 'feat/rafa-49', route: 'create' });
    expect(taken(readBranchOffer(situation({ createBranch: true, localBranch: true }))))
      .toEqual({ branch: 'feat/rafa-49', route: 'switch-local' });
    expect(taken(readBranchOffer(situation({ createBranch: true, remoteBranch: true }))))
      .toEqual({ branch: 'feat/rafa-49', route: 'switch-remote' });
  });

  it('takes the branch under --create-branch with no terminal to ask on', () => {
    const offer = readBranchOffer(situation({ createBranch: true, canAsk: false }));
    expect(taken(offer).branch).toBe('feat/rafa-49');
  });

  it('stands aside under --any-branch, whatever else was passed', () => {
    expect(stoodAside(readBranchOffer(situation({ anyBranch: true })))).toBe('any-branch');
    expect(stoodAside(readBranchOffer(situation({ anyBranch: true, createBranch: true }))))
      .toBe('any-branch');
    expect(stoodAside(readBranchOffer(situation({ anyBranch: true, localBranch: true }))))
      .toBe('any-branch');
  });

  it('stands aside with no plan stub to name a branch after', () => {
    expect(stoodAside(readBranchOffer(situation({ planStub: null })))).toBe('no-plan-stub');
    expect(stoodAside(readBranchOffer(situation({ planStub: '   ' })))).toBe('no-plan-stub');
    expect(stoodAside(readBranchOffer(situation({ planStub: null, createBranch: true }))))
      .toBe('no-plan-stub');
  });

  it('stands aside with no terminal and no flag, leaving the guard to refuse', () => {
    expect(stoodAside(readBranchOffer(situation({ canAsk: false })))).toBe('no-terminal');
    // The control: the same run with a terminal is asked.
    expect(asked(readBranchOffer(situation({ canAsk: true }))).route).toBe('create');
  });

  it('names the base the question was built from, not a fixed one', () => {
    const offer = readBranchOffer(situation({ base: 'master' }));
    expect(asked(offer).question)
      .toBe('Create feat/rafa-49 from the latest origin/master and run there? [y/N] ');
  });
});

describe('answeredYes', () => {
  it('reads y and yes, however they are typed', () => {
    expect(YES_ANSWERS).toEqual(['y', 'yes']);
    expect(answeredYes('y')).toBe(true);
    expect(answeredYes('yes')).toBe(true);
    expect(answeredYes('  YES \n')).toBe(true);
    expect(answeredYes('Y')).toBe(true);
  });

  it('declines everything else, the empty answer and an ended input included', () => {
    expect(answeredYes('')).toBe(false);
    expect(answeredYes('  ')).toBe(false);
    expect(answeredYes('n')).toBe(false);
    expect(answeredYes('yeah')).toBe(false);
    expect(answeredYes(null)).toBe(false);
  });
});

describe('trackedChanges', () => {
  it('keeps the tracked lines of the measured porcelain, verbatim, and drops the untracked one', () => {
    expect(trackedChanges(parseWorkingTree(MEASURED_PORCELAIN)))
      .toEqual([' M a.txt', 'A  "sp ace.txt"']);
  });

  it('reads a tree of untracked files alone as nothing to refuse on', () => {
    expect(trackedChanges(parseWorkingTree('?? one.txt\n?? two.txt\n'))).toEqual([]);
  });
});

describe('treeRefusal', () => {
  it('lets a clean tree through', () => {
    expect(treeRefusal(parseWorkingTree(''), PLAN)).toBeNull();
  });

  it('lets untracked files through, since a checkout carries them across', () => {
    expect(treeRefusal(parseWorkingTree('?? notes.md\n'), PLAN)).toBeNull();
  });

  it('refuses on modified tracked files, naming them as git wrote them', () => {
    const message = treeRefusal(parseWorkingTree(MEASURED_PORCELAIN), PLAN);
    expect(message).not.toBeNull();
    expect((message ?? '').split('\n')).toEqual([
      '❌ Refusing to leave main for feat/rafa-49: the working tree has 2 changes to tracked files.',
      '    M a.txt',
      '   A  "sp ace.txt"',
      '   Commit or stash them, then run again. Untracked files are left alone.',
    ]);
  });

  it('counts one change in the singular', () => {
    const message = treeRefusal(parseWorkingTree(' M a.txt\n?? b.txt\n'), PLAN) ?? '';
    expect(message).toContain('the working tree has 1 change to tracked files.');
  });

  it('lists ten changes and elides the rest', () => {
    const entries = Array.from({ length: 13 }, (_, at) => ` M file-${at}.ts`).join('\n');
    const message = treeRefusal(parseWorkingTree(entries), PLAN) ?? '';
    expect(message).toContain('has 13 changes to tracked files.');
    expect(message).toContain('    M file-9.ts');
    expect(message).not.toContain('file-10.ts');
    expect(message).toContain('   ... and 3 more');
  });
});

describe('branchSteps', () => {
  it('fetches, reads the standing, fast-forwards and cuts the branch, in that order', () => {
    const steps = branchSteps('create', PLAN);
    expect(steps.map((step) => step.id)).toEqual(['fetch', 'read-standing', 'fast-forward', 'create']);
    expect(steps.map((step) => step.argv)).toEqual([
      ['git', 'fetch', 'origin', 'main'],
      ['git', 'rev-list', '--left-right', '--count', 'main...origin/main'],
      ['git', 'merge', '--ff-only', 'origin/main'],
      ['git', 'switch', '-c', 'feat/rafa-49'],
    ]);
  });

  it('switches to a local branch in one step, fetching nothing', () => {
    const steps = branchSteps('switch-local', PLAN);
    expect(steps.map((step) => step.argv)).toEqual([['git', 'switch', 'feat/rafa-49']]);
  });

  it('checks a remote-only branch out tracking it, fetching nothing', () => {
    const steps = branchSteps('switch-remote', PLAN);
    expect(steps.map((step) => step.argv))
      .toEqual([['git', 'switch', '--track', 'origin/feat/rafa-49']]);
  });

  it('labels every step in lower case with no full stop, for the line each is reported under', () => {
    const labels = (['create', 'switch-local', 'switch-remote'] as const)
      .flatMap((route) => branchSteps(route, PLAN).map((step) => step.label));
    expect(labels).toEqual([
      'fetch origin main',
      'read how main stands against origin/main',
      'fast-forward main to origin/main',
      'create feat/rafa-49 from main',
      'switch to feat/rafa-49',
      'check out feat/rafa-49 tracking origin/feat/rafa-49',
    ]);
    for (const label of labels) expect(label).toBe(label.toLowerCase());
  });
});

describe('parseBaseStanding', () => {
  it('reads the four measured standings, the local side on the left', () => {
    expect(parseBaseStanding('0\t0\n')).toEqual({ ahead: 0, behind: 0 });
    expect(parseBaseStanding('1\t0\n')).toEqual({ ahead: 1, behind: 0 });
    expect(parseBaseStanding('0\t1\n')).toEqual({ ahead: 0, behind: 1 });
    expect(parseBaseStanding('2\t3')).toEqual({ ahead: 2, behind: 3 });
  });

  it('answers nothing for output that is no pair of counts', () => {
    expect(parseBaseStanding('')).toBeNull();
    expect(parseBaseStanding('\n')).toBeNull();
    expect(parseBaseStanding('1')).toBeNull();
    expect(parseBaseStanding('1\t2\t3')).toBeNull();
    expect(parseBaseStanding('x\t1')).toBeNull();
    expect(parseBaseStanding('-1\t1')).toBeNull();
  });
});

describe('hasDiverged', () => {
  it('is true only when each side has commits the other has not', () => {
    expect(hasDiverged({ ahead: 1, behind: 1 })).toBe(true);
    expect(hasDiverged({ ahead: 0, behind: 0 })).toBe(false);
    expect(hasDiverged({ ahead: 3, behind: 0 })).toBe(false);
    expect(hasDiverged({ ahead: 0, behind: 3 })).toBe(false);
  });
});

describe('readStepOutcome', () => {
  it('goes on from every step git exited 0 for', () => {
    for (const route of ['create', 'switch-local', 'switch-remote'] as const) {
      for (const step of branchSteps(route, PLAN)) {
        const stdout = step.id === 'read-standing'
          ? '0\t1\n'
          : '';
        expect(readStepOutcome(step, answered({ ok: true, stdout }), PLAN).kind).toBe('go');
      }
    }
  });

  it('refuses a failed fetch as a branch that would be cut from a stale base', () => {
    const outcome = readStepOutcome(stepOf('create', 'fetch'), answered({ stderr: FETCH_FATAL }), PLAN);
    expect(refusalOf(outcome).split('\n')).toEqual([
      '❌ Refusing to create feat/rafa-49 from a stale origin/main: fetch origin main failed.',
      '   fatal: \'/tmp/nothing.git\' does not appear to be a git repository',
      '   fatal: Could not read from remote repository.',
      '   The run is still on main.',
    ]);
  });

  it('refuses a base that has diverged, naming both counts', () => {
    const outcome = readStepOutcome(
      stepOf('create', 'read-standing'),
      answered({ ok: true, stdout: '2\t1\n' }),
      PLAN,
    );
    expect(refusalOf(outcome).split('\n')).toEqual([
      '❌ Refusing to create feat/rafa-49: main has diverged from origin/main.',
      '   main is 2 commits ahead of origin/main and 1 commit behind it.',
      '   Push, rebase or reset main, then run again.',
    ]);
  });

  it('lets a base that is only ahead, only behind or level through', () => {
    const step = stepOf('create', 'read-standing');
    for (const stdout of ['0\t0\n', '4\t0\n', '0\t4\n']) {
      expect(readStepOutcome(step, answered({ ok: true, stdout }), PLAN).kind).toBe('go');
    }
  });

  it('refuses a standing it could not read, quoting what git answered', () => {
    const outcome = readStepOutcome(
      stepOf('create', 'read-standing'),
      answered({ ok: true, stdout: 'what?\n' }),
      PLAN,
    );
    expect(refusalOf(outcome).split('\n')).toEqual([
      '❌ Could not read how main stands against origin/main.',
      '   git answered "what?\\n", which is no pair of counts.',
      '   The run is still on main.',
    ]);
  });

  it('refuses a standing git would not answer at all', () => {
    const outcome = readStepOutcome(
      stepOf('create', 'read-standing'),
      answered({ stderr: 'fatal: bad revision' }),
      PLAN,
    );
    expect(refusalOf(outcome)).toContain('❌ Could not read how main stands against origin/main.');
    expect(refusalOf(outcome)).toContain('   fatal: bad revision');
  });

  it('refuses a fast-forward git would not do, quoting its own refusal', () => {
    const outcome = readStepOutcome(
      stepOf('create', 'fast-forward'),
      answered({ stderr: FF_FATAL }),
      PLAN,
    );
    const message = refusalOf(outcome);
    expect(message.split('\n')[0])
      .toBe('❌ Refusing to create feat/rafa-49: main would not fast-forward to origin/main.');
    expect(message).toContain('   fatal: Not possible to fast-forward, aborting.');
    expect(message).toContain('   The run is still on main.');
  });

  it('names the step that failed for the three that move the checkout', () => {
    const heads = [
      stepOf('create', 'create'),
      stepOf('switch-local', 'switch'),
      stepOf('switch-remote', 'track'),
    ].map((step) => refusalOf(readStepOutcome(step, answered({ stderr: 'fatal: nope' }), PLAN)));
    expect(heads.map((message) => message.split('\n')[0])).toEqual([
      '❌ Could not create feat/rafa-49 from main.',
      '❌ Could not switch to feat/rafa-49.',
      '❌ Could not check out feat/rafa-49 tracking origin/feat/rafa-49.',
    ]);
    for (const message of heads) expect(message).toContain('   The run is still on main.');
  });

  it('refuses a step that said nothing at all without an empty quoted line', () => {
    const outcome = readStepOutcome(stepOf('switch-local', 'switch'), answered(), PLAN);
    expect(refusalOf(outcome).split('\n')).toEqual([
      '❌ Could not switch to feat/rafa-49.',
      '   The run is still on main.',
    ]);
  });
});

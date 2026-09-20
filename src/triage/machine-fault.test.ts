/**
 * Tests for the machine-fault reading (`src/triage/machine-fault.ts`):
 * the three families it recognises, the second reading a package manager
 * needs, and the measurement over the bodies rafa itself filed.
 *
 * The module is pure — two fields in, a reading out — so there is no seam
 * to plant and every case below is a literal pair.
 *
 * {@link FILED_BODIES} is the corpus, not a sample: all 27 bugs rafa's own
 * runs filed against `open-tomato/rafa` (#6 to #18 and #32 to #46, #40
 * being a pull request), each one's `What` and `Artifact` fences taken
 * from the live body on 2026-09-20. #6 and #7 were opened by hand and
 * carry prose rather than those fences, so they are read through their
 * titles. Exactly ONE of the 27 is a machine fault, #17, and the other 26
 * are real rafa bugs; a widened pattern that starts matching one of them
 * would take a real bug off the board, which is the failure this file
 * exists to catch.
 *
 * A check that matched NOTHING would satisfy all 26 negative readings, so
 * the corpus cases never stand alone:
 *
 *  - #17 is asserted positively, on its kind, its shape and the text it
 *    matched, in the same describe as the negatives.
 *  - Each near-miss case carries the looser rule it is a near miss OF as
 *    a regex of its own, and asserts which issues THAT rule takes. Those
 *    controls fire — three, two and five of the 27 — which is what proves
 *    the corpus really holds bodies a sloppier reading would have caught,
 *    rather than 26 bodies no rule could match.
 *
 * Every planted case outside the corpus is paired the same way: a body
 * that carries the fault beside one that carries the same words without
 * it, differing only in what the shape reads.
 *
 * Six mutations of `machine-fault.ts` were driven against this file on
 * 2026-09-20, one at a time, the module restored from a scratch copy and
 * verified with `shasum -c` after each. 28 pass either side, and each
 * count below is that run's own:
 *
 *  - `readMachineFault` answering null always, so no machine fault is
 *    ever seen: 15 fail.
 *  - `readMachineFault` answering a fault always, so every rafa bug is
 *    taken off the board: 21 fail, the corpus reading among them.
 *  - the `needs` reading dropped, so a manager named alone is a fault: 1
 *    fail, `is not read from a manager named as a remedy, even beside a
 *    failure word elsewhere`. One case is the whole guard against the
 *    looseness that would swallow a `rafa doctor` remedy bug, which is
 *    why it is written with both halves of the pair.
 *  - the two fields joined into one text before reading, so a failure
 *    word in `what` certifies a manager in `artifact`: the same 1 fail.
 *  - the loops swapped to field-major, so the first FIELD to match wins
 *    rather than the first shape: 3 fail, both #17 readings and the
 *    sentence built from one.
 *  - `sdk-root` widened to any absolute path: 7 fail, the corpus count
 *    and the foreign-path near miss among them.
 */
import { describe, expect, it } from 'bun:test';

import {
  BUILD_FAILURE,
  isMachineFault,
  machineFaultSentence,
  readMachineFault,
  SHAPES,
} from './machine-fault.js';

/** One filed body, read as the two fields a report would have carried. */
interface FiledBody {
  /** Its issue number on `open-tomato/rafa`. */
  readonly issue: number;
  readonly what: string;
  readonly artifact: string | null;
}

const FILED_BODIES: readonly FiledBody[] = [
  {
    issue: 6,
    what: 'start: a session with no report block and no commit is ticked done',
    artifact: null,
  },
  {
    issue: 7,
    what: 'triage: out-of-scope bug dedupe compares stored text only, so rewordings file '
      + 'duplicates',
    artifact: null,
  },
  {
    issue: 8,
    what: 'src/tests/findNextTask.test.ts header still cites the pre-move path '
      + 'scripts/ralph/start.ts, which is now src/start.ts',
    artifact: 'Tests for the rafa start loop (scripts/ralph/start.ts).',
  },
  {
    issue: 9,
    what: 'a task line inside an unclosed rafa:context block is in no parsePlan task, so loop '
      + 'start\'s preflight cannot see its agent= while findNextTask would still dispatch it; '
      + 'the dispatch then exits 1 mid-run, which is the failure this stage exists to prevent',
    artifact: 'task-in-block: unchecked task line inside the rafa:context block',
  },
  {
    issue: 10,
    what: 'a fence labelled bash that holds JavaScript makes the checker report `const` as a '
      + 'missing tool, 4 hits over the corpus; the bodies are mislabelled, not the checker, but '
      + 'the message will read as a checker bug',
    artifact: 'the command const is in no directory of the PATH this run was given',
  },
  {
    issue: 11,
    what: 'an HTTP route that carries an extension (/openapi.json, /swagger.json) still fails as '
      + 'a foreign path; 4 hits over the corpus, for the task that wires checkDirectory over '
      + 'real tiers',
    artifact: '/openapi.json',
  },
  {
    issue: 12,
    what: 'the module note in src/commands/index.ts already claimed instinct list and instinct '
      + 'show were unregistered before this task registered them, so the sentence was false '
      + 'while they were absent from the roster; the change made it true rather than fixing it',
    artifact: '`skill index`, `instinct flag` and `instinct promote` are in the command tree and are '
      + 'not registered',
  },
  {
    issue: 13,
    what: 'src/commands/index.ts and src/commands/index.test.ts both said the roster held '
      + 'twenty-nine commands while it held 31 before this task; fixed to thirty-two in passing '
      + 'because the same sentences had to move for the new command',
    artifact: 'Five of the twenty-nine registered so far wrap a',
  },
  {
    issue: 14,
    what: 'the checker reads fenced code as command names, so const, block and nb_probe are '
      + 'reported missing-tool and would refuse six otherwise-valid demotion rows',
    artifact: 'missing-tool: line 22: the command const is in no directory of the PATH this run was '
      + 'given',
  },
  {
    issue: 15,
    what: 'unpublished-shape-read-the-image names an absolute foreign path in its body, which '
      + 'refuses its row at apply',
    artifact: 'locality foreign-path: line 12: /app/api/podcast_service.py is an absolute path '
      + 'outside both',
  },
  {
    issue: 16,
    what: 'the checker\'s missing-tool rule reads the first word of any fenced line as a command '
      + 'name, so shell functions (_phase, _ok, assert_eq), prose in output fences (Checked) '
      + 'and helper names (usage, have) refuse records that are otherwise clean; 13 of the 14 '
      + 'forecast --apply refusals are this false positive',
    artifact: 'resolution missing-tool: line 18: the command _phase is in no directory of the PATH '
      + 'this run was given',
  },
  {
    issue: 17,
    what: 'This machine\'s installed Xcode Command Line Tools SDK (MacOSX27.0.sdk) has a '
      + 'malformed/incompatible tapi stub for libSystem that breaks ld for ANY C/XS extension '
      + 'build, not just Devel::Cover — a newer Command Line Tools release (27.0) is available '
      + 'via softwareupdate and likely fixes it, but installing an OS-level toolchain update '
      + 'was judged outside a content-repair task\'s authority and was not attempted.',
    artifact: 'ld: tapi error: malformed file',
  },
  {
    issue: 18,
    what: 'src/tests/parity-differential.test.ts races a live session jsonl: the two backends '
      + 'collect at different instants, so sizeBytes and modifiedAt differ while any sibling '
      + 'session is being appended to. Pre-existing, reproduced on the unmodified tree.',
    artifact: 'holds every session row byte-identical between backends, keyed by session id',
  },
  {
    issue: 32,
    what: 'The runGh doc comment in src/utils/pr.ts says `gh pr checks` exits non-zero for a red '
      + 'run AND for a PR with no checks, so the exit code cannot carry the verdict. Measured '
      + 'today: with the --json flag the code actually passes, a red PR exits 0; only the plain '
      + 'form exits 1. The conclusion the sentence draws is still right, its stated reason is '
      + 'half wrong. The file is deleted two tasks later in this stage, so it was left alone.',
    artifact: 'gh pr checks exits non-zero for a red run AND for a PR with no checks',
  },
  {
    issue: 33,
    what: 'context/cli.md line 37 says rafa doctor runs the preflight loop start checks; doctor '
      + 'does not yet run the two automatic gh items, which the next plan task adds',
    artifact: 'the preflight `loop start` checks',
  },
  {
    issue: 34,
    what: 'context/verification.md says a parity-differential difference confined to sizeBytes '
      + 'and modifiedAt is the race and any other field is a real parity failure; the measured '
      + 'race moved lineCount, recordCount, every record-type count and every usage field as '
      + 'well, so following that sentence literally would read the known race as a regression',
    artifact: 'a difference confined to sizeBytes and modifiedAt is the race',
  },
  {
    issue: 35,
    what: 'classes.ts\'s DEPENDENCY_BUMP_AUTHORS lists \'dependabot[bot]\' as the bot-login '
      + 'reading, but gh-fake-shapes.ts\'s own module note records that a real dependabot pull '
      + 'request\'s author.login is \'app/dependabot\', not \'dependabot[bot]\' — so the '
      + 'author-based half of isDependencyBump may never match a real dependabot PR and the '
      + 'classifier falls back to the title prefix alone',
    artifact: 'app/dependabot',
  },
  {
    issue: 36,
    what: 'the two shipped CI pinned plans carry no slot for the failing log, so the spec\'s '
      + '`resolve-ci-install` and `resolve-ci-lint` tasks reach build-error-resolver without '
      + 'the log excerpt in the task text; src/pr/plans/load.ts anticipates such a slot but '
      + 'resolve-ci-install.md and resolve-ci-lint.md have none, and a value for a slot a '
      + 'template lacks is silently unused',
    artifact: 'src/pr/plans/resolve-ci-install.md',
  },
  {
    issue: 37,
    what: 'src/config.ts\'s module note says \'This file is the whole public surface ... so '
      + 'nothing outside the trio imports a sibling\', which about fifty modules already '
      + 'contradict by importing messageOf, describeValue and isMapping straight from '
      + 'config-sections.ts',
    artifact: 'nothing outside the trio imports a sibling',
  },
  {
    issue: 38,
    what: 'The non-leak half of check 2, the completeness gaps, is also unwired, so an incomplete '
      + 'issue body reaches the planner and is refused there as check 3 rather than before the '
      + 'session. The next checklist task (the spec template) owns the headings it looks for.',
    artifact: 'requireCompleteSpec',
  },
  {
    issue: 39,
    what: 'bunx eslint . reddens on the gitignored local artifact .rafa/triage/private/1.md with '
      + 'five markdown/fenced-code-language errors; the file predates this session and is '
      + 'untracked, and eslint over src/, context/, README.md and AGENTS.md exits 0',
    artifact: 'Missing code block language  markdown/fenced-code-language',
  },
  {
    issue: 41,
    what: 'rafa doctor does not check a plan\'s [start] prerequisite items at all, so its report '
      + 'differs from what loop start checks on a first dispatch; only the doc sentences were '
      + 'corrected, the behaviour was left alone',
    artifact: 'src/commands/doctor.ts:334',
  },
  {
    issue: 42,
    what: 'the dev-planner skill lists the recognized rafa:plan fields as stub, issue and spec, '
      + 'which is now an incomplete roster; left for the plan\'s docs-and-close-out stage '
      + 'rather than widened into here',
    artifact: 'Recognized fields:',
  },
  {
    issue: 43,
    what: 'Eight *.test.ts files build a complete PullRequests literal and now miss editBody '
      + '(src/start/pr-lifecycle.test.ts, '
      + 'src/commands/pr/{merge,merge-driven,view,list,current,show,pr-context}.test.ts). No '
      + 'gate catches it because tsconfig.json excludes test files; each needs one '
      + 'refuse(\'editBody\') line.',
    artifact: 'error TS2741: Property \'editBody\' is missing in type',
  },
  {
    issue: 44,
    what: 'finishRelease writes its skip sentence to the pull request body through the gh '
      + 'provider whatever pr.provider says, so a project configured with pr.provider none '
      + 'still spawns gh and logs an error line when it is absent',
    artifact: 'the pull request body could not be written: gh pull requests: gh pr list',
  },
  {
    issue: 45,
    what: '`.claude/skills/dev-planner/SKILL.md`\'s `rafa:plan` \'Recognized fields\' list '
      + 'wrongly lists `changes` as a plan-header field (a duplicate of the correct '
      + '`rafa:report` table entry two sections below); per the spec, only `release:` was meant '
      + 'to join `rafa:plan`\'s recognized fields',
    artifact: '- `changes` — Optional one-line summary of the change for the changelog, written at '
      + 'the user level',
  },
  {
    issue: 46,
    what: '`rafa doctor` does not probe a plan\'s `[start]` prerequisite items at all, since it '
      + 'starts no run and reads no tracker; the doc/behavior mismatch that originally '
      + 'motivated this finding is now closed (src/commands/doctor.ts\'s module note states the '
      + 'exclusion), but the coverage gap itself is unfixed',
    artifact: 'start-only `[start]` items are the one set left out',
  },
];

/** The issue numbers of every body the reading matches, in corpus order. */
function matchedIssues(): readonly number[] {
  return FILED_BODIES.filter((body) => isMachineFault(body)).map((body) => body.issue);
}

/** One body by its issue number; throws rather than reading undefined. */
function body(issue: number): FiledBody {
  const found = FILED_BODIES.find((row) => row.issue === issue);
  if (!found) throw new Error(`no filed body for #${issue}`);
  return found;
}

/** The issue numbers a looser rule than this module would have taken. */
function takenBy(rule: RegExp): readonly number[] {
  return FILED_BODIES
    .filter((row) => rule.test(row.what) || (row.artifact !== null && rule.test(row.artifact)))
    .map((row) => row.issue);
}

/** Every shape that fires on a body, in {@link SHAPES} order. */
function shapesOn(subject: FiledBody): readonly string[] {
  const fields = [subject.what, subject.artifact ?? ''].filter((field) => field !== '');
  return SHAPES
    .filter((shape) => fields.some((field) => shape.pattern.test(field)
      && (!shape.needs || shape.needs.test(field))))
    .map((shape) => shape.name);
}

describe('the 27 bodies rafa filed against its own repository', () => {
  it('reads exactly one of them as a fault of the machine, and it is #17', () => {
    expect(FILED_BODIES).toHaveLength(27);

    expect(matchedIssues()).toEqual([17]);
  });

  it('reads #17 as a toolchain fault quoting the words the linker wrote', () => {
    const fault = readMachineFault(body(17));

    expect(fault).toEqual({ kind: 'toolchain', shape: 'tapi-stub', evidence: 'tapi error' });
  });

  it('answers five shapes on #17 across both of its fields, the reported one first', () => {
    expect(shapesOn(body(17))).toEqual([
      'tapi-stub', 'ld-failure', 'command-line-tools', 'software-update', 'sdk-root',
    ]);
  });

  it('leaves the three checker missing-tool bugs a PATH rule would have taken', () => {
    const naive = /\bis in no directory of the PATH\b|\bcommand not found\b|\bmissing-tool\b/iu;
    expect(takenBy(naive)).toEqual([10, 14, 16]);

    expect(readMachineFault(body(10))).toBeNull();
    expect(readMachineFault(body(14))).toBeNull();
    expect(readMachineFault(body(16))).toBeNull();
  });

  it('leaves the two foreign-path bugs an absolute-path rule would have taken', () => {
    const naive = /(?<![\w.])\/[A-Za-z][\w./-]*/u;
    expect(takenBy(naive)).toEqual([11, 15]);

    expect(readMachineFault(body(11))).toBeNull();
    expect(readMachineFault(body(15))).toBeNull();
  });

  it('leaves the TypeScript and the eslint diagnostic alone, neither being the machine', () => {
    expect(body(43).artifact).toContain('error TS2741');
    expect(body(39).artifact).toContain('markdown/fenced-code-language');

    expect(readMachineFault(body(43))).toBeNull();
    expect(readMachineFault(body(39))).toBeNull();
  });

  it('leaves the spawned gh failure a rule on external tool names would have taken', () => {
    const naive = /\b(?:brew|bun|eslint|gh|git|node|npm|tsc)\b/iu;
    expect(takenBy(naive)).toEqual([32, 33, 35, 39, 44]);

    expect(readMachineFault(body(44))).toBeNull();
  });
});

describe('a system toolchain', () => {
  it('is read from a linker that cannot resolve a symbol', () => {
    const fault = readMachineFault({
      what: 'the extension will not link on this machine',
      artifact: 'ld: symbol(s) not found for architecture arm64',
    });

    expect(fault).toEqual({
      kind: 'toolchain',
      shape: 'ld-failure',
      evidence: 'ld: symbol(s) not found',
    });
  });

  it('is not read from prose that merely says a build failed to link', () => {
    expect(readMachineFault({
      what: 'the plan should link the two sections; the symbol was not found in the roster',
      artifact: 'expected the section to be linked',
    })).toBeNull();
  });

  it('is read from the sentence a failing compile ends with', () => {
    expect(readMachineFault({
      what: 'the native build fails',
      artifact: 'clang: error: linker command failed with exit code 1 (use -v to see invocation)',
    })).toMatchObject({ kind: 'toolchain', shape: 'linker-command' });
  });

  it('is read from a compiler driver reporting its own error', () => {
    expect(readMachineFault({
      what: 'the build stops here',
      artifact: 'gcc: error: unrecognized command-line option -Wno-tautological-compare',
    })).toMatchObject({ kind: 'toolchain', shape: 'compiler-driver', evidence: 'gcc: error' });
  });

  it('is not read from a diagnostic a checker wrote about rafa source', () => {
    expect(readMachineFault({
      what: 'the collector drops a row',
      artifact: 'error TS2345: Argument of type string is not assignable to parameter of type number',
    })).toBeNull();
  });

  it('is read from the dynamic loader, from xcrun and from the Windows linker', () => {
    expect(readMachineFault({ what: 'a', artifact: 'dyld[4711]: Library not loaded: @rpath/libssl.3.dylib' }))
      .toMatchObject({ shape: 'dyld' });
    expect(readMachineFault({ what: 'a', artifact: 'xcrun: error: invalid active developer path' }))
      .toMatchObject({ shape: 'xcrun' });
    expect(readMachineFault({ what: 'a', artifact: 'LNK2019: unresolved external symbol' }))
      .toMatchObject({ shape: 'msvc-linker' });
  });

  it('is read from the Command Line Tools and from the updater that installs them', () => {
    expect(readMachineFault({
      what: 'the Xcode Command Line Tools on this machine are older than the OS',
      artifact: null,
    })).toMatchObject({ kind: 'toolchain', shape: 'command-line-tools' });
    expect(readMachineFault({
      what: 'a newer release is offered by softwareupdate and was not installed',
      artifact: null,
    })).toMatchObject({ kind: 'toolchain', shape: 'software-update' });
  });
});

describe('an SDK or system install path', () => {
  it('is read from the SDK root an install carries', () => {
    expect(readMachineFault({
      what: 'the build reads the installed MacOSX14.4.sdk',
      artifact: null,
    })).toMatchObject({ kind: 'sdk-path', shape: 'sdk-root', evidence: 'MacOSX14.4.sdk' });
  });

  it('is read from the developer directory, the app bundle and a system framework', () => {
    expect(readMachineFault({
      what: 'a',
      artifact: '/Library/Developer/CommandLineTools/usr/bin/ld',
    })).toMatchObject({ shape: 'developer-dir' });
    expect(readMachineFault({
      what: 'a',
      artifact: '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild',
    })).toMatchObject({ shape: 'xcode-app' });
    expect(readMachineFault({
      what: 'a',
      artifact: '/System/Library/Frameworks/CoreFoundation.framework is unreadable',
    })).toMatchObject({ shape: 'system-framework' });
  });

  it('is read from a system library, a stub and a Homebrew prefix', () => {
    expect(readMachineFault({ what: 'a', artifact: '/usr/lib/libSystem.B.dylib' }))
      .toMatchObject({ shape: 'system-library' });
    expect(readMachineFault({ what: 'a', artifact: 'libSystem.tbd is malformed' }))
      .toMatchObject({ shape: 'tbd-stub' });
    expect(readMachineFault({ what: 'a', artifact: '/opt/homebrew/lib/libcrypto.3.dylib' }))
      .toMatchObject({ shape: 'homebrew-prefix' });
    expect(readMachineFault({ what: 'a', artifact: 'C:\\Program Files\\LLVM\\bin\\lld-link.exe' }))
      .toMatchObject({ shape: 'program-files' });
  });

  it('is not read from a path into the checkout, however absolute it looks', () => {
    expect(readMachineFault({
      what: 'the template carries no slot for the failing log',
      artifact: 'src/pr/plans/resolve-ci-install.md',
    })).toBeNull();
    expect(readMachineFault({
      what: 'an HTTP route that carries an extension still fails as a foreign path',
      artifact: '/openapi.json',
    })).toBeNull();
    expect(readMachineFault({
      what: 'the skill body names a path outside both tiers',
      artifact: '/app/api/podcast_service.py is an absolute path outside both',
    })).toBeNull();
  });
});

describe('a package-manager build failure', () => {
  it('is read from the lines a native module build ends with', () => {
    expect(readMachineFault({ what: 'a', artifact: 'gyp ERR! build error' }))
      .toMatchObject({ kind: 'package-build', shape: 'node-gyp' });
    expect(readMachineFault({ what: 'a', artifact: 'npm ERR! code 1' }))
      .toMatchObject({ kind: 'package-build', shape: 'npm-error' });
    expect(readMachineFault({ what: 'a', artifact: 'ERROR: Failed building wheel for cffi' }))
      .toMatchObject({ kind: 'package-build', shape: 'python-wheel' });
    expect(readMachineFault({ what: 'a', artifact: 'make: *** [all] Error 2' }))
      .toMatchObject({ kind: 'package-build', shape: 'make-recipe' });
  });

  it('is read from a manager named beside a failure in the same field', () => {
    expect(readMachineFault({
      what: 'the session could not build the extension',
      artifact: 'brew install pkg-config failed with exit status 1',
    })).toMatchObject({ kind: 'package-build', shape: 'package-manager', evidence: 'brew install' });
  });

  it('is not read from a manager named as a remedy, even beside a failure word elsewhere', () => {
    expect(readMachineFault({
      what: 'rafa doctor prints the wrong remedy and the run errors out later',
      artifact: 'brew install ripgrep',
    })).toBeNull();
    expect(readMachineFault({
      what: 'the prerequisite line should say brew install ripgrep',
      artifact: null,
    })).toBeNull();
  });

  it('spells the failure word list once, and it is what the pair reads', () => {
    expect(BUILD_FAILURE.test('failed')).toBe(true);
    expect(BUILD_FAILURE.test('the run aborted')).toBe(true);
    expect(BUILD_FAILURE.test('installed cleanly')).toBe(false);
  });
});

describe('the two fields', () => {
  it('are both read, so a fault named in either one is found', () => {
    expect(isMachineFault({ what: 'ld: tapi error: malformed file', artifact: null })).toBe(true);
    expect(isMachineFault({ what: null, artifact: 'ld: tapi error: malformed file' })).toBe(true);
  });

  it('answer nothing when a bug carries neither of them', () => {
    expect(readMachineFault({ what: null, artifact: null })).toBeNull();
    expect(isMachineFault({ what: '', artifact: '' })).toBe(false);
  });

  it('are read shape by shape, so the priority list and not the field order decides', () => {
    const fault = readMachineFault({
      what: '/opt/homebrew/lib is on the search path',
      artifact: 'ld: framework not found Security',
    });

    expect(fault).toMatchObject({ kind: 'toolchain', shape: 'ld-failure' });
  });
});

describe('what a match is reported as', () => {
  it('names the family and quotes the text the bug held', () => {
    const fault = readMachineFault(body(17));

    expect(machineFaultSentence(fault!)).toBe('machine-scoped (toolchain): tapi error');
  });

  it('is drawn from a frozen list whose names are each spelled once', () => {
    expect(Object.isFrozen(SHAPES)).toBe(true);
    expect(new Set(SHAPES.map((shape) => shape.name)).size).toBe(SHAPES.length);
  });

  it('carries a kind from the closed set of three', () => {
    const kinds = new Set(SHAPES.map((shape) => shape.kind));

    expect([...kinds].sort()).toEqual(['package-build', 'sdk-path', 'toolchain']);
  });
});

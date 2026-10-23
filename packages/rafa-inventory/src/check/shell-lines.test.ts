/**
 * Tests for the shell-fence line reading.
 *
 * Nothing here touches the filesystem, the environment or the `PATH`:
 * every function under test is a decision about one line of text, so
 * every case is a line in and a verdict out.
 *
 * ## Every reading is paired
 *
 * A line reported as another language's code is only a reading about
 * the rule when a near-identical REAL shell line beside it is reported
 * clean. So `const ready = true;` is answered foreign next to
 * `npm install --save-dev typescript`, the spaced assignment
 * `ready = true` next to the shell assignment `READY=true` and next to
 * a `git commit -m "const x = 1"` that carries the same shape inside
 * an argument, and the `//` comment next to the `#` one. The whole
 * {@link SHELL_BUILTINS} list is run through
 * {@link isForeignCodeLine} as one case, because a rule that called
 * any of those words foreign would have made the checker blind to
 * every `if`, `for` and `export` line in the corpus.
 *
 * ## The reading the caller refuses with
 *
 * `isForeignCodeLine` is not called by `commandOf`, and wiring it
 * into `check/references.ts` did not change that: the last case holds
 * the split. The JavaScript line the rule answers foreign is STILL
 * answered as a command by `commandOf` and as the tool `const` by
 * `toolOf`; what the caller does with the three answers together is
 * where the fence is refused, and `check/references.test.ts` is where
 * that refusal is measured.
 *
 * ## The mutation legs
 *
 * Three mutations of `check/shell-lines.ts` were driven against this
 * file on 2026-09-20 and the module restored sha256-identical after
 * each. Dropping the spaced-assignment clause reddened 1 case, listing
 * `let` as a {@link FOREIGN_KEYWORDS} entry reddened 2 (the
 * disjointness case and the builtin sweep, which is the pair that
 * exists so a keyword list cannot quietly swallow shell), and dropping
 * the `console` prompt rule from {@link commandOf} reddened 1.
 */
import { describe, expect, it } from 'bun:test';

import {
  FOREIGN_KEYWORDS,
  SHELL_BUILTINS,
  SHELL_FENCE_LANGUAGES,
  commandOf,
  continuesLine,
  heredocTerminator,
  isForeignCodeLine,
  isShellFence,
  toolOf,
} from './shell-lines.js';

describe('isShellFence', () => {
  it('answers true for every listed shell fence language', () => {
    const answered = SHELL_FENCE_LANGUAGES.map((info) => isShellFence(info));

    expect(answered).toEqual(SHELL_FENCE_LANGUAGES.map(() => true));
  });

  it('answers false for a code fence and for an unlabelled one', () => {
    expect(isShellFence('ts')).toBe(false);
    expect(isShellFence('python')).toBe(false);
    expect(isShellFence('')).toBe(false);
  });
});

describe('commandOf', () => {
  it('reads a plain line of a bash fence as the command it holds', () => {
    expect(commandOf('  bun test  ', 'bash')).toBe('bun test');
  });

  it('reads an empty line and a comment as no command', () => {
    expect(commandOf('', 'bash')).toBeNull();
    expect(commandOf('   ', 'bash')).toBeNull();
    expect(commandOf('# install the thing', 'bash')).toBeNull();
  });

  it('strips the prompt from a prompted line and refuses a bare prompt', () => {
    expect(commandOf('$ bun install', 'console')).toBe('bun install');
    expect(commandOf('$', 'console')).toBeNull();
  });

  it('reads an unprompted console line as output rather than as a command', () => {
    expect(commandOf('Cannot find package', 'console')).toBeNull();
    expect(commandOf('Cannot find package', 'bash')).toBe('Cannot find package');
  });

  it('reads a quoted continuation line as no command', () => {
    expect(commandOf('> still going', 'bash')).toBeNull();
  });
});

describe('toolOf', () => {
  it('names the first word of a command line', () => {
    expect(toolOf('bun test --coverage')).toBe('bun');
    expect(toolOf('docker-compose up')).toBe('docker-compose');
  });

  it('names nothing for a builtin, an assignment, a path or a flag', () => {
    expect(toolOf('cd src')).toBeNull();
    expect(toolOf('FOO=bar bun test')).toBeNull();
    expect(toolOf('./scripts/run.sh')).toBeNull();
    expect(toolOf('--help')).toBeNull();
    expect(toolOf('')).toBeNull();
  });
});

describe('heredocTerminator', () => {
  it('names the terminator a heredoc opens, quoted or bare', () => {
    expect(heredocTerminator('cat <<EOF')).toBe('EOF');
    expect(heredocTerminator('cat > file <<-\'TSEOF\'')).toBe('TSEOF');
  });

  it('names nothing for a line opening no heredoc', () => {
    expect(heredocTerminator('bun test')).toBeNull();
    expect(heredocTerminator('echo a < b')).toBeNull();
  });
});

describe('continuesLine', () => {
  it('reads a trailing backslash as a continuation', () => {
    expect(continuesLine('bun test \\')).toBe(true);
  });

  it('reads a trailing pipe or and-and as a pipeline, not a continuation', () => {
    expect(continuesLine('bun test |')).toBe(false);
    expect(continuesLine('bun test &&')).toBe(false);
    expect(continuesLine('bun test')).toBe(false);
  });
});

describe('isForeignCodeLine, on a keyword opening the line', () => {
  it('reads a JavaScript declaration as foreign and the install command beside it as shell', () => {
    expect(isForeignCodeLine('const ready = true;')).toBe(true);
    expect(isForeignCodeLine('npm install --save-dev typescript')).toBe(false);
  });

  it('reads a Python and a Go statement as foreign and a bun run beside them as shell', () => {
    expect(isForeignCodeLine('from django.db import connection')).toBe(true);
    expect(isForeignCodeLine('def main():')).toBe(true);
    expect(isForeignCodeLine('package main')).toBe(true);
    expect(isForeignCodeLine('bun run build')).toBe(false);
  });

  it('reads an indented declaration as foreign, because a fence indents its bodies', () => {
    expect(isForeignCodeLine('    const inner = 1;')).toBe(true);
  });

  it('reads a keyword carried mid-line as shell, because only the first word is evidence', () => {
    expect(isForeignCodeLine('grep -n const src/index.ts')).toBe(false);
    expect(isForeignCodeLine('rg "^class " src')).toBe(false);
  });

  it('holds no keyword that is also a shell builtin', () => {
    const shared = FOREIGN_KEYWORDS.filter((word) => SHELL_BUILTINS.includes(word));

    expect(shared).toEqual([]);
  });

  it('reads every shell builtin opening a line as shell', () => {
    const foreign = SHELL_BUILTINS.filter((word) => isForeignCodeLine(`${word} something`));

    expect(foreign).toEqual([]);
  });
});

describe('isForeignCodeLine, on an assignment opening the line', () => {
  it('reads a spaced assignment as foreign and a shell assignment as shell', () => {
    expect(isForeignCodeLine('ready = true')).toBe(true);
    expect(isForeignCodeLine('READY=true')).toBe(false);
    expect(isForeignCodeLine('READY=true bun test')).toBe(false);
  });

  it('leaves a spaced assignment inside an argument alone, because the shape is anchored', () => {
    expect(isForeignCodeLine('git commit -m "const x = 1"')).toBe(false);
    expect(isForeignCodeLine('echo "ready = true"')).toBe(false);
  });

  it('reads a comparison and an arrow as shell, not as an assignment', () => {
    expect(isForeignCodeLine('if [ "$a" = "b" ]; then')).toBe(false);
    expect(isForeignCodeLine('x == y')).toBe(false);
    expect(isForeignCodeLine('x => y')).toBe(false);
  });
});

describe('isForeignCodeLine, on a comment opening the line', () => {
  it('reads a C-family comment as foreign and the shell comment beside it as shell', () => {
    expect(isForeignCodeLine('// validate the schema')).toBe(true);
    expect(isForeignCodeLine('/* validate the schema */')).toBe(true);
    expect(isForeignCodeLine(' * a continued block comment')).toBe(true);
    expect(isForeignCodeLine('# validate the schema')).toBe(false);
  });

  it('reads an empty line as shell, so a blank line is never evidence', () => {
    expect(isForeignCodeLine('')).toBe(false);
    expect(isForeignCodeLine('   ')).toBe(false);
  });
});

describe('the reading the caller refuses a whole fence with', () => {
  it('still answers the JavaScript line as a command naming the tool const', () => {
    const line = 'const ready = true;';

    const command = commandOf(line, 'bash');

    expect(isForeignCodeLine(line)).toBe(true);
    expect(command).toBe('const ready = true;');
    expect(toolOf(command ?? '')).toBe('const');
  });
});

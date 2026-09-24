/**
 * Tests for the reference extractor (`src/refs/extract.ts`): each of the
 * seven kinds, each skip rule, the words that must not be read, the
 * duplicate rule and the `Blocked by:` marking.
 *
 * Every case is a pure call over a literal body; the module reads no
 * file and asks nothing.
 *
 * ## The controls
 *
 * A skip rule reads the same as a reader that finds nothing at all, so
 * every skip case plants the SAME token outside the skipped region too
 * and holds that it is read there, on that line. A reader that
 * extracted nothing would fail the control half; a reader that ignored
 * the rule would fail the skipped half.
 *
 * The must-not cases run {@link kindsOf} over bodies built only from
 * near misses, and each such body sits beside a case where the nearest
 * real shape IS read, so an empty answer is not the only way the case
 * can come out.
 */
import type { Ref, RefKind } from './extract.js';

import { describe, expect, it } from 'bun:test';

import { extractRefs } from './extract.js';

/** `kind text@line` per reference, the shape most cases compare. */
function kindsOf(text: string): readonly string[] {
  return extractRefs(text).map((ref) => `${ref.kind} ${ref.text}@${String(ref.line)}`);
}

/** The one reference of `kind` and `text`, or a throw naming what was read. */
function refOf(text: string, kind: RefKind, named: string): Ref {
  const refs = extractRefs(text);
  const found = refs.find((ref) => ref.kind === kind && ref.text === named);
  if (found === undefined) throw new Error(`no ${kind} ${named} in ${JSON.stringify(refs)}`);
  return found;
}

describe('extractRefs: each kind', () => {
  it('reads #n and rafa-<n> in running text as issues', () => {
    const body = 'Follows #80 (see #56\'s row),\nand rafa-63 before it.';

    expect(kindsOf(body)).toEqual(['issue #80@1', 'issue #56@1', 'issue rafa-63@2']);
  });

  it('reads owner/repo#n as a cross-repository issue, not as the local #n', () => {
    const body = 'Tracked in open-tomato/rafa#31 and here in #31.';

    expect(kindsOf(body)).toEqual(['cross-issue open-tomato/rafa#31@1', 'issue #31@1']);
  });

  it('reads a backticked path with a slash or a listed extension', () => {
    const body = 'Edit `src/board/issue.ts`, `.rafa/specs/`, `docs/guide` and `package.json`.';

    expect(kindsOf(body)).toEqual([
      'path src/board/issue.ts@1',
      'path .rafa/specs/@1',
      'path docs/guide@1',
      'path package.json@1',
    ]);
  });

  it('reads a backticked code-shaped name as a symbol', () => {
    const body = '`readSnapshotChange`, `GhRunner`, `SPEC_BLOCKED_LABEL` and `snapshot()`.';

    expect(kindsOf(body)).toEqual([
      'symbol readSnapshotChange@1',
      'symbol GhRunner@1',
      'symbol SPEC_BLOCKED_LABEL@1',
      'symbol snapshot@1',
    ]);
  });

  it('reads rafa <subject> <action> out of a span, stopping at the first argument', () => {
    const body = [
      'Run `rafa issue check <n> --stamp`,',
      'then `rafa doctor --deep` and `rafa plan create --issue=7`.',
    ].join('\n');

    expect(kindsOf(body)).toEqual([
      'command rafa issue check@1',
      'flag --stamp@1',
      'command rafa doctor@2',
      'flag --deep@2',
      'command rafa plan create@2',
      'flag --issue@2',
    ]);
  });

  it('reads a flag in running text, in a span of its own and in a bare subject\'s span', () => {
    const body = 'Pass --output=json, or `--accept-refs`, or `plan create --next`.';

    expect(kindsOf(body)).toEqual(['flag --output@1', 'flag --accept-refs@1', 'flag --next@1']);
  });

  it('reads section.key as a key when SETTINGS holds the section', () => {
    const body = 'Set `specs.dir` and `pr.mergeMethod`.';

    expect(kindsOf(body)).toEqual(['key specs.dir@1', 'key pr.mergeMethod@1']);
  });

  it('answers each reference once, frozen, in the order the text names them', () => {
    const refs = extractRefs('`src/a.ts` then #7\n`--deep` and `GhRunner`');

    expect(refs.map((ref) => ref.kind)).toEqual(['path', 'issue', 'flag', 'symbol']);
    expect(Object.isFrozen(refs)).toBe(true);
    expect(refs.every((ref) => Object.isFrozen(ref))).toBe(true);
  });

  it('answers an empty list for text that names nothing', () => {
    expect(extractRefs('')).toEqual([]);
    expect(extractRefs('Plain prose with no reference at all.')).toEqual([]);
  });
});

describe('extractRefs: what is skipped', () => {
  it('skips a backtick fence and reads the same token after it closes', () => {
    const body = ['```ts', 'import `src/gone.ts` from #9', '```', 'Now `src/gone.ts` and #9.'].join('\n');

    expect(kindsOf(body)).toEqual(['path src/gone.ts@4', 'issue #9@4']);
  });

  it('skips a tilde fence, which a backtick line does not close', () => {
    const body = ['~~~', '#9', '```', '#10', '~~~', '#11'].join('\n');

    expect(kindsOf(body)).toEqual(['issue #11@6']);
  });

  it('keeps a four-backtick fence open across a three-backtick line', () => {
    const body = ['````md', '```', '#9', '```', '````', '#10'].join('\n');

    expect(kindsOf(body)).toEqual(['issue #10@6']);
  });

  it('does not close a fence on a line with text after the run', () => {
    const body = ['```', '```ts', '#9', '```', '#10'].join('\n');

    expect(kindsOf(body)).toEqual(['issue #10@5']);
  });

  it('skips everything after a fence that never closes', () => {
    expect(kindsOf('#8\n```\n#9\n#10')).toEqual(['issue #8@1']);
  });

  it('skips a quotation line and reads the same token on the line after', () => {
    const body = ['> the old spec named `src/old.ts` and #9', '   > and `--gone`', 'Now `src/old.ts`, #9 and `--gone`.'].join('\n');

    expect(kindsOf(body)).toEqual(['path src/old.ts@3', 'issue #9@3', 'flag --gone@3']);
  });

  it('reads no issue from inside a code span, and the same id outside one', () => {
    const body = 'The field reads `Blocked by: #24 #26`; this spec follows #24.';

    expect(kindsOf(body)).toEqual(['issue #24@1']);
  });

  it('reads no flag from a span opening with another program, and rafa\'s from its own', () => {
    const body = 'Run `git push --force-with-lease`, `bun install --frozen-lockfile`, then `rafa pr merge --resolve`.';

    expect(kindsOf(body)).toEqual(['command rafa pr merge@1', 'flag --resolve@1']);
  });
});

describe('extractRefs: what is not a reference', () => {
  it('reads no plain word, bare ALL-CAPS word or single-capital name as a symbol', () => {
    expect(kindsOf('`ok`, `HEAD`, `PATH`, `JSON`, `Error`, `plain`, `x`')).toEqual([]);
  });

  it('reads no member call as a symbol, and the bare call beside it', () => {
    expect(kindsOf('`Bun.serve()` and `serve()`')).toEqual(['symbol serve@1']);
  });

  it('reads no path starting with /, ~ or http', () => {
    const body = '`/usr/bin/git`, `~/.claude/skills`, `http://x.test/a.md`, `https://x.test/b`';

    expect(kindsOf(body)).toEqual([]);
  });

  it('reads no placeholder, glob, specifier or bare extension as a path', () => {
    const body = '`<dir>/<name>.md`, `**/*.test.ts`, `node:fs`, `@open-tomato/rafa`, `.ts`, `a b/c.ts`';

    expect(kindsOf(body)).toEqual([]);
  });

  it('reads no dotted token as a path unless its extension is listed', () => {
    expect(kindsOf('`console.log`, `Bun.file`, `import.meta` and `bun.lock`')).toEqual(['path bun.lock@1']);
  });

  it('reads no dotted key under a section SETTINGS does not hold', () => {
    expect(kindsOf('`engines.node`, `message.model`, `section.key` and `plan.dir`')).toEqual(['key plan.dir@1']);
  });

  it('reads nothing that looks like a path, a command or a key in running text', () => {
    const body = 'rafa keeps a saved copy of src/a.ts, and/or specs.dir, e.g. GhRunner.';

    expect(kindsOf(body)).toEqual([]);
  });

  it('reads no command from a span naming rafa with no command word after it', () => {
    expect(kindsOf('`rafa <subject> <action>` and `rafa`')).toEqual([]);
  });

  it('reads no heading, anchor, entity, colour or word-joined # as an issue', () => {
    const body = ['## Design', 'See page#12, &#35;, #fff, #12a and x#3.', 'But (#12) is one.'].join('\n');

    expect(kindsOf(body)).toEqual(['issue #12@3']);
  });

  it('reads no rafa-<n> inside a longer word, and one that starts a slug', () => {
    expect(kindsOf('open-rafa-12 and xrafa-3, then rafa-151-references')).toEqual(['issue rafa-151@1']);
  });

  it('reads no em-dash, rule or HTML comment marker as a flag', () => {
    const body = ['a -- b', '---', '<!-- rafa:refs', '-->', '|---|---|', 'x--y'].join('\n');

    expect(kindsOf(body)).toEqual([]);
  });
});

describe('extractRefs: duplicates and lines', () => {
  it('reads a reference once per kind and text, at the first line naming it', () => {
    const body = ['intro', '`src/a.ts` and #7', '`src/a.ts` again, #7 again', '`readBlockedBy()`', '`readBlockedBy`'].join('\n');

    expect(kindsOf(body)).toEqual(['path src/a.ts@2', 'issue #7@2', 'symbol readBlockedBy@4']);
  });

  it('keeps one target written two ways as two references', () => {
    expect(kindsOf('#7 is rafa-7')).toEqual(['issue #7@1', 'issue rafa-7@1']);
  });

  it('counts lines over the body as handed in, CRLF or LF alike', () => {
    expect(kindsOf('one\r\ntwo\r\n#3 here')).toEqual(['issue #3@3']);
  });
});

describe('extractRefs: Blocked by targets', () => {
  const body = [
    'Follows #24 and rafa-26.',
    'Unrelated: #9 and open-tomato/other#4.',
    '```',
    'Blocked by: #9',
    '```',
    'Blocked by: #24 #26 open-tomato/other#4',
  ].join('\n');

  it('marks every issue the field names, wherever it was first read', () => {
    expect(refOf(body, 'issue', '#24')).toEqual({ kind: 'issue', text: '#24', line: 1, blocker: true });
    expect(refOf(body, 'issue', 'rafa-26').blocker).toBe(true);
    expect(refOf(body, 'cross-issue', 'open-tomato/other#4').blocker).toBe(true);
  });

  it('marks no issue a fenced field names, nor one the field leaves out', () => {
    expect(refOf(body, 'issue', '#9').blocker).toBe(false);
  });

  it('adds the field line\'s own issue at that line when nothing read it earlier', () => {
    expect(refOf(body, 'issue', '#26')).toEqual({ kind: 'issue', text: '#26', line: 6, blocker: true });
  });

  it('marks nothing on a body with no field', () => {
    expect(extractRefs('Follows #24 and `src/a.ts`.').some((ref) => ref.blocker)).toBe(false);
  });
});

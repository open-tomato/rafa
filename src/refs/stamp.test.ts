/**
 * Tests for the fingerprints, the stamp comparison and the refs block
 * codec (`src/refs/stamp.ts`): the normalisation an issue is hashed
 * under, its `##` sections, each state {@link compareToStamp} answers,
 * and a round trip of the block through {@link writeRefsBlock} and
 * {@link readRefsBlock}.
 *
 * Every case is a pure call over literals; the module reads no file.
 *
 * ## The controls
 *
 * A normalisation case reads the same as a hash that ignored its input,
 * so each one sits beside a change the normalisation must NOT absorb —
 * a word, a leading space, an inner blank line — and holds that the
 * digest moves for it. The digest itself is pinned against a sha256
 * taken here through `Bun.CryptoHasher`, a second implementation, so a
 * definition drifting in the module fails here rather than silently
 * re-stamping every copy.
 *
 * The characters the block escapes are built with
 * `String.fromCodePoint` rather than written as escapes in this file.
 */
import type { Fingerprint, IssueFingerprint, RefStamp } from './stamp.js';

import { describe, expect, it } from 'bun:test';

import { extractRefs } from './extract.js';
import {
  ABSENT,
  blobFingerprint,
  compareToStamp,
  findStamp,
  fingerprintText,
  issueFingerprint,
  normaliseIssueText,
  PRESENT,
  readRefsBlock,
  REFS_BLOCK_CLOSE,
  REFS_BLOCK_OPEN,
  RefsBlockError,
  sameFingerprint,
  UNREADABLE,
  writeRefsBlock,
} from './stamp.js';

/** A body with text above its first heading, two `##` sections and a `###` inside one. */
const BODY = [
  'Intro line.',
  '',
  '## Design',
  '',
  'The design.',
  '',
  '### Detail',
  '',
  'A detail.',
  '',
  '## Tasks',
  '',
  '- one',
].join('\n');

/** A sha1 blob id and a different one. */
const SHA1 = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const OTHER_SHA1 = '0123456789abcdef0123456789abcdef01234567';

/** An open issue #7 with `body`. */
function issue(body: string, state: 'open' | 'closed' = 'open', title = 'Seven'): IssueFingerprint {
  return issueFingerprint({ title, body, state });
}

/** sha256 in hex, through a second implementation. */
function hex(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text)
    .digest('hex');
}

/** The headings an issue fingerprint names, in order. */
function names(fingerprint: IssueFingerprint): readonly string[] {
  return fingerprint.headings.map((heading) => heading.name);
}

describe('normaliseIssueText', () => {
  it('makes CRLF and a lone CR into LF and trims each line\'s and the text\'s trailing whitespace', () => {
    expect(normaliseIssueText('a  \r\nb\t\rc \n\n  \n')).toBe('a\nb\nc');
  });

  it('keeps leading whitespace and inner blank lines', () => {
    expect(normaliseIssueText('  a\n\n\nb')).toBe('  a\n\n\nb');
  });
});

describe('issueFingerprint: the digest', () => {
  it('is sha256 over JSON.stringify([title, body]) after normalisation', () => {
    const fingerprint = issue(`${BODY}  \n\n`, 'open', 'Seven ');

    expect(fingerprint.digest).toBe(hex(JSON.stringify(['Seven', BODY])));
  });

  it('reads CRLF, trailing spaces and trailing blank lines as the body without them', () => {
    const noisy = `${BODY.split('\n').map((line) => `${line} \t`)
      .join('\r\n')}\r\n\r\n`;

    expect(issue(noisy).digest).toBe(issue(BODY).digest);
    expect(issue(noisy).headings).toEqual(issue(BODY).headings);
  });

  it('moves for a changed word, a leading space, an inner blank line and a changed title', () => {
    const base = issue(BODY).digest;
    const variants = [
      issue(BODY.replace('The design.', 'The designs.')),
      issue(BODY.replace('The design.', ' The design.')),
      issue(BODY.replace('- one', '\n- one')),
      issue(BODY, 'open', 'Seven!'),
    ];

    for (const variant of variants) expect(variant.digest).not.toBe(base);
  });

  it('does not read the title and body boundary as movable', () => {
    expect(issue('b\n\nc', 'open', 'a').digest).not.toBe(issue('c', 'open', 'a\n\nb').digest);
  });

  it('keeps the state beside the digest and out of it', () => {
    const open = issue(BODY, 'open');
    const closed = issue(BODY, 'closed');

    expect(closed.digest).toBe(open.digest);
    expect([open.state, closed.state]).toEqual(['open', 'closed']);
  });
});

describe('issueFingerprint: the sections', () => {
  it('names each ## heading in order, a ### staying inside its section', () => {
    expect(names(issue(BODY))).toEqual(['Design', 'Tasks']);
  });

  it('hashes a section with its heading line and every line up to the next ##', () => {
    const design = issue(BODY).headings[0];

    expect(design?.digest).toBe(hex(['## Design', '', 'The design.', '', '### Detail', '', 'A detail.', ''].join('\n')));
  });

  it('reads a ## line inside a fence as text, and the same line outside one as a heading', () => {
    const fenced = ['## Design', '```md', '## Fake', '```', 'after'].join('\n');
    const bare = ['## Design', '## Fake', 'after'].join('\n');

    expect(names(issue(fenced))).toEqual(['Design']);
    expect(names(issue(bare))).toEqual(['Design', 'Fake']);
  });

  it('closes a fence only on its own character, at least as long', () => {
    const body = ['## A', '````', '```', '## Inside', '````', '## B'].join('\n');

    expect(names(issue(body))).toEqual(['A', 'B']);
  });

  it('names a heading without its closing #s and up to three spaces of indent', () => {
    expect(names(issue('   ## Design ##\ntext\n## Tasks'))).toEqual(['Design', 'Tasks']);
  });

  it('hashes two sections under one name as one heading', () => {
    const fingerprint = issue('## Notes\na\n## Other\nb\n## Notes\nc');

    expect(names(fingerprint)).toEqual(['Notes', 'Other']);
    expect(fingerprint.headings[0]?.digest).toBe(hex('## Notes\na\n## Notes\nc'));
  });
});

describe('blobFingerprint and fingerprintText', () => {
  it('takes a sha1 or sha256 object id and writes it as blob:<sha>', () => {
    const sha256 = 'a'.repeat(64);

    expect(fingerprintText(blobFingerprint(SHA1))).toBe(`blob:${SHA1}`);
    expect(fingerprintText(blobFingerprint(sha256))).toBe(`blob:${sha256}`);
  });

  it('refuses anything else', () => {
    for (const bad of ['', SHA1.toUpperCase(), SHA1.slice(1), `${SHA1}0`, 'HEAD']) {
      expect(() => blobFingerprint(bad)).toThrow(RangeError);
    }
  });

  it('writes an issue as sha256:<digest> and the two words as themselves', () => {
    const fingerprint = issue(BODY);

    expect(fingerprintText(fingerprint)).toBe(`sha256:${fingerprint.digest}`);
    expect([fingerprintText(PRESENT), fingerprintText(ABSENT)]).toEqual(['present', 'absent']);
  });

  it('reads two fingerprints as the same by their text, never by an issue\'s state', () => {
    expect(sameFingerprint(issue(BODY, 'open'), issue(BODY, 'closed'))).toBe(true);
    expect(sameFingerprint(blobFingerprint(SHA1), blobFingerprint(OTHER_SHA1))).toBe(false);
    expect(sameFingerprint(PRESENT, ABSENT)).toBe(false);
  });
});

describe('compareToStamp: each state', () => {
  /** The state and changed headings, as one pair. */
  function read(live: Fingerprint | typeof UNREADABLE, stamp: Fingerprint | null, blocker = false): readonly unknown[] {
    const answer = compareToStamp({ live, stamp, blocker });
    return [answer.state, answer.changedHeadings];
  }

  it('answers unknown for an unreadable target, stamped or not', () => {
    expect(read(UNREADABLE, null)).toEqual(['unknown', []]);
    expect(read(UNREADABLE, issue(BODY), true)).toEqual(['unknown', []]);
  });

  it('answers ok for an unstamped target that exists and dangling for one that does not', () => {
    expect(read(PRESENT, null)).toEqual(['ok', []]);
    expect(read(issue(BODY, 'closed'), null, true)).toEqual(['ok', []]);
    expect(read(ABSENT, null)).toEqual(['dangling', []]);
  });

  it('answers dangling when a stamped target is gone', () => {
    expect(read(ABSENT, blobFingerprint(SHA1))).toEqual(['dangling', []]);
    expect(read(ABSENT, PRESENT)).toEqual(['dangling', []]);
  });

  it('answers ok for a target stamped absent and still missing, suspect once it appears', () => {
    expect(read(ABSENT, ABSENT)).toEqual(['ok', []]);
    expect(read(PRESENT, ABSENT)).toEqual(['suspect', []]);
    expect(read(blobFingerprint(SHA1), ABSENT)).toEqual(['suspect', []]);
  });

  it('answers ok for the same fingerprint and suspect for a changed blob', () => {
    expect(read(blobFingerprint(SHA1), blobFingerprint(SHA1))).toEqual(['ok', []]);
    expect(read(PRESENT, PRESENT)).toEqual(['ok', []]);
    expect(read(blobFingerprint(OTHER_SHA1), blobFingerprint(SHA1))).toEqual(['suspect', []]);
  });

  it('answers suspect for an issue whose Design section changed, naming that heading only', () => {
    const changed = issue(BODY.replace('The design.', 'A new design.'));

    expect(read(changed, issue(BODY))).toEqual(['suspect', ['Design']]);
  });

  it('names a heading added and one removed, the live order first', () => {
    const now = issue(BODY.replace('## Tasks', '## Steps'));

    expect(read(now, issue(BODY))).toEqual(['suspect', ['Steps', 'Tasks']]);
  });

  it('answers suspect naming no heading for a change above the first heading or to the title', () => {
    expect(read(issue(BODY.replace('Intro line.', 'Intro.')), issue(BODY))).toEqual(['suspect', []]);
    expect(read(issue(BODY, 'open', 'Eight'), issue(BODY))).toEqual(['suspect', []]);
  });

  it('answers resolved for a blocker stamped open and now closed', () => {
    expect(read(issue(BODY, 'closed'), issue(BODY, 'open'), true)).toEqual(['resolved', []]);
  });

  it('keeps a changed blocker resolved, with the changed headings beside it', () => {
    const now = issue(BODY.replace('- one', '- [x] one'), 'closed');

    expect(read(now, issue(BODY, 'open'), true)).toEqual(['resolved', ['Tasks']]);
  });

  it('answers ok, not resolved, for a closed issue that is no blocker or was closed when stamped', () => {
    expect(read(issue(BODY, 'closed'), issue(BODY, 'open'), false)).toEqual(['ok', []]);
    expect(read(issue(BODY, 'closed'), issue(BODY, 'closed'), true)).toEqual(['ok', []]);
  });
});

describe('the refs block codec', () => {
  const stamps: readonly RefStamp[] = [
    { kind: 'issue', text: '#7', fingerprint: issue(BODY) },
    { kind: 'cross-issue', text: 'open-tomato/rafa#31', fingerprint: issue('', 'closed') },
    { kind: 'path', text: 'src/a.ts', fingerprint: blobFingerprint(SHA1) },
    { kind: 'path', text: 'src/gone.ts', fingerprint: ABSENT },
    { kind: 'symbol', text: 'readSnapshotChange', fingerprint: PRESENT },
    { kind: 'command', text: 'rafa issue check', fingerprint: PRESENT },
    { kind: 'flag', text: '--accept-refs', fingerprint: PRESENT },
    { kind: 'key', text: 'specs.dir', fingerprint: PRESENT },
  ];
  const body = '# Spec\n\nSee `src/a.ts` and #7.\n';

  it('round-trips every fingerprint kind, byte for byte', () => {
    const copy = writeRefsBlock(body, stamps);
    const read = readRefsBlock(copy);

    expect(read.body).toBe(body);
    expect(read.stamps).toEqual(stamps);
    expect(writeRefsBlock(read.body, read.stamps)).toBe(copy);
  });

  it('writes the block as the module note shows it', () => {
    const fingerprint = issue('## Design\nx');
    const copy = writeRefsBlock('body\n', [
      { kind: 'issue', text: '#7', fingerprint },
      { kind: 'path', text: 'src/a.ts', fingerprint: blobFingerprint(SHA1) },
    ]);

    expect(copy).toBe([
      REFS_BLOCK_OPEN,
      'refs:',
      '  - kind: issue',
      '    text: "#7"',
      `    stamp: "sha256:${fingerprint.digest}"`,
      '    state: open',
      '    headings:',
      `      - ["Design", "${fingerprint.headings[0]?.digest ?? ''}"]`,
      '  - kind: path',
      '    text: "src/a.ts"',
      `    stamp: "blob:${SHA1}"`,
      REFS_BLOCK_CLOSE,
      '',
      'body\n',
    ].join('\n'));
  });

  it('answers null stamps and the copy untouched when there is no block, and writes it back so', () => {
    const read = readRefsBlock(body);

    expect(read).toEqual({ stamps: null, body });
    expect(writeRefsBlock(body, null)).toBe(body);
  });

  it('tells an empty block from no block', () => {
    const copy = writeRefsBlock(body, []);

    expect(copy).toBe(`${REFS_BLOCK_OPEN}\nrefs: []\n${REFS_BLOCK_CLOSE}\n\n${body}`);
    expect(readRefsBlock(copy)).toEqual({ stamps: [], body });
  });

  it('keeps a body that opens with a blank line, and an empty body', () => {
    for (const text of ['\nlate start\n', '']) {
      expect(readRefsBlock(writeRefsBlock(text, stamps)).body).toBe(text);
    }
  });

  it('leaves a reference on the body\'s own line once the block is stripped', () => {
    const copy = writeRefsBlock(body, stamps);
    const [path] = extractRefs(readRefsBlock(copy).body);

    expect(path).toMatchObject({ kind: 'path', text: 'src/a.ts', line: 3 });
  });

  it('carries a heading that holds -->, >, a quote and separators without closing the comment early', () => {
    const odd = `Tricky --> "x" \\ ${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x7)}${String.fromCodePoint(0xf0000)} end`;
    const fingerprint = issue(`## ${odd}\ntext`);
    const copy = writeRefsBlock(body, [{ kind: 'issue', text: '#9', fingerprint }]);

    expect(copy.split(REFS_BLOCK_CLOSE)).toHaveLength(2);
    expect(copy.split('\n').filter((line) => line.includes('\\u'))).toHaveLength(1);
    expect(copy).toContain('\\U000f0000');
    expect(readRefsBlock(copy).stamps?.[0]?.fingerprint).toEqual(fingerprint);
  });

  it('keeps headings in body order whatever they are called', () => {
    const fingerprint = issue('## b\n## 2\n## __proto__\n## constructor');
    const [read] = readRefsBlock(writeRefsBlock('', [{ kind: 'issue', text: '#7', fingerprint }])).stamps ?? [];

    expect(read?.fingerprint).toEqual(fingerprint);
    expect(names(fingerprint)).toEqual(['b', '2', '__proto__', 'constructor']);
  });

  it('finds a stamp by kind and text, and none for another kind of the same text', () => {
    expect(findStamp(stamps, { kind: 'path', text: 'src/a.ts' })).toEqual(blobFingerprint(SHA1));
    expect(findStamp(stamps, { kind: 'symbol', text: 'src/a.ts' })).toBeNull();
    expect(findStamp(null, { kind: 'path', text: 'src/a.ts' })).toBeNull();
  });
});

describe('the refs block codec: what it refuses', () => {
  /** A copy whose block holds `yaml`. */
  function copyWith(...yaml: readonly string[]): string {
    return [REFS_BLOCK_OPEN, ...yaml, REFS_BLOCK_CLOSE, '', 'body'].join('\n');
  }

  /** The message `readRefsBlock` throws for `copy`, or a throw when it throws none. */
  function refusal(copy: string): string {
    try {
      readRefsBlock(copy);
    } catch (error) {
      expect(error).toBeInstanceOf(RefsBlockError);
      return (error as Error).message;
    }
    throw new Error('readRefsBlock read the copy');
  }

  it('reads the entry each refusal below breaks', () => {
    const copy = copyWith('refs:', '  - kind: symbol', '    text: "X"', '    stamp: present');

    expect(readRefsBlock(copy).stamps).toEqual([{ kind: 'symbol', text: 'X', fingerprint: PRESENT }]);
  });

  it('refuses a block no --> line closes', () => {
    expect(refusal(`${REFS_BLOCK_OPEN}\nrefs: []\nbody`)).toContain('no --> line closes it');
  });

  it('refuses text that is not YAML, and YAML with no refs list', () => {
    expect(refusal(copyWith('refs: ['))).toContain('not valid YAML');
    expect(refusal(copyWith('other: 1'))).toContain('refs is not a list');
  });

  it('refuses an unknown kind, a missing text, and a stamp that is no fingerprint', () => {
    expect(refusal(copyWith('refs:', '  - kind: file', '    text: "X"', '    stamp: present'))).toContain('kind "file"');
    expect(refusal(copyWith('refs:', '  - kind: symbol', '    stamp: present'))).toContain('text is not a string');
    expect(refusal(copyWith('refs:', '  - kind: path', '    text: "a.ts"', '    stamp: "blob:xyz"'))).toContain('is not a fingerprint');
  });

  it('refuses a stamp the kind is never given', () => {
    expect(refusal(copyWith('refs:', '  - kind: symbol', '    text: "X"', `    stamp: "blob:${SHA1}"`))).toContain('a symbol is not stamped blob:');
  });

  it('refuses an issue stamp with no state or a heading that is not a pair', () => {
    const stamp = `    stamp: "sha256:${'a'.repeat(64)}"`;

    expect(refusal(copyWith('refs:', '  - kind: issue', '    text: "#7"', stamp, '    headings: []'))).toContain('state is not open or closed');
    expect(refusal(copyWith('refs:', '  - kind: issue', '    text: "#7"', stamp, '    state: open', '    headings:', '      - ["A"]'))).toContain('not a [name, digest] pair');
  });

  it('refuses one reference stamped twice', () => {
    const entry = ['  - kind: symbol', '    text: "X"', '    stamp: present'];

    expect(refusal(copyWith('refs:', ...entry, ...entry))).toContain('symbol X is stamped twice');
  });
});

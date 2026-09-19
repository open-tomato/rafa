/**
 * Tests for the board leak refusal (`src/board/leak.ts`): each home path
 * shape, each token shape, the line a finding names, the masked
 * evidence, and the bodies that only LOOK like one.
 *
 * Every function here is pure, so there is no seam to plant: each case
 * is a body in and a list out. Nothing below names a real credential or
 * a real account — every value is invented for its shape, which is all
 * the module reads.
 *
 * A check like this passes for the wrong reason in two opposite ways,
 * and both are asserted against:
 *
 *  - A check that refuses EVERYTHING satisfies every positive case
 *    below. So each shape is paired with a body that carries the same
 *    prefix and is not a leak — a bracketed segment, a stand-in login,
 *    a redacted token, a URL path — and that pair is the point of the
 *    case, not an extra.
 *  - A check that refuses NOTHING satisfies every negative case. So no
 *    negative case stands alone either: each sits beside the positive
 *    one it was written from, differing only in the part the rule
 *    reads.
 *
 * The line number is asserted through bodies whose leak sits on
 * DIFFERENT lines, because a finding hard-coded to line 1 satisfies any
 * one-line body, and the refusal is only useful if the number is the
 * author's.
 *
 * The masking is asserted from the other side too: the sentence must
 * NOT hold the account name or the token body it was built from. That
 * is the case which would catch a refusal that helpfully quoted the
 * line it found, which is how a leak refused at the command reaches a
 * terminal, a CI log and a bug report anyway.
 *
 * Seven mutations of `leak.ts` were driven against this file on
 * 2026-09-19, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each. 27 pass either side, and
 * each count below is that run's own:
 *
 *  - `isPlaceholder` answering false always, so documentation is
 *    refused: 7 fail, the stand-in logins, the example login, both
 *    redacted tokens, the token naming itself an example, the AWS
 *    documentation key and the Slack placeholder.
 *  - `isPlaceholder` answering true always, so nothing is a leak: 25
 *    fail — every case but the empty body and the tilde path, which
 *    assert no finding and cannot see it. That pair of survivors is
 *    why no negative case is written without its positive beside it.
 *  - the token character floor dropped to 1, keeping the word check: 2
 *    fail, both redacted tokens. The `example`-carrying token does NOT
 *    see it, which is why the two controls are written apart.
 *  - the character floor applied to an account segment as well: 1
 *    fail, the three-letter login, which a real person has.
 *  - the URL boundary dropped from the two home shapes: 1 fail, the
 *    `https://example.com/home/index` control.
 *  - the line number taken as `index` rather than `index + 1`: 5 fail,
 *    the four line-number cases and the sentence over them.
 *  - `maskedEvidence` answering the whole match: 4 fail, the two
 *    evidence cases, the sentence that must not quote the secret and
 *    the refusal asserting the same of its message.
 */
import type { LeakFinding } from './leak.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import {
  findLeaks,
  LEAK_REFUSAL_EXIT,
  leakRefusalMessage,
  MASK,
  requireNoLeak,
} from './leak.js';

/** An account name nobody here has; invented for its shape. */
const ACCOUNT = 'jrivera';

/** A token body with enough distinct characters to read as issued. */
const TOKEN_BODY = 'A7kQ2mZ9pX4tR6wB1nL8sV3dH5jF0gCyUe';

/** The same length spelled as a redaction: one character, repeated. */
const REDACTED_BODY = 'x'.repeat(TOKEN_BODY.length);

/** The kinds and shapes of every finding in `body`, in order. */
function shapesIn(body: string): readonly string[] {
  return findLeaks(body).map((finding) => `${finding.kind}:${finding.shape}`);
}

/** The line numbers of every finding in `body`, in order. */
function linesIn(body: string): readonly number[] {
  return findLeaks(body).map((finding) => finding.line);
}

/** The one finding in `body`; fails loudly when it holds none or several. */
function onlyFinding(body: string): LeakFinding {
  const findings = findLeaks(body);
  expect(findings).toHaveLength(1);
  return findings[0] as LeakFinding;
}

describe('a home path', () => {
  it('is found under a macOS home root, where a bracketed segment is not', () => {
    expect(shapesIn(`it writes to /Users/${ACCOUNT}/projects/rafa`)).toEqual(['home-path:unix-home']);
    expect(findLeaks('it writes to /Users/<name>/projects/rafa')).toEqual([]);
  });

  it('is found under a Linux home root, where a substituted segment is not', () => {
    expect(shapesIn(`cd /home/${ACCOUNT}/src`)).toEqual(['home-path:unix-home']);
    expect(findLeaks('cd /home/$USER/src')).toEqual([]);
  });

  it('is found under a Windows home root, where a substituted segment is not', () => {
    expect(shapesIn(`at C:\\Users\\${ACCOUNT}\\rafa`)).toEqual(['home-path:windows-home']);
    expect(findLeaks('at C:\\Users\\%USERNAME%\\rafa')).toEqual([]);
  });

  it('is not found for a stand-in login, where the same path with a person is', () => {
    expect(findLeaks('/home/user/src and /home/you/src and /Users/runner/work')).toEqual([]);
    expect(shapesIn(`/home/${ACCOUNT}/src`)).toEqual(['home-path:unix-home']);
  });

  it('is not found for a login spelled as an example, where a plain one is', () => {
    expect(findLeaks('/Users/example-person/projects')).toEqual([]);
    expect(shapesIn('/Users/dot.person/projects')).toEqual(['home-path:unix-home']);
  });

  it('is found for a three-letter login, which the token character floor would drop', () => {
    expect(shapesIn('/home/bob/src')).toEqual(['home-path:unix-home']);
  });

  it('is not found inside a URL path, where the same root after a space is', () => {
    expect(findLeaks('see https://example.com/home/index for the layout')).toEqual([]);
    expect(shapesIn(`see /home/index in ${ACCOUNT}`)).toEqual(['home-path:unix-home']);
  });

  it('is not found for a tilde path, which names no account', () => {
    expect(findLeaks('the store is at ~/.rafa/effort.sqlite, beside ~/.claude')).toEqual([]);
  });
});

describe('a token shape', () => {
  it('is found for a GitHub token, where a redacted one of the same length is not', () => {
    expect(shapesIn(`run with ghp_${TOKEN_BODY}`)).toEqual(['token:github-token']);
    expect(findLeaks(`run with ghp_${REDACTED_BODY}`)).toEqual([]);
  });

  it('is found for a GitHub token, where one naming itself an example is not', () => {
    expect(shapesIn(`gho_${TOKEN_BODY}`)).toEqual(['token:github-token']);
    expect(findLeaks(`gho_${TOKEN_BODY.slice(0, 8)}example${TOKEN_BODY.slice(0, 8)}`)).toEqual([]);
  });

  it('is found for a GitHub token, where a prefix with too little body is not', () => {
    expect(shapesIn(`ghs_${TOKEN_BODY}`)).toEqual(['token:github-token']);
    expect(findLeaks('ghs_A7kQ2mZ9')).toEqual([]);
  });

  it('is found for a fine-grained GitHub token, where a redacted one is not', () => {
    expect(shapesIn(`github_pat_${TOKEN_BODY}`)).toEqual(['token:github-fine-grained']);
    expect(findLeaks(`github_pat_${REDACTED_BODY}`)).toEqual([]);
  });

  it('is found for an AWS key id, where the documented example key is not', () => {
    expect(shapesIn('key AKIA7KQ2MZ9PX4TR6WB1')).toEqual(['token:aws-key-id']);
    expect(findLeaks('key AKIAIOSFODNN7EXAMPLE')).toEqual([]);
  });

  it('is found for an sk- key and its sk-ant- form, where a short sk- word is not', () => {
    expect(shapesIn(`sk-${TOKEN_BODY}`)).toEqual(['token:secret-key']);
    expect(shapesIn(`sk-ant-${TOKEN_BODY}`)).toEqual(['token:secret-key']);
    expect(findLeaks('the sk-flag and sk-A7kQ2mZ9 are not keys')).toEqual([]);
  });

  it('is found for a Slack token, where a placeholder of the same shape is not', () => {
    expect(shapesIn(`xoxb-${TOKEN_BODY}`)).toEqual(['token:slack-token']);
    expect(findLeaks('xoxb-your-token-here-please')).toEqual([]);
  });

  it('is found for a Google API key, where one four characters short is not', () => {
    expect(shapesIn(`AIza${TOKEN_BODY}1`)).toEqual(['token:google-api-key']);
    expect(findLeaks(`AIza${TOKEN_BODY.slice(0, 30)}`)).toEqual([]);
  });
});

describe('the line a finding names', () => {
  it('counts from 1, and is the line the leak sits on', () => {
    const body = ['# What you get', '', 'A plan.', `It ran under /Users/${ACCOUNT}/rafa.`].join('\n');
    expect(linesIn(body)).toEqual([4]);
    expect(linesIn(`ghp_${TOKEN_BODY}\n\nand nothing else`)).toEqual([1]);
  });

  it('is counted the same across a body with Windows line endings', () => {
    expect(linesIn(`first\r\nsecond\r\nghp_${TOKEN_BODY}`)).toEqual([3]);
  });

  it('is reported once per leak, so two on one line answer two findings', () => {
    const body = `/home/${ACCOUNT} exported ghp_${TOKEN_BODY}`;
    expect(shapesIn(body)).toEqual(['home-path:unix-home', 'token:github-token']);
    expect(linesIn(body)).toEqual([1, 1]);
  });

  it('is reported for each line of a body carrying several', () => {
    const body = [`/Users/${ACCOUNT}/a`, 'clean', `/home/${ACCOUNT}/b`, `sk-${TOKEN_BODY}`].join('\n');
    expect(linesIn(body)).toEqual([1, 3, 4]);
  });
});

describe('a body carrying nothing', () => {
  it('answers no finding, for an empty body and for a spec that mentions neither', () => {
    expect(findLeaks('')).toEqual([]);
    expect(findLeaks('# What you get\n\nA refusal, naming the line.\n')).toEqual([]);
  });
});

describe('the evidence a finding carries', () => {
  it('keeps the path root and masks the account', () => {
    const finding = onlyFinding(`/Users/${ACCOUNT}/projects`);
    expect(finding.evidence).toBe(`/Users/${MASK}`);
    expect(finding.evidence).not.toContain(ACCOUNT);
  });

  it('keeps the vendor prefix and masks the token body', () => {
    const finding = onlyFinding(`ghp_${TOKEN_BODY}`);
    expect(finding.evidence).toBe(`ghp_${MASK}`);
    expect(finding.evidence).not.toContain(TOKEN_BODY);
  });
});

describe('the refusal sentence', () => {
  const body = ['intro', `run from /Users/${ACCOUNT}`, `with ghp_${TOKEN_BODY}`].join('\n');

  it('names the source, each line and what to do, without quoting either secret', () => {
    const message = leakRefusalMessage('issue #20', findLeaks(body));
    expect(message).toContain('issue #20');
    expect(message).toContain(`line 2 holds a home path (/Users/${MASK})`);
    expect(message).toContain(`line 3 holds a token (ghp_${MASK})`);
    expect(message).toContain('the board is public');
    expect(message).not.toContain(ACCOUNT);
    expect(message).not.toContain(TOKEN_BODY);
  });

  it('refuses to be spelled for a body with no finding', () => {
    expect(() => leakRefusalMessage('issue #20', [])).toThrow(TypeError);
    expect(leakRefusalMessage('issue #20', findLeaks(body))).toContain('line 2');
  });
});

describe('the refusal itself', () => {
  it('lets a clean body through and exits 2 on one carrying a leak', () => {
    expect(requireNoLeak('issue #20', 'a body with ~/.rafa and /home/<name> in it')).toBeUndefined();
    expect(() => requireNoLeak('issue #20', `at /Users/${ACCOUNT}`)).toThrow(CommandExit);
  });

  it('carries the sentence and the exit code the spec names', () => {
    const body = `paste: ghp_${TOKEN_BODY}`;
    let thrown: unknown;
    try {
      requireNoLeak('issue #20', body);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect((thrown as CommandExit).exitCode).toBe(2);
    expect((thrown as CommandExit).message).toBe(leakRefusalMessage('issue #20', findLeaks(body)));
    expect((thrown as CommandExit).message).not.toContain(TOKEN_BODY);
  });
});

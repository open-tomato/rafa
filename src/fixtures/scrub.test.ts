/**
 * Tests for the fixture scrub (`src/fixtures/scrub.ts`).
 *
 * Every leak is planted in a text the case writes, and each case pairs
 * the planted leak the finder must report with a clean control it must
 * not, so a finder that always answered `[]` or always answered something
 * reddens here. Each scrub case first reads its input as leaking, the
 * control proving the scrub had something to take out, then reads its
 * output as clean.
 *
 * The context's roots do not exist, so the path redactor adds no
 * realpath form and each case reads only the text it names.
 */
import type { ScrubContext } from './scrub.js';

import { homedir, hostname } from 'node:os';

import { describe, expect, it } from 'bun:test';

import {
  EMAIL_MARKER,
  findLeaks,
  fixtureScrubber,
  HOST_MARKER,
  machineScrubContext,
  ScrubRefusal,
} from './scrub.js';

/** A host name no case text holds by chance. */
const HOST = 'build-box-7';

/** A planted secret: a token-shaped value under a name triage redacts. */
const TOKEN = { name: 'GITHUB_TOKEN', value: 'ghp_plantedPlantedPlanted0123' };

const CONTEXT: ScrubContext = {
  host: HOST,
  secrets: [TOKEN],
  repoRoot: '/home/alice/work/repo',
  home: '/home/alice',
};

describe('findLeaks', () => {
  it('reports a Unix and a macOS home path, and nothing over prose that says "home"', () => {
    expect(findLeaks('read /home/alice/.rafa/effort.sqlite', HOST))
      .toEqual([{ kind: 'home path', match: '/home/alice/.rafa/effort.sqlite' }]);
    expect(findLeaks('read /Users/bob/p/a.ts', HOST)).toEqual([{ kind: 'home path', match: '/Users/bob/p/a.ts' }]);
    expect(findLeaks('a store "home" directory, and /usr/local/bin/bun', HOST)).toEqual([]);
  });

  it('reports a Windows home path with its backslashes single or JSON-escaped', () => {
    expect(findLeaks('at C:\\Users\\carol\\p\\a.ts', HOST))
      .toEqual([{ kind: 'home path', match: 'C:\\Users\\carol\\p\\a.ts' }]);
    expect(findLeaks('{"path": "D:\\\\Users\\\\carol\\\\p"}', HOST))
      .toEqual([{ kind: 'home path', match: 'D:\\\\Users\\\\carol\\\\p' }]);
    expect(findLeaks('at C:\\Program Files\\bun', HOST)).toEqual([]);
  });

  it('reports an email address, a numeric first label included', () => {
    expect(findLeaks('author: Alice <alice@example.com>', HOST))
      .toEqual([{ kind: 'email address', match: 'alice@example.com' }]);
    expect(findLeaks('mail x.y+tag@163.com now', HOST)).toEqual([{ kind: 'email address', match: 'x.y+tag@163.com' }]);
  });

  it('reports no version pin as an email address', () => {
    const pins = 'pkg@1.2.3, @scope/pkg@1.2.3, typescript@5.4.0-dev.20240101, pkg@1.2.3-rc.alpha, pkg@v2.0';
    expect(findLeaks(pins, HOST)).toEqual([]);
    expect(findLeaks(`${pins}, ops@example.org`, HOST)).toEqual([{ kind: 'email address', match: 'ops@example.org' }]);
  });

  it('reports the host name as a whole name in any case, and its first label', () => {
    expect(findLeaks('minted on BUILD-BOX-7 at boot', HOST)).toEqual([{ kind: 'host name', match: 'BUILD-BOX-7' }]);
    expect(findLeaks('minted on box.local', 'box.local')).toEqual([{ kind: 'host name', match: 'box.local' }]);
    expect(findLeaks('minted on box', 'box.local')).toEqual([{ kind: 'host name', match: 'box' }]);
    expect(findLeaks('a sandbox, a box-7, a boxer', 'box')).toEqual([]);
  });

  it('reports nothing for a blank host name', () => {
    expect(findLeaks('any text at all', '')).toEqual([]);
    expect(findLeaks('any text at all', '  ')).toEqual([]);
  });

  it('reports a named secret by its name, never by its value, its trimmed form included', () => {
    const leaks = findLeaks(`token ${TOKEN.value} in a log`, HOST, [TOKEN]);
    expect(leaks).toEqual([{ kind: 'named secret', match: 'GITHUB_TOKEN' }]);
    expect(JSON.stringify(leaks)).not.toContain(TOKEN.value);
    expect(findLeaks('key sk-planted in a log', HOST, [{ name: 'ANTHROPIC_API_KEY', value: ' sk-planted\n' }]))
      .toEqual([{ kind: 'named secret', match: 'ANTHROPIC_API_KEY' }]);
    expect(findLeaks('no token here', HOST, [TOKEN, { name: 'BLANK', value: '  ' }])).toEqual([]);
  });

  it('reports every kind together in kind order, and nothing over clean anonymised text', () => {
    const dirty = `on ${HOST}, mail alice@example.com, path /home/alice/p, token ${TOKEN.value}`;
    expect(findLeaks(dirty, HOST, [TOKEN])).toEqual([
      { kind: 'home path', match: '/home/alice/p' },
      { kind: 'email address', match: 'alice@example.com' },
      { kind: 'host name', match: HOST },
      { kind: 'named secret', match: 'GITHUB_TOKEN' },
    ]);
    expect(findLeaks('anon:0123456789abcdef, 2026-09-28T10:00:00.000Z, src/a.ts', HOST, [TOKEN])).toEqual([]);
  });
});

describe('fixtureScrubber', () => {
  const scrub = fixtureScrubber(CONTEXT);

  /** `text` scrubbed, after reading it as leaking, and its output as clean. */
  function scrubbed(text: string): string {
    expect(findLeaks(text, HOST, [TOKEN])).not.toEqual([]);
    const out = scrub(text);
    expect(findLeaks(out, HOST, [TOKEN])).toEqual([]);
    return out;
  }

  it('writes a path under the repository relative, and the home as the marker', () => {
    expect(scrubbed('failed in /home/alice/work/repo/src/a.ts:12')).toBe('failed in src/a.ts:12');
    expect(scrubbed('ran ~ as /home/alice/.bun/bin/bun')).toBe('ran ~ as [redacted: HOME]/.bun/bin/bun');
  });

  it('writes a home path the path redactor leaves as the marker, the rest of the path kept', () => {
    expect(scrubbed('copied to /home/bob/p/a.ts')).toBe('copied to [redacted: HOME]/p/a.ts');
    expect(scrubbed('a relative src/home/bob/x.ts')).toBe('a relative src[redacted: HOME]/x.ts');
    expect(scrubbed('at C:\\Users\\carol\\p\\a.ts')).toBe('at [redacted: HOME]\\p\\a.ts');
    expect(scrubbed('{"p": "C:\\\\Users\\\\carol\\\\p"}')).toBe('{"p": "[redacted: HOME]\\\\p"}');
  });

  it('writes an email address as the marker, and leaves a version pin as it is', () => {
    expect(scrubbed('Co-Authored-By: Alice <alice@example.com>')).toBe(`Co-Authored-By: Alice <${EMAIL_MARKER}>`);
    const pins = 'bumped pkg@1.2.3 and @scope/pkg@1.2.3-rc.alpha';
    expect(scrub(pins)).toBe(pins);
    expect(scrubbed(`${pins} for ops@example.org`)).toBe(`${pins} for ${EMAIL_MARKER}`);
  });

  it('writes the host name as the marker, in any case, and leaves a longer word holding it', () => {
    expect(scrubbed(`minted on ${HOST} and Build-Box-7.local`)).toBe(`minted on ${HOST_MARKER} and ${HOST_MARKER}.local`);
    expect(scrub('build-box-70 is another machine')).toBe('build-box-70 is another machine');
  });

  it('writes a named secret as its marker, before the address or path it holds', () => {
    expect(scrubbed(`token ${TOKEN.value} sent`)).toBe('token [redacted: GITHUB_TOKEN] sent');
    const scrubSecretMail = fixtureScrubber({ ...CONTEXT, secrets: [{ name: 'MAIL_SECRET', value: 'me@example.com' }] });
    expect(scrubSecretMail('sent as me@example.com')).toBe('sent as [redacted: MAIL_SECRET]');
  });

  it('leaves clean text exactly as it is', () => {
    const clean = 'anon:0123456789abcdef, 2026-09-28T10:00:00.000Z, src/a.ts, pkg@1.2.3';
    expect(findLeaks(clean, HOST, [TOKEN])).toEqual([]);
    expect(scrub(clean)).toBe(clean);
  });

  it('refuses when a marker one step writes names the host', () => {
    const scrubOnHost = fixtureScrubber({ ...CONTEXT, host: 'host' });
    expect(() => scrubOnHost('deployed from host')).toThrow(ScrubRefusal);
    expect(() => scrubOnHost('deployed from host')).toThrow('refusing to write: host name "HOST" left after redaction');
  });

  it('refuses when a marker one step writes holds a secret, naming the secret and not its value', () => {
    const secret = { name: 'PLANTED_SECRET', value: 'EMAIL' };
    const scrubWithSecret = fixtureScrubber({ ...CONTEXT, secrets: [secret] });
    let refusal: unknown = null;
    try {
      scrubWithSecret('EMAIL went to alice@example.com');
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ScrubRefusal);
    expect((refusal as ScrubRefusal).leaks).toEqual([{ kind: 'named secret', match: 'PLANTED_SECRET' }]);
    expect((refusal as ScrubRefusal).message).not.toContain(secret.value);
  });
});

describe('machineScrubContext', () => {
  it('names the running machine and the secrets the environment holds', () => {
    const context = machineScrubContext('/repo', { GITHUB_TOKEN: TOKEN.value, LINEAR_API_KEY: '', OTHER: 'x' });
    expect(context).toEqual({ host: hostname(), secrets: [TOKEN], repoRoot: '/repo', home: homedir() });
  });
});

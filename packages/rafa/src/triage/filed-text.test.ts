/**
 * Tests for what every filed text shares
 * (`packages/rafa/src/triage/filed-text.ts`): the secrets a config and an
 * environment name, and their redaction out of a text.
 */
import type { NamedSecret } from './filed-text.js';

import { describe, expect, it } from 'bun:test';

import { namedSecrets, redactSecrets } from './filed-text.js';

describe('namedSecrets', () => {
  it('names every env prerequisite of both tiers, then each token variable that is set', () => {
    const config = {
      prerequisitesRequired: [
        { kind: 'env', name: 'DB_URL', probe: null },
        { kind: 'tool', name: 'bun', probe: null },
      ],
      prerequisitesOptional: [
        { kind: 'env', name: 'SENTRY_DSN', probe: null, reason: null },
        { kind: 'env', name: 'GITHUB_TOKEN', probe: null, reason: null },
      ],
    } as const;
    const env = {
      DB_URL: 'postgres://u:p@h/app',
      SENTRY_DSN: 'dsn-1',
      GITHUB_TOKEN: 'ghp_token',
      ANTHROPIC_API_KEY: 'sk-ant-key',
      bun: 'a tool, not a secret',
    };

    expect(namedSecrets(config, env)).toEqual([
      { name: 'DB_URL', value: 'postgres://u:p@h/app' },
      { name: 'SENTRY_DSN', value: 'dsn-1' },
      { name: 'GITHUB_TOKEN', value: 'ghp_token' },
      { name: 'ANTHROPIC_API_KEY', value: 'sk-ant-key' },
    ]);
  });

  it('names nothing for a variable unset, empty or blank', () => {
    const config = {
      prerequisitesRequired: [{ kind: 'env', name: 'EMPTY', probe: null }],
      prerequisitesOptional: [{ kind: 'env', name: 'BLANK', probe: null, reason: null }],
    } as const;

    expect(namedSecrets(config, { EMPTY: '', BLANK: '  \n', LINEAR_API_KEY: undefined })).toEqual([]);
    expect(namedSecrets(config, { LINEAR_API_KEY: 'lin_key' })).toEqual([
      { name: 'LINEAR_API_KEY', value: 'lin_key' },
    ]);
  });
});

describe('redactSecrets', () => {
  it('replaces every occurrence of each value, and the longer of two overlapping values whole', () => {
    const secrets: NamedSecret[] = [{ name: 'SHORT', value: 'abc' }, { name: 'LONG', value: 'abcdef' }];

    expect(redactSecrets('x abcdef y abc z abc', secrets))
      .toBe('x [redacted: LONG] y [redacted: SHORT] z [redacted: SHORT]');
  });

  it('matches a value trimmed as well, and never a marker it wrote', () => {
    const secrets: NamedSecret[] = [
      { name: 'PADDED', value: 'tok-123\n' },
      { name: 'WORD', value: 'redacted' },
    ];

    expect(redactSecrets('a tok-123\n b tok-123 c redacted', secrets))
      .toBe('a [redacted: PADDED] b [redacted: PADDED] c [redacted: WORD]');
  });

  it('matches regular expression characters literally', () => {
    const secrets: NamedSecret[] = [{ name: 'DOTTED', value: 'a.b+' }];

    expect(redactSecrets('axbb stays, a.b+ goes', secrets)).toBe('axbb stays, [redacted: DOTTED] goes');
  });

  it('answers the text unchanged with no secrets', () => {
    expect(redactSecrets('nothing to take out', [])).toBe('nothing to take out');
  });
});

import { describe, expect, test } from 'bun:test';

import { gitIdentityEnv } from './git-identity.js';

describe('gitIdentityEnv', () => {
  test('answers the four author and committer variables and nothing else', () => {
    const env = gitIdentityEnv();

    expect(Object.keys(env).sort()).toEqual([
      'GIT_AUTHOR_EMAIL',
      'GIT_AUTHOR_NAME',
      'GIT_COMMITTER_EMAIL',
      'GIT_COMMITTER_NAME',
    ]);
  });

  test('names one fixed test identity at an example.test address', () => {
    const env = gitIdentityEnv();

    expect(env['GIT_AUTHOR_NAME']).toBe(env['GIT_COMMITTER_NAME']);
    expect(env['GIT_AUTHOR_EMAIL']).toBe(env['GIT_COMMITTER_EMAIL']);
    expect(env['GIT_AUTHOR_NAME']).not.toBe('');
    expect(env['GIT_AUTHOR_EMAIL']).toMatch(/^[^@\s]+@example\.test$/);
  });

  test('answers a new object on each call', () => {
    expect(gitIdentityEnv()).not.toBe(gitIdentityEnv());
    expect(gitIdentityEnv()).toEqual(gitIdentityEnv());
  });
});

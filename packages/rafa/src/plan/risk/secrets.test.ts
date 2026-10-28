/**
 * Tests for the secret-name scan.
 *
 * The planted-value test stands beside a control: the same scan over the
 * same environment does report `FAKE_TOKEN`, so its silence about
 * `abc123` is the scan not reading values, not the scan reading nothing.
 */

import { describe, expect, it } from 'bun:test';

import { SECRET_NAME_SHAPES, scanSecretNames, secretShapesOf } from './secrets.js';

describe('secretShapesOf', () => {
  it.each([
    ['GITHUB_TOKEN', '*_TOKEN'],
    ['OPENAI_API_KEY', '*_KEY'],
    ['CLIENT_SECRET', '*_SECRET'],
    ['DB_PASSWORD_FILE', '*PASSWORD*'],
    ['AWS_REGION', 'AWS_*'],
  ])('reports %s as %s', (name, shape) => {
    expect(secretShapesOf(name).map((s) => s.name)).toContain(shape);
  });

  it.each(['TOKEN_PATH', 'KEYBOARD', 'SECRETARY', 'MY_AWS', 'github_token', 'PATH', 'HOME'])(
    'reports nothing for %s',
    (name) => {
      expect(secretShapesOf(name)).toEqual([]);
    },
  );

  it('carries every shape the spec names', () => {
    expect(SECRET_NAME_SHAPES.map((s) => s.name)).toEqual([
      '*_TOKEN', '*_KEY', '*_SECRET', '*PASSWORD*', 'AWS_*',
    ]);
  });
});

describe('scanSecretNames', () => {
  it('reports each matching name once as a note, sorted, with every shape it matches', () => {
    const findings = scanSecretNames({
      PATH: '/bin', AWS_SECRET_ACCESS_KEY: 'x', GITHUB_TOKEN: 'y', HOME: '/h',
    });

    expect(findings).toEqual([
      {
        level: 'note',
        kind: 'secret',
        text: 'AWS_SECRET_ACCESS_KEY — matches *_KEY, AWS_*',
        subject: 'AWS_SECRET_ACCESS_KEY',
      },
      { level: 'note', kind: 'secret', text: 'GITHUB_TOKEN — matches *_TOKEN', subject: 'GITHUB_TOKEN' },
    ]);
  });

  it('never carries a planted value into any finding', () => {
    const findings = scanSecretNames({ FAKE_TOKEN: 'abc123', PATH: '/bin' });

    expect(findings.map((f) => f.subject)).toEqual(['FAKE_TOKEN']);
    expect(JSON.stringify(findings)).not.toContain('abc123');
    for (const finding of findings) {
      expect(Object.values(finding).join('\n')).not.toContain('abc123');
    }
  });

  it('reads no value: a getter on a value is never called', () => {
    let reads = 0;
    const environment = {};
    Object.defineProperty(environment, 'FAKE_TOKEN', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'abc123';
      },
    });

    expect(scanSecretNames(environment)).toHaveLength(1);
    expect(reads).toBe(0);
  });

  it('reports nothing for an environment with no secret names', () => {
    expect(scanSecretNames({ PATH: '/bin', HOME: '/h' })).toEqual([]);
  });
});

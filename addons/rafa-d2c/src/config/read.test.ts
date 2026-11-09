import { describe, expect, it } from 'bun:test';

import { D2cConfigError, readD2cConfig } from './read.js';

/** The spec's example, with a neutral absolute store folder. */
const EXAMPLE = `
visual:
  suite:
    kind: storybook-jest
    package: packages/ui
    snapshots: visual/__image_snapshots__
    diffs: visual/__diff_output__
    report: visual-report.json
    command: bun run test:visual
  runner:
    kind: host
  store:
    kind: side-repo
    dir: /srv/baselines/example
    set: packages-ui
`;

/** The problems a refusal names, or a failure when nothing is refused. */
function problemsOf(raw: unknown): readonly string[] {
  try {
    readD2cConfig(raw);
  } catch (error) {
    if (error instanceof D2cConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected a refusal');
}

/** The example with one change made at a dotted path. */
function exampleWith(path: string, value: unknown): unknown {
  const raw = Bun.YAML.parse(EXAMPLE) as Record<string, unknown>;
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  let at: Record<string, unknown> = raw;
  for (const key of keys) at = at[key] as Record<string, unknown>;
  if (value === undefined) delete at[last];
  else at[last] = value;
  return raw;
}

describe('readD2cConfig', () => {
  it('reads the spec example and fills the index default', () => {
    const config = readD2cConfig(Bun.YAML.parse(EXAMPLE));

    expect(config.visual.suite).toEqual({
      kind: 'storybook-jest',
      package: 'packages/ui',
      snapshots: 'visual/__image_snapshots__',
      diffs: 'visual/__diff_output__',
      report: 'visual-report.json',
      index: 'storybook-static/index.json',
      command: 'bun run test:visual',
    });
    expect(config.visual.runner).toEqual({ kind: 'host' });
    expect(config.visual.store).toEqual({ kind: 'side-repo', dir: '/srv/baselines/example', set: 'packages-ui' });
  });

  it('fills the suite path defaults when left out', () => {
    const raw = Bun.YAML.parse(EXAMPLE) as { visual: { suite: Record<string, unknown> } };
    raw.visual.suite = { kind: 'storybook-jest', package: 'packages/ui', command: 'bun run test:visual' };
    const { suite } = readD2cConfig(raw).visual;

    expect([suite.snapshots, suite.diffs, suite.report, suite.index]).toEqual([
      'visual/__image_snapshots__',
      'visual/__diff_output__',
      'visual-report.json',
      'storybook-static/index.json',
    ]);
  });

  it('refuses a suite without its command', () => {
    expect(problemsOf(exampleWith('visual.suite.command', undefined))).toEqual(['visual.suite.command is missing']);
  });

  it('refuses an unknown key, naming its path', () => {
    const raw = exampleWith('visual.store.dri', '/x');

    expect(problemsOf(raw).join('\n')).toContain('visual.store.dri');
  });

  it('refuses a relative store dir', () => {
    expect(problemsOf(exampleWith('visual.store.dir', 'baselines')).join('\n')).toContain('visual.store.dir');
  });

  it('refuses a suite path that leaves the project or is absolute', () => {
    expect(problemsOf(exampleWith('visual.suite.package', '../other')).join('\n')).toContain('visual.suite.package');
    expect(problemsOf(exampleWith('visual.suite.snapshots', '/tmp/shots')).join('\n')).toContain('visual.suite.snapshots');
  });

  it('refuses a set that is not one path segment', () => {
    for (const set of ['a/b', '..', '.staging', '']) {
      expect(problemsOf(exampleWith('visual.store.set', set)).join('\n')).toContain('visual.store.set');
    }
  });

  it('refuses dir under same-repo', () => {
    const raw = exampleWith('visual.store.kind', 'same-repo');

    expect(problemsOf(raw).join('\n')).toContain('visual.store.dir');
  });

  it('reads same-repo without a dir', () => {
    const raw = exampleWith('visual.store', { kind: 'same-repo', set: 'packages-ui' });

    expect(readD2cConfig(raw).visual.store).toEqual({ kind: 'same-repo', set: 'packages-ui' });
  });

  it('refuses a side-repo without a dir', () => {
    expect(problemsOf(exampleWith('visual.store.dir', undefined))).toEqual(['visual.store.dir is missing']);
  });

  it('refuses a remote runner missing workdir', () => {
    const raw = exampleWith('visual.runner', { kind: 'remote', host: 'builder', command: 'run-visual' });

    expect(problemsOf(raw).join('\n')).toContain('visual.runner.workdir');
  });

  it('reads a remote runner with its three settings', () => {
    const runner = { kind: 'remote', host: 'builder', workdir: '/work', command: 'run-visual' };

    expect(readD2cConfig(exampleWith('visual.runner', runner)).visual.runner).toEqual(runner);
  });

  it('refuses an unknown runner kind, naming the allowed kinds', () => {
    const text = problemsOf(exampleWith('visual.runner.kind', 'container-x')).join('\n');

    expect(text).toContain('visual.runner.kind');
    expect(text).toContain('host, container, remote');
  });

  it('collects every problem in one pass', () => {
    const raw = Bun.YAML.parse(EXAMPLE) as { visual: Record<string, Record<string, unknown>> };
    raw.visual['suite'] = { ...raw.visual['suite'], kind: 'playwright' };
    raw.visual['runner'] = { kind: 'cloud' };
    raw.visual['store'] = { ...raw.visual['store'], dir: 'relative' };

    expect(problemsOf(raw)).toHaveLength(3);
  });

  it('reads __proto__ as a key like any other', () => {
    const raw = JSON.parse('{"visual":{"__proto__":{"x":1}}}') as unknown;

    expect(problemsOf(raw).join('\n')).toContain('visual.__proto__');
  });

  it('refuses a document that is not a mapping', () => {
    expect(problemsOf(['a list'])).toEqual(['the file is a list, expected a mapping with a visual key']);
  });
});

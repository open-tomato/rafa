/**
 * Tests for `assembleContext` (`src/cli/core/assembleContext.ts`).
 *
 * The source's suite, open-tomato's
 * `packages/shared/cli-core/src/assembleContext.test.ts` at commit
 * `5f337e0c79d8701ac4521df2771e673a5a896f39` (2026-06-25), is ported to
 * `bun:test` case for case, with `RAFA_OUTPUT` and `RAFA_VERBOSITY` where
 * it spells `TOMATO_OUTPUT` and `TOMATO_VERBOSITY`.
 *
 * The cases after it hold what the copy changes. The tomato names read
 * as nothing, the control that the rafa names are the ones read. A
 * command spec reaches `args` and `flags`, while the output mode and the
 * verbosity are still read off the line as it was typed. The output made
 * writes to the stream handed in, or to `process.stdout`, at the
 * verbosity resolved.
 *
 * Thirteen mutations of `assembleContext.ts` were driven on 2026-09-14,
 * as `parseArgs.test.ts` records of its module, and every one reddened at
 * least one case: `TOMATO_VERBOSITY` read 6, `TOMATO_OUTPUT` read 3, the
 * spec left off `args` and `flags` 3, the modes swapped 3, `flags` left
 * unfrozen 3, the settings read with the spec's defaults 2 and through a
 * `typedOnly` keeping them 2, the context left unfrozen 2,
 * `forceOutputMode` ignored 2, and one each for the settings read without
 * the spec's aliases, the text output made at verbosity 0,
 * `process.stderr` as the default stream, and `env` frozen in place of a
 * copy.
 */
import type { ParseArgsSpec } from './parseArgs.js';
import type { ArgSpec, FlagSpec } from './types.js';
import type { OutputStream } from '../../adapters/output/stream.js';

import { describe, expect, it, spyOn } from 'bun:test';

import { assembleContext } from './assembleContext.js';

const silentStream: OutputStream = {
  write(): unknown {
    return true;
  },
};

describe('assembleContext outputMode resolution', () => {
  it('defaults to text mode when no flag, env, or force is provided', () => {
    const context = assembleContext({
      argv: ['svc', 'validate'],
      env: {},
      stream: silentStream,
    });

    expect(context.outputMode).toBe('text');
  });

  it('uses --output=json flag to select json mode', () => {
    const context = assembleContext({
      argv: ['svc', '--output=json'],
      env: {},
      stream: silentStream,
    });

    expect(context.outputMode).toBe('json');
  });

  it('uses RAFA_OUTPUT=json env var when no flag is provided', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: { RAFA_OUTPUT: 'json' },
      stream: silentStream,
    });

    expect(context.outputMode).toBe('json');
  });

  it('--output flag wins over RAFA_OUTPUT env var', () => {
    const context = assembleContext({
      argv: ['svc', '--output=text'],
      env: { RAFA_OUTPUT: 'json' },
      stream: silentStream,
    });

    expect(context.outputMode).toBe('text');
  });

  it('--output=json flag wins over RAFA_OUTPUT=text env var', () => {
    const context = assembleContext({
      argv: ['svc', '--output=json'],
      env: { RAFA_OUTPUT: 'text' },
      stream: silentStream,
    });

    expect(context.outputMode).toBe('json');
  });

  it('forceOutputMode arg wins over --output flag and env var', () => {
    const context = assembleContext({
      argv: ['svc', '--output=json'],
      env: { RAFA_OUTPUT: 'json' },
      forceOutputMode: 'text',
      stream: silentStream,
    });

    expect(context.outputMode).toBe('text');
  });

  it('forceOutputMode=json overrides --output=text and env=text', () => {
    const context = assembleContext({
      argv: ['svc', '--output=text'],
      env: { RAFA_OUTPUT: 'text' },
      forceOutputMode: 'json',
      stream: silentStream,
    });

    expect(context.outputMode).toBe('json');
  });
});

describe('assembleContext verbosity resolution', () => {
  it('defaults to verbosity 0 with no flags or env', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: {},
      stream: silentStream,
    });

    expect(context.verbosity).toBe(0);
  });

  it('clamps repeated -v tokens above 3 down to 3', () => {
    const context = assembleContext({
      argv: ['-v', '-v', '-v', '-v', '-v'],
      env: {},
      stream: silentStream,
    });

    expect(context.verbosity).toBe(3);
  });

  it('clamps --verbose=99 down to 3', () => {
    const context = assembleContext({
      argv: ['--verbose=99'],
      env: {},
      stream: silentStream,
    });

    expect(context.verbosity).toBe(3);
  });

  it('clamps a negative RAFA_VERBOSITY down to 0', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: { RAFA_VERBOSITY: '-5' },
      stream: silentStream,
    });

    expect(context.verbosity).toBe(0);
  });

  it('uses RAFA_VERBOSITY when no verbose flag is provided', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: { RAFA_VERBOSITY: '2' },
      stream: silentStream,
    });

    expect(context.verbosity).toBe(2);
  });

  it('clamps RAFA_VERBOSITY=10 down to 3', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: { RAFA_VERBOSITY: '10' },
      stream: silentStream,
    });

    expect(context.verbosity).toBe(3);
  });

  it('parses single -v as verbosity 1', () => {
    const context = assembleContext({
      argv: ['-v', '--env=staging'],
      env: {},
      stream: silentStream,
    });

    expect(context.verbosity).toBe(1);
  });
});

describe('assembleContext returns a frozen context', () => {
  it('freezes the top-level context object', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: {},
      stream: silentStream,
    });

    expect(Object.isFrozen(context)).toBe(true);
  });

  it('freezes the flags object', () => {
    const context = assembleContext({
      argv: ['--env=staging'],
      env: {},
      stream: silentStream,
    });

    expect(Object.isFrozen(context.flags)).toBe(true);
  });

  it('freezes the args array', () => {
    const context = assembleContext({
      argv: ['svc', 'validate'],
      env: {},
      stream: silentStream,
    });

    expect(Object.isFrozen(context.args)).toBe(true);
  });

  it('freezes the env object', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: { RAFA_OUTPUT: 'text' },
      stream: silentStream,
    });

    expect(Object.isFrozen(context.env)).toBe(true);
  });

  it('throws when mutating an existing flag property in strict mode', () => {
    const context = assembleContext({
      argv: ['--env=staging'],
      env: {},
      stream: silentStream,
    });

    expect(() => {
      (context.flags as Record<string, string | boolean>).env = 'production';
    }).toThrow(TypeError);
  });

  it('throws when adding a new flag property in strict mode', () => {
    const context = assembleContext({
      argv: ['--env=staging'],
      env: {},
      stream: silentStream,
    });

    expect(() => {
      (context.flags as Record<string, string | boolean>).newFlag = 'value';
    }).toThrow(TypeError);
  });

  it('throws when reassigning context.outputMode in strict mode', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: {},
      stream: silentStream,
    });

    expect(() => {
      (context as { outputMode: 'text' | 'json' }).outputMode = 'json';
    }).toThrow(TypeError);
  });
});

describe('assembleContext signal handling', () => {
  it('uses the provided AbortSignal when one is passed in', () => {
    const controller = new AbortController();
    const context = assembleContext({
      argv: ['svc'],
      env: {},
      signal: controller.signal,
      stream: silentStream,
    });

    expect(context.signal).toBe(controller.signal);
  });

  it('provides a default AbortSignal when none is passed in', () => {
    const context = assembleContext({
      argv: ['svc'],
      env: {},
      stream: silentStream,
    });

    expect(context.signal).toBeInstanceOf(AbortSignal);
    expect(context.signal.aborted).toBe(false);
  });
});

/** A flag spec of type `string`, with whatever else is given. */
function flag(name: string, extra: Partial<FlagSpec> = {}): FlagSpec {
  return { name, description: `The ${name} flag.`, type: 'string', ...extra };
}

/** An argument spec of type `string`, with whatever else is given. */
function arg(name: string, extra: Partial<ArgSpec> = {}): ArgSpec {
  return { name, description: `The ${name} argument.`, type: 'string', ...extra };
}

/** A stream keeping every chunk written to it. */
function memoryStream(): { stream: OutputStream; chunks: string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk: string): unknown => chunks.push(chunk),
    },
    chunks,
  };
}

describe('assembleContext environment names', () => {
  it('reads nothing from TOMATO_OUTPUT', () => {
    const context = assembleContext({ argv: ['svc'], env: { TOMATO_OUTPUT: 'json' }, stream: silentStream });

    expect(context.outputMode).toBe('text');
  });

  it('reads nothing from TOMATO_VERBOSITY', () => {
    const context = assembleContext({ argv: ['svc'], env: { TOMATO_VERBOSITY: '2' }, stream: silentStream });

    expect(context.verbosity).toBe(0);
  });

  it('selects json mode from RAFA_OUTPUT only when it reads exactly json', () => {
    const modes = ['JSON', ' json', 'text', ''].map((value) => assembleContext({
      argv: ['svc'],
      env: { RAFA_OUTPUT: value },
      stream: silentStream,
    }).outputMode);

    expect(modes).toEqual(['text', 'text', 'text', 'text']);
  });
});

describe('assembleContext flag spellings', () => {
  it('reads --output json in its space-separated form', () => {
    const context = assembleContext({ argv: ['--output', 'json'], env: {}, stream: silentStream });

    expect(context.outputMode).toBe('json');
  });

  it('reads a numeric --verbose value over RAFA_VERBOSITY', () => {
    const context = assembleContext({ argv: ['--verbose=1'], env: { RAFA_VERBOSITY: '3' }, stream: silentStream });

    expect(context.verbosity).toBe(1);
  });

  it('counts the bare -v and --verbose tokens before the -- marker', () => {
    const context = assembleContext({ argv: ['-v', '--verbose', '--', '-v'], env: {}, stream: silentStream });

    expect(context.verbosity).toBe(2);
    expect(context.args).toEqual(['-v']);
  });

  it('falls back to RAFA_VERBOSITY when --verbose carries no number', () => {
    const context = assembleContext({ argv: ['--verbose=loud'], env: { RAFA_VERBOSITY: '2' }, stream: silentStream });

    expect(context.verbosity).toBe(2);
  });

  it('takes the word after a bare -v as its value, not as a positional word', () => {
    const context = assembleContext({ argv: ['-v', 'plan', 'list'], env: { RAFA_VERBOSITY: '2' }, stream: silentStream });

    expect(context.verbosity).toBe(2);
    expect(context.args).toEqual(['list']);
    expect(context.flags).toEqual({ v: 'plan' });
  });
});

describe('assembleContext with a command spec', () => {
  const spec: ParseArgsSpec = {
    args: [arg('stub', { default: 'current' })],
    flags: [flag('plan', { aliases: ['p'] }), flag('inject', { default: 'full' })],
  };

  it('hands over args and flags with aliases resolved and defaults filled', () => {
    const context = assembleContext({ argv: ['-p', 'PLAN.md'], env: {}, stream: silentStream, spec });

    expect(context.args).toEqual(['current']);
    expect(context.flags).toEqual({ plan: 'PLAN.md', inject: 'full' });
  });

  it('hands over the flags as typed when no spec is handed', () => {
    const context = assembleContext({ argv: ['-p', 'PLAN.md'], env: {}, stream: silentStream });

    expect(context.args).toEqual([]);
    expect(context.flags).toEqual({ p: 'PLAN.md' });
  });

  it('keeps a declared output default from masking RAFA_OUTPUT', () => {
    const context = assembleContext({
      argv: [],
      env: { RAFA_OUTPUT: 'json' },
      stream: silentStream,
      spec: { flags: [flag('output', { default: 'text' })] },
    });

    expect(context.outputMode).toBe('json');
    expect(context.flags).toEqual({ output: 'text' });
  });

  it('reads the output mode through a declared alias of output', () => {
    const context = assembleContext({
      argv: ['-o', 'json'],
      env: {},
      stream: silentStream,
      spec: { flags: [flag('output', { aliases: ['o'], default: 'text' })] },
    });

    expect(context.outputMode).toBe('json');
  });

  it('counts no declared alias of verbose as a bare verbose token', () => {
    const verboseSpec: ParseArgsSpec = { flags: [flag('verbose', { type: 'boolean', aliases: ['V'] })] };

    expect(assembleContext({ argv: ['-V'], env: {}, stream: silentStream, spec: verboseSpec }).verbosity).toBe(0);
    expect(assembleContext({ argv: ['--verbose'], env: {}, stream: silentStream, spec: verboseSpec }).verbosity).toBe(1);
  });

  it('throws the TypeError parseArgs refuses a spec with', () => {
    expect(() => assembleContext({
      argv: ['a'],
      env: {},
      stream: silentStream,
      spec: { args: [arg('stub', { aliases: ['s'] })] },
    })).toThrow('parseArgs: argument "stub" declares aliases');
  });

  it('keeps a declared verbose default from raising the verbosity', () => {
    const context = assembleContext({
      argv: [],
      env: { RAFA_VERBOSITY: '1' },
      stream: silentStream,
      spec: { flags: [flag('verbose', { default: '3' })] },
    });

    expect(context.verbosity).toBe(1);
  });
});

describe('assembleContext output', () => {
  it('writes NDJSON events to the stream in json mode', () => {
    const { stream, chunks } = memoryStream();
    const context = assembleContext({ argv: ['--output=json'], env: {}, stream });

    context.output.info('hello');

    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0] ?? '')).toMatchObject({ type: 'log', level: 'info', message: 'hello' });
  });

  it('writes text lines at the verbosity resolved in text mode', () => {
    const quiet = memoryStream();
    const loud = memoryStream();

    assembleContext({ argv: ['-v'], env: {}, stream: quiet.stream }).output.debug('detail');
    assembleContext({ argv: ['-v', '-v'], env: {}, stream: loud.stream }).output.debug('detail');

    expect(quiet.chunks).toEqual([]);
    expect(loud.chunks).toEqual(['debug: detail\n']);
  });

  it('writes to process.stdout when no stream is handed', () => {
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      assembleContext({ argv: [], env: {} }).output.info('through stdout');

      expect(write.mock.calls).toEqual([['through stdout\n']]);
    } finally {
      write.mockRestore();
    }
  });

  it('copies env, so a later change to the object handed in does not reach the context', () => {
    const env: Record<string, string | undefined> = { RAFA_OUTPUT: 'text' };
    const context = assembleContext({ argv: [], env, stream: silentStream });

    env.RAFA_OUTPUT = 'json';

    expect(context.env).toEqual({ RAFA_OUTPUT: 'text' });
  });
});

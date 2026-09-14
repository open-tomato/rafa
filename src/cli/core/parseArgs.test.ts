/**
 * Tests for `parseArgs` (`src/cli/core/parseArgs.ts`).
 *
 * The source's suite, open-tomato's
 * `packages/shared/cli-core/src/parseArgs.test.ts` at commit
 * `931c7d8f2d5c821d5761c755444101a45fd3cd1e` (2026-06-25), is ported to
 * `bun:test` case for case, each case still calling `parseArgs` with no
 * spec: with none, the copy answers what the source answers.
 *
 * The cases after it hold what the copy adds: a declared flag's aliases,
 * the defaults a spec declares, and the refusals of a spec naming one
 * spelling twice or an alias for a positional argument. Each alias case
 * carries its own control, the same line read with no spec, so a case
 * cannot pass on a parse that ignores the spec.
 *
 * Measured on 2026-09-14. Against the source's function copied as it is,
 * every ported case passed, and 27 of the 109 cases then written across
 * this file and `assembleContext.test.ts` failed, each a case of the
 * wiring or of the rafa environment names. Fourteen mutations of
 * `parseArgs.ts` were then driven against `src/cli/core/`, one run each,
 * with 125 pass before and after and the module restored byte-identical
 * (sha256), and every one reddened at least one case: aliases left
 * unresolved 10, the first value winning 8, an empty argument alias list
 * refused 8, a collision left unrefused 2, argument aliases left
 * unrefused 2, and one each for a default's presence read as `undefined`,
 * a default over a typed value, a number default kept a number, positional
 * defaults filled past a gap, a positional default left unconverted, names
 * and aliases claimed in one pass, an alias of its own name refused, a
 * one-dash `-no-` negated, and the negation read before the `=`.
 */
import type { ParseArgsSpec } from './parseArgs.js';
import type { ArgSpec, FlagSpec } from './types.js';

import { describe, expect, it } from 'bun:test';

import { parseArgs } from './parseArgs.js';

describe('parseArgs --flag=value syntax', () => {
  it('parses a single --flag=value assignment', () => {
    const result = parseArgs(['--env=staging']);

    expect(result.flags).toEqual({ env: 'staging' });
    expect(result.positional).toEqual([]);
  });

  it('parses multiple --flag=value assignments', () => {
    const result = parseArgs(['--env=staging', '--region=us-east-1']);

    expect(result.flags).toEqual({ env: 'staging', region: 'us-east-1' });
    expect(result.positional).toEqual([]);
  });

  it('preserves positional args alongside --flag=value', () => {
    const result = parseArgs(['svc', '--env=staging', 'validate']);

    expect(result.flags).toEqual({ env: 'staging' });
    expect(result.positional).toEqual(['svc', 'validate']);
  });

  it('treats the value as a string even when it parses as a number', () => {
    const result = parseArgs(['--port=8080']);

    expect(result.flags).toEqual({ port: '8080' });
  });

  it('accepts an empty value after the equals sign', () => {
    const result = parseArgs(['--label=']);

    expect(result.flags).toEqual({ label: '' });
  });

  it('keeps additional equals signs inside the value', () => {
    const result = parseArgs(['--filter=key=value']);

    expect(result.flags).toEqual({ filter: 'key=value' });
  });
});

describe('parseArgs --flag value (space-separated) syntax', () => {
  it('parses a single space-separated --flag value pair', () => {
    const result = parseArgs(['--env', 'staging']);

    expect(result.flags).toEqual({ env: 'staging' });
    expect(result.positional).toEqual([]);
  });

  it('parses multiple space-separated --flag value pairs', () => {
    const result = parseArgs(['--env', 'staging', '--region', 'us-east-1']);

    expect(result.flags).toEqual({ env: 'staging', region: 'us-east-1' });
    expect(result.positional).toEqual([]);
  });

  it('preserves positional args alongside space-separated flags', () => {
    const result = parseArgs(['svc', '--env', 'staging', 'validate']);

    expect(result.flags).toEqual({ env: 'staging' });
    expect(result.positional).toEqual(['svc', 'validate']);
  });

  it('keeps an = inside a space-separated value', () => {
    const result = parseArgs(['--filter', 'key=value']);

    expect(result.flags).toEqual({ filter: 'key=value' });
  });

  it('treats the value as a string even when it parses as a number', () => {
    const result = parseArgs(['--port', '8080']);

    expect(result.flags).toEqual({ port: '8080' });
  });

  it('mixes --flag=value and --flag value forms in one argv', () => {
    const result = parseArgs(['--env=staging', '--region', 'us-east-1']);

    expect(result.flags).toEqual({ env: 'staging', region: 'us-east-1' });
    expect(result.positional).toEqual([]);
  });

  it('does not consume a following flag as a value', () => {
    const result = parseArgs(['--env', '--region', 'us-east-1']);

    expect(result.flags).toEqual({ env: true, region: 'us-east-1' });
    expect(result.positional).toEqual([]);
  });
});

describe('parseArgs boolean flag syntax', () => {
  it('parses a single bare --flag as true', () => {
    const result = parseArgs(['--verbose']);

    expect(result.flags).toEqual({ verbose: true });
    expect(result.positional).toEqual([]);
  });

  it('parses multiple bare --flag arguments as true', () => {
    const result = parseArgs(['--verbose', '--debug']);

    expect(result.flags).toEqual({ verbose: true, debug: true });
    expect(result.positional).toEqual([]);
  });

  it('treats a trailing --flag at the end of argv as boolean true', () => {
    const result = parseArgs(['svc', '--verbose']);

    expect(result.flags).toEqual({ verbose: true });
    expect(result.positional).toEqual(['svc']);
  });

  it('mixes boolean flags with --flag=value forms', () => {
    const result = parseArgs(['--verbose', '--env=staging']);

    expect(result.flags).toEqual({ verbose: true, env: 'staging' });
    expect(result.positional).toEqual([]);
  });

  it('treats a flag followed by another flag as boolean true', () => {
    const result = parseArgs(['--verbose', '--env=staging', '--region', 'us-east-1']);

    expect(result.flags).toEqual({ verbose: true, env: 'staging', region: 'us-east-1' });
    expect(result.positional).toEqual([]);
  });
});

describe('parseArgs --no-flag negation syntax', () => {
  it('sets the underlying flag to false for --no-flag', () => {
    const result = parseArgs(['--no-color']);

    expect(result.flags).toEqual({ color: false });
    expect(result.positional).toEqual([]);
  });

  it('does not consume the next token as a value for --no-flag', () => {
    const result = parseArgs(['--no-color', 'staging']);

    expect(result.flags).toEqual({ color: false });
    expect(result.positional).toEqual(['staging']);
  });

  it('mixes --no-flag with positional and other flags', () => {
    const result = parseArgs(['svc', '--no-color', '--env=staging']);

    expect(result.flags).toEqual({ color: false, env: 'staging' });
    expect(result.positional).toEqual(['svc']);
  });

  it('preserves hyphenated targets when negating', () => {
    const result = parseArgs(['--no-dry-run']);

    expect(result.flags).toEqual({ 'dry-run': false });
    expect(result.positional).toEqual([]);
  });

  it('treats --no-flag=value as a literal flag named no-<rest>', () => {
    const result = parseArgs(['--no-color=red']);

    expect(result.flags).toEqual({ 'no-color': 'red' });
    expect(result.positional).toEqual([]);
  });

  it('lets a later --flag=value override an earlier --no-flag', () => {
    const result = parseArgs(['--no-color', '--color=red']);

    expect(result.flags).toEqual({ color: 'red' });
    expect(result.positional).toEqual([]);
  });
});

describe('parseArgs short alias syntax', () => {
  it('parses -f=value as a string assignment', () => {
    const result = parseArgs(['-v=2']);

    expect(result.flags).toEqual({ v: '2' });
    expect(result.positional).toEqual([]);
  });

  it('parses space-separated -f value as a string assignment', () => {
    const result = parseArgs(['-v', '2']);

    expect(result.flags).toEqual({ v: '2' });
    expect(result.positional).toEqual([]);
  });

  it('treats a trailing -f at the end of argv as boolean true', () => {
    const result = parseArgs(['svc', '-v']);

    expect(result.flags).toEqual({ v: true });
    expect(result.positional).toEqual(['svc']);
  });

  it('treats -f followed by another flag as boolean true', () => {
    const result = parseArgs(['-v', '--env=staging']);

    expect(result.flags).toEqual({ v: true, env: 'staging' });
    expect(result.positional).toEqual([]);
  });

  it('mixes short aliases with positional args', () => {
    const result = parseArgs(['svc', '-v=2', 'validate']);

    expect(result.flags).toEqual({ v: '2' });
    expect(result.positional).toEqual(['svc', 'validate']);
  });

  it('mixes short aliases with long flags', () => {
    const result = parseArgs(['-v', '2', '--env=staging']);

    expect(result.flags).toEqual({ v: '2', env: 'staging' });
    expect(result.positional).toEqual([]);
  });

  it('keeps additional equals signs inside the value', () => {
    const result = parseArgs(['-f=key=value']);

    expect(result.flags).toEqual({ f: 'key=value' });
  });

  it('accepts an empty value after the equals sign', () => {
    const result = parseArgs(['-f=']);

    expect(result.flags).toEqual({ f: '' });
  });

  it('does not consume a following short flag as a value', () => {
    const result = parseArgs(['-v', '-d']);

    expect(result.flags).toEqual({ v: true, d: true });
    expect(result.positional).toEqual([]);
  });

  it('treats a bare - as a positional argument', () => {
    const result = parseArgs(['cmd', '-']);

    expect(result.flags).toEqual({});
    expect(result.positional).toEqual(['cmd', '-']);
  });
});

describe('parseArgs -- end-of-flags marker', () => {
  it('treats every token after -- as positional', () => {
    const result = parseArgs(['svc', '--', '--env=staging', '-v', 'extra']);

    expect(result.flags).toEqual({});
    expect(result.positional).toEqual(['svc', '--env=staging', '-v', 'extra']);
  });

  it('does not include the -- marker itself in positional', () => {
    const result = parseArgs(['--', 'a', 'b']);

    expect(result.flags).toEqual({});
    expect(result.positional).toEqual(['a', 'b']);
  });

  it('parses flags before -- normally', () => {
    const result = parseArgs(['--env=staging', '--', '--debug', 'tail']);

    expect(result.flags).toEqual({ env: 'staging' });
    expect(result.positional).toEqual(['--debug', 'tail']);
  });

  it('handles -- at the very end of argv with no trailing tokens', () => {
    const result = parseArgs(['--env=staging', '--']);

    expect(result.flags).toEqual({ env: 'staging' });
    expect(result.positional).toEqual([]);
  });

  it('passes through a second -- as a positional after the marker', () => {
    const result = parseArgs(['--', '--', 'x']);

    expect(result.flags).toEqual({});
    expect(result.positional).toEqual(['--', 'x']);
  });

  it('preserves order of positional tokens before and after --', () => {
    const result = parseArgs(['one', '--flag=value', 'two', '--', 'three', '--four']);

    expect(result.flags).toEqual({ flag: 'value' });
    expect(result.positional).toEqual(['one', 'two', 'three', '--four']);
  });
});

describe('parseArgs edge cases', () => {
  it('last --flag=value wins when the same flag is repeated', () => {
    const result = parseArgs(['--env=staging', '--env=production']);

    expect(result.flags).toEqual({ env: 'production' });
    expect(result.positional).toEqual([]);
  });

  it('last --flag value wins when the same flag is repeated in space-separated form', () => {
    const result = parseArgs(['--env', 'staging', '--env', 'production']);

    expect(result.flags).toEqual({ env: 'production' });
    expect(result.positional).toEqual([]);
  });

  it('last value wins when --flag=value and --flag value forms are mixed', () => {
    const result = parseArgs(['--env=staging', '--env', 'production']);

    expect(result.flags).toEqual({ env: 'production' });
    expect(result.positional).toEqual([]);
  });

  it('last short -f assignment wins when repeated', () => {
    const result = parseArgs(['-v=1', '-v=2']);

    expect(result.flags).toEqual({ v: '2' });
    expect(result.positional).toEqual([]);
  });

  it('overrides an earlier boolean --flag with a later --flag=value', () => {
    const result = parseArgs(['--verbose', '--verbose=2']);

    expect(result.flags).toEqual({ verbose: '2' });
    expect(result.positional).toEqual([]);
  });

  it('overrides an earlier --flag=value with a later bare --flag (boolean true)', () => {
    const result = parseArgs(['--env=staging', '--env']);

    expect(result.flags).toEqual({ env: true });
    expect(result.positional).toEqual([]);
  });

  it('falls back to boolean true when a long flag intended as a value has no value at end of argv', () => {
    const result = parseArgs(['--env']);

    expect(result.flags).toEqual({ env: true });
    expect(result.positional).toEqual([]);
  });

  it('falls back to boolean true when a long flag intended as a value is followed by another flag', () => {
    const result = parseArgs(['--env', '--region=us-east-1']);

    expect(result.flags).toEqual({ env: true, region: 'us-east-1' });
    expect(result.positional).toEqual([]);
  });

  it('falls back to boolean true when a short flag intended as a value has no value at end of argv', () => {
    const result = parseArgs(['-v']);

    expect(result.flags).toEqual({ v: true });
    expect(result.positional).toEqual([]);
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

/** The `TypeError` a call throws, failing the case when it throws none or another error. */
function refusalOf(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error('expected a TypeError, and nothing was thrown');
}

describe('parseArgs declared flag aliases', () => {
  const spec: ParseArgsSpec = {
    flags: [
      flag('plan', { aliases: ['p', 'plan-file'] }),
      flag('detached', { type: 'boolean', aliases: ['d'] }),
    ],
  };

  it('records a short alias and its value under the flag name', () => {
    expect(parseArgs(['-p', 'PLAN.md'], spec)).toEqual({ positional: [], flags: { plan: 'PLAN.md' } });
    expect(parseArgs(['-p', 'PLAN.md']).flags).toEqual({ p: 'PLAN.md' });
  });

  it('records -p=value and --plan-file=value under the flag name', () => {
    expect(parseArgs(['-p=a.md'], spec).flags).toEqual({ plan: 'a.md' });
    expect(parseArgs(['--plan-file=b.md'], spec).flags).toEqual({ plan: 'b.md' });
    expect(parseArgs(['--plan-file=b.md']).flags).toEqual({ 'plan-file': 'b.md' });
  });

  it('reads a one-letter alias spelled with two dashes as the flag name too', () => {
    expect(parseArgs(['--p', 'c.md'], spec).flags).toEqual({ plan: 'c.md' });
    expect(parseArgs(['--p', 'c.md']).flags).toEqual({ p: 'c.md' });
  });

  it('records a bare alias as true under the flag name', () => {
    expect(parseArgs(['-d', '--plan=x'], spec).flags).toEqual({ detached: true, plan: 'x' });
    expect(parseArgs(['-d', '--plan=x']).flags).toEqual({ d: true, plan: 'x' });
  });

  it('records --no-<alias> as false under the flag name', () => {
    expect(parseArgs(['--no-d'], spec).flags).toEqual({ detached: false });
    expect(parseArgs(['--no-d']).flags).toEqual({ d: false });
  });

  it('lets the later of a name and an alias win, whichever comes first', () => {
    expect(parseArgs(['--plan=first', '-p', 'second'], spec).flags).toEqual({ plan: 'second' });
    expect(parseArgs(['-p', 'first', '--plan=second'], spec).flags).toEqual({ plan: 'second' });
  });

  it('keeps a spelling no flag declares as it was typed', () => {
    expect(parseArgs(['-x', 'svc', '--region=eu'], spec)).toEqual({
      positional: [],
      flags: { x: 'svc', region: 'eu' },
    });
  });

  it('resolves no alias after the -- marker', () => {
    expect(parseArgs(['-p', 'a', '--', '-p', 'b'], spec)).toEqual({
      positional: ['-p', 'b'],
      flags: { plan: 'a' },
    });
  });

  it('answers what no spec answers when the spec declares no alias and no default', () => {
    const argv = ['svc', '--env=staging', '-v', '2', '--no-color', '--', '--tail'];
    const plain: ParseArgsSpec = {
      args: [arg('service')],
      flags: [flag('env'), flag('color', { type: 'boolean' })],
    };

    expect(parseArgs(argv, plain)).toEqual(parseArgs(argv));
  });
});

describe('parseArgs refusing a spec it cannot read', () => {
  it('refuses an alias spelled as the name of another flag', () => {
    const refusal = refusalOf(() => parseArgs([], { flags: [flag('plan', { aliases: ['port'] }), flag('port')] }));

    expect(refusal.message).toBe('parseArgs: the spelling "port" names both flag "port" and flag "plan"');
  });

  it('refuses two flags declaring the same alias', () => {
    const refusal = refusalOf(() => parseArgs([], {
      flags: [flag('plan', { aliases: ['p'] }), flag('port', { aliases: ['p'] })],
    }));

    expect(refusal.message).toBe('parseArgs: the spelling "p" names both flag "plan" and flag "port"');
  });

  it('accepts an alias spelled as its own flag name', () => {
    expect(parseArgs(['--plan=x'], { flags: [flag('plan', { aliases: ['plan', 'p'] })] }).flags)
      .toEqual({ plan: 'x' });
  });

  it('refuses a positional argument declaring aliases', () => {
    const refusal = refusalOf(() => parseArgs(['a'], { args: [arg('stub', { aliases: ['s'] })] }));

    expect(refusal.message).toBe(
      'parseArgs: argument "stub" declares aliases, and a positional argument has no spelling for one to stand for',
    );
  });

  it('accepts a positional argument declaring an empty alias list', () => {
    expect(parseArgs(['a'], { args: [arg('stub', { aliases: [] })] }).positional).toEqual(['a']);
  });
});

describe('parseArgs declared defaults', () => {
  it('fills a flag default when the line gives the flag no value', () => {
    expect(parseArgs(['svc'], { flags: [flag('inject', { default: 'full' })] })).toEqual({
      positional: ['svc'],
      flags: { inject: 'full' },
    });
  });

  it('keeps a value the line gives over the default, however it is spelled', () => {
    const spec: ParseArgsSpec = {
      flags: [
        flag('inject', { default: 'full', aliases: ['i'] }),
        flag('color', { type: 'boolean', default: true }),
      ],
    };

    expect(parseArgs(['--inject=task'], spec).flags).toEqual({ inject: 'task', color: true });
    expect(parseArgs(['-i', 'stage'], spec).flags).toEqual({ inject: 'stage', color: true });
    expect(parseArgs(['--inject'], spec).flags).toEqual({ inject: true, color: true });
    expect(parseArgs(['--no-color'], spec).flags).toEqual({ inject: 'full', color: false });
  });

  it('fills a number default as the string a typed number is read as', () => {
    const spec: ParseArgsSpec = { flags: [flag('limit', { type: 'number', default: 20 })] };

    expect(parseArgs([], spec).flags).toEqual({ limit: '20' });
    expect(parseArgs(['--limit', '20'], spec).flags).toEqual(parseArgs([], spec).flags);
  });

  it('fills a boolean default as a boolean', () => {
    expect(parseArgs([], { flags: [flag('ci-wait', { type: 'boolean', default: false })] }).flags)
      .toEqual({ 'ci-wait': false });
  });

  it('fills the default of a flag named like an object property', () => {
    const spec: ParseArgsSpec = {
      flags: [flag('constructor', { default: 'x' }), flag('toString', { default: 'y' })],
    };

    expect(parseArgs([], spec).flags).toEqual({ constructor: 'x', toString: 'y' });
  });

  it('fills positional defaults after the words given, in order', () => {
    const spec: ParseArgsSpec = {
      args: [arg('subject'), arg('action', { default: 'list' }), arg('limit', { type: 'number', default: 10 })],
    };

    expect(parseArgs(['plan'], spec).positional).toEqual(['plan', 'list', '10']);
    expect(parseArgs(['plan', 'show'], spec).positional).toEqual(['plan', 'show', '10']);
    expect(parseArgs(['plan', 'show', '3', 'extra'], spec).positional).toEqual(['plan', 'show', '3', 'extra']);
  });

  it('stops filling at the first absent argument that declares no default', () => {
    const spec: ParseArgsSpec = {
      args: [arg('first', { default: 'one' }), arg('second'), arg('third', { default: 'three' })],
    };

    expect(parseArgs([], spec).positional).toEqual(['one']);
    expect(parseArgs(['1', '2'], spec).positional).toEqual(['1', '2', 'three']);
  });

  it('counts the words after the -- marker as given', () => {
    const spec: ParseArgsSpec = { args: [arg('first'), arg('second', { default: 'two' })] };

    expect(parseArgs(['--', '--one'], spec)).toEqual({ positional: ['--one', 'two'], flags: {} });
  });
});

describe('parseArgs rules the copy keeps', () => {
  it('reads a one-dash -no-flag as a flag named no-flag, not as a negation', () => {
    expect(parseArgs(['-no-color'])).toEqual({ positional: [], flags: { 'no-color': true } });
    expect(parseArgs(['-no-color'], { flags: [flag('color', { type: 'boolean' })] }).flags)
      .toEqual({ 'no-color': true });
  });

  it('refuses no line leaving out a flag or an argument the spec marks required', () => {
    const spec: ParseArgsSpec = {
      args: [arg('stub', { required: true })],
      flags: [flag('plan', { required: true })],
    };

    expect(parseArgs([], spec)).toEqual({ positional: [], flags: {} });
  });

  it('converts no value to the type a spec declares', () => {
    const spec: ParseArgsSpec = {
      args: [arg('count', { type: 'number' })],
      flags: [flag('limit', { type: 'number' }), flag('dry-run', { type: 'boolean' })],
    };

    expect(parseArgs(['3', '--limit=5', '--dry-run', 'false'], spec)).toEqual({
      positional: ['3'],
      flags: { limit: '5', 'dry-run': 'false' },
    });
  });
});

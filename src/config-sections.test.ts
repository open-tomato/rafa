/**
 * Tests for the value readers behind `config.ts`.
 *
 * Every reader is driven directly, with no file, so a case names the
 * raw value it hands over. Three cases parse YAML first, because the
 * reading they pin is the parser's: a `__proto__` key in an item, a
 * `toString` key in an item, and a `constructor` key beside a kind.
 * The path from a file through `config.ts` is `config.test.ts`'s.
 *
 * Every refusal sits beside an accepting control of the same reader,
 * so a reader refusing everything fails here as surely as one
 * accepting everything.
 *
 * Twenty-five of the fifty mutations `config.test.ts` describes were
 * aimed at this module, and on the last pass each reddened at least one
 * case across the two files. One stayed green on the first two passes:
 * an item refused on its kind key answering a value beside its problem.
 * Every caller in `config.ts` discards a refused value, and no case read
 * one. The case answering no value beside a problem was added for it,
 * and is the one case that leg reddens.
 */
import type { Reader, ValueAt } from './config-sections.js';

import { describe, expect, it } from 'bun:test';

import {
  CLAUDE_SETTING_SOURCES,
  dayCount,
  describeValue,
  flag,
  githubLogin,
  isGitHubLogin,
  isMapping,
  listOf,
  mergeMethod,
  MODULE_SOURCE_KINDS,
  moduleSource,
  oneOf,
  optionalPrerequisite,
  PR_PROVIDERS,
  PREREQUISITE_KINDS,
  RELEASE_AUTO,
  releaseEnabled,
  requiredPrerequisite,
  routeTarget,
  STORE_BACKENDS,
  subsetOf,
  text,
  TIER_SWITCHES,
  tierPin,
  tierSwitch,
  usdAmount,
} from './config-sections.js';

/** Where every case reads its value. */
const AT: ValueAt = { label: 'F: s', key: 's' };

/** The choices a prerequisite refusal lists. */
const KINDS = 'tool, env, service, lsp';

/** The problems `read` names for `raw`; empty when it accepts it. */
function problemsOf<T>(read: Reader<T>, raw: unknown): readonly string[] {
  return read(raw, AT).problems;
}

/** The value `read` accepts `raw` as. Fails the case on a refusal. */
function valueOf<T>(read: Reader<T>, raw: unknown): T {
  const reading = read(raw, AT);
  expect(reading.problems).toEqual([]);
  if (reading.value === undefined) throw new Error('accepted, with no value');
  return reading.value;
}

/** The first item of a one-item YAML list, as the parser returns it. */
function parsedItem(yaml: string): unknown {
  const [item] = Bun.YAML.parse(yaml) as unknown[];
  return item;
}

describe('describeValue', () => {
  it.each([
    ['a string, quoted', 'x', '"x"'],
    ['a string holding a quote, escaped', 'a"b', '"a\\"b"'],
    ['null', null, 'null'],
    ['a list, never serialised', [1, 2], 'a list'],
    ['a mapping, never serialised', { a: 1 }, 'a mapping'],
    ['a number', 3, '3'],
    ['a boolean', true, 'true'],
  ])('describes %s', (_label, value, described) => {
    expect(describeValue(value)).toBe(described);
  });
});

describe('isMapping', () => {
  it('is true for a mapping and false for a list, null and a scalar', () => {
    expect(isMapping({})).toBe(true);
    expect([[], null, 'x', 1].map(isMapping)).toEqual([false, false, false, false]);
  });
});

describe('oneOf', () => {
  it('accepts each of its values as itself', () => {
    const read = oneOf(STORE_BACKENDS);

    expect(STORE_BACKENDS.map((value) => valueOf(read, value))).toEqual(['sqlite', 'ndjson']);
  });

  it.each([
    ['a different case', 'SQLite', '"SQLite"'],
    ['a number', 3, '3'],
    ['a list', ['sqlite'], 'a list'],
  ])('refuses %s, naming the label and the choices', (_label, raw, found) => {
    expect(problemsOf(oneOf(STORE_BACKENDS), raw)).toEqual([
      `F: s is ${found}, expected one of: sqlite, ndjson`,
    ]);
  });

  it('compares with ===, so the number 1 is not the string "1"', () => {
    expect(valueOf(oneOf([1]), 1)).toBe(1);
    expect(problemsOf(oneOf([1]), '1')).toEqual(['F: s is "1", expected one of: 1']);
  });
});

describe('text', () => {
  it('accepts a string as written, never trimmed', () => {
    expect(valueOf(text('a name'), ' linear ')).toBe(' linear ');
  });

  it.each([
    ['an empty string', '', '""'],
    ['a whitespace-only string', '  \t', '"  \\t"'],
    ['a number', 3, '3'],
    ['a list', ['a'], 'a list'],
    ['null', null, 'null'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(text('a name'), raw)).toEqual([`F: s is ${found}, expected a name`]);
  });
});

describe('flag', () => {
  it('accepts true and false, false as a value rather than silence', () => {
    expect(valueOf(flag, true)).toBe(true);
    expect(flag(false, AT)).toEqual({ value: false, problems: [], extras: [] });
  });

  it.each([
    ['the string true', 'true', '"true"'],
    ['yes', 'yes', '"yes"'],
    ['the number 1', 1, '1'],
    ['null', null, 'null'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(flag, raw)).toEqual([`F: s is ${found}, expected true or false`]);
  });

  it('reads dangerous.acceptStaleRefs as a file spells it, the boolean alone turning it on', () => {
    const parsed = Bun.YAML.parse([
      'on: true',
      'off: false',
      'yes: yes',
      'quoted: "true"',
      'one: 1',
    ].join('\n')) as Record<string, unknown>;

    expect([valueOf(flag, parsed.on), valueOf(flag, parsed.off)]).toEqual([true, false]);
    expect([parsed.yes, parsed.quoted, parsed.one].map((raw) => problemsOf(flag, raw))).toEqual([
      ['F: s is "yes", expected true or false'],
      ['F: s is "true", expected true or false'],
      ['F: s is 1, expected true or false'],
    ]);
  });
});

describe('listOf', () => {
  const names = listOf(text('a name'), 'names');

  it('accepts an empty list, frozen', () => {
    const value = valueOf(names, []);

    expect(value).toEqual([]);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('accepts a list in its order, as a frozen copy of what it was handed', () => {
    const raw = ['local', 'github'];
    const value = valueOf(names, raw);

    expect(value).toEqual(['local', 'github']);
    expect(value).not.toBe(raw);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(() => (value as string[]).push('x')).toThrow(TypeError);
  });

  it('refuses a value that is not a list, a lone name included', () => {
    expect(problemsOf(names, 'local')).toEqual(['F: s is "local", expected a list of names']);
  });

  it('names every unusable entry by its index, and answers no value', () => {
    const reading = names(['a', 3, ''], AT);

    expect(reading.problems).toEqual([
      'F: s[1] is 3, expected a name',
      'F: s[2] is "", expected a name',
    ]);
    expect(reading.value).toBeUndefined();
  });

  it('keeps the unknown keys of its items under their indexed paths', () => {
    const reading = listOf(moduleSource, 'sources')([{ npm: 'a' }, { npm: 'b', tag: 1 }], AT);

    expect(reading.problems).toEqual([]);
    expect(reading.extras).toEqual([{ key: 's[1].tag', value: 1 }]);
  });
});

describe('subsetOf', () => {
  const sources = subsetOf(CLAUDE_SETTING_SOURCES);

  it.each([
    ['project,local', ['project', 'local']],
    ['local,project', ['local', 'project']],
    ['user', ['user']],
    ['user, project , local', ['user', 'project', 'local']],
  ])('accepts %s, in the order written', (raw, expected) => {
    const value = valueOf(sources, raw);

    expect<readonly string[]>(value).toEqual(expected);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([
    ['an empty value', ''],
    ['a trailing comma', 'project,'],
    ['a leading comma', ',local'],
    ['an empty entry', 'project,,local'],
    ['an entry given twice', 'project,project'],
    ['a different case', 'Project'],
    ['a source Claude Code has not', 'global'],
  ])('refuses %s', (_label, raw) => {
    expect(problemsOf(sources, raw)).toEqual([
      `F: s is ${JSON.stringify(raw)}, expected a comma-separated subset of: user, project, local`,
    ]);
  });

  it('refuses a YAML list rather than joining it', () => {
    expect(problemsOf(sources, ['project', 'local'])).toEqual([
      'F: s is a list, expected a comma-separated subset of: user, project, local',
    ]);
  });
});

/** The refusal every unusable dollar amount is named with. */
const USD_EXPECTED = 'a number of US dollars above zero, '
  + 'at most six digits either side of the point';

describe('the pr provider reader', () => {
  const provider = oneOf(PR_PROVIDERS);

  it('accepts each of the two providers as itself', () => {
    expect(PR_PROVIDERS.map((value) => valueOf(provider, value))).toEqual(['gh', 'none']);
  });

  it.each([
    ['a different case', 'GH', '"GH"'],
    ['the host rather than the CLI', 'github', '"github"'],
    ['a provider nothing implements', 'gitlab', '"gitlab"'],
    ['a YAML null, which the layer reads as silence', null, 'null'],
    ['a boolean', false, 'false'],
  ])('refuses %s, naming both providers', (_label, raw, found) => {
    expect(problemsOf(provider, raw)).toEqual([
      `F: s is ${found}, expected one of: gh, none`,
    ]);
  });

  it('reads a file spelling none as the provider, not as no value', () => {
    // YAML spells null `~`, `null` or nothing at all, so `provider: none`
    // is the plain string and reaches the reader as a value. Measured on
    // bun 1.3.14.
    const parsed = Bun.YAML.parse('provider: none\n') as { provider: unknown };

    expect(parsed.provider).toBe('none');
    expect(valueOf(provider, parsed.provider)).toBe('none');
  });
});

describe('mergeMethod', () => {
  it('accepts each of the pull request port three methods as itself', () => {
    const methods = ['squash', 'merge', 'rebase'];

    expect(methods.map((raw) => valueOf(mergeMethod, raw))).toEqual(methods);
  });

  it.each([
    ['a different case', 'Squash', '"Squash"'],
    ['a method gh pr merge has not', 'ff-only', '"ff-only"'],
    ['the flag rather than its value', '--squash', '"--squash"'],
    ['a list of methods', ['squash'], 'a list'],
    ['null', null, 'null'],
  ])('refuses %s, naming the three in the order the port lists them', (_label, raw, found) => {
    expect(problemsOf(mergeMethod, raw)).toEqual([
      `F: s is ${found}, expected one of: squash, merge, rebase`,
    ]);
  });
});

describe('usdAmount', () => {
  it.each([[2], [0.5], [0.01], [0.000001], [999999.999999]])('accepts %p dollars as itself', (raw) => {
    expect(valueOf(usdAmount, raw)).toBe(raw);
  });

  it.each([
    ['zero, which no session could run under', 0, '0'],
    ['a negative amount', -1, '-1'],
    ['more than six whole digits', 1000000, '1000000'],
    ['more than six decimal places', 0.0000001, '1e-7'],
    ['an amount String writes with an exponent', 1e21, '1e+21'],
    ['a string spelled like a number', '2', '"2"'],
    ['a string carrying the currency', '$2', '"$2"'],
    ['a boolean', true, 'true'],
    ['null', null, 'null'],
    ['a list', [2], 'a list'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(usdAmount, raw)).toEqual([`F: s is ${found}, expected ${USD_EXPECTED}`]);
  });

  it.each([
    ['.inf', 'Infinity'],
    ['-.inf', '-Infinity'],
    ['.nan', 'NaN'],
  ])('refuses %s, which the parser answers as a number', (written, found) => {
    // The typeof check alone would accept each of these: `Bun.YAML.parse`
    // answers a number for all three, measured on bun 1.3.14, and
    // `String` writes each as something --max-budget-usd never takes.
    const parsed = Bun.YAML.parse(`budget: ${written}\n`) as { budget: unknown };

    expect(typeof parsed.budget).toBe('number');
    expect(problemsOf(usdAmount, parsed.budget)).toEqual([
      `F: s is ${found}, expected ${USD_EXPECTED}`,
    ]);
  });

  it('accepts a number the parser read from a file, and refuses the same amount quoted', () => {
    const parsed = Bun.YAML.parse('a: 1.50\nb: "1.50"\n') as { a: unknown; b: unknown };

    expect(valueOf(usdAmount, parsed.a)).toBe(1.5);
    expect(problemsOf(usdAmount, parsed.b)).toEqual([`F: s is "1.50", expected ${USD_EXPECTED}`]);
  });
});

describe('dayCount', () => {
  it('accepts a whole number of days above zero as itself', () => {
    expect([valueOf(dayCount, 1), valueOf(dayCount, 30)]).toEqual([1, 30]);
  });

  it.each([
    ['zero, which is not read as off', 0, '0'],
    ['a negative count', -7, '-7'],
    ['a fraction', 2.5, '2.5'],
    ['a count quoted as a string', '30', '"30"'],
    ['null, which the layer reads as silence', null, 'null'],
    ['a list', [30], 'a list'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(dayCount, raw)).toEqual([
      `F: s is ${found}, expected a number of days, a whole number above zero`,
    ]);
  });

  it('accepts the count a file spells unquoted, and refuses the same count quoted', () => {
    const parsed = Bun.YAML.parse('a: 30\nb: "30"\n') as { a: unknown; b: unknown };

    expect(valueOf(dayCount, parsed.a)).toBe(30);
    expect(problemsOf(dayCount, parsed.b)).toEqual([
      'F: s is "30", expected a number of days, a whole number above zero',
    ]);
  });
});

describe('releaseEnabled', () => {
  it('accepts both booleans and auto, each as itself', () => {
    expect(valueOf(releaseEnabled, true)).toBe(true);
    expect(valueOf(releaseEnabled, RELEASE_AUTO)).toBe(RELEASE_AUTO);
  });

  it('reads false as a value rather than as silence, as flag does', () => {
    expect(releaseEnabled(false, AT)).toEqual({ value: false, problems: [], extras: [] });
  });

  it.each([
    ['the string true, which nothing here coerces', 'true', '"true"'],
    ['a different case of auto', 'Auto', '"Auto"'],
    ['the number 1', 1, '1'],
    ['null, which the layer reads as silence', null, 'null'],
    ['a list', [true], 'a list'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(releaseEnabled, raw)).toEqual([
      `F: s is ${found}, expected true, false or auto`,
    ]);
  });

  it.each([['on'], ['off'], ['yes'], ['no']])('refuses %s, which the parser answers as a string', (written) => {
    // YAML 1.1 spelled these booleans; `Bun.YAML.parse` does not, so each
    // reaches the reader as its own word. Measured on bun 1.3.14, beside
    // `true`, which it does answer as the boolean.
    const parsed = Bun.YAML.parse(`enabled: ${written}\n`) as { enabled: unknown };

    expect(parsed.enabled).toBe(written);
    expect(problemsOf(releaseEnabled, parsed.enabled)).toEqual([
      `F: s is "${written}", expected true, false or auto`,
    ]);
  });

  it('accepts the word auto a file spells unquoted, and the same word quoted', () => {
    const parsed = Bun.YAML.parse('a: auto\nb: "auto"\nc: true\n') as Record<string, unknown>;

    expect([parsed.a, parsed.b, parsed.c]).toEqual([RELEASE_AUTO, RELEASE_AUTO, true]);
    expect([valueOf(releaseEnabled, parsed.a), valueOf(releaseEnabled, parsed.c)])
      .toEqual([RELEASE_AUTO, true]);
  });
});

describe('tierSwitch', () => {
  it('accepts on and off, each as itself', () => {
    expect(TIER_SWITCHES.map((word) => valueOf(tierSwitch, word))).toEqual(['on', 'off']);
  });

  it('accepts the words a file spells unquoted, which the parser answers as strings', () => {
    // Measured on bun 1.3.14: `Bun.YAML.parse` answers `on` and `off` as
    // the words, so an unquoted `rafa: off` reaches the reader as `off`.
    const parsed = Bun.YAML.parse('a: on\nb: off\n') as Record<string, unknown>;

    expect([parsed.a, parsed.b]).toEqual(['on', 'off']);
    expect([valueOf(tierSwitch, parsed.a), valueOf(tierSwitch, parsed.b)]).toEqual(['on', 'off']);
  });

  it.each([
    ['the boolean false, which nothing here coerces', false, 'false'],
    ['the boolean true', true, 'true'],
    ['a different case', 'Off', '"Off"'],
    ['null', null, 'null'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(tierSwitch, raw)).toEqual([`F: s is ${found}, expected one of: on, off`]);
  });
});

describe('tierPin', () => {
  it('accepts false and each of the three tiers, each as itself', () => {
    expect(tierPin(false, AT)).toEqual({ value: false, problems: [], extras: [] });
    expect(['project', 'rafa', 'user'].map((tier) => valueOf(tierPin, tier)))
      .toEqual(['project', 'rafa', 'user']);
  });

  it.each([
    ['true, which would say nothing', true, 'true'],
    ['null, a name that pins nothing', null, 'null'],
    ['the string false, which nothing here coerces', 'false', '"false"'],
    ['a different case of a tier', 'Rafa', '"Rafa"'],
    ['a source outside the three tiers', 'plugin', '"plugin"'],
    ['a list', ['user'], 'a list'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(tierPin, raw)).toEqual([
      `F: s is ${found}, expected false or one of: project, rafa, user`,
    ]);
  });
});

describe('routeTarget', () => {
  it('accepts false and an agent name, each as itself', () => {
    expect(routeTarget(false, AT)).toEqual({ value: false, problems: [], extras: [] });
    expect(['loop-implementer', 'refactor-cleaner'].map((name) => valueOf(routeTarget, name)))
      .toEqual(['loop-implementer', 'refactor-cleaner']);
  });

  it('reads the string false as a name, not as false, since nothing here coerces', () => {
    expect(valueOf(routeTarget, 'false')).toBe('false');
  });

  it.each([
    ['true, which names no agent', true, 'true'],
    ['null, a shape that routes nothing', null, 'null'],
    ['an empty name', '', '""'],
    ['a blank name', '  ', '"  "'],
    ['a list of agents', ['tdd-guide'], 'a list'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(routeTarget, raw)).toEqual([
      `F: s is ${found}, expected false or an agent name`,
    ]);
  });
});

describe('githubLogin', () => {
  it.each([
    ['a plain login', 'octocat'],
    ['one carrying a hyphen and digits', 'open-tomato-2'],
    ['one in mixed case, kept as written', 'OctoCat'],
    ['a bot account', 'dependabot[bot]'],
    ['a single character', 'o'],
  ])('accepts %s as itself', (_label, raw) => {
    expect(valueOf(githubLogin, raw)).toBe(raw);
  });

  it.each([
    ['a path that would move the permission path', '../../evil', '"../../evil"'],
    ['a login carrying a slash, as gh renders an app account', 'app/dependabot', '"app/dependabot"'],
    ['one opening with a hyphen, which gh would read as a flag', '-octocat', '"-octocat"'],
    ['one carrying a space', 'octo cat', '"octo cat"'],
    ['one carrying a percent escape', 'octo%2Fcat', '"octo%2Fcat"'],
    ['one carrying a dot', 'octo.cat', '"octo.cat"'],
    ['the empty string', '', '""'],
    ['a number', 7, '7'],
    ['null', null, 'null'],
    ['a list of logins', ['octocat'], 'a list'],
  ])('refuses %s', (_label, raw, found) => {
    expect(problemsOf(githubLogin, raw)).toEqual([`F: s is ${found}, expected a GitHub login`]);
  });

  it('reads the same shape as the predicate the trust check narrows logins with', () => {
    // The control pairs the two: a reader that accepted what the
    // predicate refuses would put a login into the collaborators path
    // that `src/board/trust.ts` would not.
    expect(isGitHubLogin('octocat')).toBe(true);
    expect(isGitHubLogin('dependabot[bot]')).toBe(true);
    expect(isGitHubLogin('../../evil')).toBe(false);
    expect(isGitHubLogin(7)).toBe(false);
  });
});

describe('requiredPrerequisite', () => {
  it.each([...PREREQUISITE_KINDS])('reads an item keyed by %s, with no probe', (kind) => {
    expect(valueOf(requiredPrerequisite, { [kind]: 'x' })).toEqual({
      kind,
      name: 'x',
      probe: null,
    });
  });

  it('reads a probe, and answers the item frozen', () => {
    const item = valueOf(requiredPrerequisite, { tool: 'bun', probe: 'bun --version' });

    expect(item).toEqual({ kind: 'tool', name: 'bun', probe: 'bun --version' });
    expect(Object.isFrozen(item)).toBe(true);
  });

  it('reads a null probe as no probe', () => {
    expect(valueOf(requiredPrerequisite, { env: 'A', probe: null }).probe).toBeNull();
  });

  it('retains a reason and an unknown key as extras, never refusing them', () => {
    const reading = requiredPrerequisite({ env: 'A', reason: 'why', timeout: 30 }, AT);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toEqual({ kind: 'env', name: 'A', probe: null });
    expect(reading.extras).toEqual([
      { key: 's.reason', value: 'why' },
      { key: 's.timeout', value: 30 },
    ]);
  });

  it.each([
    ['a scalar', 'bun', '"bun"'],
    ['a list', ['bun'], 'a list'],
    ['null', null, 'null'],
  ])('refuses an item that is %s', (_label, raw, found) => {
    expect(problemsOf(requiredPrerequisite, raw)).toEqual([
      `F: s is ${found}, expected a mapping naming one of: ${KINDS}`,
    ]);
  });

  it('refuses an item naming none of the kinds', () => {
    expect(problemsOf(requiredPrerequisite, { probe: 'x' })).toEqual([
      `F: s names none of: ${KINDS}`,
    ]);
  });

  it.each([
    ['tool before env', { tool: 'a', env: 'B' }],
    ['env before tool', { env: 'B', tool: 'a' }],
  ])('refuses an item naming two kinds, written %s', (_label, raw) => {
    expect(problemsOf(requiredPrerequisite, raw)).toEqual([
      `F: s names tool and env, expected exactly one of: ${KINDS}`,
    ]);
  });

  it.each([
    ['null', null, 'null'],
    ['empty', '', '""'],
    ['a number', 3, '3'],
  ])('refuses a kind naming a value that is %s', (_label, raw, found) => {
    expect(problemsOf(requiredPrerequisite, { tool: raw })).toEqual([
      `F: s.tool is ${found}, expected a non-empty string`,
    ]);
  });

  it('answers no value beside a problem, whichever key the problem is on', () => {
    expect(requiredPrerequisite({ tool: '' }, AT).value).toBeUndefined();
    expect(requiredPrerequisite({ tool: 'bun', probe: 3 }, AT).value).toBeUndefined();
    expect(requiredPrerequisite({ tool: 'bun', probe: 'bun -v' }, AT).value).toBeDefined();
  });

  it('names every problem one item has', () => {
    expect(problemsOf(requiredPrerequisite, { tool: '', probe: 3 })).toEqual([
      'F: s.tool is "", expected a non-empty string',
      'F: s.probe is 3, expected a non-empty string',
    ]);
  });

  it('retains a __proto__ key as an extra, the parser keeping it as an own key', () => {
    const item = parsedItem('- __proto__: x\n  tool: bun\n');
    const reading = requiredPrerequisite(item, AT);

    expect(Object.hasOwn(item as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
    expect(reading.value).toEqual({ kind: 'tool', name: 'bun', probe: null });
    expect(reading.extras).toEqual([{ key: 's.__proto__', value: 'x' }]);
  });

  it('reads a toString key as no kind, though every mapping answers it to in', () => {
    const item = parsedItem('- toString: bun\n');

    expect('toString' in (item as object)).toBe(true);
    expect(problemsOf(requiredPrerequisite, item)).toEqual([`F: s names none of: ${KINDS}`]);
  });

  it('retains a constructor key beside a kind as an extra', () => {
    const reading = requiredPrerequisite(parsedItem('- constructor: a\n  env: B\n'), AT);

    expect(reading.value).toEqual({ kind: 'env', name: 'B', probe: null });
    expect(reading.extras).toEqual([{ key: 's.constructor', value: 'a' }]);
  });
});

describe('optionalPrerequisite', () => {
  it('reads a reason beside a probe', () => {
    const raw = { tool: 'mgrep', probe: 'mgrep --version', reason: 'faster search' };

    expect(valueOf(optionalPrerequisite, raw)).toEqual({
      kind: 'tool',
      name: 'mgrep',
      probe: 'mgrep --version',
      reason: 'faster search',
    });
  });

  it('reads a missing reason and a null one as no reason', () => {
    expect(valueOf(optionalPrerequisite, { lsp: 'typescript' }).reason).toBeNull();
    expect(valueOf(optionalPrerequisite, { lsp: 'typescript', reason: null }).reason).toBeNull();
  });

  it('refuses a reason that is not a string', () => {
    expect(problemsOf(optionalPrerequisite, { lsp: 'typescript', reason: 4 })).toEqual([
      'F: s.reason is 4, expected a non-empty string',
    ]);
  });
});

describe('moduleSource', () => {
  it.each([...MODULE_SOURCE_KINDS])('reads a %s source, with no ref', (kind) => {
    const source = valueOf(moduleSource, { [kind]: 'x' });

    expect(source).toEqual({ kind, location: 'x', ref: null });
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('reads a ref beside a github source', () => {
    expect(valueOf(moduleSource, { github: 'someone/rafa-obsidian', ref: 'v0.3.0' })).toEqual({
      kind: 'github',
      location: 'someone/rafa-obsidian',
      ref: 'v0.3.0',
    });
  });

  it.each(['npm', 'path'])('retains a ref beside a %s source as an extra', (kind) => {
    const reading = moduleSource({ [kind]: 'x', ref: 'v1' }, AT);

    expect(reading.value?.ref).toBeNull();
    expect(reading.extras).toEqual([{ key: 's.ref', value: 'v1' }]);
  });

  it('refuses a source naming two kinds, one naming none, and a ref that is no string', () => {
    const choices = 'npm, github, path';

    expect(problemsOf(moduleSource, { npm: 'a', path: 'b' })).toEqual([
      `F: s names npm and path, expected exactly one of: ${choices}`,
    ]);
    expect(problemsOf(moduleSource, {})).toEqual([`F: s names none of: ${choices}`]);
    expect(problemsOf(moduleSource, { github: 'a/b', ref: 2 })).toEqual([
      'F: s.ref is 2, expected a non-empty string',
    ]);
  });
});

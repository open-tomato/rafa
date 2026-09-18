/**
 * Tests for the stack vocabulary.
 *
 * Everything here is a literal in and a literal out. The module reads
 * no file and no directory, so there is no fixture tree, and the one
 * corpus it was written against — the ECC skill directory names in
 * `~/.claude/skills` — is PINNED as a literal below rather than read.
 * Reading the home would make this file pass on the machine the table
 * was measured on and on no other, and would make the reading
 * "`django-tdd` maps to python and django" a statement about that
 * machine instead of about the table.
 *
 * The 61 names in {@link ECC_SKILL_DIRECTORIES} are the output of
 * `grep -l '^origin: ECC' ~/.claude/skills/*\/SKILL.md` on 2026-09-18,
 * sorted, with the `/SKILL.md` suffix stripped. 38 of them name a
 * stack and 23 name none, and the case below asserts BOTH halves: a
 * table that mapped every name to something would redden on
 * `verification-loop`, and one that mapped nothing would redden on
 * `kotlin-testing`. That pairing is what makes the empty answers a
 * reading rather than a default.
 *
 * The inference cases come in pairs for the same reason. Every
 * positive body is matched by a prose body holding the punctuation
 * that most looks like a file extension — `e.g.`, `etc.`, a semantic
 * version, a dotted property chain, a `README.md`. That pairing does
 * NOT measure the extension pattern's boundary assertions, and the
 * module says why: stripping both leaves every case here green,
 * because the captures those bodies yield are not extensions any
 * language claims. The one assertion that IS measured is the trailing
 * word-character refusal, by the `main.py_old` case and the
 * `main.py` control beside it.
 *
 * The glob table is driven through `Bun.Glob` rather than compared to
 * a second copy of itself: every glob is asked to match a path built
 * from its own extension and to refuse one built from another, which
 * is the only form in which "these globs parse and gate" is measured
 * rather than asserted.
 */
import { describe, expect, test } from 'bun:test';

import {
  AGNOSTIC_STACK,
  ECC_STACK_PREFIXES,
  FENCE_LANGUAGE_ALIASES,
  LANGUAGE_EXTENSIONS,
  LANGUAGE_STACKS,
  PLATFORM_GLOBS,
  STACK_NAMES,
  UNGATED_STACKS,
  fencedLanguages,
  inferStacks,
  isAgnosticStackList,
  isStackList,
  isStackName,
  isStackValue,
  stackGlobs,
  stackPaths,
  stacksFromEccSkillName,
  unknownStacks,
} from './stack.js';

/**
 * The ECC-origin skill directories measured on 2026-09-18, with the
 * stacks the table is expected to read off each name.
 */
const ECC_SKILL_DIRECTORIES: Readonly<Record<string, readonly string[]>> = {
  'agent-introspection-debugging': [],
  'agent-sort': [],
  'ai-regression-testing': [],
  'android-clean-architecture': ['kotlin', 'android'],
  'angular-developer': ['typescript', 'angular'],
  'api-design': [],
  'backend-patterns': [],
  'code-tour': [],
  'coding-standards': [],
  'compose-multiplatform-patterns': ['kotlin'],
  'configure-ecc': [],
  'continuous-learning-v2': [],
  'cpp-coding-standards': ['cpp'],
  'cpp-testing': ['cpp'],
  'csharp-testing': ['csharp'],
  'dart-flutter-patterns': ['dart', 'flutter'],
  'django-patterns': ['python', 'django'],
  'django-tdd': ['python', 'django'],
  'django-verification': ['python', 'django'],
  'dotnet-patterns': ['csharp', 'dotnet'],
  'e2e-testing': [],
  'error-handling': [],
  'eval-harness': [],
  'frontend-patterns': [],
  'frontend-slides': [],
  'fsharp-testing': ['fsharp'],
  'golang-patterns': ['go'],
  'golang-testing': ['go'],
  'iterative-retrieval': [],
  'java-coding-standards': ['java'],
  'kotlin-coroutines-flows': ['kotlin'],
  'kotlin-exposed-patterns': ['kotlin'],
  'kotlin-ktor-patterns': ['kotlin'],
  'kotlin-patterns': ['kotlin'],
  'kotlin-testing': ['kotlin'],
  'laravel-patterns': ['php', 'laravel'],
  'laravel-plugin-discovery': ['php', 'laravel'],
  'laravel-tdd': ['php', 'laravel'],
  'laravel-verification': ['php', 'laravel'],
  'mcp-server-patterns': [],
  'motion-ui': [],
  'nestjs-patterns': ['typescript', 'nestjs'],
  'perl-patterns': ['perl'],
  'perl-testing': ['perl'],
  'project-guidelines-example': [],
  'python-patterns': ['python'],
  'python-testing': ['python'],
  'quarkus-patterns': ['java', 'quarkus'],
  'quarkus-tdd': ['java', 'quarkus'],
  'quarkus-verification': ['java', 'quarkus'],
  'rust-patterns': ['rust'],
  'rust-testing': ['rust'],
  'skill-stocktake': [],
  'springboot-patterns': ['java', 'springboot'],
  'springboot-tdd': ['java', 'springboot'],
  'springboot-verification': ['java', 'springboot'],
  'strategic-compact': [],
  'tdd-workflow': [],
  'verification-loop': [],
  'windows-desktop-e2e': ['windows'],
  council: [],
};

describe('the vocabulary', () => {
  test('holds every language, platform and ungated name exactly once', () => {
    const expected = [
      ...Object.keys(LANGUAGE_EXTENSIONS),
      ...Object.keys(PLATFORM_GLOBS),
      ...UNGATED_STACKS,
    ];

    expect(new Set(STACK_NAMES).size).toBe(expected.length);
    expect([...STACK_NAMES]).toEqual([...expected].sort((a, b) => a.localeCompare(b)));
  });

  test('names from each of the three tables are recognised', () => {
    expect(isStackName('kotlin')).toBe(true);
    expect(isStackName('springboot')).toBe(true);
    expect(isStackName('postgres')).toBe(true);
  });

  test('a plausible name outside the vocabulary is refused', () => {
    expect(isStackName('kotlin-jvm')).toBe(false);
    expect(isStackName('Kotlin')).toBe(false);
    expect(isStackName('')).toBe(false);
  });

  test('agnostic is a value but not a name', () => {
    expect(isStackName(AGNOSTIC_STACK)).toBe(false);
    expect(isStackValue(AGNOSTIC_STACK)).toBe(true);
    expect(isStackValue('kotlin')).toBe(true);
    expect(isStackValue('kotlin-jvm')).toBe(false);
  });

  test('the language subset is the keys of the extension table, sorted', () => {
    expect([...LANGUAGE_STACKS]).toEqual(
      Object.keys(LANGUAGE_EXTENSIONS).sort((a, b) => a.localeCompare(b)),
    );
    expect(LANGUAGE_STACKS).not.toContain('springboot');
  });
});

describe('stack lists', () => {
  test('a list of vocabulary names is usable and the agnostic list is too', () => {
    expect(isStackList(['typescript', 'postgres'])).toBe(true);
    expect(isStackList([AGNOSTIC_STACK])).toBe(true);
  });

  test('agnostic mixed with a name is refused', () => {
    expect(isStackList([AGNOSTIC_STACK, 'kotlin'])).toBe(false);
    expect(isAgnosticStackList([AGNOSTIC_STACK, 'kotlin'])).toBe(false);
    expect(unknownStacks([AGNOSTIC_STACK, 'kotlin'])).toEqual([AGNOSTIC_STACK]);
  });

  test('an empty list is refused', () => {
    expect(isStackList([])).toBe(false);
    expect(isAgnosticStackList([])).toBe(false);
  });

  test('the agnostic list alone yields no unknowns', () => {
    expect(unknownStacks([AGNOSTIC_STACK])).toEqual([]);
  });

  test('every unknown entry is named, in the order given', () => {
    expect(unknownStacks(['kotlin-jvm', 'kotlin', 'Rust'])).toEqual(['kotlin-jvm', 'Rust']);
  });
});

describe('the glob table', () => {
  test('a language glob list is derived from its extensions', () => {
    expect(stackGlobs('kotlin')).toEqual(['**/*.kt', '**/*.kts']);
    expect(stackGlobs('typescript')).toEqual(['**/*.ts', '**/*.tsx']);
  });

  test('a platform keeps its manifest glob first', () => {
    expect(stackGlobs('flutter')[0]).toBe('**/pubspec.yaml');
  });

  test('an ungated name is in the vocabulary and still gates on nothing', () => {
    expect(isStackName('postgres')).toBe(true);
    expect(stackGlobs('postgres')).toEqual([]);
  });

  test('a name outside the vocabulary gates on nothing either', () => {
    expect(stackGlobs('kotlin-jvm')).toEqual([]);
  });

  test('every glob in the table is one Bun.Glob accepts', () => {
    const globs = [...STACK_NAMES].flatMap((name) => [...stackGlobs(name)]);

    expect(globs.length).toBeGreaterThan(0);
    for (const pattern of globs) {
      expect(() => new Bun.Glob(pattern).match('probe/path.txt')).not.toThrow();
    }
  });

  test('every language glob matches its own extension and refuses another', () => {
    for (const name of LANGUAGE_STACKS) {
      for (const ext of LANGUAGE_EXTENSIONS[name]) {
        const glob = new Bun.Glob(`**/*.${ext}`);

        expect(glob.match(`src/deep/file.${ext}`)).toBe(true);
        expect(glob.match('src/deep/file.nomatchzz')).toBe(false);
      }
    }
  });
});

describe('paths for a stack list', () => {
  test('the globs of each stack appear in the order the stacks were given', () => {
    expect(stackPaths(['typescript', 'flutter'])).toEqual([
      '**/*.ts',
      '**/*.tsx',
      '**/pubspec.yaml',
      '**/*.dart',
    ]);
  });

  test('a glob two stacks share appears once', () => {
    expect(stackPaths(['kotlin', 'android'])).toEqual([
      '**/*.kt',
      '**/*.kts',
      '**/AndroidManifest.xml',
      '**/*.java',
    ]);
  });

  test('the agnostic list gates on nothing', () => {
    expect(stackPaths([AGNOSTIC_STACK])).toEqual([]);
  });

  test('a non-agnostic list of ungated names also gates on nothing', () => {
    expect(stackPaths(['postgres', 'redis'])).toEqual([]);
    expect(isAgnosticStackList(['postgres', 'redis'])).toBe(false);
  });
});

describe('fenced languages', () => {
  test('an info string is read off a backtick and a tilde fence alike', () => {
    const body = ['```kotlin', 'val x = 1', '```', '~~~python', 'x = 1', '~~~'].join('\n');

    expect(fencedLanguages(body)).toEqual(['kotlin', 'python']);
  });

  test('an info string is lowercased and repeats are kept', () => {
    const body = ['```TS', 'a', '```', '```ts', 'b', '```'].join('\n');

    expect(fencedLanguages(body)).toEqual(['ts', 'ts']);
  });

  test('a fence indented three spaces is read and one indented four is not', () => {
    expect(fencedLanguages('   ```go\n')).toEqual(['go']);
    expect(fencedLanguages('    ```go\n')).toEqual([]);
  });

  test('a bare fence carries no info string', () => {
    expect(fencedLanguages('```\nplain\n```\n')).toEqual([]);
  });
});

describe('inference from a body', () => {
  test('a fenced language becomes its stack', () => {
    expect(inferStacks('```kotlin\nval x = 1\n```\n')).toEqual(['kotlin']);
  });

  test('a fence alias resolves to the canonical name', () => {
    expect(inferStacks('```ts\nconst a = 1;\n```\n')).toEqual(['typescript']);
    expect(inferStacks('```bash\nls\n```\n')).toEqual(['shell']);
  });

  test('every alias in the table names a language in the vocabulary', () => {
    for (const name of Object.values(FENCE_LANGUAGE_ALIASES)) {
      expect(LANGUAGE_STACKS).toContain(name);
    }
  });

  test('a rendering-only info string names no stack', () => {
    expect(inferStacks('```console\n$ ls\n```\n')).toEqual([]);
    expect(inferStacks('```text\nhello\n```\n')).toEqual([]);
    expect(inferStacks('```diff\n-a\n+b\n```\n')).toEqual([]);
  });

  test('a path, a glob and a bare extension each name their stack', () => {
    expect(inferStacks('edit src/main/Thing.kt next')).toEqual(['kotlin']);
    expect(inferStacks('gated on **/*.py today')).toEqual(['python']);
    expect(inferStacks('a file ending in .rb')).toEqual(['ruby']);
  });

  test('a mention closing a sentence is still read', () => {
    expect(inferStacks('see src/main.py.')).toEqual(['python']);
  });

  test('an extension running into more word characters names nothing', () => {
    expect(inferStacks('a backup at src/main.py_old')).toEqual([]);
    expect(inferStacks('a backup at src/main.py')).toEqual(['python']);
  });

  test('prose punctuation that looks like an extension names nothing', () => {
    const prose = [
      'A body with no code at all, e.g. this one, and etc. besides.',
      'It pins version 1.2.3 and calls Bun.YAML.parse on the result.',
      'See README.md and the notes in CHANGELOG.md for the rest.',
    ].join('\n');

    expect(inferStacks(prose)).toEqual([]);
  });

  test('a mention repeated in prose and in a fence is returned once', () => {
    const body = ['The file src/a.ts and src/b.ts.', '```typescript', 'const a = 1;', '```'].join('\n');

    expect(inferStacks(body)).toEqual(['typescript']);
  });

  test('several stacks come back in vocabulary order, not body order', () => {
    const body = ['```typescript', 'const a = 1;', '```', '```go', 'package main', '```'].join('\n');

    expect(inferStacks(body)).toEqual(['go', 'typescript']);
  });

  test('a platform is never inferred, only the language under it', () => {
    const body = ['```dart', 'void main() {}', '```', 'and lib/main.dart beside pubspec.yaml'].join('\n');

    expect(inferStacks(body)).toEqual(['dart']);
    expect(inferStacks(body)).not.toContain('flutter');
  });

  test('an empty body infers nothing', () => {
    expect(inferStacks('')).toEqual([]);
  });
});

describe('the ECC directory-name table', () => {
  test('every measured directory name reads back its stacks', () => {
    for (const [directory, expected] of Object.entries(ECC_SKILL_DIRECTORIES)) {
      expect([...stacksFromEccSkillName(directory)]).toEqual([...expected]);
    }
  });

  test('the measured corpus splits into stack-bearing and agnostic names', () => {
    const named = Object.values(ECC_SKILL_DIRECTORIES).filter((stacks) => stacks.length > 0);

    expect(Object.keys(ECC_SKILL_DIRECTORIES)).toHaveLength(61);
    expect(named).toHaveLength(38);
  });

  test('a two-token key outranks the one-token key inside it', () => {
    expect([...stacksFromEccSkillName('dart-flutter-patterns')]).toEqual(['dart', 'flutter']);
    expect([...stacksFromEccSkillName('dart-testing')]).toEqual(['dart']);
  });

  test('the name is matched case-insensitively', () => {
    expect([...stacksFromEccSkillName('Kotlin-Testing')]).toEqual(['kotlin']);
  });

  test('a name with no stack prefix yields nothing rather than a guess', () => {
    expect(stacksFromEccSkillName('verification-loop')).toEqual([]);
    expect(stacksFromEccSkillName('')).toEqual([]);
    expect(stacksFromEccSkillName('---')).toEqual([]);
  });

  test('every stack the table names is in the vocabulary', () => {
    for (const stacks of Object.values(ECC_STACK_PREFIXES)) {
      for (const name of stacks) {
        expect(isStackName(name)).toBe(true);
      }
    }
  });

  test('every stack the table names carries globs or is ungated on purpose', () => {
    for (const stacks of Object.values(ECC_STACK_PREFIXES)) {
      for (const name of stacks) {
        const gated = stackGlobs(name).length > 0;

        expect(gated || (UNGATED_STACKS as readonly string[]).includes(name)).toBe(true);
      }
    }
  });
});

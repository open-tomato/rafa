/**
 * The controlled vocabulary a skill's `stack` field draws from, the
 * globs each name gates on, and the two ways a name is guessed rather
 * than written.
 *
 * `tags` on a skill are free text, and `stack` deliberately is not.
 * The field answers one question — WOULD THIS SKILL EVER APPLY HERE —
 * and two consumers ask it. rafa's index drops a skill whose stack the
 * consuming project does not carry, and Claude Code's own loader skips
 * a skill whose `paths` no file matches (the spec's Q7 answer for
 * ECC's stack skills). Both readers have to agree, and they only can
 * if the name is drawn from a closed set with a glob table beside it:
 * a free-text `stack: [kotlin-jvm]` is a name rafa cannot translate
 * into a `paths` entry, so the skill would load everywhere while
 * appearing gated.
 *
 * ## Three kinds of name, one vocabulary
 *
 * The set is the union of three tables, and which table a name sits in
 * is the record of what evidence its gate has:
 *
 *   - {@link LANGUAGE_EXTENSIONS} — a language, keyed to the file
 *     extensions that ARE that language. Its globs are derived from
 *     the extensions rather than written twice, so a language's gate
 *     and its inference can never disagree.
 *   - {@link PLATFORM_GLOBS} — a framework, runtime or OS target,
 *     whose globs are written out because a platform is recognised by
 *     a manifest as much as by an extension (`**\/pubspec.yaml` says
 *     Flutter where `**\/*.dart` only says Dart).
 *   - {@link UNGATED_STACKS} — a name no file in a tree reliably
 *     announces. A Postgres project and a MySQL project both hold
 *     `.sql` files, so `postgres` gates on NOTHING rather than on a
 *     glob that would match the wrong tree. {@link stackGlobs} returns
 *     an empty list for these on purpose, and a skill with `stack:
 *     [typescript, postgres]` is gated by its TypeScript half alone.
 *
 * A stack with no glob is the reason {@link stackPaths} can return an
 * empty array for a non-agnostic stack list, and the reason the
 * checker cannot require `paths` merely because `stack` is not
 * `[agnostic]`.
 *
 * ## `agnostic` is not a name
 *
 * {@link AGNOSTIC_STACK} is a sentinel, not a member of
 * {@link STACK_NAMES}, and the schema accepts it only as the whole
 * list. `stack: [agnostic, kotlin]` is a contradiction — either the
 * skill applies everywhere or it needs Kotlin files — so
 * {@link isStackList} refuses it rather than quietly dropping one
 * half. {@link isStackName} answers for the names alone, which is what
 * a `--fix` writing an inferred list needs.
 *
 * ## Inference is language-level, and only ever a suggestion
 *
 * {@link inferStacks} reads a skill BODY, which is prose plus fenced
 * blocks, and the two things in it that name a stack without being
 * about one are a fence's info string and a file extension. Neither
 * can name a platform: a body full of `.dart` does not say whether the
 * project is Flutter, so inference returns language names only and a
 * platform is always written by hand or taken from
 * {@link stacksFromEccSkillName}. That is a deliberate floor, not a
 * gap — a wrong `stack` gates a useful skill out of every project,
 * which is the failure mode nobody notices.
 *
 * The extension scan is loose by design and its looseness is named:
 * `Node.js` in prose infers `javascript`, because the token is
 * indistinguishable from a filename and a body discussing Node is
 * rarely the wrong place for that guess. What it does NOT do is fire
 * on prose punctuation or versions — `e.g.`, `etc.` and `1.2.3` are
 * each rejected, and `stack.test.ts` holds them as controls, so a
 * reading of "no stacks inferred" from a prose-only body is one that
 * could have come out otherwise.
 *
 * ## The ECC table
 *
 * {@link ECC_STACK_PREFIXES} maps a skill DIRECTORY name onto stacks,
 * keyed on the longest leading hyphen-token run rather than on whole
 * names, because the corpus names a stack skill `<stack>-<concern>`
 * (`kotlin-testing`, `django-tdd`, `springboot-verification`) and the
 * concern half is open-ended. A directory whose leading tokens match
 * nothing yields an empty list, which the backfill reads as agnostic:
 * `verification-loop` and `code-tour` are ECC skills about no stack at
 * all, and inventing one for them would gate them out of everything.
 *
 * Nothing here throws, nothing reads a file and nothing reads the
 * home. Every table is a literal, and the corpus it was measured
 * against is pinned as a literal in `stack.test.ts` for the same
 * reason — a test that reads `~/.claude/skills` would pass on this
 * machine and on no other.
 */

/** The file extensions that identify each language in the vocabulary. */
export const LANGUAGE_EXTENSIONS = {
  arkts: ['ets'],
  c: ['c', 'h'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh'],
  csharp: ['cs'],
  css: ['css', 'scss'],
  dart: ['dart'],
  elixir: ['ex', 'exs'],
  fsharp: ['fs', 'fsx'],
  go: ['go'],
  haskell: ['hs'],
  html: ['html', 'htm'],
  java: ['java'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  kotlin: ['kt', 'kts'],
  lua: ['lua'],
  perl: ['pl', 'pm'],
  php: ['php'],
  python: ['py'],
  ruby: ['rb'],
  rust: ['rs'],
  scala: ['scala', 'sc'],
  shell: ['sh', 'bash', 'zsh'],
  sql: ['sql'],
  swift: ['swift'],
  typescript: ['ts', 'tsx'],
  zig: ['zig'],
} as const;

/**
 * The globs that identify each platform. A manifest comes first, since
 * it is the entry that distinguishes the platform from the language it
 * is written in.
 */
export const PLATFORM_GLOBS = {
  android: ['**/AndroidManifest.xml', '**/*.kt', '**/*.java'],
  angular: ['**/angular.json', '**/*.ts'],
  bun: ['**/bun.lock', '**/bun.lockb', '**/bunfig.toml'],
  deno: ['**/deno.json', '**/deno.jsonc'],
  django: ['**/manage.py', '**/*.py'],
  docker: ['**/Dockerfile', '**/docker-compose*.yml'],
  dotnet: ['**/*.csproj', '**/*.sln', '**/*.cs'],
  flutter: ['**/pubspec.yaml', '**/*.dart'],
  ios: ['**/*.xcodeproj/**', '**/*.swift'],
  laravel: ['**/artisan', '**/*.php'],
  nestjs: ['**/nest-cli.json', '**/*.ts'],
  node: ['**/package.json'],
  quarkus: ['**/pom.xml', '**/*.java'],
  react: ['**/*.tsx', '**/*.jsx'],
  springboot: ['**/pom.xml', '**/build.gradle*', '**/*.java', '**/*.kt'],
  terraform: ['**/*.tf'],
  windows: ['**/*.sln', '**/*.ps1'],
} as const;

/**
 * Vocabulary names with no file gate at all. Each is a service whose
 * presence a tree does not announce: two projects holding identical
 * `.sql` files may run on either engine, so gating on the extension
 * would load the wrong skill as confidently as the right one.
 */
export const UNGATED_STACKS = [
  'mongodb',
  'mysql',
  'postgres',
  'redis',
] as const;

/** The sentinel a skill uses to say it applies to every stack. */
export const AGNOSTIC_STACK = 'agnostic';

/** A language name in the vocabulary. */
export type LanguageStack = keyof typeof LANGUAGE_EXTENSIONS;

/** A platform name in the vocabulary. */
export type PlatformStack = keyof typeof PLATFORM_GLOBS;

/** Any name a skill's `stack` list may hold. */
export type StackName = LanguageStack | PlatformStack | typeof UNGATED_STACKS[number];

/** A `stack` list entry: a vocabulary name or the agnostic sentinel. */
export type StackValue = StackName | typeof AGNOSTIC_STACK;

const languageNames = Object.keys(LANGUAGE_EXTENSIONS) as LanguageStack[];
const platformNames = Object.keys(PLATFORM_GLOBS) as PlatformStack[];

/**
 * Every vocabulary name, sorted, with {@link AGNOSTIC_STACK} absent.
 * The order is the one a generated `stack` list is written in, so two
 * runs of `--fix` over the same body produce the same bytes.
 */
export const STACK_NAMES: readonly StackName[] = [
  ...languageNames,
  ...platformNames,
  ...UNGATED_STACKS,
].sort((a, b) => a.localeCompare(b));

/** Language names alone, sorted; the only names inference can return. */
export const LANGUAGE_STACKS: readonly LanguageStack[] = [...languageNames]
  .sort((a, b) => a.localeCompare(b));

const stackNameSet = new Set<string>(STACK_NAMES);

/** Whether `value` is a vocabulary name. `agnostic` is not one. */
export function isStackName(value: string): value is StackName {
  return stackNameSet.has(value);
}

/** Whether `value` is a vocabulary name or the agnostic sentinel. */
export function isStackValue(value: string): value is StackValue {
  return value === AGNOSTIC_STACK || stackNameSet.has(value);
}

/**
 * Whether `values` is exactly the agnostic list. One entry, spelled
 * {@link AGNOSTIC_STACK}; `[agnostic, kotlin]` is not agnostic and not
 * a valid list either.
 */
export function isAgnosticStackList(values: readonly string[]): boolean {
  return values.length === 1 && values[0] === AGNOSTIC_STACK;
}

/**
 * Whether `values` is a usable `stack` list: either exactly
 * `[agnostic]`, or one or more vocabulary names with no sentinel mixed
 * in. An empty list is not usable — a skill has to say something.
 */
export function isStackList(values: readonly string[]): boolean {
  if (isAgnosticStackList(values)) {
    return true;
  }
  return values.length > 0 && values.every((value) => isStackName(value));
}

/**
 * The entries of `values` that are not vocabulary names, in the order
 * given, so a checker can name every offender in one message rather
 * than the first. {@link AGNOSTIC_STACK} counts as unknown here unless
 * it is the whole list, which is the rule {@link isStackList} states.
 */
export function unknownStacks(values: readonly string[]): string[] {
  if (isAgnosticStackList(values)) {
    return [];
  }
  return values.filter((value) => !isStackName(value));
}

const globTable = new Map<StackName, readonly string[]>();
for (const name of languageNames) {
  globTable.set(name, LANGUAGE_EXTENSIONS[name].map((ext) => `**/*.${ext}`));
}
for (const name of platformNames) {
  globTable.set(name, PLATFORM_GLOBS[name]);
}
for (const name of UNGATED_STACKS) {
  globTable.set(name, []);
}

/**
 * The globs `name` gates on. Empty for an {@link UNGATED_STACKS} name
 * and for anything outside the vocabulary; a language's list is
 * derived from {@link LANGUAGE_EXTENSIONS}.
 */
export function stackGlobs(name: string): readonly string[] {
  return globTable.get(name as StackName) ?? [];
}

/**
 * The `paths` value for a `stack` list: every stack's globs in the
 * order the stacks were given, each glob once. Empty for the agnostic
 * list — a skill that applies everywhere is gated by nothing — and
 * empty for a list of {@link UNGATED_STACKS} names, which is why the
 * checker cannot infer a missing `paths` from a non-agnostic `stack`.
 */
export function stackPaths(values: readonly string[]): string[] {
  if (isAgnosticStackList(values)) {
    return [];
  }
  const paths: string[] = [];
  for (const value of values) {
    for (const glob of stackGlobs(value)) {
      if (!paths.includes(glob)) {
        paths.push(glob);
      }
    }
  }
  return paths;
}

/**
 * Fence info strings that name a language, beyond the language names
 * themselves. `console`, `text`, `diff` and friends are absent on
 * purpose: they say how a block is rendered, not what stack it needs.
 */
export const FENCE_LANGUAGE_ALIASES: Readonly<Record<string, LanguageStack>> = {
  'c++': 'cpp',
  bash: 'shell',
  cjs: 'javascript',
  cs: 'csharp',
  ets: 'arkts',
  fs: 'fsharp',
  golang: 'go',
  hs: 'haskell',
  js: 'javascript',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  mjs: 'javascript',
  pl: 'perl',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  ts: 'typescript',
  tsx: 'typescript',
  zsh: 'shell',
};

const fenceTable = new Map<string, LanguageStack>();
for (const name of languageNames) {
  fenceTable.set(name, name);
}
for (const [alias, name] of Object.entries(FENCE_LANGUAGE_ALIASES)) {
  fenceTable.set(alias, name);
}

const extensionTable = new Map<string, LanguageStack>();
for (const name of languageNames) {
  for (const ext of LANGUAGE_EXTENSIONS[name]) {
    if (!extensionTable.has(ext)) {
      extensionTable.set(ext, name);
    }
  }
}

/** A fenced block's opening line, with its info string captured. */
const FENCE_OPEN = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9+#_-]+)/;

/**
 * A filename-shaped or glob-shaped token, with its extension
 * captured. It accepts `src/foo.ts`, `**\/*.kt`, a bare `.py` and a
 * sentence-final `src/main.py.`
 *
 * What rejects prose is the extension TABLE, not this pattern, and
 * that was measured rather than assumed: with both boundary
 * assertions removed the pattern still captures `g` from `e.g.` and
 * `parse` from `Bun.YAML.parse`, and every prose case in
 * `stack.test.ts` stays green, because neither capture is an
 * extension any language claims. A leading lookbehind was tried and
 * dropped for the same reason — no body could be found that it
 * changed the reading of — and it cost a real mention: with
 * `(?![\w.])` closing the pattern, `see src/main.py.` inferred
 * NOTHING, since the sentence period blocked the assertion.
 *
 * The trailing `(?!\w)` is the one assertion that earns its place,
 * and `main.py_old` is where: without it that token reads as Python,
 * with it as nothing. Versions are refused by the capture requiring a
 * leading letter, so `1.2.3` names no stack.
 */
const EXTENSION_TOKEN = /[\w*@/\\.-]*\.([A-Za-z][A-Za-z0-9+]{0,7})(?!\w)/g;

/** The language a fenced block's info string names, if any. */
function fenceStack(info: string): LanguageStack | undefined {
  return fenceTable.get(info.toLowerCase());
}

/**
 * The fence info strings of `body`, lowercased, in order and with
 * repeats kept. Exported because the checker reports on the fenced
 * commands of a body and wants the same reading of what a fence is.
 */
export function fencedLanguages(body: string): string[] {
  const found: string[] = [];
  for (const line of body.split('\n')) {
    const info = FENCE_OPEN.exec(line)?.[1];
    if (info) {
      found.push(info.toLowerCase());
    }
  }
  return found;
}

/**
 * The languages `body` mentions through fenced blocks and through
 * file extensions, in {@link STACK_NAMES} order and each once.
 *
 * Only language names are ever returned; see this module's note on why
 * a platform is never inferred.
 */
export function inferStacks(body: string): LanguageStack[] {
  const found = new Set<LanguageStack>();
  for (const info of fencedLanguages(body)) {
    const stack = fenceStack(info);
    if (stack) {
      found.add(stack);
    }
  }
  for (const match of body.matchAll(EXTENSION_TOKEN)) {
    const extension = match[1];
    if (!extension) {
      continue;
    }
    const stack = extensionTable.get(extension.toLowerCase());
    if (stack) {
      found.add(stack);
    }
  }
  return LANGUAGE_STACKS.filter((name) => found.has(name));
}

/**
 * ECC skill directory-name prefixes and the stacks they mean. A key is
 * the leading hyphen-token run of a directory name, so `kotlin` covers
 * `kotlin-testing` and `kotlin-ktor-patterns` both, and a two-token
 * key is used wherever one token would over-reach.
 *
 * Several keys map to a language AND its platform, because that is
 * what the gate needs: a Laravel skill is useless without PHP files,
 * so `laravel-tdd` carries both and inherits both sets of globs.
 *
 * Keys the measured corpus does not use yet (`ruby`, `swift`, `dart`,
 * `php`, `typescript`) are here because the naming rule is the
 * corpus's, not those names': a `swift-testing` added tomorrow reads
 * the same way `kotlin-testing` does today. `stack.test.ts` pins which
 * keys the corpus actually exercises.
 */
export const ECC_STACK_PREFIXES: Readonly<Record<string, readonly StackName[]>> = {
  'compose-multiplatform': ['kotlin'],
  'dart-flutter': ['dart', 'flutter'],
  'windows-desktop': ['windows'],
  android: ['kotlin', 'android'],
  angular: ['typescript', 'angular'],
  cpp: ['cpp'],
  csharp: ['csharp'],
  dart: ['dart'],
  django: ['python', 'django'],
  dotnet: ['csharp', 'dotnet'],
  fsharp: ['fsharp'],
  golang: ['go'],
  java: ['java'],
  kotlin: ['kotlin'],
  laravel: ['php', 'laravel'],
  nestjs: ['typescript', 'nestjs'],
  perl: ['perl'],
  php: ['php'],
  python: ['python'],
  quarkus: ['java', 'quarkus'],
  ruby: ['ruby'],
  rust: ['rust'],
  springboot: ['java', 'springboot'],
  swift: ['swift'],
  typescript: ['typescript'],
};

/** How many leading hyphen tokens a prefix key may span. */
const MAX_PREFIX_TOKENS = 2;

/**
 * The stacks an ECC skill directory name declares, longest leading
 * token run first. Empty for a name about no stack, which the backfill
 * reads as `[agnostic]`.
 */
export function stacksFromEccSkillName(directory: string): readonly StackName[] {
  const tokens = directory
    .toLowerCase()
    .split('-')
    .filter((token) => token.length > 0);
  const span = Math.min(MAX_PREFIX_TOKENS, tokens.length);
  for (let width = span; width >= 1; width -= 1) {
    const found = ECC_STACK_PREFIXES[tokens.slice(0, width).join('-')];
    if (found) {
      return found;
    }
  }
  return [];
}

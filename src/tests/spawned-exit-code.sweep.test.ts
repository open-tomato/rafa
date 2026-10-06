/**
 * Sweep: a test that spawns rafa asserts the run's exit code with
 * `expectExit` (`src/tests/cli-capture.ts`), never with a bare
 * `expect(run.exitCode).toBe(n)`. A red bare assertion prints two numbers;
 * `expectExit` prints the child's stderr, stdout and scratch paths, so a
 * red spawned run says why it is red (#775).
 *
 * A file can hold both kinds of run: `doctor.test.ts` spawns rafa in three
 * cases and asserts an in-process `doctor()` result bare in the others,
 * which stay bare. So the sweep judges each assertion by where its value
 * comes from, not the file by what it holds. The source is parsed with
 * TypeScript, so a comment or a string holding either shape is no reading,
 * and two detectors run over it:
 *
 * - the spawned-rafa detector ({@link spawnsRafa}) answers whether an
 *   expression spawns rafa. A spawn of rafa is one of: a `Bun.spawn`,
 *   `Bun.spawnSync` or `node:child_process` call whose command names the
 *   rafa entry and whose program is not some other literal one (`'git'`,
 *   `'sh'`); the same through a command wrapper the file declares
 *   (`run(command, cwd, env)`), judged by the command each call hands it;
 *   a call of the shared runners `runRafa`, `startRafa` and
 *   `runLoopStart`; or a call of a function the file declares around any
 *   of these, found again until no new one turns up. A command names the
 *   entry with a `rafa.ts` or `cli.js` path literal, the `RAFA_ENTRY`
 *   import, or a name whose own declaration holds one of those;
 * - the bare-assertion detector ({@link bareExitAssertions}) finds each
 *   `expect(<value>.exitCode).toBe(...)`, and each `expect(exitCode).toBe(...)`
 *   on a name destructured from a run, with no `.not` between. It follows
 *   `<value>`'s leftmost name to its declaration in the enclosing scopes
 *   (for a bare `let`, to each assignment to it there) and hands what it
 *   finds, or the expression itself when it is inline, to the first
 *   detector.
 *
 * Every name is read in its own scope, so a `run` or `probe` bound to rafa
 * in one case says nothing about another case's. What neither detector
 * follows: a run handed in as a parameter, a value read through a second
 * variable (`const code = await proc.exited`), and the tuple and
 * `.not.toBe` shapes, which Bug sweep 12 left as they are because they
 * print the run in the diff or assert no equality. Each detector's answers
 * have planted-source cases below.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';

const REPO_ROOT = join(import.meta.dir, '..', '..');

/** Callees that start a process: Bun's and `node:child_process`'s. */
const SPAWN_CALLEES: ReadonlySet<string> = new Set([
  'Bun.spawn',
  'Bun.spawnSync',
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
]);

/** The shared helpers in `src/tests/` that spawn `bun src/rafa.ts`. */
const SHARED_RUNNERS: ReadonlySet<string> = new Set(['runRafa', 'startRafa', 'runLoopStart']);

/** The rafa entry's name, as the constant `src/tests/loop-scratch.ts` exports and files copy. */
const ENTRY_CONSTANT = 'RAFA_ENTRY';

/** A path literal naming the rafa entry: the source entry or a built one, not `fake-rafa.ts`. */
const ENTRY_PATH = /(^|\/)(rafa\.ts|cli\.js)$/;

/** The one program literal a spawn of rafa may name first: the bun that runs the entry. */
const BUN_PROGRAM = 'bun';

/** One bare exit-code assertion on a spawned rafa run, as the sweep names it. */
interface BareAssertion {
  /** 1-based line of the `expect` call. */
  readonly line: number;
  /** The assertion's source text, on one line. */
  readonly text: string;
}

/** What a source declares that the spawned-rafa detector reads by name. */
interface RafaNames {
  /** Names bound to the entry by import (`RAFA_ENTRY` and its aliases), for a name no scope declares. */
  readonly imported: ReadonlySet<string>;
  /**
   * The file's own command wrappers (`run(command, cwd, env)`), each with
   * the indices of the parameters it passes into a spawn's command.
   */
  readonly spawners: ReadonlyMap<string, readonly number[]>;
  /** Functions that spawn rafa: the shared runners and the file's own wrappers of one. */
  readonly runners: ReadonlySet<string>;
}

/** A function the source declares by name. */
interface NamedFunction {
  readonly name: string;
  /** Its parameters' names in order, null where one is destructured. */
  readonly parameters: ReadonlyArray<string | null>;
  readonly body: ts.Node;
}

/** Node's callees that take the program and its arguments apart; Bun's take one command array. */
const SPLIT_COMMAND_CALLEES: ReadonlySet<string> = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync']);

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** True when `node` or any node below it satisfies `match`. */
function holds(node: ts.Node, match: (inner: ts.Node) => boolean): boolean {
  if (match(node)) return true;
  return ts.forEachChild(node, (child) => holds(child, match) || undefined) === true;
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** The callee of a call as dotted text (`Bun.spawnSync`), or null when it is no plain name chain. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return `${callee.expression.text}.${callee.name.text}`;
  }
  return null;
}

/** True when an identifier is a member name (`env` in `scratch.env`), which no scope binds. */
function isMemberName(node: ts.Identifier): boolean {
  const { parent } = node;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node);
}

/**
 * True when `node` names the rafa entry: a path literal ending in it, or
 * a name whose declaration in the enclosing scopes holds one and starts
 * no process. A name no scope declares names it when an import binds it
 * to the entry. `seen` stops a name read through itself.
 */
function namesEntry(node: ts.Node, names: RafaNames, seen: ReadonlySet<ts.Node> = new Set()): boolean {
  if (ts.isStringLiteralLike(node)) return ENTRY_PATH.test(node.text);
  if (!ts.isIdentifier(node) || isMemberName(node)) return false;
  const values = valuesOf(node, node.text).filter((value) => !seen.has(value));
  if (values.length === 0) return names.imported.has(node.text);
  return values.some((value) => !startsProcess(value, names.spawners)
    && holds(value, (inner) => namesEntry(inner, names, new Set([...seen, value]))));
}

/**
 * The arguments of a call that spell what it runs: the command array of
 * a Bun spawn, the program and arguments of a node one, the parameters a
 * command spawner passes on. Null for a call that starts no process.
 */
function commandOf(call: ts.CallExpression, spawners: RafaNames['spawners']): ts.Expression[] | null {
  const callee = calleeName(call);
  if (callee === null) return null;
  if (SPAWN_CALLEES.has(callee)) {
    return call.arguments.slice(0, SPLIT_COMMAND_CALLEES.has(callee)
      ? 2
      : 1);
  }
  const passed = spawners.get(callee);
  if (passed === undefined) return null;
  return passed.flatMap((index) => {
    const argument = call.arguments[index];
    return argument === undefined
      ? []
      : [argument];
  });
}

/** The program a command starts when it is spelled as a string literal, or null. */
function literalProgram(command: ts.Expression): string | null {
  const program = ts.isArrayLiteralExpression(command)
    ? command.elements[0]
    : command;
  return program !== undefined && ts.isStringLiteralLike(program)
    ? program.text
    : null;
}

/** True when `call` starts a process running the rafa entry, directly or through a command spawner. */
function isEntrySpawn(call: ts.CallExpression, names: RafaNames): boolean {
  const command = commandOf(call, names.spawners);
  const [first] = command ?? [];
  if (command === null || first === undefined) return false;
  const program = literalProgram(first);
  if (program !== null && program !== BUN_PROGRAM && !ENTRY_PATH.test(program)) return false;
  return command.some((argument) => holds(argument, (inner) => namesEntry(inner, names)));
}

/** True when `call` spawns rafa: a spawn of the entry, or a call of a runner. */
function isRafaCall(call: ts.CallExpression, names: RafaNames): boolean {
  const callee = calleeName(call);
  return (callee !== null && names.runners.has(callee)) || isEntrySpawn(call, names);
}

/**
 * The spawned-rafa detector: true when `node` holds a call that spawns
 * rafa, under the names `names` gives.
 */
function spawnsRafa(node: ts.Node, names: RafaNames): boolean {
  return holds(node, (inner) => ts.isCallExpression(inner) && isRafaCall(inner, names));
}

/** The names of a function's parameters in order, null where one is destructured. */
function parameterNames(fn: ts.SignatureDeclaration): Array<string | null> {
  return fn.parameters.map((parameter) => ts.isIdentifier(parameter.name)
    ? parameter.name.text
    : null);
}

/** Each function the source declares by name. */
function namedFunctions(file: ts.SourceFile): NamedFunction[] {
  const found: NamedFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      found.push({ name: node.name.text, parameters: parameterNames(node), body: node.body });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined && isFunctionLike(node.initializer)) {
      found.push({ name: node.name.text, parameters: parameterNames(node.initializer), body: node.initializer.body });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Local names an import binds to the entry constant (`import { RAFA_ENTRY as ENTRY }`). */
function importedEntries(file: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === ENTRY_CONSTANT) {
      found.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Adds each name whose value `qualifies` until a pass adds none; answers the grown set. */
function grow(
  seed: ReadonlySet<string>,
  candidates: ReadonlyArray<readonly [string, ts.Node]>,
  qualifies: (node: ts.Node, known: ReadonlySet<string>) => boolean,
): Set<string> {
  const known = new Set(seed);
  let added = true;
  while (added) {
    added = false;
    for (const [name, node] of candidates) {
      if (known.has(name) || !qualifies(node, known)) continue;
      known.add(name);
      added = true;
    }
  }
  return known;
}

/** The indices of the parameters of `fn` that reach the command of a process its body starts. */
function passedParameters(fn: NamedFunction, spawners: RafaNames['spawners']): number[] {
  const commands: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) commands.push(...commandOf(node, spawners) ?? []);
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  const reaches = (parameter: string): boolean => commands.some((command) => holds(
    command,
    (inner) => ts.isIdentifier(inner) && inner.text === parameter,
  ));
  return fn.parameters.flatMap((parameter, index) => parameter !== null && reaches(parameter)
    ? [index]
    : []);
}

/** The file's command spawners, each found through the spawns of the ones before it. */
function commandSpawners(functions: readonly NamedFunction[]): Map<string, readonly number[]> {
  const spawners = new Map<string, readonly number[]>();
  let added = true;
  while (added) {
    added = false;
    for (const fn of functions) {
      if (spawners.has(fn.name)) continue;
      const passed = passedParameters(fn, spawners);
      if (passed.length === 0) continue;
      spawners.set(fn.name, passed);
      added = true;
    }
  }
  return spawners;
}

/** True when `node` holds a call that starts a process or runs a shared runner. */
function startsProcess(node: ts.Node, spawners: RafaNames['spawners']): boolean {
  return holds(node, (inner) => ts.isCallExpression(inner)
    && (commandOf(inner, spawners) !== null || SHARED_RUNNERS.has(calleeName(inner) ?? '')));
}

/**
 * The names of a source the spawned-rafa detector reads. A command
 * spawner is a function passing a parameter into a spawn's command; a
 * runner is a shared one or a function whose body spawns rafa, which may
 * itself be through a runner found on an earlier pass. Every other name
 * is read where it is used ({@link namesEntry}).
 */
function rafaNames(file: ts.SourceFile): RafaNames {
  const functions = namedFunctions(file);
  const spawners = commandSpawners(functions);
  const imported = new Set([ENTRY_CONSTANT, ...importedEntries(file)]);
  const bodies = functions.map(({ name, body }) => [name, body] as const);
  const runners = grow(SHARED_RUNNERS, bodies, (body, known) => spawnsRafa(body, { imported, spawners, runners: known }));
  return { imported, spawners, runners };
}

/** True when the declaration binds `name`, plainly or by destructuring. */
function bindsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, name));
}

/** The statements of a scope node, or null when the node opens no block scope. */
function statementsOf(node: ts.Node): ts.NodeArray<ts.Statement> | null {
  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node)
    || ts.isDefaultClause(node)) {
    return node.statements;
  }
  return null;
}

/** The variable declaration binding `name` among a scope's own statements, or null. */
function declaredIn(statements: ts.NodeArray<ts.Statement>, name: string): ts.VariableDeclaration | null {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const found = statement.declarationList.declarations.find((declaration) => bindsName(declaration.name, name));
    if (found !== undefined) return found;
  }
  return null;
}

/** True when a function between `from` and its scope takes `name` as a parameter. */
function isParameterOf(node: ts.Node, name: string): boolean {
  return ts.isFunctionLike(node) && node.parameters.some((parameter) => bindsName(parameter.name, name));
}

/** The right side of each assignment to `name` below `scope`. */
function assignedIn(scope: ts.Node, name: string): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left) && node.left.text === name) {
      found.push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/**
 * The expressions `name` holds at `from`: the initializer of the nearest
 * enclosing declaration, or, for a `let` declared bare, the right side of
 * each assignment to it in that scope. Empty for a parameter or a name
 * the source never binds.
 */
function valuesOf(from: ts.Node, name: string): ts.Expression[] {
  for (let scope: ts.Node | undefined = from.parent; scope !== undefined; scope = scope.parent) {
    if (isParameterOf(scope, name)) return [];
    const statements = statementsOf(scope);
    const declaration = statements === null
      ? null
      : declaredIn(statements, name);
    if (declaration === null) continue;
    return declaration.initializer === undefined
      ? assignedIn(scope, name)
      : [declaration.initializer];
  }
  return [];
}

/** The leftmost name of an access chain (`good` in `good.run.exitCode`), or null. */
function rootName(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
    || ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current)
    ? current.text
    : null;
}

/**
 * The value an asserted exit code is read from: `run` in `run.exitCode`,
 * `exitCode` when it is a bare name. Null for any other argument.
 */
function exitCodeSubject(argument: ts.Expression): ts.Expression | null {
  if (ts.isPropertyAccessExpression(argument) && argument.name.text === 'exitCode') return argument.expression;
  if (ts.isIdentifier(argument) && argument.text === 'exitCode') return argument;
  return null;
}

/** The single argument of `expect(x).toBe(...)`, with no `.not` between; null for any other call. */
function bareToBeArgument(call: ts.CallExpression): ts.Expression | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'toBe') return null;
  const inner = callee.expression;
  if (!ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression) || inner.expression.text !== 'expect') {
    return null;
  }
  const [argument] = inner.arguments;
  return inner.arguments.length === 1 && argument !== undefined
    ? argument
    : null;
}

/** True when the value an exit code is read from comes from spawning rafa. */
function isSpawnedRun(subject: ts.Expression, names: RafaNames): boolean {
  if (spawnsRafa(subject, names)) return true;
  const name = rootName(subject);
  if (name === null) return false;
  return valuesOf(subject, name).some((value) => spawnsRafa(value, names));
}

/**
 * The bare-assertion detector: each `expect(<run>.exitCode).toBe(...)`
 * in `source` whose run the spawned-rafa detector reads as a spawn of
 * rafa, in source order.
 */
function bareExitAssertions(source: string): BareAssertion[] {
  const file = parse(source);
  const names = rafaNames(file);
  const found: BareAssertion[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const argument = bareToBeArgument(node);
      const subject = argument === null
        ? null
        : exitCodeSubject(argument);
      if (subject !== null && isSpawnedRun(subject, names)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push({ line: line + 1, text: node.getText(file).replace(/\s+/g, ' ') });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The tracked test files under `src/`, repo-relative. */
function trackedTests(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'src/*.test.ts'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '');
}

/** `<path>:<line>: <assertion>` for each bare assertion on a spawned run across `paths`. */
async function offenders(paths: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) {
    const source = await Bun.file(join(REPO_ROOT, path)).text();
    for (const { line, text } of bareExitAssertions(source)) found.push(`${path}:${line}: ${text}`);
  }
  return found;
}

/** A planted test source: the given lines after the imports a spawned-rafa test carries. */
function planted(...lines: string[]): string {
  return [
    'import { expectExit, plantScratchRepo, runRafa } from \'./cli-capture\';',
    'import { dispatchCaptured } from \'./cli-capture\';',
    ...lines,
  ].join('\n');
}

const SPAWNED_BARE = planted(
  'test(\'refuses\', () => {',
  '  const scratch = plantScratchRepo(base);',
  '  const run = runRafa(scratch, scratch.repo, [\'doctor\']);',
  '  expect(run.exitCode).toBe(1);',
  '});',
);

const SPAWNED_EXPECT_EXIT = planted(
  'test(\'refuses\', () => {',
  '  const scratch = plantScratchRepo(base);',
  '  const run = runRafa(scratch, scratch.repo, [\'doctor\']);',
  '  expectExit(run, 1, scratch);',
  '});',
);

describe('spawned exit codes', () => {
  test('no test file under src/ asserts a spawned rafa run\'s exit code bare', async () => {
    const found = await offenders(trackedTests());

    expect(found, `assert these with expectExit from src/tests/cli-capture.ts:\n${found.join('\n')}`).toEqual([]);
  });

  test('the listing holds the files the moves touched, so an empty answer is not an empty read', () => {
    const listing = trackedTests();

    expect(listing).toContain('src/commands/doctor.test.ts');
    expect(listing).toContain('src/tests/loop-output.test.ts');
  });
});

describe('bare-assertion detector over planted sources', () => {
  test('flags a spawned-rafa file asserting the exit code bare', () => {
    expect(bareExitAssertions(SPAWNED_BARE)).toEqual([{ line: 6, text: 'expect(run.exitCode).toBe(1)' }]);
  });

  test('passes the same file once it asserts with expectExit', () => {
    expect(bareExitAssertions(SPAWNED_EXPECT_EXIT)).toEqual([]);
  });

  test('passes an in-process file asserting the exit code bare', () => {
    const source = planted(
      'test(\'refuses\', async () => {',
      '  const run = await dispatchCaptured([\'doctor\']);',
      '  expect(run.exitCode).toBe(1);',
      '});',
    );

    expect(bareExitAssertions(source)).toEqual([]);
  });

  test('passes a file spawning only git and asserting the exit code bare', () => {
    const source = [
      'test(\'commits\', () => {',
      '  const run = Bun.spawnSync([\'git\', \'add\', \'src/rafa.ts\'], { cwd: repo });',
      '  expect(run.exitCode).toBe(0);',
      '});',
    ].join('\n');

    expect(bareExitAssertions(source)).toEqual([]);
  });

  test('flags only the spawned run in a file that also asserts an in-process one bare', () => {
    const source = planted(
      'test(\'both\', async () => {',
      '  const inProcess = await dispatchCaptured([\'doctor\']);',
      '  expect(inProcess.exitCode).toBe(1);',
      '  const spawned = runRafa(scratch, scratch.repo, [\'doctor\']);',
      '  expect(spawned.exitCode).toBe(1);',
      '});',
    );

    expect(bareExitAssertions(source).map(({ text }) => text)).toEqual(['expect(spawned.exitCode).toBe(1)']);
  });

  test('reads a name by the declaration of its own scope, not another case\'s of the same name', () => {
    const source = planted(
      'test(\'spawned\', () => { const run = runRafa(scratch, dir, []); expectExit(run, 0); });',
      'test(\'in process\', async () => { const run = await dispatchCaptured([]); expect(run.exitCode).toBe(0); });',
    );

    expect(bareExitAssertions(source)).toEqual([]);
  });

  test('passes a .not.toBe and a tuple on a spawned run, which the moves left as they are', () => {
    const source = planted(
      'const run = runRafa(scratch, dir, []);',
      'expect(run.exitCode).not.toBe(0);',
      'expect([run.exitCode, run.stderr]).toEqual([0, \'\']);',
    );

    expect(bareExitAssertions(source)).toEqual([]);
  });

  test('ignores the shape inside a comment or a string', () => {
    const source = planted(
      'const run = runRafa(scratch, dir, []);',
      '// expect(run.exitCode).toBe(0);',
      'const text = \'expect(run.exitCode).toBe(0)\';',
    );

    expect(bareExitAssertions(source)).toEqual([]);
  });

  test('flags a bare exitCode destructured from a spawned run', () => {
    const source = planted('const { exitCode } = runRafa(scratch, dir, []);', 'expect(exitCode).toBe(0);');

    expect(bareExitAssertions(source)).toEqual([{ line: 4, text: 'expect(exitCode).toBe(0)' }]);
  });

  test('flags a run a bare let takes from a spawn in a hook', () => {
    const source = planted(
      'let run;',
      'beforeAll(() => { run = runRafa(scratch, dir, []); });',
      'test(\'runs\', () => { expect(run.exitCode).toBe(0); });',
    );

    expect(bareExitAssertions(source).map(({ text }) => text)).toEqual(['expect(run.exitCode).toBe(0)']);
  });
});

describe('spawned-rafa detector over planted sources', () => {
  /** True when the planted source's first `const run` initializer spawns rafa. */
  function runSpawnsRafa(source: string): boolean {
    return bareExitAssertions(`${source}\nexpect(run.exitCode).toBe(0);`).length > 0;
  }

  test('reads a spawn of bun on the source entry as a spawn of rafa', () => {
    const source = [
      'const RAFA = fileURLToPath(new URL(\'../rafa.ts\', import.meta.url));',
      'const run = Bun.spawnSync([process.execPath, RAFA, \'--help\']);',
    ].join('\n');

    expect(runSpawnsRafa(source)).toBe(true);
  });

  test('reads a spawn of the built entry through an imported RAFA_ENTRY alias', () => {
    const source = [
      'import { RAFA_ENTRY as ENTRY } from \'./loop-scratch\';',
      'const run = spawnSync(\'bun\', [ENTRY, \'plan\']);',
    ].join('\n');

    expect(runSpawnsRafa(source)).toBe(true);
  });

  test('reads a call of a file\'s own wrapper of a wrapper of runLoopStart', () => {
    const source = [
      'function startIn(scratch) { return runLoopStart(scratch, \'json\', []); }',
      'const again = (scratch) => startIn(scratch);',
      'const run = again(scratch);',
    ].join('\n');

    expect(runSpawnsRafa(source)).toBe(true);
  });

  test('passes a spawn of bun on a generated probe', () => {
    const source = 'const run = Bun.spawnSync([process.execPath, join(dir, \'probe.ts\')]);';

    expect(runSpawnsRafa(source)).toBe(false);
  });

  test('passes a spawn of a stand-in named fake-rafa.ts', () => {
    const source = 'const run = Bun.spawnSync([process.execPath, join(dir, \'fake-rafa.ts\')]);';

    expect(runSpawnsRafa(source)).toBe(false);
  });

  test('reads a file\'s own command wrapper by the command each call hands it', () => {
    const wrapper = 'function run(command, cwd) { return Bun.spawnSync([...command], { cwd }); }';

    expect(runSpawnsRafa(`${wrapper}\nconst run = run([process.execPath, join(DIST, 'cli.js'), 'plan'], dir);`))
      .toBe(true);
    expect(runSpawnsRafa(`${wrapper}\nconst run = run(['git', 'add', 'src/rafa.ts'], dir);`)).toBe(false);
  });

  test('reads a name by its own scope, not by another case\'s same name bound to the entry', () => {
    const source = [
      'function run(command) { return Bun.spawnSync([...command]); }',
      'test(\'imports\', () => { const probe = probeImport(join(DIST, \'cli.js\')); });',
      'test(\'plans\', () => {',
      '  const probe = join(dir, \'probe.ts\');',
      '  const plan = run([process.execPath, probe]);',
      '  expect(plan.exitCode).toBe(1);',
      '});',
    ].join('\n');

    expect(bareExitAssertions(source)).toEqual([]);
  });

  test('passes a spawn of sh that only names the entry in its arguments', () => {
    const source = 'const run = Bun.spawnSync([\'sh\', \'-c\', \'test -f src/rafa.ts\']);';

    expect(runSpawnsRafa(source)).toBe(false);
  });
});

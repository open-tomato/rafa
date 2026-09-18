/**
 * Tests for the resolution and locality checks.
 *
 * Every case plants its own project, its own skill directory and its
 * own `PATH` directory under this file's temporary directory, and the
 * first case measures that the answer comes from THERE: the same body
 * is resolved against two planted projects and passes in one and
 * fails in the other. The three seams are the whole point of the
 * module — a case that lost one of them would be reading this
 * checkout, this machine home, or the real `PATH`.
 *
 * Nothing here spawns anything, and no case runs the tool it names:
 * the `PATH` seam is a directory holding a file that is executable or
 * is not.
 *
 * ## Every reading is paired
 *
 * A reference REPORTED is only a reading about the rule when the
 * near-identical reference beside it in the same body is reported
 * clean. So `src/gone.ts` fails next to a `src/there.ts` that
 * resolves, `nosuchtool` fails next to a planted `mytool`, and the
 * non-executable file that fails as a tool is then made executable
 * and passes in the same case. The two closed-set cases hold
 * {@link REFERENCE_ISSUE_CODES} from both ends: a code nothing
 * provokes and a code produced by nothing named here are both red.
 *
 * ## The mutation legs
 *
 * Five mutations of `check/references.ts` were driven against this
 * file on 2026-09-18, the module restored sha256-identical after
 * each, and each reddened at least two cases: making `unchecked-path`
 * a failure (2), reading paths out of every fence (2), dropping the
 * `console` prompt rule (2), treating a `&&`-terminated line as a
 * continuation (2), and dropping the skill directory from the path
 * classification so a script resolved as a project path (4).
 */
import type { BodyReference, ReferenceIssue, ReferenceIssueCode } from './references.js';

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  REFERENCE_ISSUE_CODES,
  REFERENCE_SEVERITY,
  checkReferences,
  collectReferences,
  hasReferenceFailure,
  isProjectPath,
  pathDirectories,
} from './references.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-check-references-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/**
 * Plants a tree and answers its root. A key ending in `/` is an empty
 * directory, a key opening with `+` is an executable file, and every
 * other key is a plain file holding its value.
 */
function plant(files: Readonly<Record<string, string>>): string {
  planted += 1;
  const root = join(tempBase, `case-${planted}`);
  mkdirSync(root, { recursive: true });
  for (const [key, text] of Object.entries(files)) {
    const executable = key.startsWith('+');
    const name = executable
      ? key.slice(1)
      : key;
    const path = join(root, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    if (executable) chmodSync(path, 0o755);
  }
  return root;
}

/** A code span delimiter, kept out of the template literals. */
const TICK = '`';

/** A fence delimiter, kept out of the template literals. */
const FENCE = '```';

/** `text` wrapped in a code span. */
function span(text: string): string {
  return `${TICK}${text}${TICK}`;
}

/** The lines of a body, joined the way a markdown file holds them. */
function body(...lines: readonly string[]): string {
  return lines.join('\n');
}

/** A fenced block with `info` as its info string. */
function fence(info: string, ...lines: readonly string[]): string[] {
  return [`${FENCE}${info}`, ...lines, FENCE];
}

/** Every code carried by `issues`, in the order they were reported. */
function codesOf(issues: readonly ReferenceIssue[]): ReferenceIssueCode[] {
  return issues.map((issue) => issue.code);
}

/** The texts of every reference of `kind`, in body order. */
function textsOf(references: readonly BodyReference[], kind: 'path' | 'tool'): string[] {
  return references.filter((reference) => reference.kind === kind).map((item) => item.text);
}

describe('the seams', () => {
  it('resolves a body against the project it is handed and no other', () => {
    const root = plant({
      'here/src/there.ts': 'x',
      'elsewhere/README.md': 'x',
      'skill/SKILL.md': 'x',
    });
    const text = body(`Read ${span('src/there.ts')} before starting.`);
    const skillDir = join(root, 'skill');

    const found = checkReferences(text, {
      projectRoot: join(root, 'here'),
      skillDir,
      pathDirs: [],
    });
    const elsewhere = checkReferences(text, {
      projectRoot: join(root, 'elsewhere'),
      skillDir,
      pathDirs: [],
    });

    expect(root.startsWith(tempBase)).toBe(true);
    expect(found.issues).toEqual([]);
    expect(codesOf(elsewhere.issues)).toEqual(['unresolved-path']);
    expect(elsewhere.issues[0]?.message).toContain('src/there.ts');
  });

  it('looks a command up in the PATH directories it is handed, in order', () => {
    const root = plant({ '+second/mytool': '#!/bin/sh\n', 'first/': '' });
    const text = body(...fence('bash', 'mytool --version'));
    const seams = { projectRoot: null, skillDir: null };

    const found = checkReferences(text, {
      ...seams,
      pathDirs: [join(root, 'first'), join(root, 'second')],
    });
    const missing = checkReferences(text, { ...seams, pathDirs: [join(root, 'first')] });

    expect(found.issues).toEqual([]);
    expect(codesOf(missing.issues)).toEqual(['missing-tool']);
    expect(missing.issues[0]?.message).toContain('mytool');
  });
});

describe('what a body names', () => {
  it('takes a path from a code span and never from running text', () => {
    const references = collectReferences(body(
      `Prose naming src/prose.ts plainly, and a span naming ${span('src/span.ts')}.`,
    ));

    expect(textsOf(references, 'path')).toEqual(['src/span.ts']);
  });

  it('takes a relative path with a separator and an extension, or one opening with a dot', () => {
    const references = collectReferences(body(
      `${span('src/a.ts')} ${span('./b')} ${span('../c/d.md')} ${span('e/f/g.test.ts')}`,
    ));

    expect(textsOf(references, 'path')).toEqual(['src/a.ts', './b', '../c/d.md', 'e/f/g.test.ts']);
  });

  it('passes over a bare file name, a module specifier, a URL, a glob and a placeholder', () => {
    const references = collectReferences(body(
      `${span('package.json')} ${span('node:fs')} ${span('https://example.com/a.html')}`,
      `${span('src/**/*.ts')} ${span('<dir>/<group>/<name>.md')} ${span('~/.claude/skills/x.md')}`,
      `and a real one, ${span('src/kept.ts')}`,
    ));

    expect(textsOf(references, 'path')).toEqual(['src/kept.ts']);
  });

  it('drops an editor line number so the path behind it resolves', () => {
    const references = collectReferences(body(`See ${span('src/plan.ts:315')}.`));

    expect(textsOf(references, 'path')).toEqual(['src/plan.ts']);
  });

  it('numbers a reference by its line in the body', () => {
    const references = collectReferences(body(
      'First line.',
      '',
      `Third line names ${span('src/a.ts')}.`,
    ));

    expect(references[0]?.line).toBe(3);
    expect(references[0]?.source).toBe('code-span');
  });

  it('keeps a repeated mention, which is what the check deduplicates', () => {
    const references = collectReferences(body(
      `${span('src/a.ts')}`,
      `${span('src/a.ts')}`,
    ));

    expect(textsOf(references, 'path')).toEqual(['src/a.ts', 'src/a.ts']);
  });

  it('answers on the path shape without touching the filesystem', () => {
    expect(isProjectPath('src/a.ts')).toBe(true);
    expect(isProjectPath('./anything')).toBe(true);
    expect(isProjectPath('package.json')).toBe(false);
    expect(isProjectPath('src/')).toBe(false);
    expect(isProjectPath('/etc/hosts')).toBe(false);
  });

  it('holds a four-backtick fence closed through a bare three-backtick line inside it, and reads plain prose as prose again after the real close', () => {
    const references = collectReferences(body(
      '````markdown',
      '```example',
      'stub: my-feature',
      'spec: .specs/my-feature.md',
      '```',
      '````',
      'Prose after the fence naming src/kept.ts with no code span at all.',
    ));

    expect(textsOf(references, 'path')).toEqual([]);
  });
});

describe('a shell fence', () => {
  it('reads the first word of a command line as a tool and strips a prompt', () => {
    const references = collectReferences(body(...fence(
      'bash',
      'first --flag',
      '$ second build',
    )));

    expect(textsOf(references, 'tool')).toEqual(['first', 'second']);
  });

  it('passes over a comment, a builtin, an assignment, a flag and a path', () => {
    const references = collectReferences(body(...fence(
      'sh',
      '# nosuchtool in a comment',
      'cd somewhere',
      'FOO=bar nosuchtool',
      '--flag alone',
      './scripts/run.sh --once',
      'kept --flag',
    )));

    expect(textsOf(references, 'tool')).toEqual(['kept']);
    expect(textsOf(references, 'path')).toEqual(['./scripts/run.sh']);
  });

  it('reads only the prompted lines of a console fence, because the rest is output', () => {
    const prompted = collectReferences(body(...fence(
      'console',
      '$ kept test',
      'Cannot find package',
    )));
    const unprompted = collectReferences(body(...fence('console', 'Cannot find package')));

    expect(textsOf(prompted, 'tool')).toEqual(['kept']);
    expect(textsOf(unprompted, 'tool')).toEqual([]);
  });

  it('passes over a heredoc body and picks the command line up after it', () => {
    const references = collectReferences(body(...fence(
      'bash',
      'cat <<EOF > out.txt',
      'buried --flag',
      'EOF',
      'after --flag',
    )));

    expect(textsOf(references, 'tool')).toEqual(['cat', 'after']);
  });

  it('passes over a backslash continuation but not the line after a pipeline operator', () => {
    const references = collectReferences(body(...fence(
      'bash',
      'docker run \\',
      'ubuntu bash',
      'grep -q x &&',
      'after --flag',
    )));

    expect(textsOf(references, 'tool')).toEqual(['docker', 'grep', 'after']);
  });

  it('reads no path out of a language fence, and reads one out of a text fence', () => {
    const code = collectReferences(body(...fence('ts', 'import x from \'./hidden.js\';')));
    const text = collectReferences(body(...fence('text', './shown.js')));

    expect(textsOf(code, 'path')).toEqual([]);
    expect(textsOf(text, 'path')).toEqual(['./shown.js']);
  });

  it('reads no tool out of a fence that holds no commands', () => {
    const references = collectReferences(body(...fence('text', 'nosuchtool --flag')));

    expect(textsOf(references, 'tool')).toEqual([]);
  });
});

describe('resolution', () => {
  it('fails a project path that names nothing, beside one that names a file', () => {
    const root = plant({ 'project/src/there.ts': 'x' });
    const found = checkReferences(
      body(`${span('src/there.ts')} and ${span('src/gone.ts')}`),
      { projectRoot: join(root, 'project'), skillDir: null, pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['unresolved-path']);
    expect(found.issues[0]?.message).toContain('src/gone.ts');
    expect(hasReferenceFailure(found.issues)).toBe(true);
  });

  it('fails a relative path that climbs out of the project root', () => {
    const root = plant({ 'project/src/there.ts': 'x', 'outside.md': 'x' });
    const found = checkReferences(
      body(span('../outside.md')),
      { projectRoot: join(root, 'project'), skillDir: null, pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['unresolved-path']);
    expect(found.issues[0]?.message).toContain('outside the project root');
  });

  it('resolves a path under the skill directory as its own script', () => {
    const root = plant({ 'skill/scripts/there.sh': 'x', 'project/': '' });
    const found = checkReferences(
      body(`Run ${span('scripts/there.sh')}.`),
      { projectRoot: join(root, 'project'), skillDir: join(root, 'skill'), pathDirs: [] },
    );

    expect(found.issues).toEqual([]);
  });

  it('fails a script under a directory the skill really has', () => {
    const root = plant({ 'skill/scripts/there.sh': 'x', 'project/': '' });
    const found = checkReferences(
      body(`Run ${span('scripts/gone.sh')}.`),
      { projectRoot: join(root, 'project'), skillDir: join(root, 'skill'), pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['missing-script']);
    expect(found.issues[0]?.message).toContain('under the skill directory');
  });

  it('reports one issue for a path named three times, at its first line', () => {
    const root = plant({ 'project/': '' });
    const found = checkReferences(
      body(span('src/gone.ts'), span('src/gone.ts'), span('src/gone.ts')),
      { projectRoot: join(root, 'project'), skillDir: null, pathDirs: [] },
    );

    expect(found.references).toHaveLength(3);
    expect(codesOf(found.issues)).toEqual(['unresolved-path']);
    expect(found.issues[0]?.message.startsWith('line 1:')).toBe(true);
  });

  it('holds a language fence to nothing, and the same path in a span to the project', () => {
    const root = plant({ 'project/': '' });
    const seams = { projectRoot: join(root, 'project'), skillDir: null, pathDirs: [] };

    const fenced = checkReferences(body(...fence('ts', 'import x from \'./gone.js\';')), seams);
    const spanned = checkReferences(body(span('./gone.js')), seams);

    expect(fenced.issues).toEqual([]);
    expect(codesOf(spanned.issues)).toEqual(['unresolved-path']);
  });

  it('holds the output of a console fence to nothing, and its prompted line to the PATH', () => {
    const root = plant({ '+bin/mytool': '#!/bin/sh\n' });
    const seams = { projectRoot: null, skillDir: null, pathDirs: [join(root, 'bin')] };

    const clean = checkReferences(
      body(...fence('console', '$ mytool test', 'Cannot find package')),
      seams,
    );
    const missing = checkReferences(body(...fence('console', '$ nosuchtool test')), seams);

    expect(clean.issues).toEqual([]);
    expect(codesOf(missing.issues)).toEqual(['missing-tool']);
  });

  it('checks the command after a pipeline operator, which opens a command of its own', () => {
    const root = plant({ '+bin/mytool': '#!/bin/sh\n' });
    const found = checkReferences(
      body(...fence('bash', 'mytool x &&', 'nosuchtool y')),
      { projectRoot: null, skillDir: null, pathDirs: [join(root, 'bin')] },
    );

    expect(codesOf(found.issues)).toEqual(['missing-tool']);
    expect(found.issues[0]?.message).toContain('nosuchtool');
  });

  it('fails a command whose PATH entry is not executable, and passes it once it is', () => {
    const root = plant({ 'bin/mytool': 'not executable yet' });
    const text = body(...fence('bash', 'mytool --version'));
    const seams = { projectRoot: null, skillDir: null, pathDirs: [join(root, 'bin')] };

    const before = checkReferences(text, seams);
    chmodSync(join(root, 'bin', 'mytool'), 0o755);
    const after = checkReferences(text, seams);

    expect(codesOf(before.issues)).toEqual(['missing-tool']);
    expect(after.issues).toEqual([]);
  });

  it('passes a call to a function the body defines for itself, beside one it never defines', () => {
    const posix = checkReferences(
      body(...fence('bash', '_ok() {', '  echo "$1"', '}', '_ok "done"', 'nosuchtool')),
      { projectRoot: null, skillDir: null, pathDirs: [] },
    );
    const bashStyle = checkReferences(
      body(...fence('bash', 'function _bad {', '  echo "$1" 1>&2', '}', '_bad "no"')),
      { projectRoot: null, skillDir: null, pathDirs: [] },
    );

    expect(codesOf(posix.issues)).toEqual(['missing-tool']);
    expect(posix.issues[0]?.message).toContain('nosuchtool');
    expect(bashStyle.issues).toEqual([]);
  });
});

describe('a run with no project root', () => {
  it('warns on a project path instead of failing the file', () => {
    const root = plant({ 'skill/SKILL.md': 'x' });
    const found = checkReferences(
      body(span('src/gone.ts')),
      { projectRoot: null, skillDir: join(root, 'skill'), pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['unchecked-path']);
    expect(hasReferenceFailure(found.issues)).toBe(false);
    expect(found.issues[0]?.message).toContain('no project root');
  });

  it('still fails a missing script and a missing tool', () => {
    const root = plant({ 'skill/scripts/there.sh': 'x' });
    const found = checkReferences(
      body(span('scripts/gone.sh'), ...fence('bash', 'nosuchtool --flag')),
      { projectRoot: null, skillDir: join(root, 'skill'), pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['missing-script', 'missing-tool']);
    expect(hasReferenceFailure(found.issues)).toBe(true);
  });
});

describe('locality', () => {
  /** The verdict on one absolute path, with no project and no skill. */
  function verdict(path: string): ReferenceIssueCode | null {
    const found = checkReferences(body(span(path)), {
      projectRoot: null,
      skillDir: null,
      pathDirs: [],
    });
    return found.issues[0]?.code ?? null;
  }

  it('fails an absolute path under a home root, whichever of the three it is', () => {
    expect(verdict('/Users/someone/notes.md')).toBe('home-path');
    expect(verdict('/home/someone/notes.md')).toBe('home-path');
    expect(verdict('/root/notes.md')).toBe('home-path');
  });

  it('passes an absolute path under a system root', () => {
    expect(verdict('/tmp/probe.mjs')).toBe(null);
    expect(verdict('/usr/local/bin/tool')).toBe(null);
    expect(verdict('/etc/hosts')).toBe(null);
    expect(verdict('/var/log/system.log')).toBe(null);
  });

  it('fails another absolute path that names a file', () => {
    expect(verdict('/srv/data/payload.json')).toBe('foreign-path');
  });

  it('passes over an HTTP route and a home-relative path, which are not local claims', () => {
    const references = collectReferences(body(
      `${span('/api/markets')} ${span('~/.claude/skills')} ${span('/login')}`,
    ));

    expect(references).toEqual([]);
  });

  it('resolves an absolute path inside the project instead of judging where it lives', () => {
    const root = plant({ 'project/src/there.ts': 'x' });
    const project = join(root, 'project');
    const found = checkReferences(
      body(span(join(project, 'src/there.ts')), span(join(project, 'src/gone.ts'))),
      { projectRoot: project, skillDir: null, pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['unresolved-path']);
    expect(found.issues[0]?.message).toContain('src/gone.ts');
  });

  it('resolves an absolute path inside the skill directory as a script', () => {
    const root = plant({ 'skill/scripts/there.sh': 'x' });
    const skillDir = join(root, 'skill');
    const found = checkReferences(
      body(span(join(skillDir, 'scripts/there.sh')), span(join(skillDir, 'scripts/gone.sh'))),
      { projectRoot: null, skillDir, pathDirs: [] },
    );

    expect(codesOf(found.issues)).toEqual(['missing-script']);
  });
});

describe('the issue codes', () => {
  /** A body and seams provoking every code the module has. */
  function everyCode(): readonly ReferenceIssue[] {
    const root = plant({ 'skill/scripts/there.sh': 'x', 'project/': '' });
    const withProject = checkReferences(
      body(
        span('src/gone.ts'),
        span('scripts/gone.sh'),
        span('/Users/someone/notes.md'),
        span('/srv/data/payload.json'),
        ...fence('bash', 'nosuchtool --flag'),
      ),
      { projectRoot: join(root, 'project'), skillDir: join(root, 'skill'), pathDirs: [] },
    );
    const withoutProject = checkReferences(
      body(span('src/gone.ts')),
      { projectRoot: null, skillDir: null, pathDirs: [] },
    );
    return [...withProject.issues, ...withoutProject.issues];
  }

  it('provokes every code the module declares, and no code it does not', () => {
    const seen = new Set(codesOf(everyCode()));

    expect([...seen].sort()).toEqual([...REFERENCE_ISSUE_CODES].sort());
  });

  it('gives every declared code a severity, and only failures reach the exit code', () => {
    const severities = REFERENCE_ISSUE_CODES.map((code) => REFERENCE_SEVERITY[code]);
    const warnings = REFERENCE_ISSUE_CODES.filter(
      (code) => REFERENCE_SEVERITY[code] === 'warning',
    );

    expect(Object.keys(REFERENCE_SEVERITY).sort()).toEqual([...REFERENCE_ISSUE_CODES].sort());
    expect(severities.every((severity) => severity === 'failure' || severity === 'warning'))
      .toBe(true);
    expect(warnings).toEqual(['unchecked-path']);
  });

  it('opens every message with the line the reference sits on', () => {
    for (const issue of everyCode()) {
      expect(issue.message.startsWith(`line ${issue.reference.line}: `)).toBe(true);
    }
  });
});

describe('pathDirectories', () => {
  it('splits a PATH value and drops the empty entries an unset one leaves', () => {
    expect(pathDirectories(['/a', '/b'].join(delimiter))).toEqual(['/a', '/b']);
    expect(pathDirectories(['/a', '', '/b'].join(delimiter))).toEqual(['/a', '/b']);
    expect(pathDirectories(undefined)).toEqual([]);
    expect(pathDirectories('')).toEqual([]);
  });
});

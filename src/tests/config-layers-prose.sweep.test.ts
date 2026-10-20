/**
 * The prose stays swept of the one-file reading: each scope is read from
 * TWO layers, its module file (`rafa.config.ts` or `rafa.config.mjs`, the
 * person's file) and its YAML file over it key by key, so no file shadows
 * another and none is left unread. A sentence that says otherwise is the
 * old lookup surviving in a page or a module note.
 *
 * What is read: `README.md`, every `context/*.md` and `docs/*.md`, and the
 * leading module note of the eight source files that describe the lookup.
 * Each paragraph's lines are joined on one space before the match, so a
 * phrase split across a hand-wrapped line still matches; a list item or a
 * table row is a paragraph of its own. The paragraph is then cut into
 * sentences and each sentence is held to the phrases below.
 *
 * ## The phrases
 *
 * - a module file shadows the YAML file (or the YAML file is shadowed);
 * - a module file leaves the YAML file unread;
 * - the YAML file is not read (beside a module file);
 * - a scope is read from one file;
 * - the lookup takes the first of three names that is a file and the
 *   others are not read.
 *
 * A sentence that denies one of them ("No file shadows another") passes:
 * every phrase needs its subject, and the denial has none.
 *
 * ## The controls
 *
 * The live claim is an empty offender list, which a scanner that has
 * stopped scanning also answers. So `CASES` holds each phrase as a fixture
 * paragraph the sweep reddens on, beside paragraphs it passes over, and
 * the live test also asserts how many files it read.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const MODULE_NOTE_FILES = [
  'packages/rafa/src/core/config/config-load.ts',
  'packages/rafa/src/core/config/config.ts',
  'packages/rafa/src/core/config/config-origins.ts',
  'packages/rafa/src/core/config/scope.ts',
  'src/project/scope.ts',
  'src/commands/config/show.ts',
  'src/commands/config/set.ts',
  'src/commands/doctor-config.ts',
] as const;

const MODULE_FILE = String.raw`(?:module files?|\`?rafa\.config\.(?:ts|mjs)\`?)`;
const YAML_FILE = String.raw`(?:yaml(?: file)?|\`?\.?(?:rafa/)?config\.yaml\`?)`;
const THREE_NAMES = String.raw`(?:the three(?: names)?|all three(?: names)?|\`?rafa\.config\.ts\`?, \`?rafa\.config\.mjs\`? and \`?\.rafa/config\.yaml\`?)`;

interface Phrase {
  readonly name: string;
  readonly pattern: RegExp;
}

const PHRASES: readonly Phrase[] = [
  {
    name: 'a module file shadows the YAML file',
    pattern: new RegExp(`${MODULE_FILE}[^.;]{0,80}\\bshadows?\\b[^.;]{0,60}${YAML_FILE}`, 'i'),
  },
  {
    name: 'the YAML file is shadowed',
    pattern: new RegExp(`\\bshadowed ${YAML_FILE}|${YAML_FILE}[^.;]{0,60}\\b(?:is|are) shadowed\\b`, 'i'),
  },
  {
    name: 'a module file leaves the YAML file unread',
    pattern: new RegExp(`${MODULE_FILE}[^.;]{0,80}\\b(?:leaves?|left)\\b[^.;]{0,60}${YAML_FILE}[^.;]{0,30}\\bunread\\b`, 'i'),
  },
  {
    name: 'the YAML file is not read',
    pattern: new RegExp(`${YAML_FILE}[^.;]{0,60}\\b(?:is|are) (?:not|never) read\\b|${YAML_FILE}[^.;]{0,30}\\bis left unread\\b`, 'i'),
  },
  {
    name: 'a scope is read from one file',
    pattern: /\b(?:scope|config|configuration) is read from (?:exactly |only )?(?:one|a single|its one) file\b/i,
  },
  {
    name: 'the lookup takes the first of three names and the others are not read',
    pattern: new RegExp(`\\bfirst of ${THREE_NAMES}[^.]*\\b(?:the others?|the rest)\\b[^.;]{0,40}\\b(?:is|are) (?:not|never) read\\b`, 'i'),
  },
  {
    name: 'the others are not read',
    pattern: /\bthe others? (?:is|are) not read\b/i,
  },
];

/** The phrases a sentence says, by name. */
export function phrasesIn(sentence: string): string[] {
  return PHRASES.filter((phrase) => phrase.pattern.test(sentence)).map((phrase) => phrase.name);
}

const ITEM_START = /^\s*(?:[-*]|\d+\.|\|)\s/;

/** The paragraphs of a text, each one's lines joined on one space. */
export function paragraphsOf(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) paragraphs.push(current.join(' ').replace(/\s+/g, ' ')
      .trim());
    current = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim() === '') flush();
    else {
      if (ITEM_START.test(line)) flush();
      current.push(line.trim());
    }
  }
  flush();
  return paragraphs;
}

/** A paragraph cut into sentences at a stop followed by a space. */
function sentencesOf(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+(?=[A-Z`"(])/);
}

/** The phrases a paragraph says, by name, over its sentences. */
export function paragraphOffences(paragraph: string): string[] {
  return sentencesOf(paragraph).flatMap(phrasesIn);
}

/** The text of a source file's leading module note, with its comment stars off. */
export function leadingNote(source: string): string {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source);
  if (match === null) return '';
  return (match[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n');
}

interface Source {
  readonly file: string;
  readonly text: string;
}

function markdownSources(): Source[] {
  const files = ['README.md'];
  for (const dir of ['context', 'docs']) {
    for (const name of readdirSync(join(REPO_ROOT, dir)).sort()) {
      if (name.endsWith('.md')) files.push(`${dir}/${name}`);
    }
  }
  return files.map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), 'utf8') }));
}

function noteSources(): Source[] {
  return MODULE_NOTE_FILES.map((file) => ({
    file,
    text: leadingNote(readFileSync(join(REPO_ROOT, file), 'utf8')),
  }));
}

/** Each offending paragraph as `file: phrase: paragraph`. */
function offendersIn(sources: readonly Source[]): string[] {
  return sources.flatMap(({ file, text }) => paragraphsOf(text).flatMap((paragraph) => paragraphOffences(paragraph).map((name) => `${file}: ${name}: ${paragraph}`)));
}

interface Case {
  readonly name: string;
  readonly paragraph: string;
  readonly offences: readonly string[];
}

const CASES: readonly Case[] = [
  {
    name: 'a module file shadows the YAML file',
    paragraph: 'When `rafa.config.ts` is present it shadows\n`.rafa/config.yaml`, which is then ignored.',
    offences: ['a module file shadows the YAML file'],
  },
  {
    name: 'the YAML file shadowed by a module file',
    paragraph: 'Shadowed YAML and `rafa config show`: the YAML file is shadowed by the module file.',
    offences: ['the YAML file is shadowed'],
  },
  {
    name: 'a module file leaves the YAML file unread',
    paragraph: 'A module file leaves the `.rafa/config.yaml` of the same scope unread.',
    offences: ['a module file leaves the YAML file unread'],
  },
  {
    name: 'the YAML file is not read',
    paragraph: 'Beside `rafa.config.ts`, the `.rafa/config.yaml` is not read.',
    offences: ['the YAML file is not read'],
  },
  {
    name: 'a scope is read from one file',
    paragraph: 'Each scope is read from one file, whichever name it has.',
    offences: ['a scope is read from one file'],
  },
  {
    name: 'the first of three names, the others not read',
    paragraph: 'The lookup takes the first of `rafa.config.ts`, `rafa.config.mjs` and\n`.rafa/config.yaml` that is a file; the others are not read.',
    offences: ['the lookup takes the first of three names and the others are not read', 'the others are not read'],
  },
  {
    name: 'the first of the three, the others not read',
    paragraph: 'The lookup takes the first of the three names that is a file, and the others are not read.',
    offences: ['the lookup takes the first of three names and the others are not read', 'the others are not read'],
  },
  {
    name: 'a sentence among clean ones',
    paragraph: 'The walk stops at the git top level. A scope is read from one file. The home is passed over.',
    offences: ['a scope is read from one file'],
  },
  {
    name: 'a denial of shadowing',
    paragraph: 'No file shadows another, so nothing is warned about for a scope holding both.',
    offences: [],
  },
  {
    name: 'the two-layer reading',
    paragraph: 'Each scope is read from two files: its module file, and its YAML file over it key by key.',
    offences: [],
  },
  {
    name: 'a module file beside the walk, not the YAML file',
    paragraph: 'The project scope names the first of the three found there. The user scope and the default are not read.',
    offences: [],
  },
  {
    name: 'an unrelated shadow of skills',
    paragraph: 'A project file shadows a user-level agent of the same name.',
    offences: [],
  },
];

describe('no page or module note says a module file shadows or leaves the YAML file unread', () => {
  for (const { name, paragraph, offences } of CASES) {
    it(`${offences.length > 0
      ? 'reddens on'
      : 'passes over'}: ${name}`, () => {
      expect(paragraphOffences(paragraphsOf(paragraph).join(' '))).toEqual([...offences]);
    });
  }

  it('joins a phrase split across wrapped lines, one list item to a paragraph', () => {
    expect(paragraphsOf('a b\nc d\n\n- e\n  f\n- g')).toEqual(['a b c d', '- e f', '- g']);
  });

  it('reads the leading note of a source file and nothing after it', () => {
    const note = leadingNote('/**\n * One.\n * Two.\n */\nconst x = 1; // a scope is read from one file');
    expect(note.trim()).toBe('One.\nTwo.');
  });

  it('reads a live tree of pages and notes', () => {
    const pages = markdownSources();
    const notes = noteSources();
    expect(pages.length).toBeGreaterThan(20);
    expect(notes).toHaveLength(MODULE_NOTE_FILES.length);
    for (const note of notes) expect(note.text.length).toBeGreaterThan(200);
  });

  it('finds no such sentence in the live pages', () => {
    expect(offendersIn(markdownSources())).toEqual([]);
  });

  it('finds no such sentence in the live module notes', () => {
    expect(offendersIn(noteSources())).toEqual([]);
  });

  it('names the file and the paragraph of a planted offender', () => {
    const planted = [{ file: 'README.md', text: 'Intro.\n\nEach scope is read from one file.\n' }];
    expect(offendersIn(planted)).toEqual([
      'README.md: a scope is read from one file: Each scope is read from one file.',
    ]);
  });
});

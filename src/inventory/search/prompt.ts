/**
 * The fixed template of the one session `rafa skill search` and
 * `rafa agent search` run: the question, the ranked candidates the
 * session may read, and the `rafa:search` block it must end with.
 *
 * ## The first line is a classifier key
 *
 * The rendered prompt opens with {@link SEARCH_PROMPT_PREFIX}, and that
 * literal is the `search` entry's `prefix` in `PROMPT_SHAPES`
 * (`src/effort/classify.ts`). `rafa effort collect` reads a session's
 * kind off the first characters of its prompt, so a search session is
 * counted as `search` only while the two agree. They are two literals
 * rather than one import, as every other shape's are: the classifier's
 * drift guard reads this file for the prefix as text, and
 * `prompt.test.ts` holds the rendered first line equal to the entry.
 * An edit to either side alone reddens one of them.
 *
 * ## What the template fixes and what it takes
 *
 * Nothing in it is chosen per run except the three inputs of
 * {@link SearchPromptInput}: the item kind, the question as the person
 * typed it, and the candidates, each a name and the path of its file
 * relative to the session's working directory (the scratch copy made
 * for the run). The session is told to read only those files and to
 * name only those candidates; the block parser and the quote check that
 * follow it enforce both in code, so the wording here asks and the code
 * decides.
 *
 * The question is rendered inside a fenced `text` block so a question
 * holding a line that looks like an instruction or a heading reads as
 * the person's words, not as part of the template. A fence of its own
 * length could still close it early, so the fence is made one backtick
 * longer than the longest backtick run in the question.
 */
import type { InventoryKind } from '../record.js';

/**
 * The rendered prompt's first line, and the `search` classifier key in
 * `PROMPT_SHAPES` (`src/effort/classify.ts`); see the module note.
 */
export const SEARCH_PROMPT_PREFIX = '# Inventory search instructions';

/** The info string of the fenced block the session must end with. */
export const SEARCH_BLOCK_FENCE = 'rafa:search';

/** One candidate the session may read. */
export interface SearchPromptCandidate {
  /** The item's name, the only value a match's `name` may hold. */
  readonly name: string;
  /** The file's path relative to the session's working directory. */
  readonly file: string;
}

/** What one search prompt is rendered from. */
export interface SearchPromptInput {
  /** Whether the candidates are skills or agents. */
  readonly kind: InventoryKind;
  /** The question as the person typed it. */
  readonly question: string;
  /** The ranked candidates, in rank order. */
  readonly candidates: readonly SearchPromptCandidate[];
}

/** The shortest fence Markdown allows. */
const MIN_FENCE_LENGTH = 3;

/** A backtick fence longer than any backtick run in `text`. */
function fenceFor(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
}

/** The example block the template shows, in the shape the parser reads. */
const EXAMPLE_BLOCK: readonly string[] = [
  '```' + SEARCH_BLOCK_FENCE,
  'matches:',
  '  - name: documentation',
  '    why: "owns TSDoc blocks and inline comment rules"',
  '    quote: "Every exported symbol carries a TSDoc block"',
  '    line: 41',
  'unanswerable: false',
  '```',
];

/** Renders the one search session prompt for `input`. */
export function renderSearchPrompt(input: SearchPromptInput): string {
  const plural = `${input.kind}s`;
  const fence = fenceFor(input.question);
  const candidates = input.candidates.map((candidate) => `- ${candidate.name}: \`${candidate.file}\``);

  return [
    SEARCH_PROMPT_PREFIX,
    '',
    `A person is looking for the ${plural} that answer the question below.`,
    `The candidate ${plural} were ranked by keyword and copied into your`,
    'working directory. Read them and say which ones answer the question.',
    '',
    '## The question',
    '',
    `${fence}text`,
    input.question,
    fence,
    '',
    '## The candidates',
    '',
    ...candidates,
    '',
    '## Rules',
    '',
    '- Read only the files listed above. Do not look for other files.',
    '- Name only candidates listed above, by the name before the colon.',
    '- For each match, copy one sentence or line from its file word for',
    '  word as `quote`, and give the 1-based line number it is on as `line`.',
    '  A quote that is not in the file is dropped.',
    '- Say in `why`, in one short line, what the file covers that answers',
    '  the question.',
    '- List matches best first. Leave out a candidate that does not answer.',
    '- When no candidate answers the question, write `matches: []` and',
    '  `unanswerable: true`.',
    '',
    '## Your answer',
    '',
    `End your answer with exactly one \`${SEARCH_BLOCK_FENCE}\` block shaped like`,
    'this one, and write nothing after it:',
    '',
    ...EXAMPLE_BLOCK,
    '',
  ].join('\n');
}

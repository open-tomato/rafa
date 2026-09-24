/**
 * The `### Task shape to agent` table in `context/workflow.md`, generated
 * from rafa's routing defaults.
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` turns the routing table into the
 * `routing` setting, whose defaults are `routing.ts`'s
 * {@link DEFAULT_ROUTES}, and asks for the page's table to be generated
 * from them. Before that, the table was hand-written. This module
 * renders the table ({@link formatRoutingTable}) and splices it into a
 * page between two HTML comments ({@link withRoutingTable}).
 * `routing-table.test.ts` checks the live page against that output, so a
 * default row added, dropped or re-pointed without the page fails the
 * suite.
 *
 * ## What a row carries
 *
 * Three columns, the header the page has always used and
 * `src/tests/routing-table-agents.test.ts` looks for:
 *
 *   - **Task shape**: the setting's key as a code span, then the
 *     reader's gloss from {@link SHAPE_GLOSSES}. The key is what a
 *     config file writes, so it leads. A default shape with no gloss is
 *     a thrown error rather than a bare row, since the gloss is the part
 *     a planner reads.
 *   - **Agent**: the agent name as a code span.
 *   - **Where it lives**: the agent's file in the rafa tier,
 *     `src/bundled/agents/<name>.md`, since every agent the defaults
 *     name is one rafa ships (see `routing.ts`). That file is the one to
 *     edit. This repository's `.claude/agents/<name>.md` links point
 *     at it.
 *
 * ## The generated region
 *
 * The table sits between {@link ROUTING_TABLE_START} and
 * {@link ROUTING_TABLE_END}, one line each. Markdown does not render
 * them, and they tell an editor the lines between are not
 * hand-written. {@link withRoutingTable} replaces those lines, keeps
 * everything else in the page byte for byte, and throws unless each
 * marker appears exactly once, start before end. Silently answering the
 * page unchanged would make the equality test pass on a page that has
 * lost its table.
 *
 * To regenerate the page after a default changes:
 *
 * ```sh
 * bun -e "import { withRoutingTable } from './src/tiers/routing-table.ts'; \
 *   const f = Bun.file('context/workflow.md'); \
 *   await Bun.write(f, withRoutingTable(await f.text()))"
 * ```
 */
import type { Route } from './routing.js';

import { DEFAULT_ROUTES } from './routing.js';

/** The line that opens the generated region. */
export const ROUTING_TABLE_START = '<!-- routing-table:start (generated from DEFAULT_ROUTES in src/tiers/routing.ts; do not edit by hand) -->';

/** The line that closes the generated region. */
export const ROUTING_TABLE_END = '<!-- routing-table:end -->';

/** The table's header cells, the ones the page has always carried. */
export const ROUTING_TABLE_HEADER = ['Task shape', 'Agent', 'Where it lives'] as const;

/** Where the rafa tier's agent files live in a checkout. */
export const BUNDLED_AGENTS_PATH = 'src/bundled/agents';

/** The reader's gloss after each default shape's key, keyed by the shape. */
export const SHAPE_GLOSSES: Readonly<Record<string, string>> = Object.freeze({
  prose: 'an `AGENTS.md` map, a `context/` page, a README, a skill or an agent file',
  tests: 'a suite over code that already exists, or a red-first case',
  repair: 'a red gate, a type error, a broken build',
  review: 'a change as a whole',
  implementation: 'a module plus its TSDoc plus its colocated tests',
});

/** One table row for `route`; throws when the shape has no gloss. */
function tableRow([shape, agent]: Route, glosses: Readonly<Record<string, string>>): string {
  const gloss = glosses[shape];
  if (gloss === undefined) {
    throw new Error(`routing shape ${shape} has no gloss in SHAPE_GLOSSES`);
  }
  return `| \`${shape}\` — ${gloss} | \`${agent}\` | \`${BUNDLED_AGENTS_PATH}/${agent}.md\` |`;
}

/**
 * The routing table as markdown lines joined by `\n`, header first, one
 * row per route in the list's order, with no trailing newline.
 */
export function formatRoutingTable(
  routes: readonly Route[] = DEFAULT_ROUTES,
  glosses: Readonly<Record<string, string>> = SHAPE_GLOSSES,
): string {
  return [
    `| ${ROUTING_TABLE_HEADER.join(' | ')} |`,
    `|${ROUTING_TABLE_HEADER.map(() => '---').join('|')}|`,
    ...routes.map((route) => tableRow(route, glosses)),
  ].join('\n');
}

/** The index of the one line equal to `marker`; throws unless there is exactly one. */
function markerLine(lines: readonly string[], marker: string): number {
  const found = lines.flatMap((line, index) => line === marker
    ? [index]
    : []);
  const [index] = found;
  if (found.length !== 1 || index === undefined) {
    throw new Error(`expected the marker ${marker} on exactly one line, found ${String(found.length)}`);
  }
  return index;
}

/**
 * `page` with the lines between {@link ROUTING_TABLE_START} and
 * {@link ROUTING_TABLE_END} replaced by `table`, and every other byte
 * kept. Throws unless each marker is on exactly one line, start first.
 */
export function withRoutingTable(page: string, table: string = formatRoutingTable()): string {
  const lines = page.split('\n');
  const start = markerLine(lines, ROUTING_TABLE_START);
  const end = markerLine(lines, ROUTING_TABLE_END);
  if (end < start) {
    throw new Error('the routing-table end marker comes before its start marker');
  }
  return [...lines.slice(0, start + 1), table, ...lines.slice(end)].join('\n');
}

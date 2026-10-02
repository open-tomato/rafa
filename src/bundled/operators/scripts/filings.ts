/**
 * `stretch filings`: the bugs filed since a time, grouped by cause. The
 * causes table sits in the stretch folder (`causes.json`): one entry per
 * cause, its kept issue and a pattern over a filing's title and its
 * `## What` block. A filing matching one cause is a refile of it; one
 * matching none or two is left for the agent to judge, never guessed.
 *
 * @module bundled/operators/scripts/filings
 */

/** One cause the stretch already keeps an issue for. */
export interface Cause {
  readonly cause: string;
  readonly kept: number;
  readonly pattern: string;
}

/** One issue as the listing reads it. */
export interface Filing {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

/** The filings grouped. */
export interface FilingGroups {
  readonly total: number;
  readonly byCause: readonly { cause: string; kept: number; filings: readonly number[] }[];
  readonly unmatched: readonly { number: number; title: string; causes: readonly string[] }[];
}

/** The fenced block under a body's `## What` heading, or nothing. */
function whatBlock(body: string): string {
  return /## What\s*```[a-z]*\s*([\s\S]*?)```/.exec(body)?.[1] ?? '';
}

/** Parses a causes table; a malformed entry is refused with its position. */
export function parseCauses(text: string): Cause[] {
  const entries = JSON.parse(text) as unknown;

  if (!Array.isArray(entries)) {
    throw new Error('causes.json holds no list');
  }

  return entries.map((entry, index) => {
    const { cause, kept, pattern } = entry as Partial<Cause>;

    if (typeof cause !== 'string' || typeof kept !== 'number' || typeof pattern !== 'string') {
      throw new Error(`causes.json entry ${index + 1} needs cause, kept and pattern`);
    }

    return { cause, kept, pattern };
  });
}

/** Groups `filings` by the causes whose pattern matches them. */
export function groupFilings(filings: readonly Filing[], causes: readonly Cause[]): FilingGroups {
  const compiled = causes.map((cause) => ({ ...cause, regex: new RegExp(cause.pattern, 'i') }));
  const byCause = new Map<string, number[]>();
  const unmatched: { number: number; title: string; causes: string[] }[] = [];

  for (const filing of [...filings].sort((a, b) => a.number - b.number)) {
    const text = `${filing.title} ${whatBlock(filing.body)}`;
    const hits = compiled.filter((cause) => cause.regex.test(text)).map((cause) => cause.cause);
    const [only] = hits;

    if (hits.length === 1 && only !== undefined) {
      byCause.set(only, [...(byCause.get(only) ?? []), filing.number]);
    } else {
      unmatched.push({ number: filing.number, title: filing.title, causes: hits });
    }
  }

  return {
    total: filings.length,
    byCause: compiled.filter((cause) => byCause.has(cause.cause)).map((cause) => ({ cause: cause.cause, kept: cause.kept, filings: byCause.get(cause.cause) ?? [] })),
    unmatched,
  };
}

/** The groups as text: one line per cause, then the unmatched. */
export function formatGroups(groups: FilingGroups, since: string): string {
  const refiled = groups.byCause.reduce((total, group) => total + group.filings.length, 0);

  return [
    `${groups.total} filed since ${since}: ${refiled} repeat a kept cause, ${groups.unmatched.length} left to judge`,
    ...groups.byCause.map((group) => `  ${group.cause} (kept #${group.kept}): ${group.filings.map((n) => `#${n}`).join(', ')}`),
    ...groups.unmatched.map((filing) => `  ? #${filing.number} ${filing.title.slice(0, 90)}${filing.causes.length > 1
      ? ` (matches ${filing.causes.join(' and ')})`
      : ''}`),
  ].join('\n');
}

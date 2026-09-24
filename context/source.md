## Source

What `src/` expects of a new or moved module that no gate spells out, and
the shapes the lint config forces.

### Imports

- **Relative imports name `.ts` files with `.js` specifiers.** Keep them
  when a file moves.
- **From `src/`, `./plan` and `./plan.js` both resolve to `src/plan.ts`**,
  the `rafa plan` command, and never to the `src/plan/` barrel: import
  `./plan/index.js`.
- **A library module never imports `src/rafa.ts`.** It dispatches on
  `process.argv` when imported; `src/index.ts` explains the rule and
  `index.test.ts` measures it.
- **A cross-subject helper import is the convention, not a smell.**
  Shared refusals and readers live in the subject that first needed them
  rather than in a neutral module: eighteen command modules import
  `../plan/plan-files.js`, and `src/commands/release/tag.ts` takes
  `versionTag` from `../pr/merge-followups.js` so two commands cannot
  spell one tag differently. Reach for the existing helper — a second
  spelling of a refusal is the real smell, as `release status`'s
  hand-rolled `Expected no arguments` is beside `plan-files.ts`'s shared
  `expectNoArgument`, which says `Expected no argument`.
- **Every `import type` line forms one `import/order` group**
  (`sharedRules.mjs`), and no short rule predicts its order: neither plain
  name order, "every sibling before every parent", nor path depth first,
  as this bullet read until 2026-09-24. `src/plan/risk.ts` spells
  `./parse.js`, `../config.js`, `./risk/accounts.js`,
  `../utils/declaration.js`, while `src/inventory/search/index.ts` puts
  `../record.js` after `../../utils/claude.js`. Take the order from
  `bunx eslint --fix-dry-run --format json <file>`, not from this page.
  Value imports differ: the `parent` group (`../`) comes before the
  `sibling` group (`./`), a blank line between them.
- **`tsconfig.json` sets `lib` to `ES2022`**, so an ES2023 method such as
  `Array.prototype.toSorted` fails `check-types` although bun runs it.
  Sort a copy with `[...array].sort()`.

### References

- **`src/refs/` extracts, verifies, stamps and composes references**
  in spec and bug report bodies. Each reference (an issue, a symbol, a
  path, a command) is extracted by pattern, verified against its
  target, and fingerprinted. The fingerprint at the time the spec was
  read is the reference's STAMP; it is kept in the saved copy under
  `specs.dir` as an HTML comment, never on the forge. Four states:
  `ok`; `dangling` (the target does not exist); `suspect` (the
  target's fingerprint differs from its stamp); `resolved` (a
  `Blocked by:` target closed since the stamp). A fifth, `unknown`,
  is a cross-repository target the provider cannot read; it is listed
  and never refuses. Nothing spawns a process: `gh`, `git` and
  `ts-symbols` arrive through seams (`GhRunner` from
  `src/adapters/tracker/github.ts`, `GitRunner`, a symbol lookup),
  so unit cases drive fakes and planted repositories under `tmpdir`
  only. Sha256 uses `node:crypto` or `Bun.CryptoHasher`.

### The size cap no gate reads

**The 800-line cap is a convention only.** `eslint.base.mjs`,
`eslint.config.mjs` and `sharedRules.mjs` carry no `max-lines` rule, so
nothing refuses an oversized module and a file crosses the cap without
any capture going red. `src/check/references.ts` is 825 lines at
`12e6d17`, pushed over by its own ~130-line note recording measured
corpus readings. Count the file with `wc -l` when a task adds to one
already near the cap; a module that has to grow puts the new concern in
a new file, and a note that has outgrown its module can move to the
`context/` page that owns the subject. That module is no longer the
example in the present tense: the shell-fence line reading moved to
`src/check/shell-lines.ts`, leaving `references.ts` at 759 lines,
wiring that reading back in as a whole-fence rule took it to 795, and
the single-segment route rule took it to exactly 800 — its note paid
for by rewrapping the prose the rule superseded. NO non-test file under
`src/` is over the cap; the nearest is `src/check/references.ts` at
that 800, with `src/effort/collect.ts` at 798 and
`src/demote/classify.ts` at 795 behind it.

**The cap is a rule about modules, not about their tests.** At `b2bebfe`
exactly one non-test file under `src/` is over it, `src/check/references.ts`
above, while EIGHTEEN colocated `*.test.ts` files are, from
`src/utils/commit.test.ts` at 811 to `src/effort/collect.test.ts` at 1297.
A suite that grows past 800 lines beside the module it covers is therefore
the tree's own convention and not a thing to split, and no capture reads
it either way. Splitting one costs the shared world helpers a home, which
is what keeps `src/commands/doctor.test.ts` (898) and
`src/commands/init.test.ts` (806) whole.

### Shapes the lint config forces

- **`@typescript-eslint/no-unused-vars` has no ignore pattern and no
  `ignoreRestSiblings`**, so a `{ mode: _mode, ...rest }` discard is an
  error. Drop keys with an `Object.entries` loop.
- **`eslint --fix` spreads a nested ternary over one line per branch**
  (`@stylistic/multiline-ternary`). Sort with `a.localeCompare(b)` rather
  than an `a < b ? -1 : a > b ? 1 : 0` comparator.
- **`NodeJS.*` types fail `no-undef` outside test files**: the config
  declares no `NodeJS` global. Type an environment as
  `Record<string, string>` rather than `NodeJS.ProcessEnv`. This bullet
  replaces nothing.
- **An apostrophe in a test title is written backslash-escaped inside
  single quotes**, as `describe('the hint\'s own timeout', ...)`.
  Reaching for double quotes is refused by `@stylistic/quotes`
  (`Strings must use singlequote`), and `eslint --fix` puts the escape
  back, so the escape is the convention rather than a thing to route
  around: 46 titles across `src/` carry one. This bullet read `so write
  test titles without one` until 2026-09-22, which those 46 falsify.
- **Markdown is a lint target, and every fenced block needs a language**
  (`markdown/fenced-code-language`). A fence shown INSIDE a fenced example
  — a `context/` page quoting the comment a command writes, say — is read
  as a real fence by the rule, so escape the inner backticks (`\`\`\``)
  rather than nesting them bare.

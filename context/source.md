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
- **Every `import type` line forms one `import/order` group**
  (`sharedRules.mjs`), in which a sibling path ranks ahead of a parent
  one: `./types.js` before `../../config.js`, the reverse of plain name
  order.

### Shapes the lint config forces

- **`@typescript-eslint/no-unused-vars` has no ignore pattern and no
  `ignoreRestSiblings`**, so a `{ mode: _mode, ...rest }` discard is an
  error. Drop keys with an `Object.entries` loop.
- **`eslint --fix` spreads a nested ternary over one line per branch**
  (`@stylistic/multiline-ternary`). Sort with `a.localeCompare(b)` rather
  than an `a < b ? -1 : a > b ? 1 : 0` comparator.
- **`eslint --fix` backslash-escapes an apostrophe in a single-quoted
  string**, so write test titles without one.

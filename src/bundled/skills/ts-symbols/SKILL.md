---
name: ts-symbols
provenance: first-party
description: "Project-aware TypeScript symbol queries from the shell: definition, references, resolved type, outline."
prevents: a grep-based symbol sweep that misses re-exports and aliases while matching same-named strangers
signal: silent
when_to_use: "Use when tracing a TypeScript or JavaScript symbol from a shell — its definition, its references, its resolved type, or a file's exports — and the name is too overloaded, re-exported, or aliased for grep to answer. Prevents: a grep-based symbol sweep that misses re-exports and aliases while matching same-named strangers"
tags:
  - ts
  - symbols
  - javascript
  - shell
  - typescript
stack:
  - javascript
  - shell
  - typescript
---

# ts-symbols: TypeScript symbol queries from the shell

CLI wrapper around the TypeScript language service. It locates the nearest
`tsconfig.json` above the target file and answers project-aware symbol queries —
what grep cannot do when a name has many same-named matches, is re-exported
(`export { x as y }`), or is imported via path aliases.

Invocation: `ts-symbols` (on PATH via `~/.local/bin`), or equivalently
`bun ~/.claude/tools/ts-symbols/cli.ts`. Positions are 1-based `<file>:<line>:<col>`,
where col points at the identifier itself (not the line start). `grep -n` gives
the line; get the column with `awk 'NR==60 {print index($0, "config")}' <file>`.

## Commands

**outline** — exported + top-level symbols with kinds and lines. Use before
reading a big file end to end.

```bash
ts-symbols outline packages/service/src/config.ts
# 58: export type Config
# 60: export const config
```

**def** — jump from a usage to the declaration (follows imports, aliases, `.js`
NodeNext specifiers).

```bash
ts-symbols def packages/service/src/index.ts:18:10
# packages/service/src/config.ts:60:14 const config — export const config: Config = ...
```

**refs** — every reference across the tsconfig project, tagged `[def]`,
`[write]`, or `[use]` with the source line. Trust this over grep for impact
analysis: it sees re-export sites and skips same-named strangers.

```bash
ts-symbols refs packages/service/src/config.ts:60:14
# packages/service/scripts/seed.ts:73:10 [write] import { config } from '../src/config.js';
# packages/service/src/index.ts:18:10 [write] import { config } from './config.js';
```

**type** — resolved type at a position (what an IDE hover shows). `--full`
additionally expands type aliases without truncation.

```bash
ts-symbols type packages/service/src/config.ts:60:14
# const config: { PORT: number; LOG_LEVEL: "fatal" | "error" | ...; }
```

## Notes

- `--json` on any command gives structured output.
- Exit codes: 0 results, 1 usage/error, 2 valid position but no results, 3 no
  typescript under `<root>`: add it to the project.
- In monorepos the scope is the *nearest* tsconfig's project — refs from a
  `packages/x` file cover that package, not sibling packages. For cross-package
  impact, follow up with a grep for the module specifier (the package name as
  imported).
- `--full` matters only when `type` prints a bare alias name; inline object
  types are already fully shown.
- Files a tsconfig excludes (commonly `**/*.test.ts`) still work as targets.
- Grep is still right for strings, comments, non-TS files, and cheap
  existence checks; reach for ts-symbols when identity matters.

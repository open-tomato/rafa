# rafa

To install dependencies:

```bash
bun install
```

To run the loop from a checkout (no arguments prints the command list):

```bash
bun src/rafa.ts start --plan=<file>
```

`bun run build` writes `dist/`, which the `rafa` bin and the package's
`exports` point at.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Running rafa from a snapshot

Run the global `rafa` from a copy of the build, never from this
checkout's `dist/`: `bun run build` opens with `rm -rf dist`, so a loop
running from `dist/` has its runner replaced by the first task that
builds. `bun run snapshot` builds, copies `dist/` into
`~/.rafa/runtime/<version>/` with the version from `package.json`,
points `~/.bun/bin/rafa` (under `HOME`, whatever `BUN_INSTALL` names)
at the copied `cli.js`, and prints the path the link resolves to,
exiting 0. It exits 1 before building anything while a plan tracker in
`.plans/` or the repo root still holds an open or blocked task, and
names every such tracker. It exits 2 when it could not run: a tracker or
`package.json` it could not read, or a build, copy or link that failed.
A loop may be running from the runtime it replaces, so each file and
then the link land by a rename, and nothing already in the runtime
directory is deleted.

## Runtime

The build targets bun. The package root, `./cli` and `./store` import
`bun:sqlite`, which node's ESM loader refuses before any module code runs,
so only `./plan` and `./ports` load under node, whatever `engines.node`
declares. The package ships no type declarations: `exports` names no
`types`, and a TypeScript consumer gets TS7016 under `strict`.

## Attribution

The agent task loop at the core of this project draws on several key sources:

- **Loop implementation**: Imported from
  [`marcostomatti/template-agentic-research`](https://github.com/marcostomatti/template-agentic-research),
  which provides the structured task runner and plan/report parsing layer.
- **Ralph method**: The core agent orchestration pattern originates from
  [`open-tomato/open-tomato`](https://github.com/open-tomato/open-tomato).
- **Instinct model**: Task routing and priority logic adapted from
  [`continuous-learning-v2`](https://github.com/affaan-m/continuous-learning-v2) by affaan-m.
- **Sync protocol**: The session state and artifact synchronization design is drawn from
  open-tomato's hive-learning pattern.

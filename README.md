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

# rafa

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

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

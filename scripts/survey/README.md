# Survey scripts

The map scripts that survey rafa's own code before the monorepo split
(epic #801). They read and report: each runs from the repository root,
edits no file under `src/` or `packages/`, and writes its reading as
`<name>.json` plus `<name>.md` under `.rafa/survey/`, which `.gitignore`
covers through `.rafa/`. Every markdown summary opens with the coverage
line: the tracked files the script was meant to read, the ones it read,
and each one it missed by path.

Nothing in this folder may hold a host name, a home path or a private
repository name: the repository is public. The outputs under
`.rafa/survey/` are local and may.

| Script | Output | Run line | Status |
| --- | --- | --- | --- |
| `survey-io.ts` | none; the shared helper the others import: `listTrackedFiles`, `measureCoverage`, `coverageLine`, `writeSurvey` | imported, not run | added |
| `import-graph.ts` | `.rafa/survey/import-graph.json`, `.rafa/survey/import-graph.md` | `bun scripts/survey/import-graph.ts` | planned |
| `test-index.ts` | `.rafa/survey/test-index.json`, `.rafa/survey/test-index.md` | `bun scripts/survey/test-index.ts` | planned |
| `provenance.ts` | `.rafa/survey/provenance.json`, `.rafa/survey/provenance.md` | `bun scripts/survey/provenance.ts` | planned |
| `concepts.ts` | `.rafa/survey/concepts.json`, `.rafa/survey/concepts.md` | `bun scripts/survey/concepts.ts` | planned |
| `test-timing.ts` | `.rafa/survey/test-timing.json`, `.rafa/survey/test-timing.md` | `bun scripts/survey/test-timing.ts` | planned |

A `planned` row names a script its own task adds; that task turns the row
to `added` in the same commit.

Each script sits beside its colocated `*.test.ts`. Unit tests use small
in-memory inputs or a temporary git repository, never the live one:

```sh
bun test scripts/survey/
```

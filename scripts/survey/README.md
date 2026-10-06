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
| `import-graph.ts` | `.rafa/survey/import-graph.json`, `.rafa/survey/import-graph.md` | `bun scripts/survey/import-graph.ts` | added |
| `test-index.ts` | `.rafa/survey/test-index.json`, `.rafa/survey/test-index.md` | `bun scripts/survey/test-index.ts` | added |
| `provenance.ts` | `.rafa/survey/provenance.json`, `.rafa/survey/provenance.md` | `bun scripts/survey/provenance.ts` | added |
| `concepts.ts` | `.rafa/survey/concepts.json`, `.rafa/survey/concepts.md` | `bun scripts/survey/concepts.ts` | added |
| `test-timing.ts` | `.rafa/survey/test-timing.json`, `.rafa/survey/test-timing.md` | `bun scripts/survey/test-timing.ts [--report <path>]` | added |

A `planned` row names a script its own task adds; that task turns the row
to `added` in the same commit.

`import-graph.ts` builds every tracked non-test source file under `src/`
and `packages/` in one `bun build --metafile` run, so its edges are the
runtime graph: `import type` lines are erased before the metafile and are
no edges. It clusters the graph with Louvain (`graphology`,
`graphology-communities-louvain`, both devDependencies), capped at eight
clusters ranked `c1` to `c8`, and scores betweenness per file with
`graphology-metrics`. A file with no edge is listed as isolated, and one
left beyond the eighth cluster with no edge out of it as detached.

`test-index.ts` reads every tracked test file under `src/` and
`packages/` and gives each its index, epic #801's criterion 4 baseline:
how many groups its `from '…'` imports reach under `src/` and
`packages/`, its own folder counted, doubled when it spawns a process. It
reads the groups by folder (the first folder under `src/`, or the
package) and by cluster from `.rafa/survey/import-graph.json`, so
`import-graph.ts` runs first. The guard index sets aside imports of
`src/tests/`, of `testdata/` folders and of files named `fake` or
`stand-in`.

`provenance.ts` reads the same source files as `import-graph.ts`, grouped
by its clusters, so `import-graph.ts` runs first. Each file is classified
by the commit that added it (a rename carries the origin along): `imported`
for a root commit or one whose subject names the import, `spec` or
`bug-sweep` by the labels of the issues its message names (`#<n>`,
`rafa-<n>`) resolved against `.rafa/cache/board.json`, `poc` for a spike
or a change no spec designed, and `bug-sweep` for a `fix:` subject no
issue decided. A worktree keeps no board cache of its own: pass
`--board <path>` to read another checkout's.

`concepts.ts` seeds concepts from every heading of the tracked
`context/*.md` pages (fenced code aside) and from the defined terms of
`context/terminology.md`, a bold span opening a line before `is` or
`are`. A heading naming a procedure ("What …", "Adding …") or with no
searchable term is listed as skipped. Each concept's terms match a source
file's path or text in any spelling a name takes (`copyDetection`,
`copy-detection.ts`, `COPY_DETECTION`). It searches the sources
`import-graph.ts` clusters, so that script runs first, and writes the
concept-by-cluster matrix, reading each concept as absent from the code,
within one cluster or crossing several, never renaming a cluster after a
concept. A file that is not valid UTF-8 is named as missed.

`test-timing.ts` runs no test: it reads the junit XML report a suite run
wrote, `.rafa/survey/junit.xml` unless `--report <path>` names another
(`bun test --reporter=junit --reporter-outfile=.rafa/survey/junit.xml`).
A file's seconds are the sum of its test cases' times, so hooks outside a
case are not counted. A test file's cluster is its subject source file's,
else its directory's most common, else `none`, from
`.rafa/survey/import-graph.json`, so `import-graph.ts` runs first. A
tracked test file the report holds no case for is named as missed.

Each script sits beside its colocated `*.test.ts`. Unit tests use small
in-memory inputs or a temporary git repository, never the live one:

```sh
bun test scripts/survey/
```

## rafa-d2c

Design-to-code as a rafa module, in `addons/rafa-d2c/`, a workspace
member named on its own in the root `workspaces` (the `addons/*` glob
would also take in `addons/dyno`). This first part keeps a project's
visual baselines in a store the person configures; `import`, `assess`
and `serve` from #1262 come later. The design is the main checkout's
`.rafa/specs/draft-rafa-d2c-visual.md` (gitignored).

**Verbs are bare actions.** A module's commands are routed by their
action alone, so the line is `rafa module exec @open-tomato/rafa-d2c
check`; `subject` is `visual` for grouping only. The verbs are `run`,
`check`, `seed`, `place`, `promote`, `orphans` and `migrate`.
`src/tests/d2c-module-mount.test.ts` mounts the add-on through the real
loader and dispatcher.

**A step answers, a command prints.** Each verb is a step in
`src/steps/` that takes the loaded config and its seams (the process
runner, the host facts, a clock) and answers a result; its command in
`src/commands/` prints it and refuses. Readings of files other tools
write have one reader per contract: the jest report and the story index
in `src/suite/storybook-jest.ts`, the old `ENVIRONMENT` in
`src/store/environment.ts`.

**Refusals exit 1.** The module cannot throw core's `CommandExit`
reliably (see `context/atlas.md`), so a refusal is `output.error` per
line and a plain `Error`. `run`'s last line names the suite's own exit
code and whether `place` ran clean, and either failing exits 1.

**The project root comes from the scope walk.** `module exec` resolves
no project, so `src/project.ts` calls core's `resolveScope` from the
working folder (exported as `@open-tomato/rafa-core/project/scope`). A
linked worktree resolves to its main checkout, where `.rafa/d2c.yaml`
lives. The suite's paths resolve against the work root instead
(`workRootOf`, `LoadedConfig.workRoot`): the linked worktree the
command runs from, so each branch tests its own code and two worktrees
never seed one folder. Every other start answers the project root.

**Served in this version:** the `storybook-jest` suite kind, the `host`
runner, and the `local-dir` and `side-repo` stores. `container`,
`remote` and `same-repo` are read by the config and named by `check`.

**The LFS server is the person's.** A side-repo store with LFS needs a
server that speaks it; the README recommends a self-hosted Gitea with
`LFS_ALLOW_PURE_SSH`, from a health read of the git-lfs implementations
list. The add-on never installs, configures or pushes to one.

**The add-on is private and public at once.** Its package is `private`
until the review page moves in, and its source is in a public repo, so
`privacy.sweep.test.ts` sweeps the folder with the shared helper in
`src/tests/privacy-sweep.ts`.

Test it at its own scope: `bun test addons/rafa-d2c/` and
`bun test src/tests/d2c-module-mount.test.ts`, then `check-types` and
`lint` in `addons/rafa-d2c/`.

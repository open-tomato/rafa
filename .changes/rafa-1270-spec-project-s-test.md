---
plan: rafa-1270-spec-project-s-test
title: The project's test kinds and check points read from a tracked file
level: minor
---

- config: A scope's module file (`rafa.config.ts` or `rafa.config.mjs`) and its `.rafa/config.yaml` are now both read: the module file is yours and rafa never writes it, and the YAML file is read over it key by key as the scope's local layer, in the project scope and under `~/.rafa/` alike. A YAML file beside a module file is no longer left unread with a warning: `rafa doctor` drops the shadowed-file row, `rafa config show --sources` names the project's YAML keys as `local` and its module keys as `project`, and `rafa config set` edits `.rafa/config.yaml` beside a module file instead of refusing. A `.rafa/config.yaml` that sets `effort.sync: service` with no `hub.url` is refused under its own path rather than as `local` or `user`. In the library, `resolveConfig` takes a `local` and a `userLocal` file ranked above that scope's module file, `ResolvedConfig` carries `localPath` and `localExtras` in place of `shadowed`, the `ConfigSource` union gains `local`, and `readProjectScope(root)` reads a project's two files with their templates laid under them.
- survey: The survey's test-kind reader reads `rafa.config.ts` as well as `.rafa/config.yaml`, the YAML file's keys first, so a fresh clone, a worktree and CI classify contract and integration tests from the tracked file.

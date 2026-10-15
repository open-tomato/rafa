---
plan: rafa-118-config-code
title: Configuration as code
level: minor
---

- Configuration: rafa now reads `rafa.config.ts` or `rafa.config.mjs` ahead of `.rafa/config.yaml`, in the project root and in `~/.rafa/`, and a directory holding either module file is found as a project root; the settings come from registered config sections whose cross-key checks all run; a scope holding both a module file and a YAML file reads the module file and warns naming the YAML file; two entries of one file setting the same key are reported as the new `merge.duplicates` setting decides (`warn`, `error` or `allow`); a user-scope file holding `flows` or `steps` is refused, and a file importing a module it cannot find names the module and the install; the new `naming.branch` template names the branch `rafa loop start` creates (default `feat/{stub}`); and every command prints one line per `dangerous.*` key set off its default, naming the file and entry that set it
- Library: `loadConfig` from `@open-tomato/rafa` now returns a Promise, and its result names the file and entry of each setting (`provenance`) and the YAML files left unread (`shadowed`)
- CLI: new `rafa config show` prints every setting with its merged value, or with `--sources` the layer, file and entry it came from, in text or json; `rafa config set` refuses, naming the file, in a project configured by `rafa.config.ts` or `rafa.config.mjs`
- pr: `rafa pr triage --resolve` refuses a pull request whose head carries a `rafa.config.ts` or `rafa.config.mjs` that `origin/<base>` does not hold unchanged, and `--allow-local-config` runs it anyway with a warning
- doctor: `rafa doctor` lists its config warnings, including a `.rafa/config.yaml` left unread beside `rafa.config.ts` with the fix, and one note row per `dangerous.*` key a config sets, right after the config loads
- Packaging: the package publishes `@open-tomato/rafa/config` with its type declarations, so a `rafa.config.ts` can import `defineConfig` and the `Config` type
- docs: the README's Configuration section now covers the three config file forms, the shadow warning, `config show`, the `config set` refusal and the `pr triage --resolve` trust rule

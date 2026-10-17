---
plan: rafa-906-spec-load-feature-commands
title: Load feature commands lazily through one registry
level: minor
---

- internal: rafa's entries now register core's adapters and config sections with explicit calls, `registerCoreConfigSections()` and `registerCoreAdapters()`, in place of imports kept for their effect alone, so a bundler cannot drop the registration.
- library: the package root exports `registerCoreAdapters`, `CORE_ADAPTERS` and `registerCoreConfigSections`; importing `src/config-registry.ts` or `src/adapter-registry.ts` no longer registers anything by itself, so a consumer calls the two functions once before it resolves an adapter or loads a config.
- modules: a loaded module's adapters are now active for the whole rafa invocation, so a module's kind is found wherever rafa resolves an adapter; `rafa module list` and other reloads no longer refuse a module because its own kind is already registered; and the module loader reports which bundled features the config turns off with `features.<name>: false`.
- docs: `context/cli.md` says the entries register core through `registerCoreConfigSections` and `registerCoreAdapters`, with `src/tests/preload.ts` as the suite's source of the same calls, and `context/source.md` states that a `declarations.ts` imports types and core values alone, that a feature's index reaches a command module only through `lazyCommand`, and that the two roots alone register core's config sections and adapters.
- config: a new `features` section with `features.board`, `features.pr`, `features.run` and `features.release`, each a boolean that is on by default.
- cli: a bundled feature turned off in the project config leaves the command registry, so its subject and commands drop out of `rafa --help`, `rafa describe` and routing for that invocation.

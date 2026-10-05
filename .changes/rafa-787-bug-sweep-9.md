---
plan: rafa-787-bug-sweep-9
title: Bug sweep 9 — the reference check refuses only drift
level: minor
---

- Plans: the readiness gate's reference check (`rafa plan create`'s check 4) refuses only drift — a reference stamped present that went missing, or whose file or issue text changed; a file, symbol, command, flag or key the spec is about to add reads `new`, is printed as a note and stamped, and is restamped present without asking once it exists; a symbol reads present wherever a TypeScript file declares it, module-local functions, interface members and object fields included; flags are read only from code spans opening with `rafa`, so another program's flags no longer read as missing rafa flags; and commands and flags are read against a rafa checkout's own `describe` roster, falling back to the running rafa's with a warning.
- Issues: `rafa issue check` prints a `new` reference with a note that its target is not there yet, and counts `new` references in its count line.
- Documentation: `context/pull-requests.md` and `context/cli.md` describe check 4's drift-only refusal, the `new` state, flags read from `rafa` spans, declaration-position symbols and the checkout roster with its fallback warning.

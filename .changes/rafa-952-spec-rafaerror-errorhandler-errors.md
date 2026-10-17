---
plan: rafa-952-spec-rafaerror-errorhandler-errors
title: RafaError, the failure handler and the coded result
level: minor
---

- packaging: The published package now ships type declarations for the error-code list at `@open-tomato/rafa/errors/codes` and `@open-tomato/rafa/errors/rafa-codes`.
- errors: Core gains `RafaError`, a coded error carrying a cause code, hint, level, module and action from a constructor that never throws. `ScopeError` is now a coded `RafaError` of the `project` module: its constructor takes `{ code, message, cause? }` instead of `(message, options)`, and a relative path, an unresolvable start or an unreadable main checkout ends as `no_project` with cause `input:invalid-value`, `fs:not-found` or `git:new-context`. `toBugFields` turns an error and the command that ran into a bug's module, action, cause and artifact, taking the stack from the coded error rather than its wrapper.
- core: `CommandExit` accepts an options argument and keeps the cause it is given.
- cli: A failed command's JSON result error now carries `cause`, plus `hint`, `module` and `action` where known. In text mode a coded failure ends its error line with the code in brackets and prints its hint on the line below.

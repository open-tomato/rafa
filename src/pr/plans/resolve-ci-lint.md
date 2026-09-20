<!-- eslint-disable markdown/no-multiple-h1 -->
# Plan: Resolve CI lint failure

```rafa:plan
stub: resolve-ci-lint
issue: "20"
spec: .specs/rafa-20-pr-commands.md
```

```rafa:context
The `bunx eslint .` step in CI failed. This plan routes the repair task to the build-error-resolver agent with the CI log excerpt, allowing it to diagnose and fix lint violations.

This triage already read the failing job's log, and the excerpt below is what it read; do not fetch it again.

{FAILING_LOG}
```

## Description

This plan resolves a pull request with a failed `bunx eslint .` step in CI by delegating diagnosis and repair to the build-error-resolver agent, which will analyze the log excerpt and implement the necessary lint fixes.

# Stage: Resolve

- [ ] Analyze the CI lint failure log excerpt and repair the lint violations that caused the check to fail {agent=build-error-resolver}

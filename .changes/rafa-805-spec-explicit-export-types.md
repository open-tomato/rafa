---
plan: rafa-805-spec-explicit-export-types
title: Explicit types on every export, with `isolatedDeclarations` and `erasableSyntaxOnly` on
level: patch
---

- CI: The verify workflow's Types step now runs `bun run check-types`, so the root config and both workspace packages are type-checked on every pull request.
- types: `isolatedDeclarations` and `erasableSyntaxOnly` are now on for the root config and both workspace packages; every export carries an explicit type, and `context/source.md` states the rule for new exports.

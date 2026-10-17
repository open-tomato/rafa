---
plan: rafa-1231-spec-bug-recheck-reads
title: `rafa bug recheck` reads the `-t` value as a shell does
level: patch
---

- bugs: `rafa bug recheck` reads a bug's `Rerun` `-t` value as a shell reads a double-quoted string, so a bug the loop filed for a case whose name holds a regular expression's special character, such as `a (case)`, is rerun with the pattern triage meant instead of being judged `stale`; an unescaped `$` or backtick inside the value is refused as `manual`, with the character named
- docs: the "Recheck" section of `context/bug-record.md` says how the `-t` value is read back as a shell reads it, that the value triage writes and the pattern recheck runs are inverses, and that an unescaped `$` or backtick inside the value is `manual`

---
plan: rafa-819-bug-sweep-12
title: Planned under assumptions
level: patch
---

- Tests: tests that spawn rafa now print the child's stdout, stderr and scratch paths when an exit code is wrong, a new content sweep fails any test that asserts a spawned run's exit code bare, and two type errors in the suite-step and loop-output tests are fixed

---
plan: rafa-485-green-main
title: A clean checkout of main passes bun test and eslint
level: patch
---

- Fixed: rafa refuses a `.rafa/config.yaml` line indented with a tab with its own error naming the line, on every Bun version, and the test-only store guard now accepts a temp-directory path spelled through a symlink (such as macOS's `/var`), even before the path exists.
- Tests: the live parity suites skip unless `RAFA_LIVE_PARITY=1` is set; the real-plan and migrations cases read data committed to the repository; spawned and git-committing fixtures carry their own git identity and Bun cache, so a clean checkout no longer depends on the host.
- Documentation: the README notes that tab indentation in `.rafa/config.yaml` is refused; `context/verification.md` names `RAFA_LIVE_PARITY=1` for the live parity suites and drops the known failures this release removes; the zsh README's code fence gains a language.

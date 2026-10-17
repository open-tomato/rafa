---
plan: rafa-1186-spec-1172-s-follow
title: Per-package publishing closes #1172's three gaps
level: patch
---

- Workspace: The workspace graph check's publish rules now read only the files a publishable package ships: those its `files` list names, as npm packs them, or, with no `files`, every code file except test files and the tool configs at the package root; a listed config file ships and is read, while the dependency rule and the undeclared-import rule still read every file.
- Release: The merge guard's forecast for a package fragment now folds from that package's manifest version at the base commit, with only the branch's fragments naming that package, as the root forecast folds only the root's; a package the base workspace lacks, a private one, or one declaring no version gives no forecast and one problem line naming it.

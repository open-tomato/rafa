---
plan: fix-package-bin-path
title: The manifest spells the rafa bin target as npm writes it, so a publish prints no correction warning
level: none
---

- Packaging: `package.json` maps the `rafa` binary to `dist/cli.js` where it mapped it to `./dist/cli.js`. `npm publish` cleaned the leading `./` on every publish and warned that it had auto-corrected the manifest (`"bin[rafa]" script name was cleaned`); the published manifest already held the cleaned form, so an installed rafa is unchanged. `src/tests/package-build.test.ts` pins the new spelling.

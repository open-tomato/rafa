# @opentomato/rafa

This name is a signpost. The package lives at
[`@open-tomato/rafa`](https://www.npmjs.com/package/@open-tomato/rafa),
with a hyphen:

```bash
npm i -g @open-tomato/rafa
```

Nothing is installed by this package: no binary, no code, no install
script. It exists so the unhyphenated name cannot be taken by somebody
else and so a mistyped install lands on directions instead of a 404.

## Publishing it (maintainers)

From this directory, once, and again only when this text changes:

```bash
npm publish
npm deprecate @opentomato/rafa "Use @open-tomato/rafa (with a hyphen)."
```

The deprecation is what makes `npm i @opentomato/rafa` print the
directions at install time.

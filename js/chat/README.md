# Secure Chat, in parts

This directory is `js/chat.js` — 22,096 lines in a single IIFE — cut into 36
ordered files. The cut was made by `tools/split-chat.cjs`, which parses the
original with Babel and asserts that concatenating its output reproduces the
input exactly before it writes anything.

## Why these are classic scripts and not ES modules

The obvious modernisation is `import`/`export`. It was measured and rejected.

The original file declared **973 top-level names** across **1,037 statements**.
Turning that into ES modules means deriving the full reference graph between
those names, and it introduces two hazards the original does not have:

- **Temporal dead zone.** 124 top-level `const` declarations, some with
  initialisers that call functions. Circular imports between modules turn a
  working program into a run-time `ReferenceError` that only fires on some
  paths.
- **Live bindings are read-only for importers.** 18 top-level `let` bindings are
  reassigned. Every one would have to move into a shared mutable object.

So the deciding measurement was a different one: how many of those 973 names
collide with anything else the page loads?

**One.** `downloadBlob`, which also exists in `js/app.js`. It is renamed here to
`chatDownloadBlob`.

With that single conflict resolved, dropping the IIFE and letting the parts
share the global scope preserves the original semantics almost exactly —
`function` declarations and top-level `const`/`let` behave the same way across
ordered classic scripts as they did inside one function body — while giving the
whole benefit of the split: files you can hold in your head.

## Order matters

`defer` executes scripts in document order, and the numeric prefixes *are* that
order. Renaming a file, or adding one out of sequence, will break the load.
`index.html` and `sw.js` both list them; keep the three in step.

## Re-running the split

    node tools/split-chat.cjs

The pre-split original is kept at `tools/chat.js.pre-split`, outside the served
tree, so the split can be regenerated or audited. It is not loaded by anything.

## The parts

Boundaries follow the section banners the original already carried — the
author's own decomposition — with a second cut wherever a section ran past
about 1,500 lines.

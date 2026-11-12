# Browser regression checks

Install Playwright in your development environment, then run:

```sh
node tests/crossword-dual.cjs
```

Set `CHROMIUM_PATH` to use an existing Chromium executable and `SCREENSHOT_PATH` for an optional tablet screenshot.
The test serves the local HTML through an intercepted localhost request; it needs no deployed site or external API.
It covers ten deterministic generation runs, A/B reversal, both fixed keywords, common words in different positions,
exact word count, board size, aligned common words, modes 1/2, and an impossible word-count limit.
It also checks fresh keyword selection on regeneration, free-keyword replacement on fixed shapes,
the explicit keyword lock, and keyword input synchronization. A generated fixture exercises a
five-letter same-shape replacement with the reported registrations.
Independent assertions check registration retention, connectivity, crossing letters, unintended adjacency,
matching geometry, dictionary keywords and the letters actually read at shared marks.

The two exported eight-word fixtures also verify fixed-keyword refills over multiple clicks,
confirmed helper retention, and joint search that rejects the current board. Crossings,
unintended adjacency, connectivity, both keyword readings and identical geometry are
checked independently for every intermediate refill result.

History saturation regressions ensure that all previously seen local replacements remain
available, including after a separate confirmed word changes from わきん to れきし.

Different-shape button checks exercise both DOM handlers, compare occupied-cell geometry
independently (including translations, rotations and reflections), and verify that an
impossible different-shape search preserves the entire project and reports failure.

The fixed-keyword generation regressions use the previously exported seven/eight-word
return-favor boards and eight-word thank-you board. They require a different occupied
shape while retaining both fixed keywords, all registrations, the eight-word bound and
shared mark locations. Additional checks cover every allowed word count from 3 to 8,
valid/invalid branch mutations, geometry-cache corruption and privacy, and actually
solving a new custom registration using an imported geometry with no random layout call.

NG-word regressions cover normalized bulk input, per-word buttons, removal, exact matching,
dictionary/favorite exclusion, final validation, multi-word refills, required-word conflicts,
fresh generation, different-shape generation, and file/share/undo/legacy round trips.
The suite currently contains 49 cases.

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

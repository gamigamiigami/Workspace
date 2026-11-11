# Browser regression checks

Install Playwright in your development environment, then run:

```sh
node tests/crossword-dual.cjs
```

Set `CHROMIUM_PATH` to use an existing Chromium executable and `SCREENSHOT_PATH` for an optional tablet screenshot.
The test serves the local HTML through an intercepted localhost request; it needs no deployed site or external API.
It covers ten deterministic generation runs, A/B reversal, both fixed keywords, common words in different positions,
exact word count, board size, aligned common words, modes 1/2, and an impossible word-count limit.
Independent assertions check registration retention, connectivity, crossing letters, unintended adjacency,
matching geometry, dictionary keywords and the letters actually read at shared marks.

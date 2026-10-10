# WritingSpeed

**English** · [Русский](README.ru.md)

**WritingSpeed** («Скорость печати») is a typing speed test in a single HTML page. It works with no server and no internet: open `index.html`, use it online, or install the Windows app.

**[▶ Try it online](https://alexalesha.github.io/WritingSpeed/)** · **[⬇ Windows app (setup and portable)](https://github.com/ALEXalesha/WritingSpeed/releases/latest)**

The interface is in Russian and English (the RU/EN button in the header).

![A test in progress](docs/screens/test.png)

![Results: speed by second, mistakes by key](docs/screens/result.png)

## What it can do

- **Modes:** time (15, 30, 60, 120 s), words (10, 25, 50, 100), quote (short, medium, long), custom text, and zen - no text and no limit, Shift+Enter to finish.
- **Languages:** Russian, Ukrainian, English, German, French, Spanish, and code - JavaScript and Python (keywords and snippets; a new line is Enter, the indent is not typed).
- **Word lists:** the 200, 1000 or 5000 most frequent words of each language.
- **Difficulty:** punctuation, numbers, capitals; "no backspace" (nothing can be erased) and "stop on error" (a wrong letter is not typed until you press the right one).
- **Statistics:** net WPM and CPM, raw speed, accuracy, consistency, correct/wrong/extra/missed characters, a speed graph by second with the mistakes on it, mistakes by key on the keyboard of the test language (ЙЦУКЕН, Ukrainian, QWERTY, QWERTZ, AZERTY, Spanish), weakest keys and a practice test made of words with them.
- **Records** for every mode (mode, language, list and difficulty) and a history of the last 200 tests, kept in the browser (`localStorage`, keys `typing:*`); the page keeps working if the storage is blocked.
- **Typing feel:** a smooth caret, correct and wrong letters coloured as you type, a shake on a blocked key, a hint "switch the keyboard layout" when Latin letters come in a Russian test (and the other way round).
- **Look:** five themes (Glass, Formal, Light, Night, Warm - the same as in Paint Pro and Calc Pro), font size 75-200%, monospace or proportional font.

![Code in the light theme, English interface](docs/screens/code-light.png)

![Settings in the warm theme](docs/screens/settings.png)

### How it is counted

| Value | Formula |
|---|---|
| WPM (net) | characters of correctly typed words + the spaces after them, / 5, / minutes |
| CPM | the same characters per minute |
| Raw speed | every keypress that typed a character (erased ones too), / 5, / minutes |
| Accuracy | correct keypresses / all keypresses × 100% |
| Consistency | 100 × (1 − tanh(v + v³/3 + v⁵/5)), v = standard deviation / mean of the speed by second |

Time runs from the first keypress to the last (in time mode - exactly the chosen limit). A mistake is counted on the key you should have pressed.

### Keys

| Key | Action |
|---|---|
| Tab | new text |
| Esc | the same text again |
| Ctrl+Backspace | erase a word |
| Enter (on results) | next test |
| Shift+Enter | finish a zen test |

## Run locally

- **Browser:** open `index.html` in Chrome, Edge or Firefox. Everything is in the file; nothing is downloaded.
- **Windows app:** take `WritingSpeed-<version>-Setup.exe` (installs for the current user) or `WritingSpeed-<version>-Portable.exe` (runs without installing) from [Releases](https://github.com/ALEXalesha/WritingSpeed/releases). The window remembers its size and place; the version is in the title.
- **From source:** `npm install`, then `npm start` (the app) or `npm run dist` (setup and portable in `electron/dist`).

The app in `electron/` loads the same `index.html` - there is no second copy of the page.

## Tests

```
npm install
npx playwright install chromium
npm test                       # page laws (fake clock) and the Electron app (hidden window)
npm run test:unit              # app laws without starting it
node tests/mutate.js           # mutation check: broken copies of the page must fail the laws
```

The page laws open `index.html` by its file address in headless Chromium, one at a time, with a fake clock (`page.clock`): a known text typed at a known pace must give exactly the expected WPM, accuracy and mistakes by key. The mutation check breaks 20 rules one by one (the WPM formula, accuracy, consistency, time limit, records, storage, …) in a copy in a temporary folder and never touches `index.html`. The Electron test runs the app with a hidden, non-focusable window. Mouse capture in the tests is always a stub. The pictures above were made headless by `tools/screenshots.js`.

## Where the words and texts come from

- **Word lists** (the `WORDS` block of `index.html`) are built by `tools/make-words.py` from word frequencies of **[wordfreq](https://github.com/rspeer/wordfreq) 3.1.1** by Robyn Speer et al. (data: Wikipedia, subtitles, books, news and more; licence **CC BY-SA 4.0**). Each word is kept only if the Hunspell dictionary of its language ([wooorm/dictionaries](https://github.com/wooorm/dictionaries)) knows it in that spelling - this drops names, places, abbreviations and words of other languages; rude words are removed by the patterns in `tools/blocklist.b64.txt` (base64, so the file is not readable at a glance). German nouns keep their capital letter. **The `WORDS` block is licensed under CC BY-SA 4.0**; the rest of the page is MIT.
- **Quotes** are public domain (Pushkin, Tolstoy, Lermontov, Chekhov, Gogol, Krylov, Shevchenko, Lesya Ukrainka, Kotliarevsky, Shakespeare, Dickens, Austen, Carroll, Lincoln, Goethe, Schiller, Heine, Kafka, Hugo, Descartes, Proust, La Fontaine, Voltaire, Cervantes, Machado, Bécquer, Calderón), proverbs, pangrams, or original lines written for this project. Code snippets are original.

## History

WritingSpeed was made in the [GameRoom](https://github.com/ALEXalesha/GameRoom) collection (folder `web/writing-speed`), where it is the first program in the "Programs" section of the Igroteka launcher ([open there](https://alexalesha.github.io/GameRoom/)). This repository carries it with its commit history.

## Licence

Code: MIT, see [LICENSE](LICENSE). The word lists in the `WORDS` block: CC BY-SA 4.0 (derived from wordfreq).

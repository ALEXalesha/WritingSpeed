# Changelog

## 1.1.2

- Fixed: a short Russian custom text or zen text got the QWERTY map of mistakes, and a mistake on a Russian letter went to "Other characters". The key name "space" was counted as five Latin letters.
- Fixed: the speed chart with a single point (the first test in History, a test shorter than a second) was empty. Now the point is drawn.
- The page description no longer says "quotes" (the mode is "text" since 1.1.0).

## 1.1.1

- Fixed: hovering a menu button made the lower half of the menu panel (and of the header) lighter - a light band across the whole panel. The glass panels no longer use backdrop-filter: the graphics card recomputed the blur only in a band of the panel and caught the panel itself. The panels look the same.

## 1.1.0

- New "text" mode instead of quotes: classic passages and original texts of ~10, ~20, ~50, ~100, ~200 or ~300 words, 10 for every length and language. Your quote records move to "text". The "time" mode can now run on words or on text.
- Chinese: type characters with your input method (IME), speed in characters per minute, mistakes listed by character; a "pinyin in Latin letters" mode and a pinyin hint above the characters.
- "Dictionary: 200/1000/5000 most frequent words" with a hint, and every mode shows only the settings that change it.
- Zen: the button is now "Erase". Custom text: Tab opens the window for a new text.
- A long word without spaces wraps to the next line.
- Fixed: pressing a menu button highlighted the whole row.

## 1.0.0

- Modes: time (15/30/60/120 s), words (10/25/50/100), quotes, your own text and zen (no limit).
- Russian, Ukrainian, English, German, French, Spanish, plus JavaScript and Python code; the 200, 1000 or 5000 most frequent words.
- Difficulty: punctuation, numbers, capitals, no backspace, stop on error.
- Results: WPM and CPM, raw speed, accuracy, consistency, a speed graph by second, mistakes by key on your keyboard layout, and a practice test with your weakest keys.
- Records for every mode and a history of tests; a hint when the keyboard layout is wrong.
- Five themes, Russian or English interface, adjustable font size.
- The window opens where you left it; the version is in the title.
- Setup for one user without admin rights, or a portable exe. Nothing is sent anywhere.

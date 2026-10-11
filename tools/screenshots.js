// Кадры для README: docs/screens/*.png. Страница открывается в безголовом Chromium по
// файловому адресу, часы поддельные (page.clock), ввод - с клавиатуры Playwright, так что
// кадр всегда один и тот же. Окон на экране нет, захват мыши - заглушка.
//   node tools/screenshots.js
// WS_PAGE - другая копия страницы, WS_OUT - другая папка для кадров.
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('@playwright/test');

const PAGE = process.env.WS_PAGE || path.join(__dirname, '..', 'index.html');
const OUT = process.env.WS_OUT || path.join(__dirname, '..', 'docs', 'screens');
const T0 = new Date('2026-10-10T12:00:00').getTime();

async function open(browser, { theme = 'glass', ui = 'ru', lang = 'ru', mode = 'time', size = { width: 1180, height: 760 } } = {}) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.addInitScript(() => { Element.prototype.requestPointerLock = function () {}; Document.prototype.exitPointerLock = function () {}; });
  await page.addInitScript((s) => localStorage.setItem('typing:settings', JSON.stringify(s)), { theme, ui, lang, mode, time: 30, count: 25, size: 1000, smooth: false });
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.clock.install({ time: T0 });
  await page.goto(pathToFileURL(PAGE).href + '?seed=11');
  await page.waitForFunction(() => window.__ws && window.__ws.ready);
  await page.clock.pauseAt(T0 + 60000);
  return page;
}

// Напечатать n слов теста с ровным темпом и парой ошибок
async function typeWords(page, n, step, mistakes = []) {
  const words = await page.evaluate((k) => __ws.state.words.slice(0, k).map((w) => w.text), n);
  for (let i = 0; i < words.length; i++) {
    const w = mistakes.includes(i) ? words[i].replace(/.$/, (c) => (c === 'а' ? 'о' : c === 'e' ? 'r' : 'а')) : words[i];
    for (const ch of w) { await page.keyboard.type(ch); await page.clock.runFor(step + ((ch.charCodeAt(0) * 37) % 60)); }
    await page.keyboard.type(' '); await page.clock.runFor(step);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // 1. тест на середине
  let page = await open(browser);
  await typeWords(page, 9, 150, [4]);
  const w = await page.evaluate(() => __ws.state.words[__ws.state.wi].text);
  await page.keyboard.type(w.slice(0, 2));
  await page.clock.runFor(300);
  await page.screenshot({ path: path.join(OUT, 'test.png') });

  await page.close();

  // 2. итог: все 30 секунд ровного набора с парой ошибок - график, ровность, клавиатура ошибок
  page = await open(browser, { size: { width: 1180, height: 960 } });
  for (let i = 0; i < 80 && (await page.evaluate(() => __ws.state.phase)) !== 'done'; i++) {
    const word = await page.evaluate(() => __ws.state.words[__ws.state.wi].text);
    const typo = i % 9 === 4;
    for (const [j, ch] of [...word].entries()) {
      await page.keyboard.type(typo && j === word.length - 1 ? (ch === 'о' ? 'а' : 'о') : ch);
      await page.clock.runFor(140 + ((ch.charCodeAt(0) * 37 + i * 11) % 70));
      if ((await page.evaluate(() => __ws.state.phase)) === 'done') break;
    }
    if ((await page.evaluate(() => __ws.state.phase)) === 'done') break;
    await page.keyboard.type(' '); await page.clock.runFor(150);
  }
  await page.clock.runFor(1000);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'result.png') });
  await page.close();

  // 3. английский интерфейс, светлая тема, код
  page = await open(browser, { theme: 'light', ui: 'en', lang: 'py', mode: 'quote' });
  const words = await page.evaluate(() => __ws.state.words.slice(0, 6).map((x) => [x.text, x.sep]));
  for (const [t, sep] of words) {
    for (const ch of t) { await page.keyboard.type(ch); await page.clock.runFor(120); }
    await page.keyboard.press(sep === '\n' ? 'Enter' : 'Space'); await page.clock.runFor(120);
  }
  await page.screenshot({ path: path.join(OUT, 'code-light.png') });
  await page.close();

  // 4. тёплая тема, настройки
  page = await open(browser, { theme: 'warm' });
  await page.click('#open-settings');
  await page.screenshot({ path: path.join(OUT, 'settings.png') });
  await page.close();

  await browser.close();
  for (const f of fs.readdirSync(OUT)) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' КБ');
})().catch((e) => { console.error(e); process.exit(1); });

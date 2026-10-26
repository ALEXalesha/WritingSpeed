// Законы «Скорости печати / WritingSpeed» (index.html, одна страница):
// подсчёт WPM/CPM/точности на поддельных часах (page.clock), ошибки по клавишам, режимы и
// конец по времени, «без Backspace» и «стоп на ошибке», рекорды и история (и сломанное
// хранилище), темы, языки интерфейса и теста, подсказка про раскладку, списки слов.
// Запуск: npx playwright test tests/writing-speed.spec.js --workers=1
// Проверка проверок (мутации в копии страницы): node tests/mutate.js
// WS_FILE - путь к другой копии страницы (так мутационный скрипт гоняет эти законы на сломанной копии).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE_DIR = path.join(__dirname, '..');
const FILE = process.env.WS_FILE || path.join(PAGE_DIR, 'index.html');
const URL = pathToFileURL(FILE).href;
const T0 = new Date('2026-10-10T12:00:00').getTime();

// Захват мыши в проверках только поддельный: настоящий в безголовом Chromium на Windows зажимает курсор
const FAKE_POINTER_LOCK = () => {
  const fake = function () { window.__fakeLock = (window.__fakeLock || 0) + 1; return Promise.resolve(); };
  Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, writable: true, value: fake });
  Object.defineProperty(Document.prototype, 'exitPointerLock', { configurable: true, writable: true, value: function () {} });
};

// Открыть страницу на поддельных часах (время стоит, двигается только page.clock.runFor)
async function openWs(page, { query = 'seed=7', storage = null, init = null } = {}) {
  const errors = [];
  await page.addInitScript(FAKE_POINTER_LOCK);
  if (storage) await page.addInitScript((items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }, storage);
  if (init) await page.addInitScript(init);
  page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.clock.install({ time: T0 });
  await require('./helpers').lockFirst(page); await page.goto(URL + (query ? '?' + query : ''));
  await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
  await page.clock.pauseAt(T0 + 60_000);
  return errors;
}

// Напечатать строку по знаку, сдвигая часы на step мс после каждого
async function typeTimed(page, text, step = 200) {
  for (const ch of text) {
    if (ch === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.type(ch);
    await page.clock.runFor(step);
  }
}

const result = (page) => page.evaluate(() => {
  const r = __ws.result;
  return r && { wpm: r.wpm, raw: r.raw, cpm: r.cpm, acc: r.acc, cons: r.consistency, dur: r.duration, correct: r.correct, incorrect: r.incorrect, extra: r.extra, missed: r.missed, keys: r.keys, errors: r.errors, presses: r.presses, isRecord: r.isRecord, key: r.key, unit: r.unit };
});
const state = (page) => page.evaluate(() => ({ phase: __ws.state.phase, wi: __ws.state.wi, typed: __ws.state.typed.slice(0, 30), words: __ws.state.words.slice(0, 30).map((w) => w.text) }));
const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(eps);

// Наибольшая разница каналов двух кадров одного размера (считается в странице: массивы не гоняются)
const maxDiff = (page, a, b) => page.evaluate(async ([a, b]) => {
  const load = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
  const [A, B] = [await load(a), await load(b)];
  let m = 0;
  for (let i = 0; i < A.length; i++) if ((i & 3) !== 3) m = Math.max(m, Math.abs(A[i] - B[i]));
  return m;
}, [a.toString('base64'), b.toString('base64')]);

async function custom(page, text) {
  await page.evaluate((t) => __ws.startCustom(t), text);
}

test.describe('ws: страница', () => {
  test('открывается без ошибок и без сети, режимы и флажки на месте, версия видна', async ({ page }) => {
    const errors = await openWs(page);
    await expect(page).toHaveTitle(/Скорость печати/);
    for (const m of ['time', 'words', 'text', 'custom', 'zen']) await expect(page.locator(`[data-mode=${m}]`)).toBeVisible();
    await expect(page.locator('[data-mode=quote]')).toHaveCount(0);          // 1.1.0: цитаты влились в «текст»
    for (const f of ['punct', 'nums', 'caps', 'noBack', 'stop']) await expect(page.locator(`[data-flag=${f}]`)).toBeVisible();   // время + слова - видны все
    for (const t of ['15', '30', '60', '120']) await expect(page.locator(`[data-time="${t}"]`)).toBeVisible();
    const opts = await page.locator('#lang option').evaluateAll((o) => o.map((x) => x.value));
    expect(opts).toEqual(['ru', 'uk', 'en', 'de', 'fr', 'es', 'zh', 'js', 'py']);
    const version = await page.evaluate(() => __ws.version);
    await expect(page.locator('#foot')).toContainText(version);
    expect(await page.evaluate(() => document.activeElement.id)).toBe('input');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__fakeLock || 0)).toBe(0);
  });

  test('один файл: без внешних скриптов, стилей и адресов в сети', async () => {
    const html = fs.readFileSync(FILE, 'utf8');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href="(?!data:)/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  test('версия страницы совпадает с версией приложения Electron', async ({ page }) => {
    await openWs(page);
    const pkg = JSON.parse(fs.readFileSync(path.join(PAGE_DIR, 'electron', 'package.json'), 'utf8'));
    expect(await page.evaluate(() => __ws.version)).toBe(pkg.version);
  });

  test('влезает в телефон: нет прокрутки вбок, поле и клавиши видны', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openWs(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
    await expect(page.locator('#words-wrap')).toBeVisible();
    await custom(page, 'да нет');
    await typeTimed(page, 'да нет');
    await expect(page.locator('#result')).toBeVisible();
    const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over2).toBeLessThanOrEqual(0);
  });
});

test.describe('ws: подсчёт на поддельных часах', () => {
  test('без ошибок: WPM = (знаки + пробелы) / 5 / минуты, точность 100%, время от первой клавиши до последней', async ({ page }) => {
    await openWs(page);
    const text = 'один два три четыре пять';
    await custom(page, text);
    await typeTimed(page, text, 200);
    const r = await result(page);
    // 24 знака (20 букв и 4 пробела), 24 нажатия, 23 промежутка по 200 мс
    const min = 23 * 0.2 / 60;
    close(r.dur, 4.6);
    close(r.wpm, 24 / 5 / min);
    close(r.cpm, 24 / min);
    close(r.raw, 24 / 5 / min);
    close(r.acc, 100);
    expect([r.correct, r.incorrect, r.extra, r.missed]).toEqual([20, 0, 0, 0]);
    await expect(page.locator('#r-wpm')).toHaveText(String(Math.round(24 / 5 / min)));
    await expect(page.locator('#r-acc')).toHaveText('100%');
  });

  test('ошибка в слове: слово и пробел после него не идут в WPM, точность - доля верных нажатий', async ({ page }) => {
    await openWs(page);
    await custom(page, 'кот ест рыбу');
    await typeTimed(page, 'кот ёст рыбу', 100);
    const r = await result(page);
    const min = 11 * 0.1 / 60;
    close(r.wpm, (3 + 1 + 4) / 5 / min);        // «кот» + пробел + «рыбу»
    close(r.raw, 12 / 5 / min);
    close(r.acc, 11 / 12 * 100);
    expect([r.correct, r.incorrect]).toEqual([9, 1]);
    expect(r.errors).toEqual({ 'е': 1 });       // ошибка - на клавише, которую надо было нажать
  });

  test('исправленная ошибка: WPM полный, а точность и сырая скорость помнят лишнее нажатие', async ({ page }) => {
    await openWs(page);
    await custom(page, 'мир дом');
    await typeTimed(page, 'мип', 100);
    await page.keyboard.press('Backspace');
    await typeTimed(page, 'р дом', 100);
    const r = await result(page);
    // нажатия со знаком: м и п р пробел д о м = 8 (Backspace не считается), время 7 × 100 мс
    const min = 0.7 / 60;
    close(r.wpm, 7 / 5 / min);
    close(r.raw, 8 / 5 / min);
    close(r.acc, 7 / 8 * 100);
    expect(r.errors).toEqual({ 'р': 1 });
  });

  test('слово брошено пробелом раньше конца: пропуски считаются, нажатие пробела - ошибка', async ({ page }) => {
    await openWs(page);
    await custom(page, 'привет мир');
    await typeTimed(page, 'при мир', 100);
    const r = await result(page);
    expect(r.missed).toBe(3);
    close(r.acc, 6 / 7 * 100);
    expect(r.errors).toEqual({ 'в': 1 });
    close(r.wpm, 3 / 5 / (0.6 / 60));            // засчитан только «мир»
  });

  test('лишние буквы: ошибка на пробеле (надо было нажать его)', async ({ page }) => {
    await openWs(page);
    await custom(page, 'да нет');
    await typeTimed(page, 'даа нет', 100);
    const r = await result(page);
    expect(r.extra).toBe(1);
    expect(r.errors).toEqual({ space: 1 });
  });

  test('ровность: одинаковая скорость по секундам - 100%, рваная - меньше', async ({ page }) => {
    await openWs(page);
    const c = await page.evaluate(() => [__ws.core.consistency([60, 60, 60, 60]), __ws.core.consistency([20, 100, 20, 100]), __ws.core.consistency([50, 60, 55, 65]), __ws.core.consistency([60])]);
    close(c[0], 100);
    expect(c[1]).toBeLessThan(50);
    expect(c[2]).toBeGreaterThan(80);
    expect(c[3]).toBe(null);
    // v = σ/μ = 0,4 для [20,100,20,100]: 100 × (1 − tanh(0,4 + 0,4³/3 + 0,4⁵/5))
    const v = 40 / 60;
    close(c[1], 100 * (1 - Math.tanh(v + v ** 3 / 3 + v ** 5 / 5)), 1e-9);
  });

  test('график по секундам: ровный набор 5 знаков в секунду = 60 WPM каждую секунду', async ({ page }) => {
    await openWs(page);
    const text = 'абвгд '.repeat(6).trim();
    await custom(page, text);
    await typeTimed(page, text, 200);
    const r = await page.evaluate(() => __ws.result.series);
    expect(r.length).toBe(Math.ceil((text.length - 1) * 0.2));
    for (const p of r.slice(1, -1)) close(p.raw, 60, 1e-6);
  });
});

test.describe('ws: ошибки по клавишам', () => {
  test('каждая ошибка записана на свою клавишу, карта раскладки показывает число ошибок', async ({ page }) => {
    await openWs(page);
    await custom(page, 'вода река вода');
    await typeTimed(page, 'вола река ваиа ', 100);   // последнее слово с ошибкой кончается пробелом
    const r = await result(page);
    expect(r.errors).toEqual({ 'д': 2, 'о': 1 });
    expect(r.presses['д']).toBe(2);
    expect(r.presses['о']).toBe(2);
    const keyD = page.locator('#heatmap .key[data-key="д"]');
    await expect(keyD).toHaveAttribute('data-errors', '2');
    await expect(page.locator('#heatmap .key[data-key="о"]')).toHaveAttribute('data-errors', '1');
    await expect(page.locator('#heatmap .key[data-key="р"]')).toHaveAttribute('data-errors', '0');
    // клавиши не сжаты в полоски: на широком окне - почти квадратные (кадр README 1.0.0 нашёл их по 12 px)
    expect((await keyD.boundingBox()).width).toBeGreaterThanOrEqual(30);
    const heat = await keyD.evaluate((el) => getComputedStyle(el).getPropertyValue('--heat').trim());
    expect(heat).not.toBe('0%');
    await expect(page.locator('#weak')).toContainText('д');
  });

  test('раскладка карты - по языку теста: ЙЦУКЕН, украинская, QWERTY, QWERTZ, AZERTY, испанская', async ({ page }) => {
    await openWs(page);
    const names = {};
    for (const lang of ['ru', 'uk', 'en', 'de', 'fr', 'es']) {
      await page.evaluate((l) => { __ws.set('lang', l, false); __ws.set('textLen', 10, false); __ws.set('mode', 'text'); }, lang);
      const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
      await typeTimed(page, words.join(' '), 5);
      names[lang] = await page.locator('#heatmap .key.space').getAttribute('data-presses') !== null && await page.locator('#heatmap .key.space').textContent();
    }
    expect(names).toEqual({ ru: 'ЙЦУКЕН', uk: 'ЙЦУКЕН (укр.)', en: 'QWERTY', de: 'QWERTZ', fr: 'AZERTY', es: 'QWERTY (ES)' });
  });

  test('дзен и свой текст: раскладка карты - по набранным буквам', async ({ page }) => {
    await openWs(page);
    const got = {};
    for (const [word, want] of [['да', 'ЙЦУКЕН'], ['їжак', 'ЙЦУКЕН (укр.)'], ['grün', 'QWERTZ'], ['thé', 'AZERTY'], ['año', 'QWERTY (ES)'], ['yes', 'QWERTY']]) {
      await page.evaluate(() => __ws.set('mode', 'zen'));
      await typeTimed(page, word, 50);
      await page.keyboard.press('Shift+Enter');
      got[word] = [await page.locator('#heatmap .key.space').textContent(), want];
    }
    for (const [w, [have, want]] of Object.entries(got)) expect(have, w).toBe(want);
  });

  // 1.1.2 (независимая проверка): короткий русский текст в «своём тексте» и дзене давал карту QWERTY, а ошибку
  // по русской букве - строкой «Другие знаки». Имя клавиши «space» считалось пятью латинскими буквами:
  // у «да нет» пять разных русских клавиш против s, p, a, c, e.
  test('короткий русский текст с пробелом: карта ЙЦУКЕН, ошибка - на клавише, а не в «других знаках»', async ({ page }) => {
    await openWs(page);
    await custom(page, 'да нет');
    await typeTimed(page, 'дв нет', 100);
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#heatmap .key.space')).toHaveText('ЙЦУКЕН');
    await expect(page.locator('#heatmap .key[data-key="а"]')).toHaveAttribute('data-errors', '1');
    await expect(page.locator('#weak')).not.toContainText(/Другие знаки|Other characters/);
    await page.evaluate(() => __ws.set('mode', 'zen'));
    await typeTimed(page, 'да нет', 100);
    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('#heatmap .key.space')).toHaveText('ЙЦУКЕН');
    // и английский короткий текст по-прежнему QWERTY
    await page.evaluate(() => __ws.set('mode', 'zen'));
    await typeTimed(page, 'no yes', 100);
    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('#heatmap .key.space')).toHaveText('QWERTY');
  });
});

test.describe('ws: режимы', () => {
  test('время: тест кончается ровно на 15 с, после конца клавиши ничего не меняют', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=time]');
    await page.click('[data-time="15"]');
    const s = await state(page);
    await page.keyboard.type(s.words[0]);           // часы стоят: всё напечатано в первый миг
    await page.keyboard.type(' ');
    await page.keyboard.type(s.words[1].slice(0, 2));
    await page.clock.runFor(14_900);
    expect((await state(page)).phase).toBe('run');
    await expect(page.locator('#live-main')).toHaveText('1');
    await page.clock.runFor(200);
    expect((await state(page)).phase).toBe('done');
    const r = await result(page);
    close(r.dur, 15);
    // засчитано первое слово с пробелом и верное начало второго (обрыв посреди слова)
    close(r.wpm, (s.words[0].length + 1 + 2) / 5 / 0.25);
    const keys = r.keys;
    await page.keyboard.type('abc');
    expect((await result(page)).keys).toBe(keys);
    await expect(page.locator('#result')).toBeVisible();
  });

  test('время: слова подкладываются, пока печатаешь', async ({ page }) => {
    await openWs(page);
    await page.click('[data-time="60"]');
    const n0 = await page.evaluate(() => __ws.state.words.length);
    for (let i = 0; i < 30; i++) {
      const w = await page.evaluate(() => __ws.state.words[__ws.state.wi].text);
      await typeTimed(page, w + ' ', 20);
    }
    const n1 = await page.evaluate(() => __ws.state.words.length);
    expect(n1).toBeGreaterThan(n0);
    expect((await state(page)).phase).toBe('run');
  });

  for (const n of [10, 25]) {
    test(`слова: ${n} слов, тест кончается на последнем верном слове`, async ({ page }) => {
      await openWs(page);
      await page.click('[data-mode=words]');
      await page.click(`[data-count="${n}"]`);
      const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
      expect(words.length).toBe(n);
      await expect(page.locator('#live-main')).toHaveText(`0/${n}`);
      await typeTimed(page, words.join(' '), 30);
      expect((await state(page)).phase).toBe('done');
      close((await result(page)).acc, 100);
    });
  }

  test('текст: длина ~10/~20/~50/~100/~200/~300 - текст из набора этой длины, автор подписан', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=text]');
    for (const len of [10, 20, 50, 100, 200, 300]) {
      await page.click(`[data-len="${len}"]`);
      await expect(page.locator(`[data-len="${len}"]`)).toHaveClass(/on/);
      const info = await page.evaluate((l) => {
        const text = __ws.state.words.map((w) => w.text).join(' ');
        const e = __ws.texts.ru.find((x) => x.t.replace(/\s+/g, ' ') === text);
        return { found: !!e, len: e && e.len, src: e && e.src, shown: document.querySelector('#source').textContent };
      }, len);
      expect(info.found, `~${len}`).toBe(true);
      expect(info.len).toBe(len);
      expect(info.shown).toBe(info.src ? '- ' + info.src : '');
    }
  });

  test('текст: за 30 пробных выборов попадаются и тексты с автором, и свои', async ({ page }) => {
    await openWs(page);
    await page.evaluate(() => { __ws.set('textLen', 10, false); __ws.set('mode', 'text'); });
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.locator('#source').textContent() ? 'src' : 'own');
    }
    expect([...seen].sort()).toEqual(['own', 'src']);
  });

  test('время + текст: связный текст, кончился текст - сразу идёт следующий, время идёт дальше', async ({ page }) => {
    await openWs(page);
    await page.evaluate(() => { __ws.set('time', 120, false); __ws.set('timeSrc', 'text', false); __ws.set('mode', 'time'); });
    await expect(page.locator('[data-src=text]')).toHaveClass(/on/);
    await expect(page.locator('[data-ctl=size]')).toBeHidden();
    const first = await page.evaluate(() => {
      const w = __ws.state.words;
      const all = __ws.texts.ru;
      // где кончается первый текст: длина того текста из набора, с которого начинается тест
      const start = w.slice(0, 6).map((x) => x.text).join(' ');
      const e = all.find((x) => x.t.replace(/\s+/g, ' ').startsWith(start));
      return { n: e.t.split(/\s+/).length, len: e.len, total: w.length };
    });
    expect(first.len).toBeGreaterThanOrEqual(50);
    const words = await page.evaluate((n) => __ws.state.words.slice(0, n + 3).map((w) => w.text), first.n);
    await page.keyboard.insertText(words.join(' ') + ' ');              // весь первый текст и три слова следующего - одним вводом
    const st = await page.evaluate(() => ({ phase: __ws.state.phase, wi: __ws.state.wi }));
    expect(st.phase).toBe('run');
    expect(st.wi).toBe(first.n + 3);
    // слова после первого текста - начало другого текста из набора
    const next = words.slice(first.n).join(' ');
    const ok = await page.evaluate((nx) => __ws.texts.ru.some((x) => x.t.replace(/\s+/g, ' ').startsWith(nx)), next);
    expect(ok).toBe(true);
    await page.clock.runFor(121_000);
    const r = await result(page);
    close(r.dur, 120);
    expect(r.key).toBe('time|120|ru|text|-');
  });

  test('рекорды раздельны по режиму и длине текста; время со словами и с текстом - разные рекорды', async ({ page }) => {
    await openWs(page);
    for (const len of [10, 20]) {
      await page.evaluate((l) => { __ws.set('textLen', l, false); __ws.set('mode', 'text'); }, len);
      const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
      await typeTimed(page, words.join(' '), 20);
    }
    for (const src of ['words', 'text']) {
      await page.evaluate((x) => { __ws.set('time', 15, false); __ws.set('timeSrc', x, false); __ws.set('mode', 'time'); }, src);
      const w = await page.evaluate(() => __ws.state.words[0].text);
      await typeTimed(page, w + ' ', 20);
      await page.clock.runFor(16_000);
    }
    const keys = Object.keys(await page.evaluate(() => __ws.records())).sort();
    expect(keys).toEqual(['text|10|ru|-|-', 'text|20|ru|-|-', 'time|15|ru|1000|-', 'time|15|ru|text|-']);
  });

  test('свой текст: окно ввода, текст сохраняется, тест идёт по нему', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=custom]');
    await expect(page.locator('#custom-sheet')).toBeVisible();   // своего текста ещё нет - окно открылось само
    await page.fill('#custom-text', 'мой  собственный\nтекст');
    await page.click('#custom-go');
    expect((await state(page)).words).toEqual(['мой', 'собственный', 'текст']);
    await typeTimed(page, 'мой собственный текст', 50);
    expect((await state(page)).phase).toBe('done');
    await page.reload();
    await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
    expect((await state(page)).words).toEqual(['мой', 'собственный', 'текст']);
    await page.click('#edit-custom');
    await expect(page.locator('#custom-text')).toHaveValue('мой  собственный\nтекст');
  });

  test('дзен: печатаешь что угодно, Shift+Enter заканчивает, скорость по знакам', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=zen]');
    await typeTimed(page, 'свободный текст', 250);
    await page.keyboard.press('Shift+Enter');
    const r = await result(page);
    close(r.dur, 14 * 0.25);
    close(r.wpm, 15 / 5 / (3.5 / 60));
    close(r.acc, 100);
  });

  test('код: перевод строки - Enter, отступ печатать не надо', async ({ page }) => {
    await openWs(page);
    await custom(page, 'if x:\n    y = 1');
    expect(await page.evaluate(() => __ws.state.words.map((w) => [w.text, w.sep, w.indent]))).toEqual([['if', ' ', 0], ['x:', '\n', 0], ['y', ' ', 4], ['=', ' ', 0], ['1', '', 0]]);
    await typeTimed(page, 'if x:\ny = 1', 100);
    const r = await result(page);
    close(r.acc, 100);
  });

  test('Tab - новый текст, Esc - тот же текст заново', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=words]');
    const a = (await state(page)).words;
    await page.keyboard.type(a[0].slice(0, 2));
    await page.keyboard.press('Escape');
    const b = await state(page);
    expect(b.words).toEqual(a);
    expect(b.phase).toBe('idle');
    expect(b.typed[0]).toBe('');
    await page.keyboard.press('Tab');
    expect((await state(page)).words).not.toEqual(a);
  });

  // Подписи кнопки и подсказок клавиш внизу = то, что Tab и Esc делают в этом режиме
  const LABELS = {
    time: ['Новый текст', 'новый текст', 'этот же текст заново'],
    words: ['Новый текст', 'новый текст', 'этот же текст заново'],
    text: ['Новый текст', 'новый текст', 'этот же текст заново'],
    custom: ['Новый свой текст', 'ввести новый свой текст', 'этот же текст заново'],
    zen: ['Стереть', 'стереть набранное', 'начать заново'],
  };
  for (const [mode, [btn, tab, escL]] of Object.entries(LABELS)) {
    test(`${mode}: подпись кнопки и клавиш = действие Tab и Esc`, async ({ page }) => {
      await openWs(page);
      if (mode === 'custom') await custom(page, 'один два три');
      else await page.evaluate((m) => __ws.set('mode', m), mode);
      await expect(page.locator('#restart')).toHaveText(btn);
      await expect(page.locator('#tab-label')).toHaveText(tab);
      await expect(page.locator('#esc-label')).toHaveText(escL);
      // Esc: то же самое заново, набранное стёрто
      const before = await page.evaluate(() => __ws.state.words.map((w) => w.text).join(' '));
      await page.keyboard.type(mode === 'zen' ? 'проба' : (await page.evaluate(() => __ws.state.words[0].text)).slice(0, 1));
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => ({ p: __ws.state.phase, z: __ws.state.zenText, t: __ws.state.typed[0] || '' }))).toEqual({ p: 'idle', z: '', t: '' });
      expect(await page.evaluate(() => __ws.state.words.map((w) => w.text).join(' '))).toBe(before);
      // Tab: своё действие режима
      await page.keyboard.type(mode === 'zen' ? 'проба' : (await page.evaluate(() => __ws.state.words[0].text)).slice(0, 1));
      await page.keyboard.press('Tab');
      if (mode === 'custom') {
        await expect(page.locator('#custom-sheet')).toBeVisible();
        await expect(page.locator('#custom-text')).toHaveValue('один два три');
      } else if (mode === 'zen') {
        expect(await page.evaluate(() => [__ws.state.phase, __ws.state.zenText])).toEqual(['idle', '']);
      } else {
        expect(await page.evaluate(() => __ws.state.phase)).toBe('idle');
        expect(await page.evaluate(() => __ws.state.words.map((w) => w.text).join(' '))).not.toBe(before);
      }
    });
  }

  test('Tab в окне своего текста ходит только по его полю и кнопкам', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=custom]');
    await expect(page.locator('#custom-sheet')).toBeVisible();
    const seen = new Set();
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      const where = await page.evaluate(() => ({ inSheet: !!document.activeElement.closest('#custom-sheet'), id: document.activeElement.id || document.activeElement.textContent.trim() }));
      expect(where.inSheet, where.id).toBe(true);
      seen.add(where.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);              // поле, «Печатать», «Отмена»
    await expect(page.locator('#custom-sheet')).toBeVisible();
  });
});

test.describe('ws: сложность', () => {
  test('без Backspace: стереть нельзя', async ({ page }) => {
    await openWs(page);
    await page.click('[data-flag=noBack]');
    await custom(page, 'тест слово');
    await typeTimed(page, 'тэ', 50);
    await page.keyboard.press('Backspace');
    expect((await state(page)).typed[0]).toBe('тэ');
    await expect(page.locator('[data-flag=noBack]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('стоп на ошибке: неверная буква не печатается, но считается ошибкой', async ({ page }) => {
    await openWs(page);
    await page.click('[data-flag=stop]');
    await custom(page, 'кот');
    await typeTimed(page, 'кх', 50);
    expect((await state(page)).typed[0]).toBe('к');
    await page.keyboard.press('Space');
    expect((await state(page)).wi).toBe(0);
    await typeTimed(page, 'от', 50);
    const r = await result(page);
    expect(r.errors).toEqual({ 'о': 2 });          // и буква, и пробел - на месте «о»
    close(r.acc, 3 / 5 * 100);
  });

  test('назад в прошлое слово - только если в нём ошибка', async ({ page }) => {
    await openWs(page);
    await custom(page, 'раз два три');
    await typeTimed(page, 'раз ', 50);
    await page.keyboard.press('Backspace');
    expect((await state(page)).wi).toBe(1);
    await typeTimed(page, 'дво ', 50);
    await page.keyboard.press('Backspace');
    const s = await state(page);
    expect(s.wi).toBe(1);
    expect(s.typed[1]).toBe('дво');
    await page.keyboard.press('Control+Backspace');
    expect((await state(page)).typed[1]).toBe('');
  });

  test('знаки, цифры и заглавные меняют слова (с тем же seed)', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=words]');
    await page.click('[data-count="100"]');
    const plain = (await state(page)).words.join(' ');
    expect(plain).toMatch(/^[а-яё ]+$/);
    await page.click('[data-flag=punct]');
    expect((await state(page)).words.join(' ')).toMatch(/[.,?!]/);
    await page.click('[data-flag=punct]');
    await page.click('[data-flag=nums]');
    expect((await state(page)).words.join(' ')).toMatch(/\d/);
    await page.click('[data-flag=nums]');
    await page.click('[data-flag=caps]');
    expect((await state(page)).words.join(' ')).toMatch(/[А-ЯЁ]/);
  });

  test('размер списка: 200 - только 200 самых частых слов', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=words]');
    await page.click('[data-count="100"]');
    await page.selectOption('#size', '200');
    const ok = await page.evaluate(() => {
      const top = new Set(__ws.words('ru').split(' ').slice(0, 200));
      return __ws.state.words.every((w) => top.has(w.text));
    });
    expect(ok).toBe(true);
  });
});

test.describe('ws: языки', () => {
  const ALPHA = {
    ru: /^[а-яё]+$/, uk: /^[а-щьюяєіїґ']+$/, en: /^[a-z]+$/, de: /^[a-zäöüßA-ZÄÖÜ]+$/, fr: /^[a-zàâæçéèêëîïôœùûüÿ]+$/, es: /^[a-záéíóúüñ]+$/,
  };

  test('списки слов: по 5000 разных слов каждого языка, только буквы своего алфавита', async ({ page }) => {
    await openWs(page);
    for (const lang of Object.keys(ALPHA)) {
      const words = await page.evaluate((l) => __ws.words(l).split(' '), lang);
      expect(words.length, lang).toBe(5000);
      expect(new Set(words).size, lang).toBe(5000);
      const bad = words.filter((w) => !ALPHA[lang].test(w));
      expect(bad, lang).toEqual([]);
    }
  });

  test('в списках нет грубых слов (те же выражения, что у tools/make-words.py)', async ({ page }) => {
    await openWs(page);
    const rules = {};
    for (const line of fs.readFileSync(path.join(PAGE_DIR, 'tools', 'blocklist.b64.txt'), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [lang, b64] = line.split(' ');
      rules[lang] = Buffer.from(b64, 'base64').toString('utf8');
    }
    for (const lang of Object.keys(ALPHA)) {
      const words = await page.evaluate((l) => __ws.words(l).split(' '), lang);
      const res = [new RegExp(rules['*']), new RegExp(rules[lang === 'uk' ? 'ru' : lang])];
      const bad = words.filter((w) => res.some((r) => r.test(w.toLowerCase())));
      expect(bad.length, lang).toBe(0);
    }
  });

  test('язык теста: слова берутся из своего списка, выбор запоминается', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=words]');
    for (const lang of ['en', 'de', 'uk', 'js', 'py']) {
      await page.selectOption('#lang', lang);
      const ok = await page.evaluate((l) => {
        const list = new Set(l === 'js' || l === 'py' ? __ws.core.pool(l, 0) : __ws.words(l).split(' ').slice(0, __ws.settings.size));
        return __ws.state.words.every((w) => list.has(w.text));
      }, lang);
      expect(ok, lang).toBe(true);
    }
    await page.reload();
    await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
    expect(await page.evaluate(() => __ws.settings.lang)).toBe('py');
  });

  test('подсказка про раскладку: латиница в русском тесте - показать, кириллица - убрать', async ({ page }) => {
    await openWs(page);
    await custom(page, 'привет мир');
    await page.evaluate(() => { __ws.state.cfg.lang = 'ru'; });
    await typeTimed(page, 'g', 50);
    await expect(page.locator('#layout-hint')).toBeHidden();
    await typeTimed(page, 'h', 50);
    await expect(page.locator('#layout-hint')).toBeVisible();
    await expect(page.locator('#layout-hint')).toContainText('русскую');
    await page.keyboard.press('Control+Backspace');
    await typeTimed(page, 'п', 50);
    await expect(page.locator('#layout-hint')).toBeHidden();
  });

  test('и наоборот: кириллица в английском тесте', async ({ page }) => {
    await openWs(page);
    await page.selectOption('#lang', 'en');
    await page.click('[data-mode=words]');
    await typeTimed(page, 'йц', 50);
    await expect(page.locator('#layout-hint')).toBeVisible();
    await expect(page.locator('#layout-hint')).toContainText('латиниц');
  });
});

test.describe('ws: рекорды, история, хранилище', () => {
  test('рекорд режима и история переживают перезагрузку; второй медленный тест рекорд не бьёт', async ({ page }) => {
    await openWs(page);
    await custom(page, 'море лес');
    await typeTimed(page, 'море лес', 100);
    let r = await result(page);
    expect(r.isRecord).toBe(true);
    await expect(page.locator('#r-record')).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
    const saved = await page.evaluate(() => ({ rec: __ws.records(), hist: __ws.history() }));
    expect(Object.keys(saved.rec)).toEqual([r.key]);
    expect(saved.hist.length).toBe(1);
    await typeTimed(page, 'море лес', 300);
    r = await result(page);
    expect(r.isRecord).toBe(false);
    await expect(page.locator('#r-record')).toBeHidden();
    const after = await page.evaluate(() => ({ rec: __ws.records(), hist: __ws.history() }));
    expect(after.hist.length).toBe(2);
    expect(after.rec[r.key].wpm).toBe(saved.rec[r.key].wpm);
    await page.click('[data-view=history]');
    await expect(page.locator('#records tr')).toHaveCount(2);
    await expect(page.locator('#history tr')).toHaveCount(3);
    await page.click('#clear-history');
    await page.click('#clear-history');
    expect(await page.evaluate(() => __ws.history().length)).toBe(0);
  });

  // 1.1.2 (независимая проверка): после первого теста график «Истории» был пустым - одна точка рисовалась
  // одним moveTo без линии. То же у итога теста короче секунды.
  test('график с одной точкой: точка видна в истории и в итоге короткого теста', async ({ page }) => {
    await openWs(page);
    await custom(page, 'да');
    await typeTimed(page, 'да', 100);
    await expect(page.locator('#result')).toBeVisible();
    // пиксели цвета акцента (линия WPM) на холсте
    const accentPixels = (sel) => page.evaluate((sel) => {
      const c = document.querySelector(sel), g = c.getContext('2d');
      const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(a);
      const [R, G, B] = [1, 2, 3].map((i) => parseInt(m[i], 16));
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B) < 40) n++;
      return n;
    }, sel);
    expect(await page.evaluate(() => __ws.result.series.length)).toBe(1);
    expect(await accentPixels('#graph'), 'итог теста короче секунды').toBeGreaterThan(20);
    await page.click('[data-view=history]');
    expect(await page.evaluate(() => __ws.history().length)).toBe(1);
    expect(await accentPixels('#hist-graph'), 'история с одним тестом').toBeGreaterThan(20);
  });

  test('сломанное хранилище (бросает) - страница работает, тест проходит, есть предупреждение', async ({ page }) => {
    const errors = await openWs(page, {
      init: () => {
        const boom = () => { throw new Error('storage blocked'); };
        Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom;
      },
    });
    await custom(page, 'тест');
    await typeTimed(page, 'тест', 100);
    expect((await state(page)).phase).toBe('done');
    await expect(page.locator('#foot')).toContainText('Хранилище браузера недоступно');
    await page.click('[data-view=history]');
    await expect(page.locator('#records .empty')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('мусор в хранилище - настройки по умолчанию, без ошибок', async ({ page }) => {
    const errors = await openWs(page, { storage: { 'typing:settings': '{не json', 'typing:records': '[1,2]', 'typing:history': '"x"' } });
    expect(await page.evaluate(() => __ws.settings.mode)).toBe('time');
    await page.click('[data-view=history]');
    await expect(page.locator('#history .empty')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('страница пишет только под приставкой typing: (таблица Игротеки)', async ({ page }) => {
    await openWs(page);
    await custom(page, 'да');
    await typeTimed(page, 'да', 100);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith('typing:'), k).toBe(true);
  });
});

test.describe('ws: вид', () => {
  test('пять тем Paint: атрибут на <html>, разные цвета, выбор запоминается', async ({ page }) => {
    await openWs(page);
    await page.click('#open-settings');
    await expect(page.locator('#themes .swatch')).toHaveCount(5);
    const seen = new Set();
    for (const t of ['glass', 'formal', 'light', 'night', 'warm']) {
      await page.click(`[data-theme-id=${t}]`);
      const info = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }));
      expect(info.attr).toBe(t === 'glass' ? null : t);
      seen.add(info.accent);
    }
    expect(seen.size).toBe(5);
    await page.click('[data-theme-id=light]');
    await page.reload();
    await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  });

  test('язык интерфейса RU/EN: подписи меняются и запоминаются', async ({ page }) => {
    await openWs(page);
    await expect(page.locator('[data-mode=time]')).toHaveText('время');
    await page.click('#ui-lang');
    await expect(page.locator('[data-mode=time]')).toHaveText('time');
    await expect(page.locator('h1')).toHaveText('WritingSpeed');
    await expect(page).toHaveTitle(/WritingSpeed/);
    await page.reload();
    await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
    await expect(page.locator('[data-mode=time]')).toHaveText('time');
    await page.click('#ui-lang');
    await expect(page.locator('[data-mode=words]')).toHaveText('слова');
  });

  test('размер шрифта: A+ и A− меняют поле, предел 75-200%', async ({ page }) => {
    await openWs(page);
    const size = () => page.locator('#words-wrap').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const s0 = await size();
    await page.click('#open-settings');
    await page.click('#font-up');
    await page.click('#font-up');
    expect(await size()).toBeGreaterThan(s0);
    await expect(page.locator('#font-val')).toHaveText('125%');
    for (let i = 0; i < 20; i++) await page.click('#font-down');
    await expect(page.locator('#font-val')).toHaveText('75%');
  });

  test('каретка стоит перед следующей буквой и едет вправо при наборе', async ({ page }) => {
    await openWs(page);
    await page.click('#open-settings');
    await page.click('#set-smooth');               // без анимации - сразу на месте
    await page.keyboard.press('Escape');
    await custom(page, 'каретка едет');
    const x = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#caret')).transform).m41);
    const x0 = await x();
    await typeTimed(page, 'кар', 50);
    const x1 = await x();
    const letter = await page.evaluate(() => document.querySelectorAll('.word')[0].querySelectorAll('.l')[3].offsetLeft);
    expect(x1).toBeGreaterThan(x0);
    close(x1, letter, 0.5);
  });
});

// ----------------------------------------------------------------------------------------
// 1.1.0: набор текстов, видимость настроек, перенос длинных слов, нажатие в меню, китайский

test.describe('ws: набор текстов', () => {
  const LENS = [10, 20, 50, 100, 200, 300];
  const LANGS = ['ru', 'uk', 'en', 'de', 'fr', 'es', 'zh'];
  // Длина считается здесь заново, без функций страницы: слова с буквой или цифрой; у китайского - иероглифы
  const lengthOf = (lang, t) => (lang === 'zh' ? [...t].filter((ch) => /[㐀-䶿一-鿿]/.test(ch)).length : t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length);

  test('каждый язык: ровно по 10 текстов на длину ~10/~20/~50/~100/~200/~300, допуск ±20 %, без повторов', async ({ page }) => {
    await openWs(page);
    const texts = await page.evaluate(() => __ws.texts);
    expect(Object.keys(texts).sort()).toEqual([...LANGS].sort());
    for (const lang of LANGS) {
      const k = lang === 'zh' ? 2 : 1;
      const seen = new Set();
      for (const len of LENS) {
        const list = texts[lang].filter((e) => e.len === len);
        expect(list.length, `${lang} ~${len}`).toBe(10);
        for (const e of list) {
          const n = lengthOf(lang, e.t);
          expect(n >= len * k * 0.8 && n <= len * k * 1.2, `${lang} ~${len}: ${n} - ${e.t.slice(0, 40)}`).toBe(true);
          const key = e.t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
          expect(seen.has(key), `${lang}: повтор ${e.t.slice(0, 40)}`).toBe(false);
          seen.add(key);
          if (e.src !== null) expect(typeof e.src === 'string' && e.src.length > 1).toBe(true);
        }
      }
      expect(texts[lang].length).toBe(60);
    }
  });

  test('длина текста: границы ±20 % ровно (у китайского вдвое), длина каждого текста по счёту страницы = его ~длина', async ({ page }) => {
    await openWs(page);
    const r = await page.evaluate(() => {
      const c = __ws.core;
      const b = (lang, n) => c.lengthBucket(lang, n);
      const mism = [];
      for (const [lang, list] of Object.entries(__ws.texts)) {
        for (const e of list) { const got = b(lang, c.textLength(lang, e.t)); if (got !== e.len) mism.push(lang + ' ~' + e.len + ' -> ' + got); }
      }
      return {
        en: [7, 8, 12, 13, 15, 16, 24, 25, 39, 40, 60, 61, 79, 80, 120, 121, 240, 241, 360, 361].map((n) => b('en', n)),
        zh: [15, 16, 24, 25, 79, 80, 120, 121, 719, 720, 721].map((n) => b('zh', n)),
        mism,
      };
    });
    expect(r.en).toEqual([null, 10, 10, null, null, 20, 20, null, null, 50, 50, null, null, 100, 100, null, 200, 300, 300, null]);
    expect(r.zh).toEqual([null, 10, 10, null, null, 50, 50, null, 300, 300, null]);
    expect(r.mism).toEqual([]);
  });

  test('тексты печатаются с обычной клавиатуры: без «ёлочек», длинного тире, многоточия и неразрывных пробелов', async ({ page }) => {
    await openWs(page);
    const texts = await page.evaluate(() => __ws.texts);
    for (const lang of LANGS.filter((l) => l !== 'zh')) {
      const bad = texts[lang].filter((e) => /[«»„“”’—–… ]/.test(e.t)).map((e) => e.t.slice(0, 40));
      expect(bad, lang).toEqual([]);
    }
    const zhBad = texts.zh.filter((e) => /\s/.test(e.t));
    expect(zhBad).toEqual([]);
  });
});

test.describe('ws: видимость настроек по режимам', () => {
  // Таблица «режим -> видимые настройки» (она же в README). Записана здесь заново, а не
  // взята из страницы, чтобы закон ловил расхождение.
  const ALL = ['times', 'src', 'counts', 'lens', 'edit', 'lang', 'size', 'zhInput', 'pyHint', 'punct', 'nums', 'caps', 'noBack', 'stop'];
  const TABLE = [
    ['ru', 'time', 'words', 'times src lang size punct nums caps noBack stop'],
    ['ru', 'time', 'text', 'times src lang noBack stop'],
    ['ru', 'words', 'words', 'counts lang size punct nums caps noBack stop'],
    ['ru', 'text', 'words', 'lens lang noBack stop'],
    ['ru', 'custom', 'words', 'edit noBack stop'],
    ['ru', 'zen', 'words', 'noBack'],
    ['zh', 'time', 'words', 'times src lang size zhInput pyHint noBack stop'],
    ['zh', 'text', 'words', 'lens lang zhInput pyHint noBack stop'],
    ['zh', 'text', 'words', 'lens lang zhInput noBack stop', 'pinyin'],
    ['zh', 'time', 'words', 'times src lang size zhInput noBack stop', 'pinyin'],
    ['js', 'time', 'text', 'times lang nums noBack stop'],
    ['js', 'words', 'words', 'counts lang nums noBack stop'],
    ['js', 'text', 'words', 'lang noBack stop'],
  ];
  for (const [lang, mode, src, want, zhInput = 'hanzi'] of TABLE) {
    test(`${lang} ${mode}${mode === 'time' ? ' + ' + src : ''}${zhInput !== 'hanzi' ? ', ввод ' + zhInput : ''}: видно только «${want}»`, async ({ page }) => {
      await openWs(page);
      await page.evaluate(([l, m, s, z]) => { __ws.set('lang', l, false); __ws.set('timeSrc', s, false); __ws.set('zhInput', z, false); __ws.set('mode', m); }, [lang, mode, src, zhInput]);
      if (mode === 'custom') await page.keyboard.press('Escape');
      const shown = await page.evaluate((all) => all.filter((c) => { const el = document.querySelector(`[data-ctl="${c}"]`); return el && !el.hidden && el.offsetParent !== null; }), ALL);
      expect(shown.sort()).toEqual(want.split(' ').sort());
    });
  }

  test('спрятанная настройка не сбрасывается: знаки включены в «словах», в дзене их не видно, вернулись - включены', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=words]');
    await page.click('[data-flag=punct]');
    await page.click('[data-mode=zen]');
    await expect(page.locator('[data-flag=punct]')).toBeHidden();
    await page.click('[data-mode=words]');
    await expect(page.locator('[data-flag=punct]')).toHaveAttribute('aria-pressed', 'true');
    await page.selectOption('#size', '200');
    await page.click('[data-mode=text]');
    await page.click('[data-mode=words]');
    await expect(page.locator('#size')).toHaveValue('200');
  });

  test('словарь: понятная подпись и подсказка, на двух языках интерфейса', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=words]');
    await expect(page.locator('[data-ctl=size]')).toContainText('словарь');
    expect(await page.locator('#size option').allTextContents()).toEqual(['200 частых слов', '1000 частых слов', '5000 частых слов']);
    await expect(page.locator('[data-ctl=size]')).toHaveAttribute('title', /самых частых слов языка.*меньше - проще/);
    await page.click('#ui-lang');
    await expect(page.locator('[data-ctl=size]')).toContainText('vocabulary');
    expect(await page.locator('#size option').allTextContents()).toEqual(['200 most common words', '1000 most common words', '5000 most common words']);
    await expect(page.locator('[data-ctl=size]')).toHaveAttribute('title', /most common words.*fewer is easier/);
  });
});

test.describe('ws: 1.0.0 -> 1.1.0, перенос рекордов «цитат»', () => {
  test('рекорды и история «цитат» переезжают в «текст» нужной длины, лучший рекорд остаётся, режим «цитата» -> «текст»', async ({ page }) => {
    const rec = {
      'quote|short|ru|-|p': { wpm: 61, raw: 70, acc: 97, when: 1 },
      'quote|medium|ru|-|-': { wpm: 55, raw: 60, acc: 95, when: 2 },
      'quote|any|ru|-|-': { wpm: 58, raw: 62, acc: 96, when: 3 },
      'quote|long|en|-|sb': { wpm: 70, raw: 75, acc: 99, when: 4 },
      'time|30|ru|1000|-': { wpm: 80, raw: 85, acc: 98, when: 5 },
    };
    const hist = [{ when: 1, key: 'quote|short|ru|-|p', wpm: 61, raw: 70, acc: 97, cons: 80, dur: 10 }, { when: 5, key: 'time|30|ru|1000|-', wpm: 80, raw: 85, acc: 98, cons: 90, dur: 30 }];
    const errors = await openWs(page, { storage: {
      'typing:records': JSON.stringify(rec), 'typing:history': JSON.stringify(hist),
      'typing:settings': JSON.stringify({ mode: 'quote', quote: 'long', lang: 'ru' }),
    } });
    const out = await page.evaluate(() => ({ rec: __ws.records(), hist: __ws.history().map((x) => x.key), s: [__ws.settings.mode, __ws.settings.textLen] }));
    expect(out.rec).toEqual({
      'text|10|ru|-|-': rec['quote|short|ru|-|p'],
      'text|20|ru|-|-': rec['quote|any|ru|-|-'],                // из «средней» (55) и «любой» (58) - лучший
      'text|50|en|-|sb': rec['quote|long|en|-|sb'],
      'time|30|ru|1000|-': rec['time|30|ru|1000|-'],
    });
    expect(out.hist).toEqual(['text|10|ru|-|-', 'time|30|ru|1000|-']);
    expect(out.s).toEqual(['text', 50]);
    expect(errors).toEqual([]);
    // повторный запуск ничего не меняет
    await page.reload();
    await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
    expect(await page.evaluate(() => __ws.records())).toEqual(out.rec);
    await page.click('[data-view=history]');
    await expect(page.locator('#records tr[data-key="text|10|ru|-|-"]')).toContainText('текст ~10 слов');
  });
});

test.describe('ws: перенос длинных слов', () => {
  async function checkWrap(page) {
    // Строки едут вверх плавно (transition .14s), а мерить надо уже приехавшие: без анимаций
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('#words-wrap').getBoundingClientRect();
      const ls = [...document.querySelectorAll('#words .l')].filter((l) => l.textContent.trim() && !l.classList.contains('zen-end'));
      const last = ls[ls.length - 1].getBoundingClientRect();
      const first = ls[0].getBoundingClientRect();
      const caret = document.querySelector('#caret').getBoundingClientRect();
      return { wrapRight: wrap.right, wrapTop: wrap.top, wrapBottom: wrap.bottom, lastRight: last.right, firstTop: first.top, lastTop: last.top, caretTop: caret.top, caretBottom: caret.bottom, scroll: document.documentElement.scrollWidth - innerWidth };
    });
    expect(m.lastRight).toBeLessThanOrEqual(m.wrapRight + 0.5);
    expect(m.scroll).toBeLessThanOrEqual(0);
    expect(m.lastTop).toBeGreaterThan(m.firstTop);                        // слово ушло на следующие строки
    expect(m.caretTop).toBeGreaterThanOrEqual(m.wrapTop - 1);             // каретка видна в поле
    expect(m.caretBottom).toBeLessThanOrEqual(m.wrapBottom + 1);
    return m;
  }

  test('дзен: слово из 300 букв переносится, каретка на новой строке и видна', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=zen]');
    await page.keyboard.type('ж'.repeat(300));
    const m = await checkWrap(page);
    expect(Math.abs(m.caretTop - m.lastTop)).toBeLessThan(20);           // каретка там же, где последняя буква
  });

  test('свой текст: слово из 300 букв переносится, каретка идёт за ним', async ({ page }) => {
    await openWs(page);
    await custom(page, 'q'.repeat(300) + ' конец');
    await page.keyboard.type('q'.repeat(250));
    await checkWrap(page);
  });

  test('китайский текст без пробелов переносится по строкам', async ({ page }) => {
    await openWs(page);
    await page.evaluate(() => { __ws.set('lang', 'zh', false); __ws.set('textLen', 300, false); __ws.set('mode', 'text'); });
    await checkWrap(page);
  });
});

test.describe('ws: нажатие в меню', () => {
  // Жалоба 1.0.0: зажатая на кнопке меню мышь подсвечивала фоном весь ряд. Причина - выделение
  // текста ряда, когда мышь при нажатии чуть сдвигается (браузер красит выделение фоном).
  for (const [row, btn] of [['#modes', '[data-mode=words]'], ['#flags', '[data-flag=caps]'], ['[data-ctl=times]', '[data-time="60"]']]) {
    test(`${row}: при нажатии меняется только кнопка, ряд не подсвечивается и не выделяется`, async ({ page }) => {
      await openWs(page);
      // нажатие на кнопке и в зазоре рядом, мышь зажата и сдвигается на 40 px. Кнопки ряда закрыты
      // маской: мышь доезжает до соседней кнопки, и та честно светится наведением - это не ряд.
      // Снимок «до» - перед каждым нажатием: первое нажатие на #modes меняет режим, и в меню
      // появляются выпадающие списки. На linux они на 2 px выше кнопок, и ряд съезжает на 1 px -
      // сравнение с кадром до первого нажатия давало 210 уровней без всякой подсветки.
      for (const shift of [6, -2]) {
        const rowBox = await page.locator(row).boundingBox();
        const b = await page.locator(btn).boundingBox();
        const startX = b.x + shift;
        const clip = { x: rowBox.x - 2, y: rowBox.y - 2, width: rowBox.width + 4, height: rowBox.height + 4 };
        await page.mouse.move(startX, b.y + b.height / 2);
        await page.waitForTimeout(300);                                   // наведение - без перехода цвета
        const before = await page.screenshot({ clip, mask: [page.locator(row + ' button')] });
        await page.mouse.down();
        await page.mouse.move(startX + 40, b.y + b.height / 2 + 2, { steps: 4 });
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => getSelection().toString()), 'выделение').toBe('');
        const during = await page.screenshot({ clip, mask: [page.locator(row + ' button')] });
        // до 4 уровней - сглаженный край маски у нажатой кнопки (она темнеет), выделение ряда - десятки
        expect(await maxDiff(page, before, during), 'ряд вокруг кнопки не изменился').toBeLessThanOrEqual(4);
        await page.mouse.up();
        await page.evaluate(() => getSelection().removeAllRanges());
      }
      const css = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).userSelect, row);
      expect(css).toBe('none');
    });
  }
});

test.describe('ws: наведение на меню', () => {
  // Жалоба 1.1.0: при наведении на кнопку меню светлела нижняя половина панели (полоса во всю
  // ширину, и у шапки тоже). Причина - backdrop-filter у панелей: при перерисовке одной кнопки
  // Chromium на видеокарте пересчитывал размытие подложки в полосе панели и захватывал уже
  // нарисованную панель. Безголовый Chromium рисует кадр целиком, полосу не показывает, поэтому
  // главный закон - про правило: у панели с кнопками нет backdrop-filter (ни у неё, ни у её
  // ::before/::after); подложка панели - копия фона темы обычным filter.
  const THEMES5 = ['glass', 'formal', 'light', 'night', 'warm'];
  const setTheme = (page, t) => page.evaluate((t) => { if (t === 'glass') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, t);

  test('у панелей с кнопками нет backdrop-filter, во всех темах', async ({ page }) => {
    await openWs(page);
    for (const t of THEMES5) {
      await setTheme(page, t);
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (!el.querySelector('button, select, input, textarea, a')) continue;
          for (const pseudo of [null, '::before', '::after']) {
            const bf = getComputedStyle(el, pseudo).backdropFilter;
            if (bf && bf !== 'none') out.push((el.id || el.className || el.tagName) + (pseudo || '') + ': ' + bf);
          }
        }
        return out;
      });
      expect(bad, `тема ${t}`).toEqual([]);
      // вид стекла остался: под панелью копия фона темы с насыщенностью темы
      const look = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#config'), '::before'); return { att: s.backgroundAttachment, filter: s.filter }; });
      expect(look.att, `тема ${t}`).toContain('fixed');
      expect(look.filter, `тема ${t}`).toMatch(/^saturate\(/);
    }
  });

  test('наведение на кнопку шапки или меню меняет только эту кнопку, во всех темах', async ({ page }) => {
    test.setTimeout(240_000);
    await openWs(page);
    for (const t of THEMES5) {
      await setTheme(page, t);
      for (const panel of ['header.top', '#config']) {
        const pb = await page.locator(panel).boundingBox();
        const clip = { x: pb.x - 1, y: pb.y - 1, width: pb.width + 2, height: pb.height + 2 };
        const btns = page.locator(panel + ' button:visible');
        const n = await btns.count();
        expect(n, panel).toBeGreaterThan(3);
        for (let i = 0; i < n; i++) {
          const btn = btns.nth(i);
          await page.mouse.move(2, 790);
          await page.waitForTimeout(300);                                 // переход цвета .15 с
          const before = await page.screenshot({ clip, mask: [btn] });
          const b = await btn.boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.waitForTimeout(300);
          const during = await page.screenshot({ clip, mask: [btn] });
          // до 4 уровней - сглаженный край маски у самой кнопки; полоса по панели - больше 10
          expect(await maxDiff(page, before, during), `${t} ${panel} кнопка ${i}: вне кнопки ничего не изменилось`).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  test('у шапки и меню нет резкой горизонтальной границы яркости, во всех темах', async ({ page }) => {
    test.setTimeout(120_000);
    await openWs(page);
    await page.mouse.move(2, 790);
    for (const t of THEMES5) {
      await setTheme(page, t);
      for (const panel of ['header.top', '#config']) {
        const shot = await page.screenshot({ clip: await page.locator(panel).boundingBox(), mask: [page.locator(panel + ' *')], maskColor: '#00FF00' });
        // маска поверх кнопок и текста зелёная; её край сглажен - берём пиксели, у которых
        // и соседи по столбцу не маска. Сравнение рядов - по столбцам (у шапки фон меняется
        // слева направо, среднее по разному набору столбцов прыгало бы само)
        const { jump, pairs } = await page.evaluate(async (b64) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, img.width, img.height).data, w = img.width, h = img.height;
          const lum = (x, y) => { const i = (y * w + x) * 4; return d[i] + d[i + 1] + d[i + 2]; };
          const masked = (x, y) => { const i = (y * w + x) * 4; return d[i + 1] - Math.max(d[i], d[i + 2]) > 40; };
          let jump = 0, pairs = 0;
          for (let y = 4; y < h - 6; y++) {                                 // без рамки и скруглений
            let s = 0, k = 0;
            for (let x = 20; x < w - 20; x++) {
              if (masked(x, y - 1) || masked(x, y) || masked(x, y + 1) || masked(x, y + 2)) continue;
              s += lum(x, y + 1) - lum(x, y); k++;
            }
            if (k > 50) { pairs++; jump = Math.max(jump, Math.abs(s / k / 3)); }
          }
          return { jump, pairs };
        }, shot.toString('base64'));
        expect(pairs, `${t} ${panel}: есть ряды без кнопок`).toBeGreaterThan(5);
        expect(jump, `${t} ${panel}: скачок яркости между соседними рядами`).toBeLessThan(3);
      }
    }
  });
});

test.describe('ws: китайский', () => {
  const zhOpen = async (page, extra = {}) => {
    await openWs(page);
    await page.evaluate((x) => { for (const [k, v] of Object.entries({ lang: 'zh', zhInput: 'hanzi', ...x })) __ws.set(k, v, false); __ws.set('mode', x.mode || 'words'); }, extra);
  };
  // Имитация метода ввода: события composition* в поле ввода (так их шлёт Chromium/Electron)
  async function ime(page, steps, result) {
    await page.evaluate(([steps, result]) => {
      const el = document.querySelector('#input');
      el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
      for (const s of steps) {
        el.value = s;
        el.dispatchEvent(new CompositionEvent('compositionupdate', { data: s }));
        el.dispatchEvent(new InputEvent('input', { data: s, inputType: 'insertCompositionText', isComposing: true }));
      }
      el.value = result;
      el.dispatchEvent(new CompositionEvent('compositionend', { data: result }));
    }, [steps, result]);
  }

  test('список слов: 5000 слов из иероглифов, к каждому пиньинь латиницей без тонов', async ({ page }) => {
    await openWs(page);
    const w = await page.evaluate(() => [__ws.words('zh').split(' '), __ws.wordsPy('zh').split(' ')]);
    expect(w[0].length).toBe(5000);
    expect(new Set(w[0]).size).toBe(5000);
    expect(w[0].every((x) => /^[一-鿿]{1,4}$/.test(x))).toBe(true);
    expect(w[1].length).toBe(5000);
    expect(w[1].every((x) => /^[a-zü]+$/.test(x))).toBe(true);
    const at = (x) => w[1][w[0].indexOf(x)];
    expect([at('我们'), at('中国'), at('时候')]).toEqual(['women', 'zhongguo', 'shihou']);
  });

  test('IME: пока идёт набор пиньиня, ничего не засчитывается и каретка стоит; итог сверяется по иероглифам', async ({ page }) => {
    await zhOpen(page);
    const w0 = await page.evaluate(() => __ws.state.words[0].text);
    const caret0 = await page.evaluate(() => document.querySelector('#caret').style.transform);
    await page.evaluate(() => {
      const el = document.querySelector('#input');
      el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
      el.value = 'ni'; el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }));
      el.dispatchEvent(new InputEvent('input', { data: 'ni', inputType: 'insertCompositionText', isComposing: true }));
    });
    expect(await page.evaluate(() => [__ws.state.keys.length, __ws.state.phase, __ws.state.typed[0]])).toEqual([0, 'idle', '']);
    expect(await page.evaluate(() => document.querySelector('#caret').style.transform)).toBe(caret0);
    await expect(page.locator('#ime')).toBeVisible();
    await expect(page.locator('#ime')).toHaveText('ni');
    await page.evaluate((r) => { const el = document.querySelector('#input'); el.value = r; el.dispatchEvent(new CompositionEvent('compositionend', { data: r })); }, w0);
    await expect(page.locator('#ime')).toBeHidden();
    const st = await page.evaluate(() => ({ wi: __ws.state.wi, keys: __ws.state.keys.length, ok: __ws.state.keys.every((k) => k.ok) }));
    expect(st).toEqual({ wi: 1, keys: [...w0].length, ok: true });           // слово сдалось само, без пробела
  });

  test('IME настоящим путём Chromium (CDP imeSetComposition + insertText) тоже работает', async ({ page }) => {
    await zhOpen(page);
    const w = await page.evaluate(() => __ws.state.words.slice(0, 3).map((x) => [x.text, x.py]));
    const cdp = await page.context().newCDPSession(page);
    for (const [hz, py] of w) {
      const before = await page.evaluate(() => __ws.state.keys.length);
      await cdp.send('Input.imeSetComposition', { text: py, selectionStart: py.length, selectionEnd: py.length });
      expect(await page.evaluate(() => __ws.state.keys.length), 'во время набора ничего не засчитано').toBe(before);
      await cdp.send('Input.insertText', { text: hz });
    }
    expect(await page.evaluate(() => [__ws.state.wi, __ws.state.keys.every((k) => k.ok)])).toEqual([3, true]);
  });

  test('скорость - иероглифов в минуту (1 слово = 1 иероглиф), на поддельных часах', async ({ page }) => {
    await zhOpen(page, { mode: 'words', count: 10 });
    const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
    const chars = words.join('');
    for (const w of words) { await ime(page, ['x'], w); await page.clock.runFor(1000); }
    const r = await result(page);
    const min = (words.length - 1) / 60;      // первое слово - в 0, последнее - через (n-1) с
    expect(r.unit).toBe(1);
    close(r.wpm, [...chars].length / min);
    close(r.cpm, [...chars].length / min);
    close(r.acc, 100);
    await expect(page.locator('#r-unit')).toHaveText('знаков в минуту');
  });

  test('пробел и Enter в китайском тесте ничего не делают - ни в начале, ни посреди слова', async ({ page }) => {
    await zhOpen(page);
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [__ws.state.wi, __ws.state.keys.length])).toEqual([0, 0]);
    // посреди слова: набраны все слова до первого двухзнакового и его первый иероглиф
    const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
    const k = words.findIndex((w) => [...w].length >= 2);
    expect(k).toBeGreaterThanOrEqual(0);
    for (const w of words.slice(0, k)) await ime(page, ['x'], w);
    await ime(page, ['x'], [...words[k]][0]);
    const before = await page.evaluate(() => [__ws.state.wi, __ws.state.keys.length, __ws.state.typed[__ws.state.wi]]);
    expect(before[0]).toBe(k);
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [__ws.state.wi, __ws.state.keys.length, __ws.state.typed[__ws.state.wi]])).toEqual(before);
  });

  test('ошибки - списком по иероглифам вместо клавиатуры', async ({ page }) => {
    await zhOpen(page, { mode: 'words', count: 10 });
    const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
    const wrong = words[0].length === 1 ? '错' : '错' + words[0].slice(1);
    await ime(page, ['cuo'], wrong === words[0] ? '对' : wrong);
    for (const w of words.slice(1)) await ime(page, ['x'], w);
    await expect(page.locator('#heat-title')).toHaveText('Частые ошибки по иероглифам');
    await expect(page.locator('#heatmap .key')).toHaveCount(0);
    await expect(page.locator(`#heatmap .zh-err[data-key="${words[0][0]}"]`)).toHaveAttribute('data-errors', '1');
  });

  test('латиница без IME в китайском тесте - подсказка включить метод ввода', async ({ page }) => {
    await zhOpen(page);
    await page.keyboard.type('ni');
    await expect(page.locator('#layout-hint')).toBeVisible();
    await expect(page.locator('#layout-hint')).toContainText('IME');
  });

  test('пиньинь латиницей: печатается пиньинь через пробел, иероглифы - над ним', async ({ page }) => {
    await zhOpen(page, { zhInput: 'pinyin', mode: 'words', count: 10 });
    const w = await page.evaluate(() => __ws.state.words.map((x) => [x.text, x.hz]));
    expect(w.every(([py, hz]) => /^[a-zü]+$/.test(py) && /^[一-鿿]+$/.test(hz))).toBe(true);
    await expect(page.locator('#words .word').first().locator('rt')).toHaveText(w[0][1]);
    await typeTimed(page, w.map((x) => x[0]).join(' '), 10);
    const r = await result(page);
    close(r.acc, 100);
    expect(r.key).toBe('words|10|zh-py|1000|-');
  });

  test('подсказка-пиньинь над иероглифами включается кнопкой', async ({ page }) => {
    await zhOpen(page);
    await expect(page.locator('#words rt')).toHaveCount(0);
    await page.click('[data-flag=pyHint]');
    const first = await page.evaluate(() => [__ws.state.words[0].py, document.querySelector('#words .word rt') && document.querySelector('#words .word rt').textContent]);
    expect(first[1]).toBe(first[0]);
    await expect(page.locator('#words-wrap')).toHaveClass(/hints/);
  });

  test('китайский шрифт: системный CJK с запасными, без загрузки извне', async ({ page }) => {
    await zhOpen(page);
    const ff = await page.locator('#words-wrap').evaluate((el) => getComputedStyle(el).fontFamily);
    for (const f of ['Microsoft YaHei', 'Noto Sans SC', 'PingFang SC']) expect(ff).toContain(f);
  });

  test('текст по-китайски: длины в иероглифах (~20...~600), набор через IME до конца', async ({ page }) => {
    await zhOpen(page, { mode: 'text', textLen: 10 });
    await expect(page.locator('[data-len="10"]')).toHaveText('~20');
    await expect(page.locator('[data-len="300"]')).toHaveText('~600');
    const words = await page.evaluate(() => __ws.state.words.map((w) => w.text));
    for (const w of words) await ime(page, ['x'], w);
    expect(await page.evaluate(() => __ws.state.phase)).toBe('done');
    expect((await result(page)).key).toBe('text|10|zh|-|-');
  });
});

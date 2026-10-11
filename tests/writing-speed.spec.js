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
  return r && { wpm: r.wpm, raw: r.raw, cpm: r.cpm, acc: r.acc, cons: r.consistency, dur: r.duration, correct: r.correct, incorrect: r.incorrect, extra: r.extra, missed: r.missed, keys: r.keys, errors: r.errors, presses: r.presses, isRecord: r.isRecord, key: r.key };
});
const state = (page) => page.evaluate(() => ({ phase: __ws.state.phase, wi: __ws.state.wi, typed: __ws.state.typed.slice(0, 30), words: __ws.state.words.slice(0, 30).map((w) => w.text) }));
const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(eps);

async function custom(page, text) {
  await page.evaluate((t) => __ws.startCustom(t), text);
}

test.describe('ws: страница', () => {
  test('открывается без ошибок и без сети, режимы и флажки на месте, версия видна', async ({ page }) => {
    const errors = await openWs(page);
    await expect(page).toHaveTitle(/Скорость печати/);
    for (const m of ['time', 'words', 'quote', 'custom', 'zen']) await expect(page.locator(`[data-mode=${m}]`)).toBeVisible();
    for (const f of ['punct', 'nums', 'caps', 'noBack', 'stop']) await expect(page.locator(`[data-flag=${f}]`)).toBeVisible();
    for (const t of ['15', '30', '60', '120']) await expect(page.locator(`[data-time="${t}"]`)).toBeVisible();
    const opts = await page.locator('#lang option').evaluateAll((o) => o.map((x) => x.value));
    expect(opts).toEqual(['ru', 'uk', 'en', 'de', 'fr', 'es', 'js', 'py']);
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
    const firstRow = {};
    for (const [lang, word] of [['ru', 'да'], ['uk', 'їжак'], ['en', 'yes'], ['de', 'zug'], ['fr', 'eau'], ['es', 'año']]) {
      await page.evaluate((l) => { __ws.set('lang', l, false); }, lang);
      await page.evaluate(() => __ws.set('mode', 'quote'));
      await custom(page, word);
      await page.evaluate((l) => { __ws.state.cfg.lang = l; }, lang);   // свой текст сам языка не имеет
      await typeTimed(page, word, 100);
      firstRow[lang] = await page.locator('#heatmap .krow').nth(1).locator('.key').first().getAttribute('data-key');
      if (lang === 'es') await expect(page.locator('#heatmap .key[data-key="ñ"]')).toHaveAttribute('data-presses', '1');
      if (lang === 'uk') await expect(page.locator('#heatmap .key[data-key="ї"]')).toHaveAttribute('data-presses', '1');
    }
    expect(firstRow).toEqual({ ru: 'й', uk: 'й', en: 'q', de: 'q', fr: 'a', es: 'q' });
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

  test('цитата: текст из списка языка, подпись источника, длина по выбору', async ({ page }) => {
    await openWs(page);
    await page.click('[data-mode=quote]');
    await page.click('[data-quote=short]');
    const info = await page.evaluate(() => ({ text: __ws.state.words.map((w) => w.text).join(' '), texts: __ws.texts.ru.map((q) => q.t.replace(/\s+/g, ' ')) }));
    expect(info.texts).toContain(info.text);
    expect(info.text.length).toBeLessThan(100);
    await page.click('[data-quote=long]');
    const long = await page.evaluate(() => __ws.state.words.map((w) => w.text).join(' '));
    expect(long.length).toBeGreaterThan(250);
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

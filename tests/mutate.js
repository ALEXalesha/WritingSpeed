// Проверка проверок «Скорости печати»: по одному ломает правило страницы в КОПИИ во временной
// папке и гоняет на ней tests/writing-speed.spec.js (через WS_FILE). Сломанное правило
// должно уронить хотя бы одну проверку («мутант убит»). Исходник web/writing-speed не меняется,
// поэтому обрыв скрипта ничего не портит.
// Запуск из корня репозитория: node tests/mutate.js
// Файл не *.spec.js - Playwright его сам не запускает.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index.html');
const SPEC = 'tests/writing-speed.spec.js';

// from - точный кусок кода (должен встречаться ровно один раз), to - сломанный вариант
const ALL_MUTANTS = [
  { name: 'WPM делится на 4 знака, а не на 5', from: 'const wpm = net / unit / min;', to: 'const wpm = net / (unit * 0.8) / min;' },
  { name: 'пробел после верного слова не засчитан', from: 'net += w.length; if (submitted && s.words[i].sep) net += 1; }', to: 'net += w.length; }' },
  { name: 'неверное слово засчитано в WPM', from: 'if (t === w) { net += w.length;', to: 'if (t.length === w.length) { net += w.length;' },
  { name: 'точность всегда 100%', from: 'const acc = total ? good / total * 100 : 0;', to: 'const acc = total ? 100 : 0;' },
  { name: 'сырая скорость по верным нажатиям', from: 'const raw = total / unit / min;', to: 'const raw = good / unit / min;' },
  { name: 'ошибка записана на нажатую клавишу, а не на нужную', from: 'const key = keyOf(k.ok ? k.c : k.exp);', to: 'const key = keyOf(k.c);' },
  { name: 'ровность без tanh', from: 'return 100 * (1 - Math.tanh(v + v ** 3 / 3 + v ** 5 / 5));', to: 'return 100 * (1 - v);' },
  { name: 'тест на время идёт на 10% дольше', from: "if (S.cfg.mode === 'time' && clock() - S.t0 >= S.cfg.time * 1000) { finish(", to: "if (S.cfg.mode === 'time' && clock() - S.t0 >= S.cfg.time * 1100) { finish(" },
  { name: 'брошенное слово - не ошибка', from: 'const ok = t.length >= w.text.length;', to: 'const ok = true;' },
  { name: 'лишняя буква - ошибка не на пробеле', from: "const exp = pos < w.text.length ? w.text[pos] : ' ';", to: 'const exp = pos < w.text.length ? w.text[pos] : w.text[w.text.length - 1];' },
  { name: '«без Backspace» не работает', from: 'if (S.cfg.noBack) { shake(); return; }', to: '' },
  { name: '«стоп на ошибке» не работает', from: 'if (!ok && S.cfg.stop) { record(c, exp, false); shake(); renderWord(S.wi); return; }', to: '' },
  { name: 'назад можно и в верное слово', from: '} else if (S.wi > 0 && S.typed[S.wi - 1] !== S.words[S.wi - 1].text) {', to: '} else if (S.wi > 0) {' },
  { name: 'подсказка про раскладку не появляется', from: 'if (S.layoutStreak >= 2) {', to: 'if (S.layoutStreak >= 99) {' },
  { name: 'рекорд не записывается', from: "    Store.set('records', records);", to: '' },
  { name: 'настройки не запоминаются', from: "const saveSettings = () => Store.set('settings', settings);", to: 'const saveSettings = () => {};' },
  { name: 'запись в хранилище без try/catch', from: 'try { localStorage.setItem(STORE + key, JSON.stringify(value)); return true; } catch (e) { this.ok = false; return false; }', to: 'localStorage.setItem(STORE + key, JSON.stringify(value)); return true;' },
  { name: 'список 200 слов не обрезается', from: 'cache[key] = isCode(lang) ? all : all.slice(0, size);', to: 'cache[key] = all;' },
  { name: 'отступ кода надо печатать (indent не считается)', from: 'parts.forEach((p, i) => out.push({ text: p, sep: \' \', indent: i === 0 ? indent : 0 }));', to: 'parts.forEach((p, i) => out.push({ text: (i === 0 ? \' \'.repeat(indent) : \'\') + p, sep: \' \', indent: 0 }));' },
  { name: 'дзен считает время до Shift+Enter', from: 'finish(S.keys.length ? S.keys[S.keys.length - 1].t : clock()); return; }', to: 'finish(clock()); return; }' },
  // 1.1.0: режим «текст», китайский, перенос, видимость настроек, меню без подсветки ряда (v11: true)
  { v11: true, name: 'допуск длины текста ±30 % вместо ±20 %', from: 'n >= len * k * 0.8 && n <= len * k * 1.2', to: 'n >= len * k * 0.7 && n <= len * k * 1.3' },
  { v11: true, name: 'китайские длины не удвоены', from: 'const CJK_FACTOR = 2;', to: 'const CJK_FACTOR = 1;' },
  { v11: true, name: 'китайский: скорость в словах по 5 знаков, а не в иероглифах', from: 'cfg.unit = cfg.cjk ? 1 : 5;', to: 'cfg.unit = 5;' },
  { v11: true, name: 'текст берётся любой длины, не выбранной', from: 'filter((e) => e.len === cfg.textLen)', to: 'filter((e) => e.len >= cfg.textLen)' },
  { v11: true, name: 'время + текст: идут слова вместо текста', from: "} else if (cfg.mode === 'time' && cfg.timeSrc === 'text' && !isCode(cfg.lang)) {", to: '} else if (false) {' },
  { v11: true, name: 'рекорды «цитат» не переезжают в «текст»', from: "if (raw.mode === 'quote') { s.mode = 'text'; s.textLen = QUOTE_TO_LEN[raw.quote] || 20; }", to: '' },
  { v11: true, name: 'длинное слово не переносится', from: 'overflow-wrap: anywhere; word-break: break-all;', to: '' },
  { v11: true, name: 'длины текста видны во всех режимах', from: "if (s.mode === 'text' && !code) v.add('lens');", to: "v.add('lens');" },
  { v11: true, name: 'словарь виден и у текста', from: "if (wordGen && !code) v.add('size');", to: "if (!code) v.add('size');" },
  { v11: true, name: 'пиньинь-подсказка видна и при вводе пиньинем', from: "if (s.zhInput === 'hanzi') v.add('pyHint');", to: "v.add('pyHint');" },
  { v11: true, name: 'знаки/цифры/заглавные видны у китайского', from: "if (wordGen && !zh) { v.add('nums');", to: "if (wordGen) { v.add('nums');" },
  { v11: true, name: '«слова/текст» виден и у кода', from: "if (s.mode === 'time') { v.add('times'); if (!code) v.add('src'); }", to: "if (s.mode === 'time') { v.add('times'); v.add('src'); }" },
  { v11: true, name: 'меню выделяет текст ряда (нет user-select:none)', from: 'header.top, .config, .under, .actions, .tabs, .kbd-map, .zh-errs { -webkit-user-select: none; user-select: none; }', to: '' },
  { v11: true, name: 'китайское слово не сдаётся само', from: 'if (S.cfg.cjk && S.typed[S.wi].length >= w.text.length) {', to: 'if (false) {' },
  { v11: true, name: 'пробел в китайском тесте сдаёт слово', from: "if (S.phase !== 'run' || S.cfg.cjk) return;", to: "if (S.phase !== 'run') return;" },
  { v11: true, name: 'китайский шрифт не ставится', from: '.words-wrap.cjk, .words-wrap rt {', to: '.words-wrap.cjk-x, .words-wrap rt {' },
  // 1.1.1: полоса на половину панели при наведении (backdrop-filter у панелей с кнопками)
  { v11: true, name: 'панели снова с backdrop-filter', from: '  box-shadow: var(--glass-shadow); position: relative; isolation: isolate;', to: '  box-shadow: var(--glass-shadow); position: relative; isolation: isolate; backdrop-filter: var(--blur);' },
  { v11: true, name: 'светлая полоса на нижней половине панели', from: '.glass::after { background: var(--glass-bg);', to: '.glass::after { background: linear-gradient(transparent 50%, rgb(255 255 255 / .07) 50%), var(--glass-bg);' },
  { v11: true, name: 'панель меню светлеет при наведении', from: '.btn:hover { background:', to: '.config:hover::after { background: rgb(255 255 255 / .1); } .btn:hover { background:' },
];

// WS_MUT=old - только мутанты 1.0.0, WS_MUT=new - только 1.1.0 (по ~20 мин каждый), без - все; WS_MUT_NAMES=<регулярка> - только мутанты с таким именем
const MUTANTS = ALL_MUTANTS.filter((m) => process.env.WS_MUT === 'old' ? !m.v11 : process.env.WS_MUT === 'new' ? m.v11 : true)
  .filter((m) => !process.env.WS_MUT_NAMES || new RegExp(process.env.WS_MUT_NAMES).test(m.name));   // выбрать по имени

function runSpec(file) {
  const r = spawnSync(`npx playwright test ${SPEC} --workers=1 --max-failures=1 --reporter=dot`, {
    cwd: ROOT, env: { ...process.env, WS_FILE: file }, shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000,
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mutants-'));
  const file = path.join(dir, 'index.html');
  let survived = 0;
  try {
    fs.writeFileSync(file, src);
    const base = runSpec(file);
    console.log(`исходная копия: ${base.ok ? 'проверки зелёные' : 'ПРОВЕРКИ КРАСНЫЕ'}`);
    if (!base.ok) { console.log(base.out.slice(-3000)); process.exitCode = 2; return; }
    for (const m of MUTANTS) {
      const n = src.split(m.from).length - 1;
      if (n !== 1) { console.log(`? ${m.name}: кусок кода найден ${n} раз - мутант устарел`); survived++; continue; }
      fs.writeFileSync(file, src.replace(m.from, m.to));
      const r = runSpec(file);
      const failed = /\d+\) .*›.*›\s*(.+)/.exec(r.out);
      console.log(`${r.ok ? 'ВЫЖИЛ' : 'убит '}  ${m.name}${!r.ok && failed ? '  <- ' + failed[1].replace(/[─\s]+$/, '') : ''}`);
      if (r.ok) survived++;
    }
    console.log(`итог: убито ${MUTANTS.length - survived} из ${MUTANTS.length}`);
    if (survived) process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) main();
module.exports = { MUTANTS: ALL_MUTANTS };

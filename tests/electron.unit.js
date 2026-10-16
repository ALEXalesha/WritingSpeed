// Законы оболочки Electron «Скорости печати» (electron), без запуска:
// модуль окна тот же, что у Игротеки и калькуляторов, версия одна у страницы и программы,
// страница в сборку берётся из ../index.html (не копией), окно помнит размер и место.
// Запуск: node --test tests/electron.unit.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = ROOT;
const APP = path.join(DIR, 'electron');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const PKG = JSON.parse(read(path.join(APP, 'package.json')));
const MAIN = read(path.join(APP, 'main.js'));
const PAGE = read(path.join(DIR, 'index.html'));
const WS = require(path.join(APP, 'window-state.js'));

test('window-state.js - тот же модуль, что у Игротеки (app/window-state.js)', (t) => {
  const igroteka = path.join(ROOT, 'app', 'window-state.js');
  if (!fs.existsSync(igroteka)) { t.skip('нет app/window-state.js (отдельный репозиторий)'); return; }
  assert.equal(read(path.join(APP, 'window-state.js')), read(igroteka));
});

test('версия: страница = package.json программы', () => {
  const m = /const VERSION = '([^']+)'/.exec(PAGE);
  assert.ok(m, 'VERSION в index.html');
  assert.equal(m[1], PKG.version);
});

test('сборка: страница из ../index.html, без копии в папке программы', () => {
  assert.deepEqual(PKG.build.extraResources, [{ from: '../index.html', to: 'web/index.html' }]);
  assert.ok(!fs.existsSync(path.join(APP, 'index.html')), 'копии страницы быть не должно');
  assert.match(MAIN, /process\.resourcesPath, 'web', 'index\.html'/);
  assert.match(MAIN, /path\.join\(__dirname, '\.\.', 'index\.html'\)/);
  for (const f of PKG.build.files) assert.ok(fs.existsSync(path.join(APP, f)), f);
  assert.ok(PKG.build.files.includes('window-state.js'));
});

test('сборка: установщик NSIS и portable x64 с именами WritingSpeed-<версия>', () => {
  const targets = PKG.build.win.target.map((t) => t.target).sort();
  assert.deepEqual(targets, ['nsis', 'portable']);
  assert.equal(PKG.build.nsis.artifactName, 'WritingSpeed-${version}-Setup.${ext}');
  assert.equal(PKG.build.portable.artifactName, 'WritingSpeed-${version}-Portable.${ext}');
  assert.equal(PKG.build.nsis.perMachine, false);
  assert.ok(fs.existsSync(path.join(APP, PKG.build.win.icon)), 'значок');
});

test('окно помнит размер и место: restore при запуске, запись на всех событиях и при закрытии', () => {
  assert.match(MAIN, /WindowState\.restore\(WindowState\.load\(stateFile\(\)\), areas, SIZE\)/);
  for (const ev of ['resized', 'moved', 'maximize', 'unmaximize']) assert.ok(MAIN.includes(`'${ev}'`), ev);
  assert.match(MAIN, /win\.on\('close', remember\)/);
  assert.match(MAIN, /const SIZE = \{ width: 1100, height: 760, minWidth: 420, minHeight: 520 \}/);
});

test('заголовок окна - название страницы и версия', () => {
  assert.match(MAIN, /page-title-updated/);
  assert.match(MAIN, /`\$\{pageTitle \|\| 'WritingSpeed'\} \$\{VERSION\}`/);
});

test('безопасность: без Node в странице, песочница, сеть и новые окна закрыты', () => {
  assert.match(MAIN, /contextIsolation: true/);
  assert.match(MAIN, /nodeIntegration: false/);
  assert.match(MAIN, /sandbox: true/);
  assert.match(MAIN, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(MAIN, /onBeforeRequest/);
});

test('restore: окно с отключённого монитора - по центру, размер в пределах', () => {
  const SIZE = { width: 1100, height: 760, minWidth: 420, minHeight: 520 };
  const screen = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(WS.restore(null, [screen], SIZE), { width: 1100, height: 760, maximized: false });
  assert.deepEqual(WS.restore({ x: 5000, y: 100, width: 900, height: 600 }, [screen], SIZE), { width: 900, height: 600, maximized: false });
  assert.deepEqual(WS.restore({ x: 100, y: 100, width: 100, height: 100 }, [screen], SIZE), { x: 100, y: 100, width: 420, height: 520, maximized: false });
});

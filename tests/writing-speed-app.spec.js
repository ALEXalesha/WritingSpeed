// Проверка НАСТОЯЩЕЙ программы «Скорость печати» на Electron (electron):
// окно открывается со страницей, в заголовке версия, размер и место окна переживают
// перезапуск. Окно в режиме проверок (WS_TEST=1) не показывается и не берёт фокус.
// Запуск: npx playwright test tests/writing-speed-app.spec.js
'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP = path.join(__dirname, '..', 'electron');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;

async function launch(dataDir) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [APP, '--user-data-dir=' + dataDir],
    env: { ...process.env, WS_TEST: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__ws && window.__ws.ready === true);
  return { app, page };
}

test('окно со страницей, версия в заголовке, окно не показывается в проверке', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-app-'));
  const { app, page } = await launch(dataDir);
  try {
    expect(await page.evaluate(() => __ws.version)).toBe(VERSION);
    const info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { title: w.getTitle(), visible: w.isVisible(), focusable: w.isFocusable() };
    });
    expect(info.title).toBe(`Скорость печати / WritingSpeed ${VERSION}`);
    expect(info.visible).toBe(false);
    expect(info.focusable).toBe(false);
    // язык интерфейса меняет и заголовок окна
    await page.click('#ui-lang');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(`WritingSpeed - typing test ${VERSION}`);
    // тест печати работает и в программе
    await page.evaluate(() => __ws.startCustom('да нет'));
    await page.keyboard.type('да нет');
    expect(await page.evaluate(() => __ws.state.phase)).toBe('done');
  } finally {
    await app.close();
  }
});

test('размер и место окна переживают перезапуск', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-app-'));
  let { app } = await launch(dataDir);
  const want = { x: 120, y: 90, width: 900, height: 640 };
  await app.evaluate(({ BrowserWindow }, b) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds(b); w.emit('resized'); }, want);
  await app.close();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'window-state.json'), 'utf8'));
  expect(saved).toMatchObject({ ...want, maximized: false });
  ({ app } = await launch(dataDir));
  try {
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    expect(b).toEqual(want);
  } finally {
    await app.close();
  }
});

'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store');
const { buildXlsx } = require('./xlsx');

const LANGUAGES = ['sah', 'ru', 'en'];
const THEMES = ['system', 'light', 'dark'];

// Всё лежит в профиле учителя: программа для одного компьютера и одного класса.
const homeDir = () => process.env.KERDIIS_HOME || app.getPath('userData');
const settingsFile = () => path.join(homeDir(), 'settings.json');

// Часы для проверок: только вместе с отдельной папкой данных.
const clockOffset = process.env.KERDIIS_HOME && process.env.KERDIIS_CLOCK
  ? new Date(process.env.KERDIIS_CLOCK).getTime() - Date.now()
  : 0;
const now = () => new Date(Date.now() + clockOffset);
const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = now();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function loadSettings() {
  const defaults = { lang: 'auto', theme: 'system', fullscreen: false };
  try {
    return { ...defaults, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 1)}\n`, 'utf8');
}

let settings = loadSettings();

/** Язык интерфейса: якутский, русский или английский. */
function interfaceLanguage() {
  if (LANGUAGES.includes(settings.lang)) return settings.lang;
  const system = app.getLocale().split('-')[0];
  if (system === 'sah') return 'sah';
  if (['ru', 'be', 'uk', 'kk', 'ky'].includes(system)) return 'ru';
  return system === 'en' ? 'en' : 'ru';
}

// Поля даты и времени рисует Chromium: язык ему нужен до запуска окна. Якутского в нём нет.
app.commandLine.appendSwitch('lang', interfaceLanguage() === 'en' ? 'en-GB' : 'ru');

let win = null;
let splash = null;
let splashDone = false;
let mainReady = false;
let store = null;
let data = null;

const SPLASH_MS = 3500;
const ICON = path.join(__dirname, '..', 'renderer', 'icon.png');
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function revealMain() {
  if (!splashDone || !mainReady || !win) return;
  if (!settings.fullscreen) win.maximize();
  win.show();
  win.focus();
  if (settings.fullscreen) win.setFullScreen(true);
}

function finishSplash() {
  if (splashDone) return;
  splashDone = true;
  splash?.close();
  revealMain();
}

function createSplash() {
  splash = new BrowserWindow({
    width: 640,
    height: 380,
    center: true,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !process.env.KERDIIS_HOME,
    backgroundColor: '#fbfcf7',
    title: 'Kerdi:s',
    icon: ICON,
    webPreferences,
  });
  splash.once('ready-to-show', () => {
    splash.show();
    setTimeout(finishSplash, process.env.KERDIIS_HOME ? 300 : SPLASH_MS);
  });
  splash.on('closed', () => {
    splash = null;
    finishSplash();
  });
  splash.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#fbfcf7',
    title: 'Kerdiis School',
    icon: ICON,
    webPreferences,
  });
  win.once('ready-to-show', () => {
    mainReady = true;
    revealMain();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false));
  win.on('closed', () => {
    win = null;
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

async function respond(work) {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    return { ok: false, code: err.code || 'io', message: err.message };
  }
}

const safeName = (name) => String(name).replace(/[\\/:*?"<>|]/g, ' ').trim();

async function askSave(title, fileName, filters) {
  const result = await dialog.showSaveDialog(win, { title, defaultPath: path.join(app.getPath('documents'), safeName(fileName)), filters });
  return result.canceled ? null : result.filePath;
}

function registerHandlers() {
  ipcMain.on('app:info', (event) => {
    event.returnValue = { language: interfaceLanguage(), clockOffset, version: app.getVersion() };
  });
  ipcMain.handle('data:load', () => data);
  ipcMain.handle('data:save', (_e, next) => respond(async () => {
    await store.save(next);
    data = store.normalize(next, today());
    return data;
  }));
  ipcMain.handle('settings:get', () => ({ ...settings, language: interfaceLanguage(), version: app.getVersion(), home: homeDir() }));
  ipcMain.handle('settings:set', (_e, change) => respond(() => {
    if (change.theme && THEMES.includes(change.theme)) {
      settings.theme = change.theme;
      nativeTheme.themeSource = change.theme;
    }
    if (typeof change.fullscreen === 'boolean') {
      settings.fullscreen = change.fullscreen;
      win?.setFullScreen(change.fullscreen);
    }
    saveSettings();
  }));
  ipcMain.handle('lang:set', (_e, lang) => {
    if (![...LANGUAGES, 'auto'].includes(lang)) return;
    settings.lang = lang;
    saveSettings();
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('backup:export', (_e, title, fileName) => respond(async () => {
    const file = await askSave(title, fileName, [{ name: 'JSON', extensions: ['json'] }]);
    if (!file) return false;
    await store.save(data);
    await store.exportTo(file);
    return true;
  }));
  ipcMain.handle('backup:import', (_e, title) => respond(async () => {
    const result = await dialog.showOpenDialog(win, {
      title,
      defaultPath: store.backupDir,
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    data = await store.importFrom(result.filePaths[0]);
    return data;
  }));
  ipcMain.handle('backup:folder', () => shell.openPath(store.backupDir));

  ipcMain.handle('report:xlsx', (_e, title, fileName, sheets) => respond(async () => {
    const file = await askSave(title, fileName, [{ name: 'Excel', extensions: ['xlsx'] }]);
    if (!file) return false;
    await fs.writeFile(file, buildXlsx(sheets));
    shell.showItemInFolder(file);
    return true;
  }));
  ipcMain.handle('paper:print', () => new Promise((resolve) => {
    win.webContents.print({ printBackground: false }, (success, reason) => {
      resolve({ ok: success || /cancel/i.test(String(reason)), printed: success });
    });
  }));
  ipcMain.handle('paper:pdf', (_e, title, fileName) => respond(async () => {
    const file = await askSave(title, fileName, [{ name: 'PDF', extensions: ['pdf'] }]);
    if (!file) return false;
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: false, preferCSSPageSize: true });
    await fs.writeFile(file, pdf);
    shell.showItemInFolder(file);
    return true;
  }));

  ipcMain.handle('splash:skip', finishSplash);
  ipcMain.handle('window:quit', () => app.quit());
  ipcMain.handle('window:minimize', () => win?.minimize());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = settings.theme;
    const logic = await import(pathToFileURL(path.join(__dirname, '..', 'renderer', 'logic.mjs')).href);
    store = new Store(homeDir(), logic.normalizeData, today);
    data = store.load();
    registerHandlers();
    createSplash();
    createWindow();
    const backup = () => store.dailyBackup().catch((err) => console.error('Копия не сделана:', err.message));
    setTimeout(backup, 30_000);
    setInterval(backup, 60 * 60_000);
  });

  app.on('window-all-closed', () => app.quit());
}

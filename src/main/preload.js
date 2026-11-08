'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// На сенсорной доске случайный щипок не должен масштабировать интерфейс.
webFrame.setVisualZoomLevelLimits(1, 1);

const info = ipcRenderer.sendSync('app:info');

contextBridge.exposeInMainWorld('school', {
  language: info.language,
  version: info.version,
  clockOffset: info.clockOffset,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (change) => ipcRenderer.invoke('settings:set', change),
  setLanguage: (lang) => ipcRenderer.invoke('lang:set', lang),
  exportBackup: (title, fileName) => ipcRenderer.invoke('backup:export', title, fileName),
  importBackup: (title) => ipcRenderer.invoke('backup:import', title),
  openBackups: () => ipcRenderer.invoke('backup:folder'),
  saveXlsx: (title, fileName, sheets) => ipcRenderer.invoke('report:xlsx', title, fileName, sheets),
  print: () => ipcRenderer.invoke('paper:print'),
  savePdf: (title, fileName) => ipcRenderer.invoke('paper:pdf', title, fileName),
  skipSplash: () => ipcRenderer.invoke('splash:skip'),
  quit: () => ipcRenderer.invoke('window:quit'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  onFullscreen: (handler) => ipcRenderer.on('window:fullscreen', (_e, value) => handler(value)),
});

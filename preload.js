/**
 * Preload script — bridge between main process and renderer
 * Exposes safe APIs to the renderer via contextBridge
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // State
  getState: () => ipcRenderer.invoke('get-state'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getLogs: () => ipcRenderer.invoke('get-logs'),

  // Actions
  testPrint: () => ipcRenderer.invoke('test-print'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Events from main process
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_, data) => callback(data));
  },
  onPrintSuccess: (callback) => {
    ipcRenderer.on('print-success', (_, data) => callback(data));
  },
  onPrintError: (callback) => {
    ipcRenderer.on('print-error', (_, data) => callback(data));
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_, data) => callback(data));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (_, data) => callback(data));
  },
  onLog: (callback) => {
    ipcRenderer.on('log', (_, data) => callback(data));
  },
});

/**
 * Restaurant Printer App — Main Process
 * ========================================
 * Electron main process: tray icon, window, auto-update, agent lifecycle.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Disable GPU hardware acceleration to prevent cache errors on Windows
app.disableHardwareAcceleration();

// Single instance lock — prevent multiple copies
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ============ PATHS ============
const IS_DEV = process.argv.includes('--dev');
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = IS_DEV ? 'config.dev.json' : 'config.json';
const CONFIG_PATH = path.join(USER_DATA, CONFIG_FILE);
const LOG_PATH = path.join(USER_DATA, IS_DEV ? 'agent.dev.log' : 'agent.log');

// Default config (first run)
// Dev mode uses localhost, production uses the admin portal URL
const DEFAULT_CONFIG = {
  apiBaseUrl: IS_DEV ? 'http://localhost:3001' : 'https://portaal.eethuisboles.nl',
  agentToken: IS_DEV ? 'dev-test-token' : '',
  pollIntervalMs: 5000,
  heartbeatIntervalMs: 30000,
  logLevel: IS_DEV ? 'DEBUG' : 'INFO',
  maxLogFileSizeMb: 10,
};

// ============ CONFIG ============
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Config read error:', e.message);
  }
  // Create default config
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// ============ GLOBAL STATE ============
let mainWindow = null;
let tray = null;
let agent = null; // The print agent instance
let isQuitting = false;

// Stats tracked in memory
const stats = {
  status: 'offline',        // online, offline, error
  lastError: null,
  printedToday: 0,
  lastPrint: null,           // { orderNumber, time }
  recentPrints: [],          // last 20 prints
  printerStatus: 'unknown',
  agentUptime: 0,
  updateAvailable: null,
  connectionInfo: {
    server: 'checking',
    printer: 'checking',
    location: null,
    printers: [],
    serverError: null,
    printerError: null,
  },
};

// ============ TRAY ============
function createTray() {
  // Use ICO on Windows, PNG fallback otherwise
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  const iconPath = process.platform === 'win32' && fs.existsSync(icoPath) ? icoPath : pngPath;
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("Restaurant Printer");
  updateTrayMenu();

  tray.on('double-click', () => {
    showWindow();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const statusText = stats.status === 'online'
    ? '🟢 Online'
    : stats.status === 'error'
    ? '🔴 Fout'
    : '⚪ Offline';

  const menu = Menu.buildFromTemplate([
    { label: `Restaurant Printer — ${statusText}`, enabled: false },
    { type: 'separator' },
    { label: 'Openen', click: () => showWindow() },
    { label: 'Test Print', click: () => testPrint() },
    { type: 'separator' },
    {
      label: stats.updateAvailable
        ? `Update beschikbaar: v${stats.updateAvailable}`
        : 'Geen updates',
      enabled: !!stats.updateAvailable,
      click: () => autoUpdater.quitAndInstall(),
    },
    { type: 'separator' },
    {
      label: 'Afsluiten',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

// ============ WINDOW ============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 400,
    minHeight: 500,
    resizable: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: "Restaurant Printer",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Hide instead of close (minimize to tray)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // Safety: show window after 3s even if ready-to-show never fires
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);

  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// ============ AGENT INTEGRATION ============
// The agent runs in the same process, sending events to the renderer.
function startAgent() {
  if (agent) return;

  // Import the agent module
  const PrintAgent = require('./agent');
  agent = new PrintAgent(config, {
    onStatusChange: (status) => {
      stats.status = status;
      updateTrayMenu();
      sendToRenderer('status-update', getState());
    },
    onPrintSuccess: (orderNumber, printerName) => {
      stats.printedToday++;
      stats.lastPrint = { orderNumber, time: new Date().toISOString() };
      stats.recentPrints.unshift({
        orderNumber,
        printer: printerName,
        time: new Date().toISOString(),
        status: 'success',
      });
      if (stats.recentPrints.length > 50) stats.recentPrints.pop();
      updateTrayMenu();
      sendToRenderer('status-update', getState());
      sendToRenderer('print-success', { orderNumber, printerName });
    },
    onPrintError: (orderNumber, error) => {
      stats.lastError = error;
      stats.recentPrints.unshift({
        orderNumber,
        time: new Date().toISOString(),
        status: 'error',
        error,
      });
      if (stats.recentPrints.length > 50) stats.recentPrints.pop();
      sendToRenderer('status-update', getState());
      sendToRenderer('print-error', { orderNumber, error });
    },
    onLog: (level, message) => {
      sendToRenderer('log', { level, message, time: new Date().toISOString() });
    },
    onConnectionInfo: (info) => {
      stats.connectionInfo = info;
      sendToRenderer('connection-info', info);
      sendToRenderer('status-update', getState());
    },
  });

  agent.start();
  stats.status = 'online';
  updateTrayMenu();
}

function stopAgent() {
  if (agent) {
    agent.stop();
    agent = null;
    stats.status = 'offline';
    updateTrayMenu();
    sendToRenderer('status-update', getState());
  }
}

function testPrint() {
  if (agent) {
    agent.testPrint();
  }
}

function getState() {
  return {
    ...stats,
    connectionInfo: stats.connectionInfo,
    config: {
      apiBaseUrl: config.apiBaseUrl,
      pollIntervalMs: config.pollIntervalMs,
      hasToken: !!config.agentToken,
    },
    version: app.getVersion(),
    isDev: IS_DEV,
  };
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ============ IPC HANDLERS ============
ipcMain.handle('get-state', () => getState());

ipcMain.handle('get-config', () => ({
  apiBaseUrl: config.apiBaseUrl,
  agentToken: config.agentToken ? '••••' + config.agentToken.slice(-8) : '',
  pollIntervalMs: config.pollIntervalMs,
}));

ipcMain.handle('save-config', (event, newConfig) => {
  // Only update allowed fields
  if (newConfig.apiBaseUrl) config.apiBaseUrl = newConfig.apiBaseUrl;
  if (newConfig.agentToken) config.agentToken = newConfig.agentToken;
  if (newConfig.pollIntervalMs) config.pollIntervalMs = newConfig.pollIntervalMs;
  saveConfig(config);

  // Restart agent with new config
  stopAgent();
  if (config.agentToken) {
    startAgent();
  }
  return { success: true };
});

ipcMain.handle('test-print', () => {
  testPrint();
  return { success: true };
});

ipcMain.handle('get-connection-info', () => {
  if (agent) return agent.getConnectionInfo();
  return stats.connectionInfo;
});

ipcMain.handle('check-printer-now', async () => {
  if (agent) {
    await agent.checkPrinters();
    return agent.getConnectionInfo();
  }
  return stats.connectionInfo;
});

ipcMain.handle('check-update', async () => {
  if (IS_DEV) return { available: false, error: 'Dev mode' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch (e) {
    return { available: false, error: e.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-logs', () => {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const content = fs.readFileSync(LOG_PATH, 'utf-8');
      // Return last 100 lines
      return content.split('\n').slice(-100).join('\n');
    }
  } catch (e) { /* ignore */ }
  return '';
});

// ============ AUTO-UPDATER ============
function setupAutoUpdater() {
  if (IS_DEV) {
    console.log('[DEV] Auto-updater disabled in dev mode');
    return;
  }

  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    stats.updateAvailable = info.version;
    updateTrayMenu();
    sendToRenderer('update-available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update-downloaded', { version: info.version });
    // Show notification
    if (tray) {
      tray.displayBalloon({
        title: 'Update klaar',
        content: `Versie ${info.version} is gedownload. Wordt geïnstalleerd bij afsluiten.`,
      });
    }
  });

  autoUpdater.on('error', (err) => {
    sendToRenderer('update-error', { error: err.message });
  });

  // Check for updates every hour
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);

  // Initial check after 10 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);

  } catch (err) {
    console.error('Auto-updater setup failed:', err.message);
  }
}

// ============ RESET DAILY STATS ============
function scheduleDailyReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(5, 0, 0, 0); // Reset at 5:00 AM

  const msUntilReset = tomorrow.getTime() - now.getTime();
  setTimeout(() => {
    stats.printedToday = 0;
    stats.recentPrints = [];
    sendToRenderer('status-update', getState());
    scheduleDailyReset(); // Schedule next reset
  }, msUntilReset);
}

// ============ APP LIFECYCLE ============
app.on('ready', () => {
  createTray();
  createWindow();
  setupAutoUpdater();
  scheduleDailyReset();

  // Start agent if token is configured
  if (config.agentToken) {
    startAgent();
  }
});

app.on('second-instance', () => {
  showWindow();
});

app.on('window-all-closed', (e) => {
  // Don't quit on window close — keep running in tray
  e?.preventDefault?.();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopAgent();
});

// Auto-start with Windows (on first install)
if (!IS_DEV) {
  app.setLoginItemSettings({
    openAtLogin: true,
    name: "Restaurant Printer",
  });
}

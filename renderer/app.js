/**
 * Renderer — UI logic
 * Communicates with main process via window.api (preload bridge)
 */

// ============ ELEMENTS ============
const $ = (sel) => document.querySelector(sel);
const welcomeScreen = $('#welcome-screen');
const mainApp = $('#main-app');
const printedToday = $('#printed-today');
const lastPrint = $('#last-print');
const versionEl = $('#version');
const printList = $('#print-list');
const logList = $('#log-list');
const updateBanner = $('#update-banner');
const updateText = $('#update-text');
const settingsModal = $('#settings-modal');

// Connection elements
const serverDot = $('#server-dot');
const serverStatus = $('#server-status');
const printerDot = $('#printer-dot');
const printerStatus = $('#printer-status');
const locationText = $('#location-text');
const printerCard = $('#printer-card');
const printerListCompact = $('#printer-list-compact');

// ============ INIT ============
async function init() {
  const state = await window.api.getState();

  // Show welcome screen if no token
  if (!state.config.hasToken) {
    showWelcome();
    return;
  }

  showMainApp();
  updateUI(state);

  // Load config into settings form
  const config = await window.api.getConfig();
  $('#input-api-url').value = config.apiBaseUrl || '';
  $('#input-token').placeholder = config.agentToken || 'Plak je agent token hier';
  $('#input-poll').value = config.pollIntervalMs || 5000;

  // Get initial connection info
  const connInfo = await window.api.getConnectionInfo();
  if (connInfo) updateConnectionUI(connInfo);
}

// ============ WELCOME / ONBOARDING ============
function showWelcome() {
  welcomeScreen.classList.remove('hidden');
  mainApp.classList.add('hidden');
}

function showMainApp() {
  welcomeScreen.classList.add('hidden');
  mainApp.classList.remove('hidden');
}

// ============ UI UPDATE ============
function updateUI(state) {
  // Version
  versionEl.textContent = `v${state.version}`;

  // Dev mode badge
  const devBadge = $('#dev-badge');
  if (state.isDev) {
    devBadge.classList.remove('hidden');
  } else {
    devBadge.classList.add('hidden');
  }

  // Stats
  printedToday.textContent = state.printedToday || 0;
  if (state.lastPrint) {
    const time = new Date(state.lastPrint.time);
    lastPrint.textContent = `#${state.lastPrint.orderNumber} (${formatTime(time)})`;
  } else {
    lastPrint.textContent = '—';
  }

  // Recent prints
  if (state.recentPrints && state.recentPrints.length > 0) {
    printList.innerHTML = state.recentPrints.map(renderPrintItem).join('');
  }

  // Update banner
  if (state.updateAvailable) {
    updateBanner.classList.remove('hidden');
    updateText.textContent = `Update v${state.updateAvailable} beschikbaar!`;
  }

  // Connection info
  if (state.connectionInfo) {
    updateConnectionUI(state.connectionInfo);
  }
}

// ============ CONNECTION UI ============
function updateConnectionUI(info) {
  // Server status
  serverDot.className = `connection-dot ${info.server}`;
  const serverLabels = {
    connected: 'Verbonden',
    disconnected: 'Niet bereikbaar',
    checking: 'Controleren...',
  };
  serverStatus.textContent = serverLabels[info.server] || info.server;
  if (info.server === 'disconnected' && info.serverError) {
    serverStatus.title = info.serverError;
  }

  // Printer status
  printerDot.className = `connection-dot ${info.printer === 'no-printers' ? 'no-printers' : info.printer}`;
  const printerLabels = {
    connected: 'Bereikbaar',
    disconnected: 'Niet bereikbaar',
    checking: 'Controleren...',
    'no-printers': 'Niet geconfigureerd',
  };
  printerStatus.textContent = printerLabels[info.printer] || info.printer;
  if (info.printer === 'disconnected' && info.printerError) {
    printerStatus.title = info.printerError;
  }

  // Location
  if (info.location) {
    locationText.innerHTML = `Gekoppeld aan <span class="location-name">${escapeHtml(info.location)}</span>`;
  } else if (info.server === 'connected') {
    locationText.textContent = 'Verbonden met server';
  } else {
    locationText.textContent = 'Niet verbonden';
  }

  // Printer list
  if (info.printers && info.printers.length > 0) {
    printerCard.classList.remove('hidden');
    printerListCompact.innerHTML = info.printers.map(p => {
      const dotClass = p._reachable === true ? 'ok' : p._reachable === false ? 'fail' : 'unknown';
      return `
        <div class="printer-row">
          <div class="printer-row-dot ${dotClass}"></div>
          <span class="printer-row-name">${escapeHtml(p.name)}</span>
          <span class="printer-row-ip">${escapeHtml(p.ip_address)}:${p.port || 9100}</span>
        </div>
      `;
    }).join('');
  } else {
    printerCard.classList.add('hidden');
  }
}

function renderPrintItem(print) {
  const time = formatTime(new Date(print.time));
  const icon = print.status === 'success' ? '✅' : '❌';
  const detail = print.status === 'success'
    ? (print.printer || '')
    : (print.error || 'Print mislukt');

  return `
    <div class="print-item ${print.status === 'success' ? '' : 'error'}">
      <div class="print-icon">${icon}</div>
      <div class="print-info">
        <div class="print-order">${escapeHtml(print.orderNumber || 'Onbekend')}</div>
        <div class="print-detail">${escapeHtml(detail)}</div>
      </div>
      <div class="print-time">${time}</div>
    </div>
  `;
}

// ============ EVENTS FROM MAIN ============
window.api.onStatusUpdate((state) => {
  updateUI(state);
});

window.api.onConnectionInfo((info) => {
  updateConnectionUI(info);
});

window.api.onPrintSuccess(({ orderNumber, printerName }) => {
  // Flash the connection card green
  const card = $('#connection-card');
  card.classList.remove('flash-success');
  void card.offsetWidth; // Force reflow
  card.classList.add('flash-success');
});

window.api.onPrintError(({ orderNumber, error }) => {
  // Could show a notification
});

window.api.onUpdateAvailable(({ version }) => {
  updateBanner.classList.remove('hidden');
  updateText.textContent = `Update v${version} beschikbaar!`;
});

window.api.onUpdateDownloaded(({ version }) => {
  updateText.textContent = `Update v${version} klaar — wordt geïnstalleerd bij afsluiten`;
});

window.api.onLog(({ level, message, time }) => {
  const el = document.createElement('div');
  el.className = `log-item ${level.toLowerCase()}`;
  const t = formatTime(new Date(time));
  el.textContent = `[${t}] [${level}] ${message}`;
  // Prepend (newest first)
  if (logList.querySelector('.empty-state')) {
    logList.innerHTML = '';
  }
  logList.prepend(el);
  // Limit to 200 entries
  while (logList.children.length > 200) {
    logList.removeChild(logList.lastChild);
  }
});

// ============ WELCOME CONNECT ============
$('#btn-welcome-connect').addEventListener('click', async () => {
  const token = $('#welcome-token').value.trim();
  const errorEl = $('#welcome-error');

  if (!token) {
    errorEl.textContent = 'Voer een agent token in';
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = $('#btn-welcome-connect');
  btn.disabled = true;
  btn.textContent = '⏳ Verbinden...';
  errorEl.classList.add('hidden');

  try {
    await window.api.saveConfig({ agentToken: token });

    // Wait a moment for agent to start and do heartbeat
    await new Promise(r => setTimeout(r, 2000));
    const state = await window.api.getState();

    if (state.status === 'error') {
      errorEl.textContent = 'Kon niet verbinden. Controleer het token en probeer opnieuw.';
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = '🔗 Verbinden';
      return;
    }

    // Success — switch to main app
    showMainApp();
    const config = await window.api.getConfig();
    $('#input-api-url').value = config.apiBaseUrl || '';
    $('#input-token').placeholder = config.agentToken || '';
    $('#input-poll').value = config.pollIntervalMs || 5000;
    updateUI(state);
  } catch (e) {
    errorEl.textContent = 'Er ging iets mis. Probeer opnieuw.';
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = '🔗 Verbinden';
  }
});

// ============ PRINTER REFRESH ============
$('#btn-refresh-printers').addEventListener('click', async () => {
  const btn = $('#btn-refresh-printers');
  btn.disabled = true;
  btn.textContent = '⏳';
  const info = await window.api.checkPrinterNow();
  if (info) updateConnectionUI(info);
  btn.disabled = false;
  btn.textContent = '🔄';
});

// ============ BUTTON HANDLERS ============
$('#btn-test-print').addEventListener('click', async () => {
  const btn = $('#btn-test-print');
  btn.disabled = true;
  btn.textContent = '⏳ Printen...';
  await window.api.testPrint();
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = '🖨️ Test Print';
  }, 3000);
});

$('#btn-settings').addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});

$('#btn-close-settings').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

$('#btn-cancel-settings').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

$('#btn-save-settings').addEventListener('click', async () => {
  const apiBaseUrl = $('#input-api-url').value.trim();
  const agentToken = $('#input-token').value.trim();
  const pollIntervalMs = parseInt($('#input-poll').value) || 5000;

  const config = { apiBaseUrl, pollIntervalMs };
  if (agentToken) config.agentToken = agentToken;

  await window.api.saveConfig(config);
  settingsModal.classList.add('hidden');

  // Refresh state
  const state = await window.api.getState();
  updateUI(state);
});

$('#btn-install-update').addEventListener('click', () => {
  window.api.installUpdate();
});

// ============ TABS ============
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $(`#tab-${target}`).classList.add('active');
  });
});

// ============ HELPERS ============
function formatTime(date) {
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ START ============
init();

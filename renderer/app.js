/**
 * Renderer — UI logic
 * Communicates with main process via window.api (preload bridge)
 */

// ============ ELEMENTS ============
const $ = (sel) => document.querySelector(sel);
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const printedToday = $('#printed-today');
const lastPrint = $('#last-print');
const versionEl = $('#version');
const printList = $('#print-list');
const logList = $('#log-list');
const updateBanner = $('#update-banner');
const updateText = $('#update-text');
const settingsModal = $('#settings-modal');

// ============ INIT ============
async function init() {
  const state = await window.api.getState();
  updateUI(state);

  // Load config into settings form
  const config = await window.api.getConfig();
  $('#input-api-url').value = config.apiBaseUrl || '';
  $('#input-token').placeholder = config.agentToken || 'Plak je agent token hier';
  $('#input-poll').value = config.pollIntervalMs || 5000;
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

  // Status dot
  statusDot.className = `status-dot ${state.status}`;
  const statusLabels = {
    online: '🟢 Online — Luistert naar bestellingen',
    offline: '⚪ Offline — Niet verbonden',
    error: '🔴 Fout — Controleer instellingen',
  };
  statusText.textContent = statusLabels[state.status] || 'Onbekend';

  // Stats
  printedToday.textContent = state.printedToday || 0;
  if (state.lastPrint) {
    const time = new Date(state.lastPrint.time);
    lastPrint.textContent = `${state.lastPrint.orderNumber} (${formatTime(time)})`;
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

window.api.onPrintSuccess(({ orderNumber, printerName }) => {
  // Flash the status card green
  const card = $('#status-card');
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

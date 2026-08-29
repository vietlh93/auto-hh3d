// ============= DOM Elements =============
const statusBadge = document.getElementById('statusBadge');
const toggleAll = document.getElementById('toggleAll');
const workerCheckboxes = document.querySelectorAll('input[name="worker"]');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const logContainer = document.getElementById('logContainer');
const currentTime = document.getElementById('currentTime');
const domainText = document.getElementById('domainText');

const hh3dHostPattern = /(?:^|\.)hoathinh3d\.[a-z.]+$/i;
let tabGuardOverlay = null;

// Mining config elements
const mineTypeSelect = document.getElementById('mineType');
const mineSelect = document.getElementById('mineSelect');
const checkMinesBtn = document.getElementById('checkMinesBtn');
const mineHint = document.getElementById('mineHint');

// Mê Cung config elements
const mcMinPlayersSelect = document.getElementById('mcMinPlayers');
const mcRoleSelect = document.getElementById('mcRole');
const miningSection = document.getElementById('miningSection');
const mecungSection = document.getElementById('mecungSection');

// Luyện Đan config elements
const ldTargetTierSelect = document.getElementById('ldTargetTier');
const ldAutoDecomposeCheckbox = document.getElementById('ldAutoDecompose');
const ldDecomposeTierSelect = document.getElementById('ldDecomposeTier');
const ldDecomposeTierRow = document.getElementById('ldDecomposeTierRow');
const ldDecomposeStarsSelect = document.getElementById('ldDecomposeStars');
const ldDecomposeStarsRow = document.getElementById('ldDecomposeStarsRow');
const luyenDanSection = document.getElementById('luyenDanSection');

let isRunning = false;
let minesData = []; // Store loaded mines

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  updateTime();
  setInterval(updateTime, 1000);
  checkActiveTabAccess();

  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(checkActiveTabAccess);
  }

  if (chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) checkActiveTabAccess();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LOG') addLog(message.data.message, message.data.level);
    else if (message.type === 'STATUS_UPDATE') updateStatus(message.data.isRunning);
    else if (message.type === 'LOGS_CLEARED') {
      logContainer.innerHTML = '<p class="log-empty">Chưa có log nào...</p>';
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) {
      updateStatus(response.isRunning);
      if (response.logs) response.logs.forEach(log => addLog(log.message, log.level, false));
      if (response.detectedDomain) {
        domainText.textContent = response.detectedDomain;
        domainText.parentElement.classList.add('detected');
      }
    }
  });
});


async function checkActiveTabAccess() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isHH3D = isHH3DTab(tab);
    setTabGuardVisible(!isHH3D, tab?.url);
  } catch (e) {
    setTabGuardVisible(true);
  }
}

function isHH3DTab(tab) {
  if (!tab?.url) return false;

  try {
    return hh3dHostPattern.test(new URL(tab.url).hostname.toLowerCase());
  } catch (e) {
    return false;
  }
}

function setTabGuardVisible(visible, url = '') {
  if (!tabGuardOverlay) {
    tabGuardOverlay = document.createElement('div');
    tabGuardOverlay.className = 'tab-guard-overlay';
    tabGuardOverlay.innerHTML = `
      <div class="tab-guard-card">
        <div class="tab-guard-icon">🐉</div>
        <h2>Chỉ ghim UI trên hoathinh3d</h2>
        <p>Mở hoặc chuyển về tab hoathinh3d để dùng HH3D Auto Tool.</p>
        <small id="tabGuardUrl"></small>
      </div>
    `;
    document.body.appendChild(tabGuardOverlay);
  }

  const urlText = tabGuardOverlay.querySelector('#tabGuardUrl');
  if (urlText) urlText.textContent = url || '';
  tabGuardOverlay.classList.toggle('visible', visible);
}

function updateConfigSectionsVisibility() {
  const miningCb = Array.from(workerCheckboxes).find(cb => cb.value === 'mining');
  const meCungCb = Array.from(workerCheckboxes).find(cb => cb.value === 'meCung');
  const luyenDanCb = Array.from(workerCheckboxes).find(cb => cb.value === 'luyenDan');
  if (miningSection) miningSection.style.display = (miningCb && miningCb.checked) ? 'block' : 'none';
  if (mecungSection) mecungSection.style.display = (meCungCb && meCungCb.checked) ? 'block' : 'none';
  if (luyenDanSection) luyenDanSection.style.display = (luyenDanCb && luyenDanCb.checked) ? 'block' : 'none';
}

toggleAll.addEventListener('change', () => {
  workerCheckboxes.forEach(cb => cb.checked = toggleAll.checked);
  updateConfigSectionsVisibility();
  saveState();
});

workerCheckboxes.forEach(cb => cb.addEventListener('change', () => {
  toggleAll.checked = Array.from(workerCheckboxes).every(c => c.checked);
  updateConfigSectionsVisibility();
  saveState();
}));

// Mining config change handlers
mineTypeSelect.addEventListener('change', () => {
  // Reset dropdown khi đổi loại mỏ
  mineSelect.innerHTML = '<option value="">-- Bấm Check để load --</option>';
  mineSelect.disabled = true;
  mineHint.textContent = '💡 Bấm Check để xem danh sách mỏ';
  saveState();
});

mineSelect.addEventListener('change', saveState);

// Mê Cung config change handlers
mcMinPlayersSelect.addEventListener('change', saveState);
mcRoleSelect.addEventListener('change', saveState);

// Luyện Đan config change handlers
ldTargetTierSelect.addEventListener('change', saveState);
ldAutoDecomposeCheckbox.addEventListener('change', () => {
  const visible = ldAutoDecomposeCheckbox.checked ? 'flex' : 'none';
  ldDecomposeTierRow.style.display = visible;
  ldDecomposeStarsRow.style.display = visible;
  saveState();
});
ldDecomposeTierSelect.addEventListener('change', saveState);
ldDecomposeStarsSelect.addEventListener('change', saveState);

// Check Mines Button
checkMinesBtn.addEventListener('click', async () => {
  checkMinesBtn.disabled = true;
  checkMinesBtn.textContent = '⏳ Loading...';
  mineHint.textContent = '⏳ Đang tải danh sách mỏ...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LOAD_MINES',
      mineType: mineTypeSelect.value
    });

    if (response.success && response.mines) {
      minesData = response.mines;
      populateMineSelect(response.mines);
      mineHint.textContent = `✅ Đã tải ${response.mines.length} mỏ`;
      saveState(); // Lưu danh sách mỏ
    } else {
      mineHint.textContent = `❌ Lỗi: ${response.error || 'Không thể tải'}`;
      addLog(`❌ Load mines failed: ${response.error}`, 'error');
    }
  } catch (e) {
    mineHint.textContent = `❌ Lỗi: ${e.message}`;
    addLog(`❌ Load mines error: ${e.message}`, 'error');
  }

  checkMinesBtn.disabled = false;
  checkMinesBtn.textContent = '🔍 Check';
});

function populateMineSelect(mines) {
  mineSelect.innerHTML = '<option value="">-- Chọn mỏ --</option>';

  mines.forEach(mine => {
    const opt = document.createElement('option');
    opt.value = mine.id;
    const peaceful = mine.is_peaceful ? ' 🕊️' : '';
    opt.textContent = `${mine.name} (${mine.user_count}/${mine.max_users})${peaceful}`;
    mineSelect.appendChild(opt);
  });

  mineSelect.disabled = false;
}

startBtn.addEventListener('click', async () => {
  const selectedWorkers = Array.from(workerCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
  if (selectedWorkers.length === 0) { addLog('Vui lòng chọn ít nhất một worker!', 'warning'); return; }

  // Lấy mining config
  const miningConfig = {
    mineType: mineTypeSelect.value,
    mineId: mineSelect.value ? parseInt(mineSelect.value) : null
  };

  // Lấy Mê Cung config
  const mecungConfig = {
    minPlayers: mcMinPlayersSelect.value ? parseInt(mcMinPlayersSelect.value) : 5,
    role: mcRoleSelect.value || 'member'
  };

  // Lấy Luyện Đan config
  const luyenDanConfig = {
    targetTier: ldTargetTierSelect.value || 'auto',
    autoDecompose: ldAutoDecomposeCheckbox.checked,
    decomposeTier: ldDecomposeTierSelect.value || 'ha',
    decomposeStars: ldDecomposeStarsSelect.value || '1-2'
  };

  startBtn.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: 'START',
    workers: selectedWorkers,
    miningConfig: miningConfig,
    mecungConfig: mecungConfig,
    luyenDanConfig: luyenDanConfig
  });
  if (response.success) { updateStatus(true); }
  else addLog(`❌ Lỗi: ${response.error}`, 'error');
  startBtn.disabled = isRunning;
});

stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP' });
  updateStatus(false);
});

clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '<p class="log-empty">Chưa có log nào...</p>';
  chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
});

function updateStatus(running) {
  isRunning = running;
  statusBadge.classList.toggle('running', running);
  statusBadge.querySelector('.status-text').textContent = running ? 'Đang chạy' : 'Đang dừng';
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function addLog(message, level = 'info', scroll = true) {
  const empty = logContainer.querySelector('.log-empty');
  if (empty) empty.remove();

  const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
  logContainer.appendChild(entry);
  if (scroll) logContainer.scrollTop = logContainer.scrollHeight;
  while (logContainer.children.length > 100) logContainer.removeChild(logContainer.firstChild);
}

function updateTime() {
  currentTime.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function saveState() {
  const state = {
    workers: {},
    miningConfig: {
      mineType: mineTypeSelect.value,
      mineId: mineSelect.value
    },
    mecungConfig: {
      minPlayers: mcMinPlayersSelect.value,
      role: mcRoleSelect.value
    },
    luyenDanConfig: {
      targetTier: ldTargetTierSelect.value,
      autoDecompose: ldAutoDecomposeCheckbox.checked,
      decomposeTier: ldDecomposeTierSelect.value,
      decomposeStars: ldDecomposeStarsSelect.value
    },
    // Lưu danh sách mỏ đã load
    minesData: minesData
  };
  workerCheckboxes.forEach(cb => state.workers[cb.value] = cb.checked);
  chrome.storage.local.set({ popupState: state });
}

function loadState() {
  chrome.storage.local.get(['popupState'], (result) => {
    if (result.popupState) {
      // Load workers
      if (result.popupState.workers) {
        workerCheckboxes.forEach(cb => {
          if (result.popupState.workers[cb.value] !== undefined) cb.checked = result.popupState.workers[cb.value];
        });
        toggleAll.checked = Array.from(workerCheckboxes).every(c => c.checked);
      }

      // Load mining config
      if (result.popupState.miningConfig) {
        // Set mine type first
        if (result.popupState.miningConfig.mineType) {
          mineTypeSelect.value = result.popupState.miningConfig.mineType;
        }

        // Khôi phục danh sách mỏ đã load trước đó
        if (result.popupState.minesData && result.popupState.minesData.length > 0) {
          minesData = result.popupState.minesData;
          populateMineSelect(minesData);

          // Khôi phục mỏ đã chọn
          if (result.popupState.miningConfig.mineId) {
            mineSelect.value = result.popupState.miningConfig.mineId;
          }

          mineHint.textContent = `📦 Đã khôi phục ${minesData.length} mỏ từ lần trước`;
        }
      }

      // Load Mê Cung config
      if (result.popupState.mecungConfig) {
        if (result.popupState.mecungConfig.minPlayers) {
          mcMinPlayersSelect.value = result.popupState.mecungConfig.minPlayers;
        }
        if (result.popupState.mecungConfig.role) {
          mcRoleSelect.value = result.popupState.mecungConfig.role;
        }
      }

      // Load Luyện Đan config
      if (result.popupState.luyenDanConfig) {
        if (result.popupState.luyenDanConfig.targetTier) {
          ldTargetTierSelect.value = result.popupState.luyenDanConfig.targetTier;
        }
        if (result.popupState.luyenDanConfig.autoDecompose !== undefined) {
          ldAutoDecomposeCheckbox.checked = result.popupState.luyenDanConfig.autoDecompose;
          const visible = ldAutoDecomposeCheckbox.checked ? 'flex' : 'none';
          ldDecomposeTierRow.style.display = visible;
          ldDecomposeStarsRow.style.display = visible;
        }
        if (result.popupState.luyenDanConfig.decomposeTier) {
          ldDecomposeTierSelect.value = result.popupState.luyenDanConfig.decomposeTier;
        }
        if (result.popupState.luyenDanConfig.decomposeStars) {
          ldDecomposeStarsSelect.value = result.popupState.luyenDanConfig.decomposeStars;
        }
      }

      updateConfigSectionsVisibility();
    } else {
      updateConfigSectionsVisibility();
    }
  });
}

// ============= DOM Elements =============
const statusBadge = document.getElementById('statusBadge');
const toggleAll = document.getElementById('toggleAll');
const workerCheckboxes = document.querySelectorAll('input[name="worker"]');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const logContainer = document.getElementById('logContainer');
const currentTime = document.getElementById('currentTime');

// Mining config elements
const mineTypeSelect = document.getElementById('mineType');
const mineSelect = document.getElementById('mineSelect');
const checkMinesBtn = document.getElementById('checkMinesBtn');
const mineHint = document.getElementById('mineHint');

let isRunning = false;
let minesData = []; // Store loaded mines

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  updateTime();
  setInterval(updateTime, 1000);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LOG') addLog(message.data.message, message.data.level);
    else if (message.type === 'STATUS_UPDATE') updateStatus(message.data.isRunning);
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) {
      updateStatus(response.isRunning);
      if (response.logs) response.logs.forEach(log => addLog(log.message, log.level, false));
    }
  });
});


toggleAll.addEventListener('change', () => {
  workerCheckboxes.forEach(cb => cb.checked = toggleAll.checked);
  saveState();
});

workerCheckboxes.forEach(cb => cb.addEventListener('change', () => {
  toggleAll.checked = Array.from(workerCheckboxes).every(c => c.checked);
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

  startBtn.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: 'START',
    workers: selectedWorkers,
    miningConfig: miningConfig
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
    }
  });
}

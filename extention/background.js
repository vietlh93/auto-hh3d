// Background service worker - Handles communication and script injection
// V4 - Added keep-alive mechanism and state persistence

const KEEP_ALIVE_ALARM = 'keep-alive-alarm';
const KEEP_ALIVE_INTERVAL = 0.4; // 24 seconds (less than 30s timeout)

let isRunning = false;
let logs = [];

// ============= KEEP-ALIVE MECHANISM =============
// Set up alarm to keep service worker alive
async function setupKeepAlive() {
    try {
        await chrome.alarms.create(KEEP_ALIVE_ALARM, {
            periodInMinutes: KEEP_ALIVE_INTERVAL
        });
        console.log('✅ Keep-alive alarm created');
    } catch (e) {
        console.error('Failed to create keep-alive alarm:', e);
    }
}

// Listen for alarm to keep service worker active
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM) {
        console.log('⏰ Keep-alive ping at', new Date().toLocaleTimeString());
        // Touch storage to keep service worker active
        chrome.storage.local.get(['lastPing'], () => {
            chrome.storage.local.set({ lastPing: Date.now() });
        });
    }
});

// ============= STATE PERSISTENCE =============
// Save state to storage
async function saveState() {
    try {
        await chrome.storage.local.set({
            isRunning: isRunning,
            logs: logs.slice(-100) // Save last 100 logs
        });
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

// Load state from storage
async function loadState() {
    try {
        const result = await chrome.storage.local.get(['isRunning', 'logs']);
        if (result.isRunning !== undefined) {
            isRunning = result.isRunning;
        }
        if (result.logs) {
            logs = result.logs;
        }
        console.log('📦 State loaded: isRunning =', isRunning, ', logs count =', logs.length);
    } catch (e) {
        console.error('Failed to load state:', e);
    }
}

// ============= LOGGING =============
function addLog(message, level = 'info') {
    const logEntry = { message, level, time: Date.now() };
    logs.push(logEntry);
    if (logs.length > 200) logs.shift();

    // Save logs periodically
    saveState();

    chrome.runtime.sendMessage({ type: 'LOG', data: logEntry }).catch(() => { });
    console.log(`[${level}] ${message}`);
}

// Helper function to find HH3D tabs (supports any TLD)
async function findHH3DTabs() {
    const allTabs = await chrome.tabs.query({});
    return allTabs.filter(tab => tab.url && tab.url.includes('hoathinh3d.'));
}

// Check if content script is ready (no injection - rely on manifest only)
async function checkContentScript(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }).catch(() => null);
        return response?.pong === true;
    } catch (e) {
        return false;
    }
}

// Notify content script about running state (for reconnection)
async function notifyContentScriptState() {
    if (!isRunning) return;

    try {
        const hh3dTabs = await findHH3DTabs();
        for (const tab of hh3dTabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'STATE_SYNC',
                    isRunning: isRunning
                }, { frameId: 0 });
            } catch (e) {
                // Tab might not have content script ready
            }
        }
    } catch (e) {
        console.error('Failed to notify content scripts:', e);
    }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received:", message.type);

    (async () => {
        switch (message.type) {
            case 'LOG':
                // Just save to logs array - popup receives LOG directly from content script
                logs.push(message.data);
                if (logs.length > 200) logs.shift();
                saveState(); // Persist logs
                // DO NOT forward - popup already receives this message directly!
                sendResponse({ success: true });
                break;

            case 'GET_STATUS':
                // Return persisted state
                sendResponse({ isRunning, logs: logs.slice(-50) });
                break;

            case 'HEARTBEAT':
                // Content script checking if background is alive
                sendResponse({ alive: true, isRunning: isRunning });
                break;

            case 'START':
                try {
                    const hh3dTabs = await findHH3DTabs();

                    if (hh3dTabs.length === 0) {
                        addLog("❌ Hãy mở tab hoathinh3d trước!", "error");
                        sendResponse({ success: false, error: 'Hãy mở tab hoathinh3d trước!' });
                        return;
                    }

                    const tabId = hh3dTabs[0].id;

                    // Check if content script is ready
                    const scriptReady = await checkContentScript(tabId);
                    if (!scriptReady) {
                        addLog("❌ Hãy refresh tab hoathinh3d rồi thử lại!", "error");
                        sendResponse({ success: false, error: 'Refresh tab hoathinh3d và thử lại!' });
                        return;
                    }

                    addLog("🚀 Đang khởi động...", "info");

                    // Send START message to content script (main frame only)
                    try {
                        const response = await chrome.tabs.sendMessage(tabId, {
                            type: 'START',
                            workers: message.workers,
                            miningConfig: message.miningConfig
                        }, { frameId: 0 }); // frameId: 0 = main frame only

                        if (response?.success) {
                            isRunning = true;
                            await saveState(); // Persist running state
                            chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: { isRunning: true } }).catch(() => { });
                            sendResponse({ success: true });
                        } else {
                            addLog(`❌ ${response?.error || 'Lỗi không xác định'}`, "error");
                            sendResponse({ success: false, error: response?.error || 'Unknown error' });
                        }
                    } catch (e) {
                        addLog(`❌ Lỗi kết nối: ${e.message}. Hãy refresh tab hoathinh3d!`, "error");
                        sendResponse({ success: false, error: `${e.message}. Refresh tab và thử lại!` });
                    }
                } catch (e) {
                    addLog(`❌ ${e.message}`, "error");
                    sendResponse({ success: false, error: e.message });
                }
                break;

            case 'STOP':
                try {
                    const hh3dTabs = await findHH3DTabs();
                    if (hh3dTabs.length > 0) {
                        chrome.tabs.sendMessage(hh3dTabs[0].id, { type: 'STOP' }, { frameId: 0 }).catch(() => { });
                    }
                    isRunning = false;
                    await saveState(); // Persist stopped state
                    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: { isRunning: false } }).catch(() => { });
                    sendResponse({ success: true });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;

            case 'WORKER_STOPPED':
                // Content script notified that it stopped (e.g., page reload)
                // But keep isRunning as true so we can resume
                addLog("⚠️ Worker đã dừng (có thể do refresh tab)", "warning");
                sendResponse({ success: true });
                break;

            case 'CLEAR_LOGS':
                logs = [];
                await saveState();
                sendResponse({ success: true });
                break;

            case 'LOAD_MINES':
                try {
                    const hh3dTabs = await findHH3DTabs();
                    if (hh3dTabs.length === 0) {
                        sendResponse({ success: false, error: 'Không tìm thấy tab hoathinh3d' });
                        break;
                    }

                    const tabId = hh3dTabs[0].id;
                    const response = await chrome.tabs.sendMessage(tabId, {
                        type: 'LOAD_MINES',
                        mineType: message.mineType
                    }, { frameId: 0 });

                    sendResponse(response);
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;

            default:
                sendResponse({ error: 'Unknown message type' });
        }
    })();

    return true;
});

// Listen for tab updates to notify content script about state
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('hoathinh3d.')) {
        console.log("HH3D tab loaded, content script will be auto-injected by manifest");

        // Wait a bit for content script to initialize
        setTimeout(async () => {
            if (isRunning) {
                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: 'STATE_SYNC',
                        isRunning: true
                    }, { frameId: 0 });
                    addLog("🔄 Tab mới - đồng bộ trạng thái running", "info");
                } catch (e) {
                    // Content script not ready yet
                }
            }
        }, 2000);
    }
});

// ============= INITIALIZATION =============
async function initialize() {
    console.log("🐉 HH3D Auto Tool - Background Service Worker loaded (v4 - keep-alive)");

    // Load persisted state
    await loadState();

    // Setup keep-alive alarm
    await setupKeepAlive();

    // If was running before service worker restart, notify content scripts
    if (isRunning) {
        console.log("🔄 Resuming from previous running state");
        setTimeout(() => notifyContentScriptState(), 1000);
    }
}

// Run initialization
initialize();

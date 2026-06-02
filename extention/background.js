// Background service worker - Handles communication and script injection
// V5 - Auto-detect domain + dynamic content script injection

const KEEP_ALIVE_ALARM = 'keep-alive-alarm';
const KEEP_ALIVE_INTERVAL = 0.4; // 24 seconds (less than 30s timeout)

let isRunning = false;
let logs = [];
let detectedDomain = null; // Tự động phát hiện domain hiện tại

// ============= DOMAIN AUTO-DETECTION =============
// Kiểm tra URL có phải hoathinh3d hay không (bất kỳ TLD nào)
function isHH3DUrl(url) {
    if (!url) return false;
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        // Match: hoathinh3d.xxx hoặc www.hoathinh3d.xxx hoặc sub.hoathinh3d.xxx
        return /(?:^|\.)hoathinh3d\.[a-z.]+$/i.test(hostname);
    } catch (e) {
        return false;
    }
}

// Lưu domain đã phát hiện vào storage
async function saveDetectedDomain(domain) {
    detectedDomain = domain;
    try {
        await chrome.storage.local.set({ detectedDomain: domain, domainDetectedAt: Date.now() });
        console.log(`🌐 Domain đã phát hiện và lưu: ${domain}`);
    } catch (e) {
        console.error('Failed to save detected domain:', e);
    }
}

// Load domain từ storage
async function loadDetectedDomain() {
    try {
        const result = await chrome.storage.local.get(['detectedDomain']);
        if (result.detectedDomain) {
            detectedDomain = result.detectedDomain;
            console.log(`🌐 Domain đã load từ storage: ${detectedDomain}`);
        }
    } catch (e) {
        console.error('Failed to load detected domain:', e);
    }
}

// Set lưu các tab đã inject
const injectedTabs = new Set();

// Inject content script vào tab
async function injectContentScript(tabId) {
    if (injectedTabs.has(tabId)) {
        console.log(`📜 Tab ${tabId} đã được inject, bỏ qua`);
        return true;
    }

    try {
        // Kiểm tra xem content script đã chạy chưa (qua PING)
        try {
            const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 });
            if (response?.pong === true) {
                injectedTabs.add(tabId);
                console.log(`📜 Tab ${tabId} đã có content script (responded to PING)`);
                return true;
            }
        } catch (e) {
            // Content script chưa có, tiến hành inject
        }

        // Inject inject.js vào MAIN world trước để tránh lỗi CSP khi tự load từ content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: false },
            files: ['inject.js'],
            world: 'MAIN'
        });

        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: false },
            files: ['content.js']
        });

        injectedTabs.add(tabId);
        console.log(`✅ Đã inject inject.js (MAIN) và content.js vào tab ${tabId}`);
        return true;
    } catch (e) {
        console.error(`❌ Inject failed cho tab ${tabId}:`, e.message);
        return false;
    }
}

// Xóa tab khỏi injected set khi tab đóng
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
});

// ============= KEEP-ALIVE MECHANISM =============
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

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM) {
        console.log('⏰ Keep-alive ping at', new Date().toLocaleTimeString());
        chrome.storage.local.get(['lastPing'], () => {
            chrome.storage.local.set({ lastPing: Date.now() });
        });
    }
});

// ============= STATE PERSISTENCE =============
async function saveState() {
    try {
        await chrome.storage.local.set({
            isRunning: isRunning,
            logs: logs.slice(-100)
        });
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

async function saveWorkerConfig(workers, miningConfig, mecungConfig) {
    try {
        await chrome.storage.local.set({
            savedWorkers: workers,
            savedMiningConfig: miningConfig,
            savedMecungConfig: mecungConfig,
            savedAt: Date.now()
        });
        console.log('💾 Worker config saved by background');
    } catch (e) {
        console.error('Failed to save worker config:', e);
    }
}

async function clearWorkerConfig() {
    try {
        await chrome.storage.local.remove(['savedWorkers', 'savedMiningConfig', 'savedMecungConfig', 'savedAt']);
        console.log('🗑️ Worker config cleared by background');
    } catch (e) {
        console.error('Failed to clear worker config:', e);
    }
}

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
    saveState();
    chrome.runtime.sendMessage({ type: 'LOG', data: logEntry }).catch(() => { });
    console.log(`[${level}] ${message}`);
}

// Helper function to find HH3D tabs (supports any TLD - dynamic detection)
async function findHH3DTabs() {
    const allTabs = await chrome.tabs.query({});
    return allTabs.filter(tab => tab.url && isHH3DUrl(tab.url));
}

// Check if content script is ready
async function checkContentScript(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }).catch(() => null);
        return response?.pong === true;
    } catch (e) {
        return false;
    }
}

// Notify content script about running state
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
                logs.push(message.data);
                if (logs.length > 200) logs.shift();
                saveState();
                sendResponse({ success: true });
                break;

            case 'GET_STATUS':
                // Trả về cả domain đang phát hiện
                const hh3dTabs = await findHH3DTabs();
                const currentDomain = hh3dTabs.length > 0 ? new URL(hh3dTabs[0].url).hostname : detectedDomain;
                sendResponse({
                    isRunning,
                    logs: logs.slice(-50),
                    detectedDomain: currentDomain
                });
                break;

            case 'HEARTBEAT':
                sendResponse({ alive: true, isRunning: isRunning });
                break;

            case 'START':
                try {
                    const tabs = await findHH3DTabs();

                    if (tabs.length === 0) {
                        addLog("❌ Hãy mở tab hoathinh3d trước!", "error");
                        sendResponse({ success: false, error: 'Hãy mở tab hoathinh3d trước!' });
                        return;
                    }

                    const tabId = tabs[0].id;

                    // Lưu domain đã phát hiện
                    const tabDomain = new URL(tabs[0].url).origin;
                    await saveDetectedDomain(tabDomain);
                    addLog(`🌐 Domain phát hiện: ${tabDomain}`, "info");

                    // Inject content script nếu chưa có
                    const injected = await injectContentScript(tabId);
                    if (!injected) {
                        addLog("❌ Không thể inject content script!", "error");
                        sendResponse({ success: false, error: 'Không thể inject content script!' });
                        return;
                    }

                    // Đợi content script sẵn sàng
                    let scriptReady = false;
                    for (let i = 0; i < 5; i++) {
                        scriptReady = await checkContentScript(tabId);
                        if (scriptReady) break;
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    if (!scriptReady) {
                        addLog("❌ Content script chưa sẵn sàng. Hãy refresh tab!", "error");
                        sendResponse({ success: false, error: 'Refresh tab hoathinh3d và thử lại!' });
                        return;
                    }

                    addLog("🚀 Đang khởi động...", "info");

                    try {
                        const response = await chrome.tabs.sendMessage(tabId, {
                            type: 'START',
                            workers: message.workers,
                            miningConfig: message.miningConfig,
                            mecungConfig: message.mecungConfig
                        }, { frameId: 0 });

                        if (response?.success) {
                            isRunning = true;
                            await saveState();
                            await saveWorkerConfig(message.workers, message.miningConfig, message.mecungConfig);
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
                    const stopTabs = await findHH3DTabs();
                    if (stopTabs.length > 0) {
                        chrome.tabs.sendMessage(stopTabs[0].id, { type: 'STOP' }, { frameId: 0 }).catch(() => { });
                    }
                    isRunning = false;
                    await saveState();
                    await clearWorkerConfig();
                    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: { isRunning: false } }).catch(() => { });
                    sendResponse({ success: true });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;

            case 'WORKER_STOPPED':
                addLog("⚠️ Worker đã dừng (có thể do refresh tab)", "warning");
                sendResponse({ success: true });
                break;

            case 'CLEAR_LOGS':
                logs = [];
                await saveState();
                sendResponse({ success: true });
                break;

            case 'WORKER_RESUMED':
                addLog("✅ Workers đã tự động resume thành công", "success");
                sendResponse({ success: true });
                break;

            case 'LOAD_MINES':
                try {
                    const mineTabs = await findHH3DTabs();
                    if (mineTabs.length === 0) {
                        sendResponse({ success: false, error: 'Không tìm thấy tab hoathinh3d' });
                        break;
                    }

                    const mineTabId = mineTabs[0].id;

                    // Inject nếu cần
                    await injectContentScript(mineTabId);

                    const response = await chrome.tabs.sendMessage(mineTabId, {
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

// ============= TAB MONITORING - Auto inject khi phát hiện HH3D tab =============
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Chỉ xử lý khi tab load xong
    if (changeInfo.status !== 'complete') return;

    if (tab.url && isHH3DUrl(tab.url)) {
        console.log(`🌐 Phát hiện HH3D tab: ${tab.url}`);

        // Lưu domain mới
        const domain = new URL(tab.url).origin;
        await saveDetectedDomain(domain);

        // Reset injection flag cho tab này (vì trang vừa reload)
        injectedTabs.delete(tabId);

        // Inject content script
        setTimeout(async () => {
            const injected = await injectContentScript(tabId);

            if (injected && isRunning) {
                // Đợi thêm cho content script khởi tạo xong
                setTimeout(async () => {
                    try {
                        await chrome.tabs.sendMessage(tabId, {
                            type: 'STATE_SYNC',
                            isRunning: true
                        }, { frameId: 0 });
                        addLog("🔄 Tab mới - đồng bộ trạng thái running", "info");
                    } catch (e) {
                        // Content script not ready yet
                    }
                }, 2000);
            }
        }, 1000); // Đợi 1s sau khi trang load xong
    }
});

// ============= INITIALIZATION =============
async function initialize() {
    console.log("🐉 HH3D Auto Tool - Background Service Worker loaded (v5 - auto-detect domain)");

    // Load persisted state
    await loadState();
    await loadDetectedDomain();

    // Setup keep-alive alarm
    await setupKeepAlive();

    // Scan tất cả tab hiện tại để inject content script
    try {
        const allTabs = await chrome.tabs.query({});
        for (const tab of allTabs) {
            if (tab.url && isHH3DUrl(tab.url)) {
                console.log(`🌐 Found existing HH3D tab: ${tab.url}`);
                await saveDetectedDomain(new URL(tab.url).origin);
                // Inject content script
                await injectContentScript(tab.id);
            }
        }
    } catch (e) {
        console.error('Error scanning tabs:', e);
    }

    // If was running before, notify content scripts
    if (isRunning) {
        console.log("🔄 Resuming from previous running state");
        setTimeout(() => notifyContentScriptState(), 2000);
    }
}

// Run initialization
initialize();

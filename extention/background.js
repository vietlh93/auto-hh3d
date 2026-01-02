// Background service worker - Handles communication and script injection
let isRunning = false;
let logs = [];

function addLog(message, level = 'info') {
    const logEntry = { message, level, time: Date.now() };
    logs.push(logEntry);
    if (logs.length > 200) logs.shift();
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

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received:", message.type);

    (async () => {
        switch (message.type) {
            case 'LOG':
                // Just save to logs array - popup receives LOG directly from content script
                logs.push(message.data);
                if (logs.length > 200) logs.shift();
                // DO NOT forward - popup already receives this message directly!
                sendResponse({ success: true });
                break;

            case 'GET_STATUS':
                sendResponse({ isRunning, logs: logs.slice(-50) });
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
                    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: { isRunning: false } }).catch(() => { });
                    sendResponse({ success: true });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;

            case 'CLEAR_LOGS':
                logs = [];
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

// Listen for tab updates to re-inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('hoathinh3d.')) {
        console.log("HH3D tab loaded, content script will be auto-injected by manifest");
    }
});

console.log("HH3D Auto Tool - Background Service Worker loaded (v3)");

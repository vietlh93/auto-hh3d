// Content script for hoathinh3d.gg - Runs in page context with cookies

// Only run in main frame, not iframes
if (window !== window.top) {
    console.log('🐉 HH3D - Skipping iframe');
} else if (window.__HH3D_INITIALIZED__) {
    // Prevent duplicate script loading and initialization
    console.log('🐉 HH3D Auto Tool - Already initialized, skipping...');
} else {
    window.__HH3D_INITIALIZED__ = true;
    window.__pageLoadDate = new Date().toDateString();
    console.log('🐉 HH3D Auto Tool - Content Script loaded');

    const CONFIG = {
        baseUrl: window.location.origin, // Tự động lấy domain hiện tại
        endpoints: {
            api: "/wp-content/themes/halimmovies-child/hh3d-ajax.php",
            tongMon: "/wp-json/tong-mon/v1",
            daily: "/wp-json/hh3d/v1/action",
            spin: "/wp-json/lottery/v1/",
            claimboss: "/wp-admin/admin-ajax.php",
            luanVo: "/wp-json/luan-vo/v1"
        },
        pages: {
            chest: "/phuc-loi-duong",
            boss: "/hoang-vuc",
            wp: "/bi-canh-tong-mon",
            mining: "/khoang-mach",
            missions: "/nhiem-vu-hang-ngay"
        },
        nonces: {
            chest: null,
            boss: null,
            wp: null,
            restNonce: null,
            securityToken: null,
            userid: null,
            lotterySpin: null,
            bossAttackToken: null,
            bossAttackAction: null,
            bossGetAction: null,
            bossTimerAction: null,
            chestTimerAction: null,
            chestOpenAction: null,
            tltmTimerAction: null,
            tltmAttackAction: null,
            dailyRewardAction: null,
            securityTokenMiner: null,
            mining: null,
            enterMine: null,
            claimMine: null,
            getUsersMine: null
        },
        miningConfig: {
            mineId: null,
            mineType: null
        },
        mecungConfig: {
            minPlayers: 5,
            role: "member"
        },
        luyenDanConfig: {
            targetTier: "auto",
            autoDecompose: false,
            decomposeTier: "ha",
            decomposeStars: "1-2"
        },
        delays: { error: 8000, success: 4000, check: 3000, minRequestGap: 6000 },
        heartbeat: { interval: 20000, maxMissed: 3 } // 20s interval, max 3 missed
    };

    let isRunning = false;
    const tabInstanceId = Math.random().toString(16).slice(2);
    let currentSessionId = 0; // New: Unique ID for each start session
    let workers = [];
    let activeWorkerNames = []; // Store worker names for resume
    let savedMiningConfig = null; // Store mining config for resume
    let savedMecungConfig = null; // Store Mê Cung config for resume
    let savedLuyenDanConfig = null; // Store Luyện Đan config for resume
    let heartbeatTimer = null;
    let missedHeartbeats = 0;
    let nextRequestTime = Date.now();
    let isResuming = false; // Flag to prevent double resume
    let forceSpinCheck = false; // Flag to interrupt spin sleep when milestone 2 is claimed

    // ============= UTILITIES =============
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const getMsUntilMidnight = () => {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        return midnight - now;
    };
    const parseTime = (timeStr) => {
        if (!timeStr || timeStr === "00:00") return 0;
        const [m, s] = timeStr.split(":").map(Number);
        return (m * 60 + s) * 1000;
    };
    const genRequestId = () => `req_${Math.random().toString(16).slice(2)}_${Date.now()}`;

    // ============= DAILY COMPLETION TRACKING =============
    // Lưu trạng thái hoàn thành trong ngày để resume không chạy lại worker đã xong
    const getTodayKey = () => {
        const d = new Date();
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    };

    const isNearMidnight = () => {
        const now = new Date();
        return now.getHours() === 0 && now.getMinutes() < 15;
    };

    async function markWorkerDone(workerName) {
        if (!isExtensionValid()) {
            isRunning = false;
            return;
        }
        try {
            const result = await chrome.storage.local.get(['dailyCompletion']);
            const completion = result.dailyCompletion || {};
            const today = getTodayKey();
            completion[workerName] = {
                date: today,
                timestamp: Date.now()
            };
            // Xóa dữ liệu cũ của ngày khác
            for (const key of Object.keys(completion)) {
                if (completion[key] && completion[key].date !== today) {
                    delete completion[key];
                }
            }
            await chrome.storage.local.set({ dailyCompletion: completion });
            console.log(`✅ Đã đánh dấu ${workerName} hoàn thành ngày ${today}`);
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
                return;
            }
            console.error('markWorkerDone error:', e);
        }
    }

    async function clearWorkerDone(workerName) {
        if (!isExtensionValid()) {
            isRunning = false;
            return;
        }
        try {
            const result = await chrome.storage.local.get(['dailyCompletion']);
            const completion = result.dailyCompletion || {};
            if (completion[workerName]) {
                delete completion[workerName];
                await chrome.storage.local.set({ dailyCompletion: completion });
                console.log(`🗑️ Đã xóa đánh dấu hoàn thành của ${workerName}`);
            }
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
            }
        }
    }

    async function isWorkerDone(workerName) {
        if (!isExtensionValid()) {
            isRunning = false;
            return false;
        }
        try {
            const result = await chrome.storage.local.get(['dailyCompletion']);
            const completion = result.dailyCompletion || {};
            const today = getTodayKey();
            const data = completion[workerName];
            return !!(data && data.date === today);
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
            }
            return false;
        }
    }

    async function getDoneWorkers() {
        if (!isExtensionValid()) {
            isRunning = false;
            return [];
        }
        try {
            const result = await chrome.storage.local.get(['dailyCompletion']);
            const completion = result.dailyCompletion || {};
            const today = getTodayKey();
            const done = [];
            for (const [name, val] of Object.entries(completion)) {
                if (val && val.date === today) {
                    done.push(name);
                }
            }
            return done;
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
            }
            return [];
        }
    }

    function decryptHh3dActions(html) {
        if (!html) return null;
        const matchK = html.match(/[,\s]k\s*=\s*["'](\d+)["']/);
        const matchD = html.match(/[,\s]d\s*=\s*["']([A-Za-z0-9+/=]{100,})["']/);
        if (!matchK || !matchD) return null;

        try {
            const k = matchK[1];
            const d = matchD[1];
            const b = atob(d);
            let r = "";
            for (let i = 0; i < b.length; i++) {
                r += String.fromCharCode(b.charCodeAt(i) ^ k.charCodeAt(i % k.length));
            }
            return JSON.parse(r);
        } catch (e) {
            console.error("Failed to decrypt hh3d actions:", e);
            return null;
        }
    }

    // Helper to execute code in the page context via inject.js
    function runInPage(codeStr, argVal) {
        return new Promise((resolve, reject) => {
            const id = `eval_${Math.random().toString(16).slice(2)}_${Date.now()}`;
            const handler = (e) => {
                if (e.data && e.data.type === '__hh3d_eval_res__' && e.data.id === id) {
                    window.removeEventListener('message', handler);
                    if (e.data.success) {
                        resolve(e.data.payload);
                    } else {
                        reject(new Error(e.data.error));
                    }
                }
            };
            window.addEventListener('message', handler);
            window.postMessage({ type: '__hh3d_eval__', id: id, code: codeStr, arg: argVal }, '*');
            
            // Timeout fallback
            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(null);
            }, 6000);
        });
    }

    // ============= INJECT SCRIPT ĐỌC hh3dData TỪ MAIN WORLD =============
    function injectAndReadHh3dData() {
        return new Promise((resolve) => {
            // Lắng nghe postMessage từ inject.js
            const handler = (e) => {
                if (e.data && e.data.type === '__hh3d_bridge__') {
                    window.removeEventListener('message', handler);
                    resolve(e.data.payload || {});
                }
            };
            window.addEventListener('message', handler);

            // Load inject.js từ extension URL (bypass CSP)
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('inject.js');
            script.onload = () => script.remove();
            script.onerror = () => {
                window.removeEventListener('message', handler);
                resolve({});
            };
            document.documentElement.appendChild(script);

            // Timeout fallback
            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve({});
            }, 3000);
        });
    }

    // Kiểm tra extension context còn hợp lệ
    function isExtensionValid() {
        try {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return false;
            // Gọi getManifest() để kích hoạt lỗi nếu context đã bị vô hiệu hóa (invalidated)
            chrome.runtime.getManifest();
            return true;
        } catch (e) {
            return false;
        }
    }

    // Safe sendMessage wrapper
    function safeSendMessage(message) {
        if (!isExtensionValid()) return;
        try {
            chrome.runtime.sendMessage(message).catch(() => { });
        } catch (e) {
            // Silently ignore - extension context is invalid
        }
    }

    function log(message, level = 'info') {
        console.log(`[${level.toUpperCase()}] ${message}`);
        safeSendMessage({ type: 'LOG', data: { message, level } });
    }

    // ============= WORKER CONFIG PERSISTENCE =============
    // Save worker config to storage for resume capability
    async function saveWorkerConfig(workerNames, miningConfig, mecungConfig, luyenDanConfig) {
        if (!isExtensionValid()) {
            isRunning = false;
            return;
        }
        try {
            await chrome.storage.local.set({
                savedWorkers: workerNames,
                savedMiningConfig: miningConfig,
                savedMecungConfig: mecungConfig,
                savedLuyenDanConfig: luyenDanConfig,
                savedAt: Date.now()
            });
            console.log('💾 Worker config saved to storage');
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
                return;
            }
            console.error('Failed to save worker config:', e);
        }
    }

    // Clear worker config from storage
    async function clearWorkerConfig() {
        if (!isExtensionValid()) {
            isRunning = false;
            return;
        }
        try {
            await chrome.storage.local.remove(['savedWorkers', 'savedMiningConfig', 'savedMecungConfig', 'savedLuyenDanConfig', 'savedAt']);
            console.log('🗑️ Worker config cleared from storage');
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
                return;
            }
            console.error('Failed to clear worker config:', e);
        }
    }

    // Load worker config from storage
    async function loadWorkerConfig() {
        if (!isExtensionValid()) {
            isRunning = false;
            return null;
        }
        try {
            const result = await chrome.storage.local.get(['savedWorkers', 'savedMiningConfig', 'savedMecungConfig', 'savedLuyenDanConfig', 'savedAt', 'popupState']);

            // First try: Load from savedWorkers (set by START command)
            if (result.savedWorkers && result.savedWorkers.length > 0) {
                console.log('📦 Loading config from savedWorkers');
                return {
                    workers: result.savedWorkers,
                    miningConfig: result.savedMiningConfig,
                    mecungConfig: result.savedMecungConfig,
                    luyenDanConfig: result.savedLuyenDanConfig
                };
            }

            // Fallback: Load from popupState (checkbox selections in popup)
            if (result.popupState && result.popupState.workers) {
                const selectedWorkers = Object.entries(result.popupState.workers)
                    .filter(([key, value]) => value === true)
                    .map(([key, value]) => key);

                if (selectedWorkers.length > 0) {
                    console.log('📦 Loading config from popupState (fallback)');

                    // Build mining config from popupState
                    let miningConfig = null;
                    if (result.popupState.miningConfig) {
                        miningConfig = {
                            mineType: result.popupState.miningConfig.mineType || 'silver',
                            mineId: result.popupState.miningConfig.mineId ? parseInt(result.popupState.miningConfig.mineId) : null
                        };
                    }

                    // Build mecung config from popupState
                    let mecungConfig = null;
                    if (result.popupState.mecungConfig) {
                        mecungConfig = {
                            minPlayers: result.popupState.mecungConfig.minPlayers ? parseInt(result.popupState.mecungConfig.minPlayers) : 5,
                            role: result.popupState.mecungConfig.role || 'member'
                        };
                    }

                    // Build luyenDan config from popupState
                    let luyenDanConfig = null;
                    if (result.popupState.luyenDanConfig) {
                        luyenDanConfig = {
                            targetTier: result.popupState.luyenDanConfig.targetTier || 'auto',
                            autoDecompose: !!result.popupState.luyenDanConfig.autoDecompose,
                            decomposeTier: result.popupState.luyenDanConfig.decomposeTier || 'ha'
                        };
                    }

                    return {
                        workers: selectedWorkers,
                        miningConfig: miningConfig,
                        mecungConfig: mecungConfig,
                        luyenDanConfig: luyenDanConfig
                    };
                }
            }

            return null;
        } catch (e) {
            if (e.message && e.message.includes('invalidated')) {
                isRunning = false;
                return null;
            }
            console.error('Failed to load worker config:', e);
            return null;
        }
    }

    // Resume workers from saved config
    async function resumeWorkers(force = false) {
        if ((isRunning || isResuming) && !force) {
            console.log('⚠️ Already running or resuming, skip resume');
            return false;
        }

        const todayString = new Date().toDateString();
        if (window.__pageLoadDate && window.__pageLoadDate !== todayString) {
            log("📅 Trang game được tải từ ngày cũ. Đang tự động tải lại trang để tránh dữ liệu lỗi...", "warning");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
            return false;
        }

        const config = await loadWorkerConfig();
        if (!config || !config.workers || config.workers.length === 0) {
            log('ℹ️ Không có worker config để resume - Hãy mở popup và tick chọn workers rồi bấm Start', 'warning');
            return false;
        }

        isResuming = true;
        log('🔄 Đang tự động resume workers...', 'info');

        try {
            currentSessionId++; // Increment session ID to "kill" any existing workers
            const mySessionId = currentSessionId;
            isRunning = true;
            await chrome.storage.local.set({ activeTabInstanceId: tabInstanceId });

            // Apply mining config if exists
            if (config.miningConfig) {
                CONFIG.miningConfig.mineType = config.miningConfig.mineType || 'silver';
                CONFIG.miningConfig.mineId = config.miningConfig.mineId || null;
            }

            // Apply Mê Cung config if exists
            if (config.mecungConfig) {
                CONFIG.mecungConfig.minPlayers = config.mecungConfig.minPlayers || 5;
                CONFIG.mecungConfig.role = config.mecungConfig.role || 'member';
            }

            // Apply Luyện Đan config if exists
            if (config.luyenDanConfig) {
                CONFIG.luyenDanConfig.targetTier = config.luyenDanConfig.targetTier || 'auto';
                CONFIG.luyenDanConfig.autoDecompose = !!config.luyenDanConfig.autoDecompose;
                CONFIG.luyenDanConfig.decomposeTier = config.luyenDanConfig.decomposeTier || 'ha';
                CONFIG.luyenDanConfig.decomposeStars = config.luyenDanConfig.decomposeStars || '1-2';
            }

            // Fetch fresh nonces
            const activeWorkers = [];
            for (const name of config.workers) {
                // Vòng quay (spin) có thể nhận thêm lượt trong ngày (từ Mốc 2), nên không bỏ qua khi startup
                if (name !== 'spin' && await isWorkerDone(name)) {
                    const vnNames = { chest: 'Rương', boss: 'Boss HV', bossTongMon: 'Boss TM', spin: 'Quay', tltm: 'TLTM', vanDap: 'Vấn Đáp', teLe: 'Tế Lễ', dailyReward: 'Daily', mining: 'Đào Mỏ', luyenDan: 'Luyện Đan', meCung: 'Mê Cung' };
                    log(`ℹ️ ${vnNames[name] || name} đã xong hôm nay. Bỏ qua.`, 'success');
                    continue;
                }
                activeWorkers.push(name);
            }

            await fetchNonces(activeWorkers);
            await dailyCheckIn();

            const workerMap = {
                chest: runChestWorker,
                boss: runBossWorker,
                bossTongMon: runBossTongMonWorker,
                spin: runSpinWorker,
                tltm: runTltmWorker,
                vanDap: runVanDapWorker,
                teLe: runTeLeWorker,
                dailyReward: runDailyRewardWorker,
                mining: runMiningWorker,
                luyenDan: runLuyenDanWorker,
                meCung: runMeCungWorker
            };

            const workerNames = activeWorkers.map(w => {
                const names = { chest: 'Rương', boss: 'Boss HV', bossTongMon: 'Boss TM', spin: 'Quay', tltm: 'TLTM', vanDap: 'Vấn Đáp', teLe: 'Tế Lễ', dailyReward: 'Daily', mining: 'Đào Mỏ', luyenDan: 'Luyện Đan', meCung: 'Mê Cung' };
                return names[w] || w;
            }).join(', ');

            if (activeWorkers.length > 0) {
                log(`🚀 Resume ${activeWorkers.length} workers: ${workerNames}`, 'success');
                for (const name of activeWorkers) {
                    if (workerMap[name]) {
                        workerMap[name](mySessionId).catch(e => log(`💥 ${name} crashed: ${e.message}`, 'error'));
                    }
                }
            } else {
                log(`✅ Tất cả workers được chọn đều đã hoàn thành trong ngày!`, 'success');
            }

            activeWorkerNames = config.workers;
            savedMiningConfig = config.miningConfig;
            savedMecungConfig = config.mecungConfig;

            // Start heartbeat
            startHeartbeat();

            // Notify background that we resumed
            safeSendMessage({ type: 'WORKER_RESUMED' });

            isResuming = false;
            return true;
        } catch (e) {
            log(`❌ Resume failed: ${e.message}`, 'error');
            isRunning = false;
            isResuming = false;
            return false;
        }
    }

    // ============= HEARTBEAT MECHANISM =============
    function startHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        missedHeartbeats = 0;

        heartbeatTimer = setInterval(async () => {
            if (!isRunning) {
                stopHeartbeat();
                return;
            }

            if (!isExtensionValid()) {
                missedHeartbeats++;
                console.log(`💔 Heartbeat missed (${missedHeartbeats}/${CONFIG.heartbeat.maxMissed})`);

                if (missedHeartbeats >= CONFIG.heartbeat.maxMissed) {
                    console.log('💔 Extension context lost - stopping workers');
                    isRunning = false;
                    stopHeartbeat();
                }
                return;
            }

            try {
                const response = await chrome.runtime.sendMessage({ type: 'HEARTBEAT' });
                if (response?.alive) {
                    missedHeartbeats = 0;
                    // Background is alive, check if it thinks we should be running
                    if (response.isRunning && !isRunning) {
                        console.log('🔄 Background says we should be running - resuming...');
                        // Could auto-resume here if needed
                    }
                }
            } catch (e) {
                missedHeartbeats++;
                console.log(`💔 Heartbeat error: ${e.message}`);
            }
        }, CONFIG.heartbeat.interval);

        console.log('💓 Heartbeat started');
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
            console.log('💔 Heartbeat stopped');
        }
    }

    // Notify background when page is about to unload
    window.addEventListener('beforeunload', () => {
        if (isRunning) {
            safeSendMessage({ type: 'WORKER_STOPPED' });
        }
    });

    // Detect manual claim of Milestone 2 (Vòng Quay)
    document.addEventListener("click", (e) => {
        const target = e.target;
        if (target && (target.id === "btn2" || target.closest("#btn2"))) {
            log("🎡 Phát hiện click nhận Mốc 2, lên lịch kiểm tra vòng quay sau 3 giây...", "info");
            setTimeout(() => {
                const rc2 = document.getElementById("rc2");
                if (rc2 && rc2.classList.contains("claimed")) {
                    forceSpinCheck = true;
                    clearWorkerDone('spin');
                    log("🎡 Đã nhận thành công Mốc 2 thủ công. Kích hoạt lượt quay mới!", "success");
                }
            }, 3000);
        }
    });

    // ============= HTTP CLIENT (QUEUE-BASED) =============
    // Mutex để đảm bảo chỉ 1 request tại 1 thời điểm
    let requestQueue = Promise.resolve();

    function enforceDelay() {
        // Tạo 1 promise mới chain vào queue, đảm bảo tuần tự
        return new Promise((resolve) => {
            requestQueue = requestQueue.then(async () => {
                const now = Date.now();
                if (now < nextRequestTime) {
                    await sleep(nextRequestTime - now);
                }
                nextRequestTime = Date.now() + CONFIG.delays.minRequestGap;
                resolve();
            });
        });
    }

    // Random jitter để tránh thundering herd khi retry
    const jitter = (base) => base + Math.floor(Math.random() * 2000);

    async function request(endpoint, options = {}, retryCount = 0) {
        const MAX_RETRIES = 5;
        const RETRY_DELAY = 3000; // 3 seconds base delay

        await enforceDelay();
        const url = endpoint.startsWith("http") ? endpoint : `${CONFIG.baseUrl}${endpoint}`;

        try {
            const res = await fetch(url, { credentials: "include", ...options });

            // Handle 503 Service Unavailable - retry automatically
            if (res.status === 503) {
                if (retryCount < MAX_RETRIES) {
                    const delay = jitter(RETRY_DELAY * (retryCount + 1));
                    console.log(`⚠️ 503 Error - Retry ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`);
                    log(`⚠️ Server 503 - Thử lại lần ${retryCount + 1}/${MAX_RETRIES}...`, 'warning');
                    await sleep(delay);
                    return request(endpoint, options, retryCount + 1);
                } else {
                    log(`❌ Server 503 - Đã thử ${MAX_RETRIES} lần không thành công`, 'error');
                    return { success: false, message: 'Server không phản hồi sau 5 lần thử' };
                }
            }

            // Handle 429 Too Many Requests - retry automatically
            if (res.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = res.headers.get('Retry-After');
                    const delay = retryAfter ? parseInt(retryAfter) * 1000 : jitter(RETRY_DELAY * (retryCount + 1) * 2);
                    console.log(`⚠️ 429 Too Many Requests - Retry ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`);
                    log(`⚠️ Rate Limited (429) - Thử lại lần ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`, 'warning');
                    await sleep(delay);
                    return request(endpoint, options, retryCount + 1);
                } else {
                    log(`❌ Rate Limited (429) - Đã thử ${MAX_RETRIES} lần không thành công`, 'error');
                    return { success: false, message: 'Bị giới hạn request sau 5 lần thử' };
                }
            }

            // Handle other errors
            if (!res.ok && res.status !== 200) {
                console.log(`⚠️ HTTP ${res.status} for ${url}`);
                let errorData;
                let msg = `HTTP error ${res.status}`;
                try {
                    const contentType = res.headers.get("content-type") || "";
                    if (contentType.includes("application/json")) {
                        errorData = await res.json();
                        msg = errorData?.message || errorData?.data?.message || msg;
                    } else {
                        const text = await res.text();
                        if (text.includes("Phiên đã hết hạn") || text.includes("phiên đăng nhập đã hết hạn")) {
                            log("🛑 ⚠️ Phát hiện phiên đăng nhập hết hạn! Đang tự động tải lại trang...", "error");
                            await sleep(3000);
                            window.location.reload();
                        }
                        msg = text.substring(0, 200) || msg;
                    }
                } catch (e) {
                    console.error("Error reading error response", e);
                }

                if (typeof msg === "string" && (msg.includes("Phiên đã hết hạn") || msg.includes("Phiên hết hạn") || msg.includes("phiên đăng nhập hết hạn") || (msg.includes("IP") && msg.includes("thay đổi")))) {
                    log("🛑 ⚠️ Phát hiện phiên đăng nhập hết hạn! Đang tự động tải lại trang...", "error");
                    await sleep(3000);
                    window.location.reload();
                }

                return { success: false, message: msg };
            }

            let data;
            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                data = await res.json();
                const msg = data?.message || data?.data?.message || "";
                if (typeof msg === "string" && (msg.includes("Phiên đã hết hạn") || msg.includes("Phiên hết hạn") || msg.includes("phiên đăng nhập hết hạn") || (msg.includes("IP") && msg.includes("thay đổi")))) {
                    log("🛑 ⚠️ Phát hiện phiên đăng nhập hết hạn! Đang tự động tải lại trang...", "error");
                    await sleep(3000);
                    window.location.reload();
                }
            } else {
                const text = await res.text();
                if (text.includes("Phiên đã hết hạn") || text.includes("phiên đăng nhập đã hết hạn")) {
                    log("🛑 ⚠️ Phát hiện phiên đăng nhập hết hạn! Đang tự động tải lại trang...", "error");
                    await sleep(3000);
                    window.location.reload();
                }
                data = JSON.parse(text);
            }
            return data;
        } catch (e) {
            // Network errors - also retry
            if (retryCount < MAX_RETRIES && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))) {
                const delay = jitter(RETRY_DELAY * (retryCount + 1));
                console.log(`⚠️ Network error - Retry ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`);
                log(`⚠️ Lỗi mạng - Thử lại lần ${retryCount + 1}/${MAX_RETRIES}...`, 'warning');
                await sleep(delay);
                return request(endpoint, options, retryCount + 1);
            }
            throw e;
        }
    }

    async function postForm(endpoint, data) {
        return request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
            body: new URLSearchParams(data)
        });
    }

    async function postJson(endpoint, data = {}) {
        const headers = {
            "Content-Type": "application/json",
            "X-WP-Nonce": CONFIG.nonces.wp
        };



        return request(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(data)
        });
    }

    // ============= FETCH NONCES =============
    async function fetchNonces(activeWorkers = []) {
        console.log("🔐 Đang tải Nonces...");

        const fetchPage = async (url) => {
            for (let i = 0; i < 3; i++) {
                try {
                    await sleep(2000 + i * 1000);
                    const res = await fetch(`${CONFIG.baseUrl}${url}`, { credentials: "include" });
                    if (res.ok) return await res.text();
                } catch (e) { }
            }
            return null;
        };

        const extractSecurity = (html, patterns) => {
            if (!html) return null;
            for (const p of patterns) {
                const m = html.match(p);
                if (m?.[1]) return m[1];
            }
            return null;
        };

        const patterns = {
            securityToken: [
                /hh3dData\.securityToken\s*=\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
                /hh3dData\s*=\s*\{[^}]*securityToken\s*:\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
                /"securityToken"\s*:\s*"([A-Za-z0-9+/=%]{30,})"/i,
                /'securityToken'\s*:\s*'([A-Za-z0-9+/=%]{30,})'/i,
                /securityToken["\s:]+["']([A-Za-z0-9+/=%]{30,})["']/i,
            ],
            restNonce: [
                /hh3dData\.restNonce\s*=\s*["']([a-f0-9]{10})["']/i,
                /"restNonce"\s*:\s*"([a-f0-9]{10})"/i,
                /restNonce["\s:]+["']([a-f0-9]{10})["']/i,
            ],
            userid: [
                /hh3dData\.userId\s*=\s*["']?(\d+)["']?/i,
                /"userId"\s*:\s*"(\d+)"/i,
                /"userId"\s*:\s*(\d+)/i
            ],
            lotterySpin: [
                /["']lotterySpin["']\s*:\s*["']([^"']+)["']/i,
                /lotterySpin\s*:\s*["']([^"']+)["']/i,
                /hh3dData\.act\.lotterySpin\s*=\s*["']([^"']+)["']/i,
                /["'](?:luckySpin|quaySo|vongQuay|quay|lottery|spin)["']\s*:\s*["']([^"']+)["']/i,
            ],
            chest: [
                /open_chest_pl[^}]*security["\s:]+["']([a-f0-9]{10})["']/i,
                /phuc_loi[^}]*security["\s:]+["']([a-f0-9]{10})["']/i,
            ],
            boss: [
                /attack_boss[^}]{0,300}nonce["\':=\s]+["']([a-f0-9]{10})["']/i,
                /action[=:]"attack_boss"[^)]*nonce["\':=\s]+["']([a-f0-9]{10})["']/i,
                /\.ajax\([^)]*attack_boss[^)]*nonce["\':=\s]+["']([a-f0-9]{10})["']/i,
                /boss[_-]?nonce["\':=\s]+["']([a-f0-9]{10})["']/i,
                /nonce["\':=\s]+["']([a-f0-9]{10})["']/i
            ],
            wp: [
                /wpApiSettings\s*=\s*{[^}]*nonce\s*:\s*"([a-f0-9]{10})"/i,
                /customRestNonce\s*=\s*["']([a-f0-9]{10})["']/i,
                /"nonce"\s*:\s*"([a-f0-9]{10})"/i
            ],
            bossGet: [
                /hh3dData\.act\.bossGet\s*=\s*["']([^"']+)["']/i,
                /["']bossGet["']\s*:\s*["']([^"']+)["']/i,
                /bossGet\s*:\s*["']([^"']+)["']/i,
            ],
            bossTimer: [
                /hh3dData\.act\.bossTimer\s*=\s*["']([^"']+)["']/i,
                /["']bossTimer["']\s*:\s*["']([^"']+)["']/i,
                /bossTimer\s*:\s*["']([^"']+)["']/i,
            ],
            chestTimer: [
                /hh3dData\.act\.plTimer\s*=\s*["']([^"']+)["']/i,
                /["']plTimer["']\s*:\s*["']([^"']+)["']/i,
            ],
            chestOpen: [
                /hh3dData\.act\.plOpen\s*=\s*["']([^"']+)["']/i,
                /["']plOpen["']\s*:\s*["']([^"']+)["']/i,
            ],
            bossAttack: [
                /hh3dData\.act\.bossAttack\s*=\s*["']([^"']+)["']/i,
                /["']bossAttack["']\s*:\s*["']([^"']+)["']/i,
                /bossAttack\s*:\s*["']([^"']+)["']/i,
            ],
            bossAttackToken: [
                /boss_attack_token\s*=\s*["']([a-f0-9]{32})["']/i,
                /boss_attack_token\s*=\s*["']([^"']+)["']/i,
            ],
            tltmTimer: [
                /hh3dData\.act\.tltmTimer\s*=\s*["']([^"']+)["']/i,
                /["']tltmTimer["']\s*:\s*["']([^"']+)["']/i,
            ],
            tltmAttack: [
                /hh3dData\.act\.tltmAttack\s*=\s*["']([^"']+)["']/i,
                /["']tltmAttack["']\s*:\s*["']([^"']+)["']/i,
            ],
            dailyReward: [
                /action\s*:\s*["']([a-f0-9]{8,})["']\s*,\s*stage/i,
                /action\s*:\s*["']([a-f0-9]{8,})["']/i,
            ]
        };

        const home = await fetchPage("/");
        if (home) {
            CONFIG.nonces.securityToken = extractSecurity(home, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
            CONFIG.nonces.restNonce = extractSecurity(home, patterns.restNonce);
            CONFIG.nonces.userid = extractSecurity(home, patterns.userid);
            
            // Decrypt homepage actions
            const homeDecrypted = decryptHh3dActions(home);
            if (homeDecrypted) {
                console.log("🐉 [Home Decrypted Actions]:", Object.keys(homeDecrypted));
                const spinAction = homeDecrypted.lotterySpin || homeDecrypted.spin || homeDecrypted.luckySpin || homeDecrypted.quay || homeDecrypted.quaySo || homeDecrypted.lottery || homeDecrypted.vongQuay;
                if (spinAction) CONFIG.nonces.lotterySpin = spinAction;
                if (homeDecrypted.bossAttack) CONFIG.nonces.bossAttackAction = homeDecrypted.bossAttack;
                if (homeDecrypted.bossGet) CONFIG.nonces.bossGetAction = homeDecrypted.bossGet;
                if (homeDecrypted.bossTimer) CONFIG.nonces.bossTimerAction = homeDecrypted.bossTimer;
                if (homeDecrypted.tltmTimer) CONFIG.nonces.tltmTimerAction = homeDecrypted.tltmTimer;
                if (homeDecrypted.tltmAttack) CONFIG.nonces.tltmAttackAction = homeDecrypted.tltmAttack;
                if (homeDecrypted.hdnReward) CONFIG.nonces.dailyRewardAction = homeDecrypted.hdnReward;
            }
            if (!CONFIG.nonces.lotterySpin) {
                CONFIG.nonces.lotterySpin = extractSecurity(home, patterns.lotterySpin);
            }
        }

        if (activeWorkers.includes('spin')) {
            const spinPage = await fetchPage("/vong-quay-phuc-van/");
            if (spinPage) {
                const spinDecrypted = decryptHh3dActions(spinPage);
                const spinAction = spinDecrypted ? (spinDecrypted.lotterySpin || spinDecrypted.spin || spinDecrypted.luckySpin || spinDecrypted.quay || spinDecrypted.quaySo || spinDecrypted.lottery || spinDecrypted.vongQuay) : null;
                if (spinDecrypted) {
                    console.log("🐉 [Spin Decrypted Actions]:", Object.keys(spinDecrypted));
                }
                if (spinAction) {
                    CONFIG.nonces.lotterySpin = spinAction;
                    await chrome.storage.local.set({ lastKnownSpinRoute: spinAction });
                } else {
                    CONFIG.nonces.lotterySpin = extractSecurity(spinPage, patterns.lotterySpin) || CONFIG.nonces.lotterySpin || "spin";
                }
            } else if (!CONFIG.nonces.lotterySpin) {
                CONFIG.nonces.lotterySpin = "spin";
            }

            if (CONFIG.nonces.lotterySpin === "spin") {
                const saved = await chrome.storage.local.get(['lastKnownSpinRoute']);
                if (saved.lastKnownSpinRoute) {
                    CONFIG.nonces.lotterySpin = saved.lastKnownSpinRoute;
                    console.log("🎡 [Startup] Using last known spin route from storage:", CONFIG.nonces.lotterySpin);
                }
            }
        }

        const bossPage = await fetchPage(CONFIG.pages.boss);
        CONFIG.nonces.boss = extractSecurity(bossPage, patterns.boss);
        if (!CONFIG.nonces.securityToken && bossPage) {
            CONFIG.nonces.securityToken = extractSecurity(bossPage, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
        }

        // Extract boss_attack_token và bossAttack action từ trang boss
        if (bossPage) {
            const bossDecrypted = decryptHh3dActions(bossPage);
            if (bossDecrypted) {
                if (bossDecrypted.bossAttack) CONFIG.nonces.bossAttackAction = bossDecrypted.bossAttack;
                if (bossDecrypted.bossGet) CONFIG.nonces.bossGetAction = bossDecrypted.bossGet;
                if (bossDecrypted.bossTimer) CONFIG.nonces.bossTimerAction = bossDecrypted.bossTimer;
            }
            if (!CONFIG.nonces.bossAttackAction) {
                CONFIG.nonces.bossAttackAction = extractSecurity(bossPage, patterns.bossAttack);
            }
            if (!CONFIG.nonces.bossGetAction) {
                CONFIG.nonces.bossGetAction = extractSecurity(bossPage, patterns.bossGet);
            }
            if (!CONFIG.nonces.bossTimerAction) {
                CONFIG.nonces.bossTimerAction = extractSecurity(bossPage, patterns.bossTimer);
            }
            CONFIG.nonces.bossAttackToken = extractSecurity(bossPage, patterns.bossAttackToken);
        }

        // Extract chest actions from chest page if needed
        if (activeWorkers.includes('chest')) {
            const chestPage = await fetchPage(CONFIG.pages.chest);
            if (chestPage) {
                const chestDecrypted = decryptHh3dActions(chestPage);
                if (chestDecrypted) {
                    if (chestDecrypted.plTimer) CONFIG.nonces.chestTimerAction = chestDecrypted.plTimer;
                    if (chestDecrypted.plOpen) CONFIG.nonces.chestOpenAction = chestDecrypted.plOpen;
                }
                if (!CONFIG.nonces.chestTimerAction) {
                    CONFIG.nonces.chestTimerAction = extractSecurity(chestPage, patterns.chestTimer);
                }
                if (!CONFIG.nonces.chestOpenAction) {
                    CONFIG.nonces.chestOpenAction = extractSecurity(chestPage, patterns.chestOpen);
                }
            }
        }

        const wpPage = await fetchPage(CONFIG.pages.wp);
        CONFIG.nonces.wp = extractSecurity(wpPage, patterns.wp);
        if (wpPage) {
            const wpDecrypted = decryptHh3dActions(wpPage);
            if (wpDecrypted) {
                if (wpDecrypted.tltmTimer) CONFIG.nonces.tltmTimerAction = wpDecrypted.tltmTimer;
                if (wpDecrypted.tltmAttack) CONFIG.nonces.tltmAttackAction = wpDecrypted.tltmAttack;
            }
            if (!CONFIG.nonces.tltmTimerAction) {
                CONFIG.nonces.tltmTimerAction = extractSecurity(wpPage, patterns.tltmTimer);
            }
            if (!CONFIG.nonces.tltmAttackAction) {
                CONFIG.nonces.tltmAttackAction = extractSecurity(wpPage, patterns.tltmAttack);
            }
        }

        // Fetch mining nonces if included
        if (activeWorkers.includes('mining')) {
            await fetchMiningNonces();
        }

        // Fetch daily reward action if needed
        if (activeWorkers.includes('dailyReward')) {
            const missionPage = await fetchPage(CONFIG.pages.missions);
            if (missionPage) {
                const missionDecrypted = decryptHh3dActions(missionPage);
                if (missionDecrypted && missionDecrypted.hdnReward) {
                    CONFIG.nonces.dailyRewardAction = missionDecrypted.hdnReward;
                } else {
                    CONFIG.nonces.dailyRewardAction = extractSecurity(missionPage, patterns.dailyReward);
                }
            }
        }

        const missing = [];
        if (!CONFIG.nonces.boss) missing.push('Boss');
        if (!CONFIG.nonces.securityToken) missing.push('Token');
        if (!CONFIG.nonces.bossAttackToken) missing.push('BossToken');
        if (missing.length > 0) {
            log(`⚠️ Nonces thiếu: ${missing.join(', ')}`, "error");
        } else {
            log("✅ Nonces loaded thành công", "success");
        }
    }

    // ============= MINING NONCES (RIÊNG BIỆT) =============
    async function fetchMiningNonces() {
        console.log("⛏️ Đang tải Mining Nonces...");

        const fetchPage = async (url) => {
            for (let i = 0; i < 3; i++) {
                try {
                    await sleep(2000 + i * 1000);
                    const res = await fetch(`${CONFIG.baseUrl}${url}`, { credentials: "include" });
                    if (res.ok) return await res.text();
                } catch (e) { }
            }
            return null;
        };

        const extractSecurity = (html, patterns) => {
            if (!html) return null;
            for (const p of patterns) {
                const m = html.match(p);
                if (m?.[1]) return m[1];
            }
            return null;
        };

        const miningPage = await fetchPage(CONFIG.pages.mining);
        if (!miningPage) {
            log("⛏️ ❌ Không thể fetch trang /khoang-mach", "error");
            return false;
        }

        // Fetch action strings from hh3dData
        const matchHh3d = miningPage.match(/var\s+hh3dData\s*=\s*({[^;]+})/);
        let miningAct = {};
        if (matchHh3d) {
            try {
                const pd = JSON.parse(matchHh3d[1]);
                if (pd.act) miningAct = pd.act;
            } catch (e) { }
        }

        CONFIG.nonces.kmListAct = miningAct.kmList || "load_mines_by_type";
        CONFIG.nonces.kmEnterAct = miningAct.kmEnter || "enter_mine";
        CONFIG.nonces.kmClaimAct = miningAct.kmClaim || "claim_mycred_reward";
        CONFIG.nonces.kmUsersAct = miningAct.kmUsers || "get_users_in_mine";

        const miningPatterns = {
            securityToken: [
                /hh3dData\.securityToken\s*=\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
                /hh3dData\s*=\s*\{[^}]*securityToken\s*:\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
                /"securityToken"\s*:\s*"([A-Za-z0-9+/=%]{30,})"/i,
            ],
            mining: [
                /hh3dData\.act\.kmList[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /load_mines_by_type[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /mine_type[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
            ],
            enterMine: [
                /hh3dData\.act\.kmEnter[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /enter_mine[^}]*security[":\s]+["']([a-f0-9]{10})["']/i
            ],
            claimMine: [
                /hh3dData\.act\.kmClaim[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /claim_mycred_reward[^}]*security[":\s]+["']([a-f0-9]{10})["']/i
            ],
            getUsersMine: [
                /hh3dData\.act\.kmUsers[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /get_users_in_mine[^}]*security[":\s]+["']([a-f0-9]{10})["']/i
            ],
        };

        CONFIG.nonces.securityTokenMiner = extractSecurity(miningPage, miningPatterns.securityToken);
        if (CONFIG.nonces.securityTokenMiner) {
            CONFIG.nonces.securityTokenMiner = decodeURIComponent(CONFIG.nonces.securityTokenMiner);
        }

        CONFIG.nonces.mining = extractSecurity(miningPage, miningPatterns.mining);
        CONFIG.nonces.enterMine = extractSecurity(miningPage, miningPatterns.enterMine);
        CONFIG.nonces.claimMine = extractSecurity(miningPage, miningPatterns.claimMine);
        CONFIG.nonces.getUsersMine = extractSecurity(miningPage, miningPatterns.getUsersMine);

        if (!CONFIG.nonces.userid) {
            CONFIG.nonces.userid = extractSecurity(miningPage, [
                /current_user_id\s*:\s*["'](\d+)["']/i,
                /userId\s*:\s*["']?(\d+)["']?/i
            ]);
        }

        if (CONFIG.nonces.mining && CONFIG.nonces.securityTokenMiner) {
            log("⛏️ Mining Nonces loaded thành công", "success");
        } else {
            log("⛏️ ❌ Mining Nonces thiếu - Worker khoáng mạch sẽ lỗi!", "error");
        }

        return true;
    }

    // ============= DAILY CHECK-IN =============
    async function dailyCheckIn() {
        try {
            if (await isWorkerDone('dailyCheckIn')) {
                console.log(`📅 Điểm danh đã xong ngày ${getTodayKey()}, bỏ qua`);
                return;
            }

            log("📅 Đang điểm danh...", "info");
            const result = await postJson(CONFIG.endpoints.daily, { action: "daily_check_in" });
            const msg = result?.message || '';
            if (result?.success) {
                log(`✅ Điểm danh: ${msg || 'Thành công'}`, "success");
                await markWorkerDone('dailyCheckIn');
            } else {
                log(`⚠️ Điểm danh: ${msg || 'Đã điểm danh hoặc lỗi'}`, "warning");
                if (msg.includes('đã điểm danh') || msg.includes('Đã điểm danh') || msg.includes('hôm nay')) {
                    if (isNearMidnight()) {
                        log("📅 ⚠️ Đang gần nửa đêm. Không đánh dấu điểm danh xong để tránh lỗi ngày mới. Sẽ thử lại sau 5 phút...", "warning");
                        setTimeout(dailyCheckIn, 300000);
                        return;
                    }
                    await markWorkerDone('dailyCheckIn');
                }
            }
        } catch (e) {
            log(`❌ Điểm danh lỗi: ${e.message}`, "error");
        }
    }

    // ============= WORKER FUNCTIONS =============
    async function runChestWorker(sessionId) {
        log("🎁 [Chest] Started", "info");

        // Use pre-fetched actions or default
        const actionTimer = CONFIG.nonces.chestTimerAction || "get_next_time_pl";
        const actionOpen = CONFIG.nonces.chestOpenAction || "open_chest_pl";
        log(`🎁 Actions: Timer='${actionTimer}', Open='${actionOpen}'`, "info");

        while (isRunning && sessionId === currentSessionId) {
            try {
                const resp = await postForm(CONFIG.endpoints.api, {
                    action: actionTimer,
                    security_token: CONFIG.nonces.securityToken,
                });

                if (!resp?.success) {
                    const errMsg = resp?.message || resp?.data?.message || JSON.stringify(resp) || "Không có response";
                    if (errMsg.includes("hoàn thành")) {
                        if (isNearMidnight()) {
                            log("🎁 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("🎁 ✅ Đã hoàn thành hôm nay", "success");
                        await markWorkerDone('chest');
                        await sleep(getMsUntilMidnight() + 5000);
                        continue;
                    }
                    log(`🎁 API lỗi: ${errMsg}`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const { time, chest_level } = resp.data || {};
                // chest_level là level đã hoàn thành (0,1,2,3), rương tiếp theo = chest_level + 1
                const currentLevel = Number(chest_level);
                const nextChestId = currentLevel + 1;
                const chestNames = { 1: "Phàm Giới", 2: "Thiên Cơ", 3: "Địa Nguyên", 4: "Chí Tôn" };

                if (isNaN(currentLevel) || currentLevel < 0) {
                    log(`🎁 Chest level không hợp lệ: ${chest_level}. Chờ retry...`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                if (currentLevel >= 4) {
                    if (isNearMidnight()) {
                        log("🎁 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                        await sleep(300000);
                        continue;
                    }
                    log("🎁 Đã nhận đủ 4 rương", "success");
                    await markWorkerDone('chest');
                    await sleep(getMsUntilMidnight() + 5000);
                    continue;
                }

                const waitMs = parseTime(time);
                if (waitMs === 0) {
                    const chestName = chestNames[nextChestId] || `ID ${nextChestId}`;
                    log(`🎁 Level: ${currentLevel}. Đang mở rương ${chestName} (ID: ${nextChestId})...`, "info");

                    const result = await postForm(CONFIG.endpoints.api, {
                        action: actionOpen,
                        security_token: CONFIG.nonces.securityToken,
                        chest_id: nextChestId
                    });

                    if (result?.success) {
                        log(`🎁 Mở rương ${chestName} thành công: ${result.data?.message || 'OK'}`, "success");
                    } else {
                        const errMsg = result?.message || result?.data?.message || JSON.stringify(result) || 'Lỗi không xác định';
                        if (errMsg.includes("Thiên Cơ") || errMsg.includes("rương trước")) {
                            log(`🎁 Cần mở rương thủ công từ web trước! (${errMsg})`, "error");
                            return;
                        }
                        log(`🎁 Lỗi: ${errMsg}`, "error");
                    }
                    await sleep(2000);
                } else {
                    const chestName = chestNames[nextChestId] || `ID ${nextChestId}`;
                    log(`🎁 Rương ${chestName} còn ${time}`, "info");
                    await sleep(waitMs + 1000);
                }
            } catch (e) {
                log(`🎁 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    // Hàm helper mới dùng để fetch file HTML và extract cấu hình nội bộ hh3dData
    async function fetchHh3dDataAndNonces(url) {
        console.log(`🔍 [Config] Đang tải cấu hình trang ${url}...`);
        try {
            await sleep(2000);
            const res = await fetch(`${CONFIG.baseUrl}${url}`, { credentials: "include" });
            const html = await res.text();
            if (!html) return null;

            const match = html.match(/var\s+hh3dData\s*=\s*({[^;]+})/);
            if (match && match[1]) {
                try {
                    return JSON.parse(match[1]);
                } catch (e) { }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // Hàm fetch lại boss_attack_token từ trang /hoang-vuc
    async function fetchBossAttackToken() {
        console.log("🛡️ Đang fetch boss_attack_token...");
        try {
            await sleep(2000);
            const res = await fetch(`${CONFIG.baseUrl}${CONFIG.pages.boss}`, { credentials: "include" });
            const html = await res.text();
            if (!html) return null;

            const tokenPatterns = [
                /boss_attack_token\s*=\s*["']([a-f0-9]{32})["']/i,
                /boss_attack_token\s*=\s*["']([^"']+)["']/i,
            ];
            for (const p of tokenPatterns) {
                const m = html.match(p);
                if (m?.[1]) {
                    console.log(`🛡️ ✓ boss_attack_token OK`);
                    return m[1];
                }
            }
            log("🛡️ ❌ Không tìm thấy boss_attack_token trong HTML", "error");
            return null;
        } catch (e) {
            log(`🛡️ ❌ Fetch boss token lỗi: ${e.message}`, "error");
            return null;
        }
    }

    async function runBossWorker(sessionId) {
        log("🛡️ [Boss] Started", "info");

        let attackToken = CONFIG.nonces.bossAttackToken || null;
        let bossAttackAction = CONFIG.nonces.bossAttackAction || 'attack_boss';
        let actionGetBoss = CONFIG.nonces.bossGetAction || "get_boss";
        let actionTimer = CONFIG.nonces.bossTimerAction || "get_next_attack_time";



        while (isRunning && sessionId === currentSessionId) {
            try {
                const boss = await postForm(CONFIG.endpoints.api, { action: actionGetBoss, nonce: CONFIG.nonces.boss });
                if (!boss?.success || !boss.data?.id) {
                    const errMsg = boss?.message || boss?.data?.message || boss?.data?.error || JSON.stringify(boss) || "Không có response";
                    if (errMsg.includes("hết lượt") || errMsg.includes("hoàn thành")) {
                        if (isNearMidnight()) {
                            log("🛡️ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("🛡️ ✅ Đã hoàn thành Boss Hoang Vực hôm nay", "success");
                        await markWorkerDone('boss');
                        await sleep(getMsUntilMidnight() + 5000);
                        continue;
                    }
                    log(`🛡️ get_boss lỗi: ${errMsg}`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const bossId = boss.data.id;
                log(`🛡️ Boss: ${boss.data.name || "?"} (ID: ${bossId})`, "info");

                const timeResp = await postForm(CONFIG.endpoints.api, { action: actionTimer });
                if (timeResp?.success) {
                    const nextTs = Number(timeResp.data);
                    if (nextTs > Date.now()) {
                        const wait = nextTs - Date.now() + 1000;
                        log(`🛡️ Chưa tới giờ attack – đợi ${Math.ceil(wait / 1000)}s`, "info");
                        await sleep(wait);
                        continue;
                    }
                }

                // Nếu chưa có token, tự fetch trang /hoang-vuc để lấy
                if (!attackToken) {
                    attackToken = await fetchBossAttackToken();
                    if (!attackToken) {
                        log("🛡️ ⚠️ Không lấy được attack_token! Thử lại sau...", "error");
                        await sleep(CONFIG.delays.error);
                        continue;
                    }
                }

                const result = await postForm(CONFIG.endpoints.api, {
                    action: bossAttackAction,
                    boss_id: String(bossId),
                    security_token: CONFIG.nonces.securityToken,
                    nonce: CONFIG.nonces.boss,
                    attack_token: attackToken,
                    request_id: genRequestId()
                });

                if (result?.success) {
                    // Cập nhật token mới cho lần attack kế tiếp
                    if (result.data?.attack_token) {
                        attackToken = result.data.attack_token;
                        log("🛡️ Attack thành công ✓ (token updated)", "success");
                    } else {
                        log("🛡️ Attack thành công ✓", "success");
                    }
                } else {
                    const msg = result?.message || result?.data?.error || result?.data?.message || "";
                    const errCode = result?.data?.error_code || "";

                    if (errCode === 'token_expired' || msg.includes("token")) {
                        log("🛡️ ⚠️ Token hết hạn – đang fetch token mới...", "warning");
                        attackToken = await fetchBossAttackToken();
                        if (attackToken) {
                            log("🛡️ Đã lấy token mới, thử lại...", "info");
                        } else {
                            log("🛡️ ❌ Không lấy được token mới!", "error");
                        }
                        await sleep(2000);
                        continue;
                    } else if (msg.includes("hết lượt") || msg.includes("hết lượt tấn công")) {
                        if (isNearMidnight()) {
                            log("🛡️ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("🛡️ ✅ Đã hoàn thành hôm nay", "success");
                        await markWorkerDone('boss');
                        await sleep(getMsUntilMidnight() + 5000);
                    } else if (msg.includes("nhận thưởng từ boss cũ") || msg.includes("nhận thưởng")) {
                        log("🛡️ Đang nhận thưởng từ boss cũ...", "info");
                        const claimResult = await postForm(CONFIG.endpoints.claimboss, { action: "claim_chest", nonce: CONFIG.nonces.boss });
                        if (claimResult?.success) {
                            log(`🛡️ Nhận thưởng thành công: ${claimResult?.message || ""}`, "success");
                        } else {
                            log(`🛡️ Nhận thưởng thất bại: ${claimResult?.message || JSON.stringify(claimResult)}`, "error");
                        }
                        log("🛡️ Sẽ thử attack lại ngay...", "info");
                        await sleep(2000);
                        continue;
                    } else {
                        // Cập nhật token mới nếu response trả về (kể cả khi fail)
                        if (result?.data?.attack_token) {
                            attackToken = result.data.attack_token;
                        }
                        log(`🛡️ Attack thất bại: ${msg}`, "warning");
                        await sleep(CONFIG.delays.error);
                    }
                }
            } catch (e) {
                log(`🛡️ Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runBossTongMonWorker(sessionId) {
        log("⚔️ [Boss TM] Started", "info");
        while (isRunning && sessionId === currentSessionId) {
            try {
                const info = await postJson(`${CONFIG.endpoints.tongMon}/check-attack-cooldown`);

                if (!info?.success) {
                    log("⚔️ Lỗi check cooldown", "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                if (info.cooldown_type === "daily_limit" || info.remaining_attacks === 0) {
                    if (isNearMidnight()) {
                        log("⚔️ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                        await sleep(300000);
                        continue;
                    }
                    log("⚔️ ✅ Hết lượt trong ngày – chờ đến 0h", "success");
                    await markWorkerDone('bossTongMon');
                    await sleep(getMsUntilMidnight() + 5000);
                    continue;
                }

                if (info.can_attack === true) {
                    log(`⚔️ Có thể tấn công ngay (${info.remaining_attacks} lượt còn lại)`, "info");
                    const result = await postJson(`${CONFIG.endpoints.tongMon}/attack-boss`);

                    if (result?.success) {
                        log(`⚔️ Attack thành công: ${result.message} | HP: ${result.boss_hp}/${result.boss_max_hp}`, "success");
                    } else {
                        log(`⚔️ Attack thất bại: ${result?.message || "Unknown"}`, "warning");
                    }

                    await sleep(CONFIG.delays.check);
                } else {
                    const cd = (info.cooldown_interval || 30) * 1000;
                    log(`⚔️ Cooldown ${info.cooldown_interval}s, còn ${info.remaining_attacks} lượt`, "info");
                    await sleep(cd + 1000);
                }
            } catch (e) {
                log(`⚔️ Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runSpinWorker(sessionId) {
        log("🎡 [Spin] Started", "info");
        while (isRunning && sessionId === currentSessionId) {
            try {
                // Inject script để đọc hh3dData từ MAIN world
                const pageData = await injectAndReadHh3dData();
                let spinRoute = pageData.lotterySpin || CONFIG.nonces.lotterySpin || "spin";

                if (spinRoute === "spin") {
                    const saved = await chrome.storage.local.get(['lastKnownSpinRoute']);
                    if (saved.lastKnownSpinRoute) {
                        spinRoute = saved.lastKnownSpinRoute;
                        console.log("🎡 [Spin] Using last known spin route from storage:", spinRoute);
                    }
                }

                const spinUrl = CONFIG.endpoints.spin + spinRoute;
                const spinNonce = pageData.restNonce || CONFIG.nonces.restNonce || CONFIG.nonces.wp;
                const spinToken = pageData.securityToken || CONFIG.nonces.securityToken;

                if (!spinNonce) {
                    log("🎡 ⚠️ Thiếu Rest Nonce, đang đợi...", "warning");
                    await sleep(10000);
                    continue;
                }

                const result = await request(spinUrl, {
                    method: "POST",
                    headers: {
                        "X-WP-Nonce": spinNonce,
                        "X-Security-Token": spinToken,
                        "Content-Type": "application/json"
                    }
                });

                if (result?.success) {
                    log(`🎡 Quay: ${result.message || 'OK'}`, "success");
                    await sleep(CONFIG.delays.check);
                } else {
                    const msg = result?.message || result?.data?.message || "";
                    if (msg.includes("hết lượt") || msg.includes("đã hết lượt")) {
                        if (isNearMidnight()) {
                            log("🎡 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("🎡 ✅ Đã hoàn thành hôm nay. Chờ đến 0h hoặc Mốc 2...", "success");
                        await markWorkerDone('spin');
                        const wakeTime = Date.now() + getMsUntilMidnight() + 5000;
                        while (Date.now() < wakeTime && !forceSpinCheck) {
                            if (!isRunning || sessionId !== currentSessionId) break;
                            await sleep(5000);
                        }
                        forceSpinCheck = false;
                    } else if (msg.includes("Cần tối thiểu") && msg.includes("Tu Vi")) {
                        log("🎡 ⚠️ Không đủ Tu Vi để quay - Dừng worker", "warning");
                        return;
                    } else if (msg.includes("Không tìm thấy đường dẫn") || msg.includes("rest_no_route")) {
                        log(`🎡 ⚠️ Route quay số không hợp lệ hoặc đã đổi: ${spinRoute}`, "warning");
                        await sleep(CONFIG.delays.error);
                    } else {
                        log(`🎡 ${msg || JSON.stringify(result)}`, "warning");
                        await sleep(CONFIG.delays.error);
                    }
                }
            } catch (e) {
                log(`🎡 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runTltmWorker(sessionId) {
        log("💎 [TLTM] Started", "info");

        // Dynamically get action strings
        const pageData = await fetchHh3dDataAndNonces("/thi-luyen-tong-mon-hh3d");
        const actionTimer = (pageData && pageData.act && pageData.act.tltmTimer) ? pageData.act.tltmTimer : "get_remaining_time_tltm";
        const actionOpen = (pageData && pageData.act && pageData.act.tltmOpen) ? pageData.act.tltmOpen : "open_chest_tltm";
        console.log(`💎 [TLTM] Actions: Timer='${actionTimer}', Open='${actionOpen}'`);

        while (isRunning && sessionId === currentSessionId) {
            try {
                const check = await postForm(CONFIG.endpoints.api, {
                    action: actionTimer,
                    security_token: CONFIG.nonces.securityToken
                });

                if (check?.success) {
                    const { time_remaining } = check.data || {};

                    // Check time_remaining undefined
                    if (time_remaining === undefined) {
                        log("💎 time_remaining undefined, retry...", "warning");
                        await sleep(CONFIG.delays.error);
                        continue;
                    }

                    const waitMs = parseTime(time_remaining);
                    if (waitMs === 0) {
                        const result = await postForm(CONFIG.endpoints.api, {
                            action: actionOpen,
                            security_token: CONFIG.nonces.securityToken
                        });

                        // Check message hoàn thành sau khi mở rương
                        const resultMsg = result?.data?.message || result?.message || "";
                        if (resultMsg.includes("hoàn thành Thí Luyện Tông Môn") || resultMsg.includes("quay lại vào ngày kế tiếp")) {
                            if (isNearMidnight()) {
                                log("💎 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                                await sleep(300000);
                                continue;
                            }
                            log("💎 ✅ Đã hoàn thành hôm nay", "success");
                            await markWorkerDone('tltm');
                            await sleep(getMsUntilMidnight() + 5000);
                            continue;
                        }

                        if (result?.success) {
                            log(`💎 Mở rương: ${result.data?.message || 'OK'}`, "success");
                        } else {
                            log(`💎 Mở rương thất bại: ${result?.message || "Unknown"}`, "warning");
                        }
                        await sleep(2000);
                    } else {
                        log(`💎 ${time_remaining} → đợi ${Math.ceil(waitMs / 1000)}s`, "info");
                        await sleep(waitMs + 1000);
                    }
                } else {
                    const msg = check?.data?.message || check?.message || "";
                    if (msg.includes("hoàn thành Thí Luyện Tông Môn") || msg.includes("quay lại vào ngày kế tiếp")) {
                        if (isNearMidnight()) {
                            log("💎 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("💎 ✅ Đã hoàn thành hôm nay", "success");
                        await markWorkerDone('tltm');
                        await sleep(getMsUntilMidnight() + 5000);
                    } else {
                        log(`💎 ${msg}`, "warning");
                        await sleep(CONFIG.delays.error);
                    }
                }
            } catch (e) {
                log(`💎 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }


    // ============= VẤN ĐÁP ANSWERS DATA =============
    let VANDAP_ANSWERS = null;

    // Hàm load answers từ file JSON
    async function loadVanDapAnswers() {
        if (VANDAP_ANSWERS) return true; // Đã load rồi

        try {
            const url = chrome.runtime.getURL('answers.json');
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            VANDAP_ANSWERS = await response.json();
            log(`❓ Đã tải ${Object.keys(VANDAP_ANSWERS).length} câu trả lời từ answers.json`, "success");
            return true;
        } catch (e) {
            log(`❓ Lỗi khi tải answers.json: ${e.message}`, "error");
            return false;
        }
    }

    // Hàm chuẩn hóa chuỗi để so sánh
    function normalizeString(str) {
        if (!str) return "";
        return str.toString()
            .toLowerCase()
            .normalize("NFC")
            .replace(/[.,;?!:"'()]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Hàm tìm đáp án đúng
    function findAnswer(question, options) {
        if (!VANDAP_ANSWERS) return 0;

        let rawAnswer = VANDAP_ANSWERS[question];

        if (!rawAnswer) {
            const normQuestion = normalizeString(question);
            const foundKey = Object.keys(VANDAP_ANSWERS).find(k => {
                const normKey = normalizeString(k);
                return normKey === normQuestion || normKey.includes(normQuestion) || normQuestion.includes(normKey);
            });

            if (foundKey) {
                rawAnswer = VANDAP_ANSWERS[foundKey];
                log(`❓ ⚠️ Tìm thấy câu hỏi gần đúng: "${foundKey}"`, "info");
            }
        }

        if (!rawAnswer) {
            log(`❓ Không tìm thấy đáp án cho: ${question}`, "warning");
            log(`❓ Sẽ chọn đáp án mặc định: 0`, "info");
            return 0;
        }

        const searchKey = normalizeString(rawAnswer);
        const answerIndex = options.findIndex(opt => {
            const optNorm = normalizeString(opt);
            return optNorm === searchKey || optNorm.includes(searchKey) || searchKey.includes(optNorm);
        });

        if (answerIndex === -1) {
            log(`❓ Không tìm thấy đáp án "${rawAnswer}" trong options`, "warning");
            return 0;
        }

        return answerIndex;
    }

    async function runVanDapWorker(sessionId) {
        log("❓ [Vấn Đáp] Started", "info");

        while (isRunning && sessionId === currentSessionId) {
            try {
                // Load answers từ file JSON
                log("❓ Đang tải dữ liệu câu trả lời...", "info");
                const loadedAnswers = await loadVanDapAnswers();
                if (!loadedAnswers) {
                    log("❓ Không thể tải file answers.json → Dừng worker", "error");
                    return;
                }

                log("❓ Đang tải câu hỏi vấn đáp...", "info");
                // Dynamically get action strings
                const pageData = await fetchHh3dDataAndNonces("/van-dap-tong-mon");
                const actionVdLoad = (pageData && pageData.act && pageData.act.vdLoad) ? pageData.act.vdLoad : "load_quiz_data";
                const actionVdSave = (pageData && pageData.act && pageData.act.vdSave) ? pageData.act.vdSave : "save_quiz_result";
                console.log(`❓ [Vấn Đáp] Actions: Load='${actionVdLoad}', Save='${actionVdSave}'`);

                const quizData = await postForm(CONFIG.endpoints.api, {
                    action: actionVdLoad,
                    security_token: CONFIG.nonces.securityToken
                });

                if (!quizData?.success || !quizData?.data?.questions) {
                    log(`❓ Không có câu hỏi hoặc lỗi: ${quizData?.message || JSON.stringify(quizData)}`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const { questions, correct_answers, completed } = quizData.data;

                if (completed) {
                    if (isNearMidnight()) {
                        log("❓ ⚠️ Nhận trạng thái hoàn thành vấn đáp gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                        await sleep(300000);
                        continue;
                    }
                    log(`❓ ✅ Đã hoàn thành vấn đáp hôm nay! Số câu đúng: ${correct_answers}`, "success");
                    await markWorkerDone('vanDap');
                    await sleep(getMsUntilMidnight() + 5000);
                    continue;
                }

                log(`❓ Có ${questions.length} câu hỏi. Đã trả lời đúng: ${correct_answers || 0} câu`, "info");

                for (const q of questions) {
                    if (!isRunning || sessionId !== currentSessionId) break;
                    const { id, question, options } = q;

                    log(`❓ --- Câu hỏi #${id} ---`, "info");
                    log(`❓ ${question}`, "info");

                    const answerIndex = findAnswer(question, options);
                    const selectedAnswer = options[answerIndex];
                    log(`❓ Đáp án tìm được: ${answerIndex}. ${selectedAnswer}`, "info");

                    log(`❓ Đang gửi câu trả lời...`, "info");
                    const result = await postForm(CONFIG.endpoints.api, {
                        action: actionVdSave,
                        question_id: id,
                        answer: answerIndex,
                        security_token: CONFIG.nonces.securityToken
                    });

                    if (result?.success && result?.data?.is_correct === 1) {
                        log(`❓ ✓ Đúng: ${result.data.message}`, "success");
                    } else if (result?.success && result?.data?.is_correct === 2) {
                        log(`❓ ✗ Sai: ${result.data.message}`, "warning");
                    } else {
                        log(`❓ Lỗi: ${result?.message || result?.data?.message || "Unknown"}`, "error");
                    }
                    await sleep(1000);
                }
                log(`❓ ✅ Đã hoàn thành trả lời ${questions.length} câu hỏi!`, "success");
                if (isNearMidnight()) {
                    log("❓ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                    await sleep(300000);
                    continue;
                }
                await markWorkerDone('vanDap');
                await sleep(getMsUntilMidnight() + 5000);
            } catch (e) {
                log(`❓ Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runTeLeWorker(sessionId) {
        log("🙏 [Tế Lễ] Started", "info");
        while (isRunning && sessionId === currentSessionId) {
            try {
                const check = await postJson(`${CONFIG.endpoints.tongMon}/check-te-le-status`);

                if (check?.success === false && check?.message?.includes("chưa tế lễ")) {
                    log("🙏 Phát hiện chưa tế lễ, đang tiến hành tế lễ...", "info");

                    const result = await postJson(`${CONFIG.endpoints.tongMon}/te-le-tong-mon`, {
                        action: "te_le_tong_mon",
                        security_token: CONFIG.nonces.securityToken
                    });

                    let resultDone = false;
                    if (result?.success) {
                        log(`🙏 Thành công: ${result.message}`, "success");
                        log(`🙏 Cống hiến: ${result.cong_hien_points} | Tông khố: ${result.treasury}`, "success");
                        resultDone = true;
                    } else {
                        const msg = result?.message || JSON.stringify(result);
                        log(`🙏 Thất bại: ${msg}`, "warning");
                        resultDone = msg.includes('đã tế lễ') || msg.includes('Đã tế lễ') || msg.includes('hôm nay');
                    }

                    if (resultDone) {
                        if (isNearMidnight()) {
                            log("🙏 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("🙏 Đã tế lễ xong - Chờ đến 0h", "success");
                        await markWorkerDone('teLe');
                        await sleep(getMsUntilMidnight() + 5000);
                    } else {
                        await sleep(CONFIG.delays.error);
                    }
                } else if (check?.success === true) {
                    if (isNearMidnight()) {
                        log("🙏 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                        await sleep(300000);
                        continue;
                    }
                    log(`🙏 Trạng thái: ${check?.message || "Đã tế lễ hoặc không cần tế lễ"}`, "success");
                    await markWorkerDone('teLe');
                    await sleep(getMsUntilMidnight() + 5000);
                } else {
                    const msg = check?.message || JSON.stringify(check);
                    log(`🙏 Check status thất bại: ${msg}`, "warning");
                    if (msg.includes('đã tế lễ') || msg.includes('Đã tế lễ') || msg.includes('hôm nay')) {
                        if (isNearMidnight()) {
                            log("🙏 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        await markWorkerDone('teLe');
                        await sleep(getMsUntilMidnight() + 5000);
                        continue;
                    }
                    await sleep(CONFIG.delays.error);
                }
            } catch (e) {
                log(`🙏 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    // ============= DAILY ACTIVITY REWARD WORKER =============
    async function runDailyRewardWorker(sessionId) {
        log("🎁 [Daily Reward] Started", "info");

        const stages = ["stage1", "stage2"];
        const claimedStages = new Set();

        while (isRunning && sessionId === currentSessionId) {
            try {
                // === PHẦN 1: Thưởng hoạt động ngày ===
                for (const stage of stages) {
                    if (!isRunning || sessionId !== currentSessionId) break;
                    if (claimedStages.has(stage)) continue;

                    log(`🎁 Đang thử nhận thưởng ${stage}...`, "info");

                    const result = await postForm(CONFIG.endpoints.api, {
                        action: CONFIG.nonces.dailyRewardAction || "daily_activity_reward",
                        stage: stage,
                        security_token: CONFIG.nonces.securityToken
                    });

                    if (result?.success) {
                        const msg = result?.data?.message || "Thành công";
                        log(`🎁 ✅ ${stage}: ${msg}`, "success");
                        claimedStages.add(stage);
                        if (stage === "stage2") {
                            forceSpinCheck = true;
                            await clearWorkerDone('spin');
                            log("🎡 Đã nhận thành công Mốc 2 từ Auto Worker. Kích hoạt lượt quay mới!", "success");
                        }
                    } else {
                        const errMsg = result?.data?.message || result?.message || "";

                        if (errMsg.includes("đã nhận") || errMsg.includes("hoàn thành")) {
                            log(`🎁 ${stage}: Đã nhận trước đó`, "info");
                            claimedStages.add(stage);
                            if (stage === "stage2") {
                                forceSpinCheck = true;
                                await clearWorkerDone('spin');
                                log("🎡 Mốc 2 đã nhận trước đó. Đảm bảo kích hoạt lượt quay mới!", "info");
                            }
                        } else if (errMsg.includes("chưa đủ điều kiện") || errMsg.includes("chưa đạt")) {
                            log(`🎁 ${stage}: Chưa đủ điều kiện`, "warning");
                        } else {
                            log(`🎁 ${stage}: ${errMsg}`, "warning");
                        }
                    }

                    await sleep(2000);
                }

                // === CHECK HOÀN THÀNH ===
                const allDone = claimedStages.size >= stages.length;

                if (allDone) {
                    if (isNearMidnight()) {
                        log("🎁 ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                        await sleep(300000);
                        continue;
                    }
                    log("🎁 ✅ Đã nhận hết thưởng - Chờ đến 0h", "success");
                    await markWorkerDone('dailyReward');
                    await sleep(getMsUntilMidnight() + 5000);
                    // Reset cho ngày mới
                    claimedStages.clear();
                    continue;
                }

                // Chưa nhận hết, đợi 1 tiếng rồi thử lại
                log("🎁 Chưa nhận hết thưởng - Đợi 1 tiếng rồi thử lại...", "info");
                await sleep(60 * 60 * 1000); // 1 tiếng

            } catch (e) {
                log(`🎁 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    // ============= MINING WORKER =============
    async function runMiningWorker(sessionId) {
        log("⛏️ [Mining] Started", "info");

        // Chỉ fetch nonces nếu chưa có
        if (!CONFIG.nonces.securityTokenMiner || !CONFIG.nonces.mining) {
            console.log("⛏️ Đang tải Mining Nonces...");
            const noncesOk = await fetchMiningNonces();
            if (!noncesOk || !CONFIG.nonces.securityTokenMiner || !CONFIG.nonces.mining) {
                log("⛏️ ❌ Không có mining nonces", "error");
                return;
            }
        }

        let mineId = CONFIG.miningConfig.mineId;
        let mineType = CONFIG.miningConfig.mineType || "silver";

        if (!mineId) {
            log(`⛏️ Đang load danh sách mỏ ${mineType}...`, "info");
            const minesResult = await postForm(CONFIG.endpoints.api, {
                action: CONFIG.nonces.kmListAct || "load_mines_by_type",
                mine_type: mineType,
                security: CONFIG.nonces.mining
            });

            if (!minesResult?.success || !minesResult?.data?.length) {
                log(`⛏️ ❌ Không thể load danh sách mỏ`, "error");
                return;
            }

            const availableMine = minesResult.data.find(m => m.user_count < m.max_users);
            if (!availableMine) {
                log("⛏️ ❌ Tất cả các mỏ đều đầy", "error");
                return;
            }

            mineId = availableMine.id;
            log(`⛏️ Đã chọn mỏ: ${availableMine.name} (ID: ${mineId})`, "info");
        }

        while (isRunning && sessionId === currentSessionId) {
            try {
                // Kiểm tra tab lock để tránh chạy trùng lặp ở nhiều tab
                const lockRes = await chrome.storage.local.get(['activeTabInstanceId']);
                if (lockRes.activeTabInstanceId && lockRes.activeTabInstanceId !== tabInstanceId) {
                    log("⚠️ Phát hiện tab khác đang chạy workers. Dừng workers ở tab này.", "warning");
                    isRunning = false;
                    break;
                }

                log(`⛏️ Đang kiểm tra trạng thái mỏ ID ${mineId}...`, "info");
                const usersResult = await postForm(CONFIG.endpoints.api, {
                    action: CONFIG.nonces.kmUsersAct || "get_users_in_mine",
                    mine_id: mineId,
                    security_token: CONFIG.nonces.securityTokenMiner,
                    security: CONFIG.nonces.getUsersMine || CONFIG.nonces.mining
                });

                // Check phiên hết hạn
                const sessionExpiredMsg = usersResult?.data?.message || usersResult?.message || "";
                if (sessionExpiredMsg.includes("Phiên đã hết hạn") || sessionExpiredMsg.includes("hết hạn") || sessionExpiredMsg.includes("IP") && sessionExpiredMsg.includes("thay đổi")) {
                    log(`⛏️ ⚠️ Phiên hết hạn - Đang tải lại token...`, "warning");
                    await fetchMiningNonces();
                    await sleep(2000);
                    continue;
                }

                if (!usersResult?.success || !usersResult?.data?.users) {
                    log(`⛏️ ⚠️ Không thể lấy danh sách người chơi`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const users = usersResult.data.users;
                const myUserId = CONFIG.nonces.userid;
                const myUser = users.find(u => String(u.id) === String(myUserId));

                if (myUser) {
                    log(`⛏️ Đang trong mỏ - Đang claim reward...`, "info");
                    const claimResult = await postForm(CONFIG.endpoints.api, {
                        action: CONFIG.nonces.kmClaimAct || "claim_mycred_reward",
                        mine_id: mineId,
                        security_token: CONFIG.nonces.securityTokenMiner,
                        security: CONFIG.nonces.claimMine
                    });

                    if (!claimResult?.success) {
                        const msg = claimResult?.message || claimResult?.data?.message || "";
                        // Check phiên hết hạn
                        if (msg.includes("Phiên đã hết hạn") || msg.includes("hết hạn") || (msg.includes("IP") && msg.includes("thay đổi"))) {
                            log(`⛏️ ⚠️ Phiên hết hạn - Đang tải lại token...`, "warning");
                            await fetchMiningNonces();
                            await sleep(2000);
                            continue;
                        }
                        if (msg.includes("đạt đủ thưởng") || msg.includes("không thể vào")) {
                            if (isNearMidnight()) {
                                log("⛏️ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                                await sleep(300000);
                                continue;
                            }
                            log(`⛏️ ✅ Đã đạt đủ thưởng ngày - Chờ đến 0h`, "success");
                            await markWorkerDone('mining');
                            await sleep(getMsUntilMidnight() + 5000);
                            continue;
                        }
                        log(`⛏️ ⚠️ Claim thất bại: ${msg}`, "warning");
                        await sleep(CONFIG.delays.error);
                        continue;
                    }

                    const message = claimResult?.data?.message || "";
                    log(`⛏️ ✅ Claim thành công: ${message}`, "success");
                    log(`⛏️ Đợi 30 phút...`, "info");
                    await sleep(30 * 60 * 1000);
                } else {
                    log(`⛏️ Không trong mỏ! Đang vào mỏ ID ${mineId}...`, "warning");
                    const enterResult = await postForm(CONFIG.endpoints.api, {
                        action: CONFIG.nonces.kmEnterAct || "enter_mine",
                        mine_id: mineId,
                        security_token: CONFIG.nonces.securityTokenMiner,
                        security: CONFIG.nonces.enterMine
                    });

                    if (!enterResult?.success) {
                        const errMsg = enterResult?.data?.message || enterResult?.message || "";
                        // Check phiên hết hạn
                        if (errMsg.includes("Phiên đã hết hạn") || errMsg.includes("hết hạn") || (errMsg.includes("IP") && errMsg.includes("thay đổi"))) {
                            log(`⛏️ ⚠️ Phiên hết hạn - Đang tải lại token...`, "warning");
                            await fetchMiningNonces();
                            await sleep(2000);
                            continue;
                        }
                        if (errMsg.includes("đạt đủ thưởng") || errMsg.includes("không thể vào")) {
                            if (isNearMidnight()) {
                                log("⛏️ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                                await sleep(300000);
                                continue;
                            }
                            log(`⛏️ ✅ Đã đạt đủ thưởng ngày - Chờ đến 0h`, "success");
                            await markWorkerDone('mining');
                            await sleep(getMsUntilMidnight() + 5000);
                            continue;
                        }
                        log(`⛏️ ❌ Không thể vào mỏ: ${errMsg}`, "error");
                        await sleep(CONFIG.delays.error);
                        continue;
                    }

                    log(`⛏️ ✅ Đã vào mỏ thành công! Đợi 30 phút...`, "success");
                    await sleep(30 * 60 * 1000);
                }
            } catch (e) {
                log(`⛏️ Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runLuyenDanWorker(sessionId) {
        log("🧪 [Luyện Đan] Started", "info");

        let luyenDanToken = null;
        let luyenDanTokenExpires = 0;

        async function ensureLuyenDanToken() {
            const now = Math.floor(Date.now() / 1000);
            if (luyenDanToken && luyenDanTokenExpires > now + 30) {
                return luyenDanToken;
            }
            console.log("🧪 Đang lấy session token Luyện Đan...");

            // Đảm bảo có WP rest nonce trước
            if (!CONFIG.nonces.wp) {
                const wpPage = await fetch(`${CONFIG.baseUrl}/bi-canh-tong-mon`, { credentials: "include" }).then(r => r.text()).catch(() => null);
                if (wpPage) {
                    const match = wpPage.match(/"nonce"\s*:\s*"([a-f0-9]{10})"/i) || wpPage.match(/wpApiSettings\s*=\s*{[^}]*nonce\s*:\s*"([a-f0-9]{10})"/i);
                    if (match?.[1]) {
                        CONFIG.nonces.wp = match[1];
                    }
                }
            }

            if (!CONFIG.nonces.wp) {
                log("🧪 ❌ Không có WP rest nonce, không thể lấy session token", "error");
                return null;
            }

            try {
                const response = await request("/wp-json/hh3d/v1/luyen-dan/session-token", {
                    method: "GET",
                    headers: {
                        "X-WP-Nonce": CONFIG.nonces.wp
                    }
                });

                if (response?.data?.security_token) {
                    luyenDanToken = response.data.security_token;
                    luyenDanTokenExpires = response.data.expires_at || (now + 1800); // Mặc định 30 phút
                    console.log("🧪 ✓ Session token Luyện Đan OK");
                    return luyenDanToken;
                } else {
                    log("🧪 ❌ Không thể lấy session token từ phản hồi", "error");
                    return null;
                }
            } catch (e) {
                log(`🧪 ❌ Lỗi khi lấy session token Luyện Đan: ${e.message}`, "error");
                return null;
            }
        }

        async function callLdApi(path, method = "GET", body = null) {
            const token = await ensureLuyenDanToken();
            if (!token) {
                throw new Error("Không có Luyện Đan session token");
            }

            const headers = {
                "X-WP-Nonce": CONFIG.nonces.wp,
                "X-LD-Token": token
            };
            if (body) {
                headers["Content-Type"] = "application/json";
            }

            const endpoint = `/wp-json/hh3d/v1/luyen-dan${path}`;
            return request(endpoint, {
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : undefined
            });
        }

        async function checkAndDecomposeIfFull(tier, data) {
            const bag = data.pill_bag?.[tier] || {};
            const stored = bag.stored != null ? parseInt(bag.stored, 10) : 0;
            const cap = bag.cap != null ? parseInt(bag.cap, 10) : 0;
            const isFull = bag.full != null ? !!bag.full : (cap > 0 && stored >= cap);

            const autoDecompose = CONFIG.luyenDanConfig?.autoDecompose || false;
            const decomposeTier = CONFIG.luyenDanConfig?.decomposeTier || "ha";
            const decomposeStars = CONFIG.luyenDanConfig?.decomposeStars || "1-2";

            if (isFull && autoDecompose && tier === decomposeTier) {
                const matchStars = (stars) => {
                    const s = parseInt(stars, 10);
                    if (decomposeStars === "1") return s === 1;
                    if (decomposeStars === "2") return s === 2;
                    if (decomposeStars === "3") return s === 3;
                    if (decomposeStars === "1-2") return s === 1 || s === 2;
                    if (decomposeStars === "1-3") return s === 1 || s === 2 || s === 3;
                    if (decomposeStars === "all") return true;
                    return false;
                };

                let pillId = null;
                let targetStars = null;

                const lowStarPills = (data.pills || []).filter(p => p.tier === decomposeTier && matchStars(p.stars));
                if (lowStarPills.length > 0) {
                    const targetPill = lowStarPills[0];
                    pillId = targetPill.id;
                    targetStars = targetPill.stars;
                } else {
                    // Fallback to pill_stacks if pills is empty or not available
                    const lowStarStacks = (data.pill_stacks || []).filter(p => p.tier === decomposeTier && matchStars(p.stars) && (p.count | 0) > 0);
                    if (lowStarStacks.length > 0) {
                        const targetStack = lowStarStacks[0];
                        pillId = targetStack.stack_id || (targetStack.tier + ":" + targetStack.stars);
                        targetStars = targetStack.stars;
                    }
                }

                if (pillId) {
                    log(`🧪 Túi đan phẩm ${decomposeTier.toUpperCase()} đã đầy. Tự động phân giải đan phù hợp (${decomposeStars}★) để lấy chỗ...`, "warning");
                    log(`🧪 Đang phân giải đan phẩm ${decomposeTier.toUpperCase()} ${targetStars}★ (ID: ${pillId})...`, "info");
                    const decompRes = await callLdApi("/decompose", "POST", { pill_id: String(pillId) });
                    if (decompRes && decompRes.success !== false && !decompRes.code && (decompRes.success || decompRes.data)) {
                        log(`🧪 ✅ Phân giải đan thành công!`, "success");
                        return true;
                    } else {
                        log(`🧪 ❌ Phân giải đan thất bại: ${decompRes?.message || decompRes?.code || 'lỗi'}`, "error");
                    }
                } else {
                    log(`🧪 ⚠️ Túi đan phẩm ${decomposeTier.toUpperCase()} đã đầy và không có đan phù hợp tiêu chí (${decomposeStars}★) để phân giải.`, "warning");
                }
            }
            return false;
        }

        while (isRunning && sessionId === currentSessionId) {
            try {
                // Kiểm tra tab lock để tránh chạy trùng lặp ở nhiều tab
                const lockRes = await chrome.storage.local.get(['activeTabInstanceId']);
                if (lockRes.activeTabInstanceId && lockRes.activeTabInstanceId !== tabInstanceId) {
                    log("⚠️ Phát hiện tab khác đang chạy workers. Dừng workers ở tab này.", "warning");
                    isRunning = false;
                    break;
                }

                log("🧪 Đang kiểm tra trạng thái Lò Đan...", "info");
                const stateRes = await callLdApi("/state?fresh=1", "GET");
                if (!stateRes || !stateRes.data) {
                    log("🧪 ❌ Không lấy được trạng thái Lò Đan", "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const data = stateRes.data;
                const furnace = data.furnace || "idle";
                const craft = data.craft || null;
                const materials = data.materials || {};
                const recipes = data.recipes || {};

                log(`🧪 Trạng thái Lò Đan: ${furnace.toUpperCase()}`, "info");

                if (furnace === "exploded") {
                    log("🧪 💥 Đan Lô bị nổ! Đang xác nhận dọn dẹp lò...", "warning");
                    const jobId = craft?.id || data.craftJobId;
                    if (jobId) {
                        const ackRes = await callLdApi("/ack-explosion", "POST", { job_id: jobId });
                        if (ackRes && ackRes.success !== false && !ackRes.code && (ackRes.success || ackRes.data)) {
                            log("🧪 ✅ Đã dọn dẹp lò đan bị nổ", "success");
                        } else {
                            log(`🧪 ❌ Lỗi khi dọn dẹp lò đan nổ: ${ackRes?.message || ackRes?.code || 'lỗi'}`, "error");
                        }
                    } else {
                        log("🧪 ❌ Không tìm thấy job_id của lò nổ", "warning");
                    }
                    await sleep(CONFIG.delays.success);
                    continue;
                }

                if (furnace === "ready") {
                    const finishedTier = craft?.ui_tier || data.tier || "ha";
                    const didDecompose = await checkAndDecomposeIfFull(finishedTier, data);
                    if (didDecompose) {
                        await sleep(CONFIG.delays.success);
                        continue;
                    }

                    log("🧪 🎉 Luyện đan hoàn tất! Đang tiến hành Thu Đan...", "info");
                    const jobId = craft?.id || data.craftJobId;
                    if (jobId) {
                        const collectRes = await callLdApi("/collect", "POST", { job_id: jobId });
                        if (collectRes && collectRes.success !== false && !collectRes.code && (collectRes.success || collectRes.data)) {
                            const pillName = collectRes.data?.pill_name || "Đan dược";
                            const stars = collectRes.data?.stars || 1;
                            log(`🧪 🏆 Thu hoạch thành công: ${pillName} ${"★".repeat(stars)}`, "success");

                            const pillId = collectRes.data?.pill_id;
                            if (pillId) {
                                log(`🧪 Đang tự động sử dụng đan để tăng Tu Vi...`, "info");
                                const useRes = await callLdApi("/use-pill", "POST", { pill_id: String(pillId) });
                                if (useRes && useRes.success !== false && !useRes.code && (useRes.success || useRes.data)) {
                                    log(`🧪 ✅ Đã sử dụng đan. Tu Vi nhận được: ${useRes.data?.tu_vi_granted || "thành công"}`, "success");
                                } else {
                                    log(`🧪 ⚠️ Lỗi khi sử dụng đan: ${useRes?.message || useRes?.code || 'không thành công'}`, "warning");
                                }
                            }
                        } else {
                            log(`🧪 ❌ Thu đan thất bại: ${collectRes?.message || collectRes?.code || 'lỗi mạng'}`, "error");
                        }
                    } else {
                        log("🧪 ❌ Không tìm thấy job_id để thu đan", "warning");
                    }
                    await sleep(CONFIG.delays.success);
                    continue;
                }

                if (furnace === "crafting") {
                    const unstableLeftSec = craft ? (craft.unstable_left_sec | 0) : 0;
                    const timerLeftSec = craft ? (craft.timer_left_sec | 0) : 0;
                    const stability = craft ? (craft.stability_pct != null ? parseFloat(craft.stability_pct) : 100) : 100;
                    const tuneCount = craft ? (craft.tune_count | 0) : 0;
                    const tuneSurvivalMin = (data.danMaster && data.danMaster.rng && data.danMaster.rng.tuneSurvivalMin) ? (data.danMaster.rng.tuneSurvivalMin | 0) : 3;
                    const isSurvival = tuneCount >= tuneSurvivalMin;

                    log(`🧪 Đang luyện. Còn lại: ${timerLeftSec}s. Giai đoạn nhạy cảm: ${unstableLeftSec}s. Độ ổn định: ${stability.toFixed(1)}%. Giữ lửa: ${tuneCount}/${tuneSurvivalMin}`, "info");

                    if (unstableLeftSec > 0 && !isSurvival) {
                        if (stability <= 68) {
                            const cooldown = craft ? (craft.tune_cooldown_left_sec | 0) : 0;
                            if (cooldown <= 0) {
                                log(`🧪 🔥 Độ ổn định tụt xuống ${stability.toFixed(1)}% <= 68%. Tiến hành Điều Hỏa...`, "warning");
                                const tuneRes = await callLdApi("/tune", "POST", {});
                                if (tuneRes && tuneRes.success !== false && !tuneRes.code && (tuneRes.success || tuneRes.data)) {
                                    const newStability = tuneRes.data?.craft?.stability_pct || stability;
                                    const newCount = tuneRes.data?.craft?.tune_count || (tuneCount + 1);
                                    log(`🧪 🔥 Điều Hỏa thành công! Độ ổn định mới: ${newStability}%. Giữ lửa: ${newCount}/${tuneSurvivalMin}`, "success");
                                } else {
                                    log(`🧪 ❌ Điều Hỏa thất bại: ${tuneRes?.message || tuneRes?.code || 'lỗi'}`, "error");
                                }
                                await sleep(CONFIG.delays.success);
                                continue;
                            } else {
                                log(`🧪 ⏳ Chờ cooldown Điều Hỏa: ${cooldown}s...`, "info");
                                await sleep(Math.min(cooldown * 1000, 3000));
                                continue;
                            }
                        } else {
                            const sleepTime = Math.max(1000, Math.min((stability - 68) * 1000, 5000));
                            log(`🧪 Lửa ổn định (${stability.toFixed(1)}%). Chờ check lại sau ${Math.round(sleepTime/1000)}s...`, "info");
                            await sleep(sleepTime);
                            continue;
                        }
                    } else {
                        log(`🧪 Lò đan đã an toàn tuyệt đối. Chờ hoàn thành sau ${timerLeftSec}s...`, "success");
                        const finishTime = Date.now() + (timerLeftSec * 1000) + 3000; // 3s buffer
                        while (Date.now() < finishTime && isRunning && sessionId === currentSessionId) {
                            await sleep(5000);
                        }
                        continue;
                    }
                }

                if (furnace === "idle") {
                    const targetTier = CONFIG.luyenDanConfig?.targetTier || "auto";
                    const tiersOrder = targetTier === "auto" ? ["cuc", "thuong", "trung", "ha"] : [targetTier];
                    let selectedTier = null;
                    let lackOfTn = false;

                    for (const tier of tiersOrder) {
                        const rec = recipes[tier];
                        const isUnlocked = rec ? !!rec.craft_unlocked : false;
                        if (isUnlocked) {
                            const vec = rec.vector || {};
                            let hasEnoughMats = true;
                            let totalNeed = 0;
                            const vecKeys = Object.keys(vec);
                            for (const el of vecKeys) {
                                const need = parseInt(vec[el], 10) || 0;
                                totalNeed += need;
                                const owned = parseInt(materials[el], 10) || 0;
                                if (owned < need) {
                                    hasEnoughMats = false;
                                    break;
                                }
                            }
                            if (totalNeed === 0) {
                                hasEnoughMats = false;
                            }
                            if (hasEnoughMats) {
                                const tnCost = rec.tien_ngoc_cost != null ? (rec.tien_ngoc_cost | 0) : 0;
                                const balance = data.tien_ngoc_balance != null ? (data.tien_ngoc_balance | 0) : 0;
                                if (balance < tnCost) {
                                    lackOfTn = true;
                                    continue;
                                }
                                selectedTier = tier;
                                break;
                            }
                        }
                    }

                    if (selectedTier) {
                        const didDecompose = await checkAndDecomposeIfFull(selectedTier, data);
                        if (didDecompose) {
                            await sleep(CONFIG.delays.success);
                            continue;
                        }

                        const bag = data.pill_bag?.[selectedTier] || {};
                        const stored = bag.stored != null ? parseInt(bag.stored, 10) : 0;
                        const cap = bag.cap != null ? parseInt(bag.cap, 10) : 0;
                        const isFull = bag.full != null ? !!bag.full : (cap > 0 && stored >= cap);
                        if (isFull) {
                            log(`🧪 ❌ Túi đan phẩm ${selectedTier.toUpperCase()} đã đầy. Vui lòng sử dụng hoặc phân giải đan. Dừng Luyện Đan Worker.`, "error");
                            break;
                        }

                        log(`🧪 Đủ nguyên liệu. Đang khai lò luyện phẩm: ${selectedTier.toUpperCase()}...`, "info");
                        const startRes = await callLdApi("/start", "POST", { tier: selectedTier });
                        if (startRes && startRes.success !== false && !startRes.code && (startRes.success || startRes.data)) {
                            log(`🧪 🔥 Khai lò Luyện Đan phẩm ${selectedTier.toUpperCase()} thành công!`, "success");
                        } else {
                            log(`🧪 ❌ Khai lò thất bại: ${startRes?.message || startRes?.code || 'lỗi'}`, "error");
                        }
                    } else if (lackOfTn) {
                        log("🧪 ❌ Thiếu Tiên Ngọc để khai lò luyện đan. Dừng Luyện Đan Worker.", "error");
                        break;
                    } else {
                        log("🧪 ❌ Không đủ nguyên liệu ngũ hành để luyện đan. Thử mở các gói linh dược trong túi...", "warning");
                        const matBundles = data.mat_bundles || [];
                        if (matBundles.length > 0) {
                            const bundle = matBundles[0];
                            const bundleKey = bundle.bundle_key;
                            log(`🧪 📦 Phát hiện túi linh dược ${bundle.name || bundleKey}. Đang tự động mở...`, "info");
                            const openRes = await callLdApi("/open-mat-bundle", "POST", { job_id: String(bundleKey), bundle_key: String(bundleKey) });
                            if (openRes && openRes.success !== false && !openRes.code && (openRes.success || openRes.data)) {
                                log(`🧪 ✅ Mở gói linh dược thành công!`, "success");
                            } else {
                                log(`🧪 ❌ Mở gói linh dược thất bại: ${openRes?.message || openRes?.code || 'lỗi'}`, "error");
                            }
                        } else {
                            log("🧪 ❌ Không còn nguyên liệu và gói linh dược nào. Dừng Luyện Đan Worker.", "error");
                            break;
                        }
                    }
                    await sleep(CONFIG.delays.success);
                    continue;
                }
            } catch (e) {
                log(`🧪 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runMeCungWorker(mySessionId) {
        log("⚔️ Khởi động Worker Mê Cung...", "success");

        // Đảm bảo script trong MAIN world được khởi tạo thông qua injectAndReadHh3dData
        try {
            await injectAndReadHh3dData();
        } catch (e) {
            console.error("Failed to inject script for Mê Cung:", e);
        }

        let lastStateKey = "";
        const failedRooms = new Map(); // roomCode -> { timestamp, attempts }

        while (isRunning && currentSessionId === mySessionId) {
            try {
                // 0. Kiểm tra extension context còn hợp lệ
                if (!isExtensionValid()) {
                    console.log("⚠️ Extension context lost - stopping Mê Cung worker");
                    isRunning = false;
                    break;
                }

                // Kiểm tra tab lock để tránh chạy trùng lặp ở nhiều tab
                const lockRes = await chrome.storage.local.get(['activeTabInstanceId']);
                if (lockRes.activeTabInstanceId && lockRes.activeTabInstanceId !== tabInstanceId) {
                    log("⚠️ Phát hiện tab khác đang chạy workers. Dừng workers ở tab này.", "warning");
                    isRunning = false;
                    break;
                }

                // 1. Kiểm tra URL trang
                if (!window.location.pathname.includes('/me-cung')) {
                    log("⚠️ Worker Mê Cung chỉ hoạt động khi ở trang Mê Cung (/me-cung). Vui lòng chuyển trang.", "warning");
                    await sleep(10000);
                    continue;
                }

                // 2. Lấy trạng thái hiện tại từ màn hình game
                const screenState = await runInPage(`
                    const screenLoading = document.getElementById("screen-loading");
                    const screenBattle = document.getElementById("screen-battle");
                    const screenLobby = document.getElementById("screen-lobby");
                    const roomPanel = document.getElementById("room-panel");
                    const lobbyOverview = document.getElementById("lobby-overview");

                    const inBattle = screenBattle && screenBattle.classList.contains("active");
                    const inLobby = screenLobby && screenLobby.classList.contains("active") && lobbyOverview && !lobbyOverview.classList.contains("hidden");
                    const inRoom = screenLobby && screenLobby.classList.contains("active") && roomPanel && !roomPanel.classList.contains("hidden");
                    const isLoading = screenLoading && !screenLoading.classList.contains("mc-loaded") && !inBattle && !inLobby && !inRoom;

                    const isHost = typeof Ne === 'function' ? Ne() : false;

                    return { isLoading, inBattle, inRoom, inLobby, isHost };
                `);

                if (!screenState) {
                    log("⚠️ Không thể kết nối với trang game Mê Cung. Đang thử lại...", "warning");
                    await sleep(3000);
                    continue;
                }

                // Ghi log trạng thái khi thay đổi
                const stateKey = `${screenState.inLobby}-${screenState.inRoom}-${screenState.inBattle}-${screenState.isLoading}-${screenState.isHost}`;
                if (stateKey !== lastStateKey) {
                    let stateName = "Không xác định";
                    if (screenState.isLoading) stateName = "Đang tải trang";
                    else if (screenState.inBattle) stateName = "Trong Trận Chiến";
                    else if (screenState.inRoom) stateName = "Trong Phòng Chờ " + (screenState.isHost ? "(Chủ phòng)" : "(Thành viên)");
                    else if (screenState.inLobby) stateName = "Đang ở Sảnh";
                    
                    log(`📱 Trạng thái game: ${stateName}`, "info");
                    lastStateKey = stateKey;
                }

                if (screenState.isLoading) {
                    await sleep(3000);
                    continue;
                }

                // 3. Kiểm tra giới hạn Huyền Tinh ngày (Chỉ kiểm tra khi game đã load xong)
                const stats = await runInPage(`
                    const usedEl = document.getElementById("mc-ht-daily-used");
                    const capEl = document.getElementById("mc-ht-daily-cap");
                    const used = usedEl ? parseInt(usedEl.textContent.trim()) : (typeof WP !== 'undefined' ? WP.htDailyUsed : null);
                    const cap = capEl ? parseInt(capEl.textContent.trim()) : (typeof WP !== 'undefined' ? WP.htDailyCap : null);
                    return { used, cap };
                `);

                if (stats && stats.used !== null) {
                    const cap = stats.cap || 200;
                    if (stats.used >= cap || stats.used >= 200) {
                        log(`⚔️ Đã đạt giới hạn Huyền Tinh trong ngày (${stats.used}/${cap}). Dừng worker Mê Cung.`, "success");
                        await markWorkerDone('meCung');
                        break;
                    }
                }

                // 4. Tự động tắt hộp thoại xác nhận khi có popups thông báo lỗi
                await runInPage(`
                    const confirmBtn = document.querySelector("#confirm-overlay .confirm-btn-ok");
                    if (confirmBtn) {
                        confirmBtn.click();
                        return true;
                    }
                    return false;
                `);

                if (screenState.inBattle) {
                    // Màn hình chiến đấu: Đảm bảo các cài đặt tự động chiến đấu luôn bật
                    await runInPage(`
                        // Tự động Tấn công
                        const autoAttackTrack = document.getElementById("auto-attack-track");
                        if (autoAttackTrack && !autoAttackTrack.classList.contains("on")) {
                            if (typeof window.toggleAutoAttack === 'function') window.toggleAutoAttack();
                        }
                        
                        // Chuyển ải tiếp theo khi qua ải
                        const rewardModal = document.getElementById("modal-reward");
                        if (rewardModal && !rewardModal.classList.contains("hidden")) {
                            const nextBtn = document.getElementById("btn-next-stage");
                            if (nextBtn && !nextBtn.disabled) {
                                nextBtn.click();
                            }
                        }

                        // Tự động quay lại sảnh khi thất bại
                        const failModal = document.getElementById("modal-fail");
                        if (failModal && !failModal.classList.contains("hidden")) {
                            if (typeof window.backToLobby === 'function') {
                                window.backToLobby();
                            }
                        }

                        // Nhận thưởng Boss 5 và quay lại sảnh
                        const b5RewardModal = document.getElementById("modal-b5-reward");
                        if (b5RewardModal && !b5RewardModal.classList.contains("hidden")) {
                            const backLobbyBtn = b5RewardModal.querySelector("button.btn-back-lobby");
                            if (backLobbyBtn) {
                                backLobbyBtn.click();
                            }
                        }
                    `);

                    await sleep(4000);
                    continue;
                }

                if (screenState.inRoom) {
                    failedRooms.clear(); // Xóa danh sách đen phòng khi đã vào phòng thành công
                    // Màn hình phòng chờ phó bản: Bật tất cả tính năng tự động phòng chờ
                    await runInPage(`
                        // Tự động Sẵn sàng
                        const autoReadyTrack = document.getElementById("auto-ready-track");
                        if (autoReadyTrack && !autoReadyTrack.classList.contains("on")) {
                            if (typeof window.toggleAutoReady === 'function') window.toggleAutoReady();
                        }

                        // Tự động Chuyển ải
                        const autoNextTrack = document.getElementById("auto-next-stage-track");
                        if (autoNextTrack && !autoNextTrack.classList.contains("on")) {
                            if (typeof window.toggleAutoNextStage === 'function') window.toggleAutoNextStage();
                        }

                        // Tự động Mở Rương
                        const autoOpenChestTrack = document.getElementById("auto-open-chest-track");
                        if (autoOpenChestTrack && !autoOpenChestTrack.classList.contains("on")) {
                            if (typeof window.toggleAutoOpenChest === 'function') window.toggleAutoOpenChest();
                        }
                    `);

                    // Nếu là Chủ phòng (Host): Kiểm tra số lượng người và trạng thái để Bắt đầu
                    if (screenState.isHost) {
                        const minPlayers = CONFIG.mecungConfig.minPlayers || 5;
                        const actionResult = await runInPage(`
                            const filledCards = document.querySelectorAll(".player-card.filled").length;
                            const btnStart = document.getElementById("btn-start");
                            
                            if (btnStart && filledCards >= arg && btnStart.classList.contains("ready-glow") && !btnStart.classList.contains("blocked-start")) {
                                btnStart.click();
                                return { clicked: true, count: filledCards };
                            }
                            return { clicked: false, count: filledCards };
                        `, minPlayers);

                        if (actionResult && actionResult.clicked) {
                            log(`⚔️ Đội hình đủ điều kiện (Số người: ${actionResult.count}/${minPlayers}). Bắt đầu trận chiến!`, "success");
                        }
                    } else {
                        // Thành viên (Member): Bấm Sẵn Sàng (nút dự phòng nếu auto-ready lỗi)
                        await runInPage(`
                            const btnStart = document.getElementById("btn-start");
                            if (btnStart && btnStart.textContent.includes("SẴN SÀNG") && !btnStart.textContent.includes("HỦY")) {
                                btnStart.click();
                            }
                        `);
                    }

                    await sleep(3000);
                    continue;
                }

                if (screenState.inLobby) {
                    // Màn hình Sảnh chính: Tìm phòng để vào hoặc tạo phòng
                    const role = CONFIG.mecungConfig.role || 'member';

                    // Dọn dẹp phòng hết hạn trong danh sách đen (quá 25 giây)
                    const now = Date.now();
                    for (const [code, info] of failedRooms.entries()) {
                        if (now - info.timestamp > 25000) {
                            failedRooms.delete(code);
                        }
                    }
                    const blacklistArray = Array.from(failedRooms.keys());

                    const lobbyAction = await runInPage(`
                        const role = arg.role;
                        const blacklist = arg.blacklist || [];

                        const availableJoinBtns = Array.from(document.querySelectorAll(".btn-join-room:not(.disabled)")).filter(btn => {
                            const onclickAttr = btn.getAttribute('onclick') || '';
                            const firstQuote = onclickAttr.indexOf("'");
                            const secondQuote = onclickAttr.indexOf("'", firstQuote + 1);
                            const code = (firstQuote !== -1 && secondQuote !== -1) ? onclickAttr.substring(firstQuote + 1, secondQuote) : '';
                            return code && !blacklist.includes(code);
                        });

                        if (role !== 'host' && availableJoinBtns.length > 0) {
                            const btn = availableJoinBtns[0];
                            const onclickAttr = btn.getAttribute('onclick') || '';
                            const firstQuote = onclickAttr.indexOf("'");
                            const secondQuote = onclickAttr.indexOf("'", firstQuote + 1);
                            const roomCode = (firstQuote !== -1 && secondQuote !== -1) ? onclickAttr.substring(firstQuote + 1, secondQuote) : 'unknown';

                            btn.click();
                            return { action: 'join', success: true, roomCode: roomCode };
                        }

                        if (role === 'member') {
                            if (typeof window.manualRefreshLobby === 'function') {
                                window.manualRefreshLobby();
                            }
                            return { action: 'refresh', success: true };
                        }

                        // Tạo phòng (áp dụng cho role 'host' hoặc 'auto' khi không tìm thấy phòng công khai)
                        const createBtn = document.querySelector(".btn-create-room") || document.querySelector('button[onclick="createRoom()"]');
                        if (createBtn) {
                            createBtn.click();
                            return { action: 'create', success: true };
                        }

                        return { action: 'none', success: false };
                    `, { role: role, blacklist: blacklistArray });

                    if (lobbyAction) {
                        if (lobbyAction.action === 'join' && lobbyAction.success) {
                            const targetCode = lobbyAction.roomCode;
                            log(`🏰 Phát hiện phòng công khai #${targetCode}. Đang tự động vào phòng...`, "info");

                            // Tăng số lần thử tham gia cho phòng này
                            const info = failedRooms.get(targetCode) || { timestamp: Date.now(), attempts: 0 };
                            info.attempts++;
                            info.timestamp = Date.now();
                            failedRooms.set(targetCode, info);

                            if (info.attempts >= 2) {
                                log(`⚠️ Phòng #${targetCode} không thể vào (đầy/lỗi). Tạm thời đưa vào danh sách đen.`, "warning");
                            }

                            await sleep(4000);
                        } else if (lobbyAction.action === 'create' && lobbyAction.success) {
                            log("🏰 Đang tạo phòng Mê Cung mới...", "info");
                            await sleep(1500); // Đợi modal tạo phòng hiển thị
                            // Bấm OK xác nhận tạo phòng
                            await runInPage(`
                                const confirmBtn = document.querySelector("#confirm-overlay .confirm-btn-ok");
                                if (confirmBtn) {
                                    confirmBtn.click();
                                    return true;
                                }
                                return false;
                            `);
                            await sleep(3000);
                        } else if (lobbyAction.action === 'refresh') {
                            log("🏰 Sảnh không có phòng công khai. Đang làm mới danh sách sảnh...", "info");
                            await sleep(4000);
                        }
                    }
                    continue;
                }

                await sleep(3000);

            } catch (e) {
                log(`💥 Lỗi trong vòng lặp Mê Cung: ${e.message}`, "error");
                await sleep(5000);
            }
        }
        log("⚔️ Đã dừng Worker Mê Cung.", "warning");
    }

    // ============= MESSAGE HANDLER =============
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Content script received:", message);

        (async () => {
            switch (message.type) {
                case 'START':
                    if (window !== window.top) {
                        sendResponse({ success: false, error: 'Not main frame' });
                        break;
                    }

                    const todayString = new Date().toDateString();
                    if (window.__pageLoadDate && window.__pageLoadDate !== todayString) {
                        log("📅 Trang game được tải từ ngày cũ. Đang tự động tải lại trang để tránh dữ liệu lỗi...", "warning");
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                        sendResponse({ success: true });
                        break;
                    }

                    if (isRunning) {
                        log("🔄 Workers already running, restarting...", "info");
                        isRunning = false;
                        await sleep(1000); // Allow old loops to see isRunning=false
                    }

                    currentSessionId++; // New session
                    const mySessionId = currentSessionId;
                    isRunning = true;
                    await chrome.storage.local.set({ activeTabInstanceId: tabInstanceId });

                    if (message.miningConfig) {
                        CONFIG.miningConfig.mineType = message.miningConfig.mineType || "silver";
                        CONFIG.miningConfig.mineId = message.miningConfig.mineId || null;
                    }

                    if (message.mecungConfig) {
                        CONFIG.mecungConfig.minPlayers = message.mecungConfig.minPlayers || 5;
                        CONFIG.mecungConfig.role = message.mecungConfig.role || "member";
                    }

                    if (message.luyenDanConfig) {
                        CONFIG.luyenDanConfig.targetTier = message.luyenDanConfig.targetTier || "auto";
                        CONFIG.luyenDanConfig.autoDecompose = !!message.luyenDanConfig.autoDecompose;
                        CONFIG.luyenDanConfig.decomposeTier = message.luyenDanConfig.decomposeTier || "ha";
                        CONFIG.luyenDanConfig.decomposeStars = message.luyenDanConfig.decomposeStars || "1-2";
                    }

                    const activeWorkers = [];
                    for (const name of message.workers) {
                        // Vòng quay (spin) có thể nhận thêm lượt trong ngày (từ Mốc 2), nên không bỏ qua khi startup
                        if (name !== 'spin' && await isWorkerDone(name)) {
                            const vnNames = { chest: 'Rương', boss: 'Boss HV', bossTongMon: 'Boss TM', spin: 'Quay', tltm: 'TLTM', vanDap: 'Vấn Đáp', teLe: 'Tế Lễ', dailyReward: 'Daily', mining: 'Đào Mỏ', luyenDan: 'Luyện Đan', meCung: 'Mê Cung' };
                            log(`ℹ️ ${vnNames[name] || name} đã xong hôm nay. Bỏ qua.`, 'success');
                            continue;
                        }
                        activeWorkers.push(name);
                    }

                    await fetchNonces(activeWorkers);
                    await dailyCheckIn();

                    const workerMap = {
                        chest: runChestWorker,
                        boss: runBossWorker,
                        bossTongMon: runBossTongMonWorker,
                        spin: runSpinWorker,
                        tltm: runTltmWorker,
                        vanDap: runVanDapWorker,
                        teLe: runTeLeWorker,
                        dailyReward: runDailyRewardWorker,
                        mining: runMiningWorker,
                        luyenDan: runLuyenDanWorker,
                        meCung: runMeCungWorker
                    };

                    for (const name of activeWorkers) {
                        if (workerMap[name]) {
                            workerMap[name](mySessionId).catch(e => log(`💥 ${name} crashed: ${e.message}`, 'error'));
                        }
                    }
                    // Store for potential resume
                    activeWorkerNames = message.workers;
                    savedMiningConfig = message.miningConfig;
                    savedMecungConfig = message.mecungConfig;
                    savedLuyenDanConfig = message.luyenDanConfig;

                    // Save to storage for auto-resume on tab refresh
                    await saveWorkerConfig(message.workers, message.miningConfig, message.mecungConfig, message.luyenDanConfig);

                    // Start heartbeat
                    startHeartbeat();

                    sendResponse({ success: true });
                    break;

                case 'STOP':
                    isRunning = false;
                    activeWorkerNames = [];
                    savedMiningConfig = null;
                    savedMecungConfig = null;
                    savedLuyenDanConfig = null;
                    stopHeartbeat();
                    // Clear saved config so we don't auto-resume
                    await clearWorkerConfig();
                    log("⏹️ Đã dừng workers", "warning");
                    sendResponse({ success: true });
                    break;

                case 'CHECK_STATUS':
                    sendResponse({ isRunning });
                    break;

                case 'PING':
                    sendResponse({ pong: true });
                    break;

                case 'STATE_SYNC':
                    // Background is telling us the running state (after service worker restart or tab reload)
                    if (message.isRunning && !isRunning && !isResuming) {
                        log("🔄 Nhận thông báo đồng bộ từ background - đang tự động resume...", "info");
                        // Auto-resume workers
                        resumeWorkers().then(resumed => {
                            if (resumed) {
                                log("✅ Tự động resume thành công!", "success");
                            }
                        });
                    }
                    sendResponse({ success: true, currentState: isRunning });
                    break;

                case 'NEW_DAY_RESET':
                    log("🌅 Nhận thông báo ngày mới từ background. Đang tải lại trang...", "info");
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                    sendResponse({ success: true });
                    break;

                case 'LOAD_MINES':
                    try {
                        if (!CONFIG.nonces.mining) {
                            await fetchMiningNonces();
                        }
                        if (!CONFIG.nonces.mining) {
                            sendResponse({ success: false, error: 'Không lấy được mining nonce' });
                            break;
                        }
                        const mineType = message.mineType || 'silver';
                        const result = await postForm(CONFIG.endpoints.api, {
                            action: 'load_mines_by_type',
                            mine_type: mineType,
                            security: CONFIG.nonces.mining
                        });
                        if (result?.success && result?.data) {
                            sendResponse({ success: true, mines: result.data });
                        } else {
                            sendResponse({ success: false, error: result?.message || 'Lỗi load mines' });
                        }
                    } catch (e) {
                        sendResponse({ success: false, error: e.message });
                    }
                    break;

                default:
                    sendResponse({ error: 'Unknown' });
            }
        })();

        return true;
    });

    // Auto-save spin route if we are on the spin page
    if (window.location.pathname.includes('/vong-quay-phuc-van/')) {
        setTimeout(async () => {
            try {
                const pageData = await injectAndReadHh3dData();
                const route = pageData.lotterySpin;
                if (route && route !== "spin") {
                    await chrome.storage.local.set({ lastKnownSpinRoute: route });
                    console.log("🎡 [Auto-Save] Saved last known spin route:", route);
                }
            } catch (e) {
                console.error("Failed to auto-save spin route:", e);
            }
        }, 1000);
    }

    // Notify that content script is ready
    safeSendMessage({ type: 'CONTENT_READY' });

} // End of if (!window.__HH3D_INITIALIZED__)
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
            bossCheckElemAction: null,
            bossChangeElemAction: null,
            chestTimerAction: null,
            chestOpenAction: null,
            chestClaimAction: null,
            tltmTimerAction: null,
            tltmOpenAction: null,
            tltmAttackAction: null,
            vdLoadAction: null,
            vdSaveAction: null,
            dailyRewardAction: null,
            securityTokenMiner: null,
            mining: null,
            enterMine: null,
            claimMine: null,
            getUsersMine: null,
            kmListAct: null,
            kmEnterAct: null,
            kmClaimAct: null,
            kmUsersAct: null,
            kmRewardAct: null,
            kmCheckAct: null,
            kmRewardNonce: null,
            kmCheckNonce: null
        },
        miningConfig: {
            mineId: null,
            mineType: null
        },
        mecungConfig: {
            minPlayers: 5,
            role: "member",
            maxCap: null
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
    let activeWorkerNames = []; // Store worker names for resume
    let savedMiningConfig = null; // Store mining config for resume
    let savedMecungConfig = null; // Store Mê Cung config for resume
    let savedLuyenDanConfig = null; // Store Luyện Đan config for resume
    let heartbeatTimer = null;
    let missedHeartbeats = 0;
    let nextRequestTime = Date.now();
    let isResuming = false; // Flag to prevent double resume
    let forceSpinCheck = false; // Flag to interrupt spin sleep when milestone 2 is claimed
    let sessionAbortController = null;
    let spinWakeController = null;
    let bossElementState = {
        bossId: null,
        bossElement: null,
        userElement: null,
        freeChange: false,
        checkedBossId: null
    };

    // ============= UTILITIES =============
    const sleep = (ms, signal = sessionAbortController?.signal) => {
        if (signal?.aborted) return Promise.resolve();
        return new Promise((resolve) => {
            let onAbort = null;
            const timer = setTimeout(() => {
                if (signal && onAbort) signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            if (signal) {
                onAbort = () => {
                    clearTimeout(timer);
                    resolve();
                };
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    };
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

    // Helper trích xuất object JSON gán cho biến (ví dụ window.HV2 = {...};) an toàn với dấu ';' bên trong chuỗi
    function extractAssignedJsonObject(html, varNames) {
        if (!html || !Array.isArray(varNames)) return null;
        for (const varName of varNames) {
            const assignRegex = new RegExp(`(?:window\\.)?${varName}\\s*=\\s*\\{`);
            const match = assignRegex.exec(html);
            if (!match) continue;

            const startIdx = match.index + match[0].length - 1;
            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let i = startIdx; i < html.length; i++) {
                const ch = html[i];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === '"') {
                        inString = false;
                    }
                    continue;
                }
                if (ch === '"') {
                    inString = true;
                } else if (ch === '{') {
                    depth++;
                } else if (ch === '}') {
                    depth--;
                    if (depth === 0) {
                        try {
                            return JSON.parse(html.slice(startIdx, i + 1));
                        } catch (e) {
                            break;
                        }
                    }
                }
            }
        }
        return null;
    }

    // Helper trích xuất window.HV2 (hoặc window.HH3DBossConfig cũ) từ HTML của trang /hoang-vuc
    function extractBossConfig(html) {
        if (!html) return null;
        const cfg = extractAssignedJsonObject(html, ['HV2', 'HH3DBossConfig']);
        if (cfg) {
            return {
                nonce: cfg.nonce || null,
                attackToken: cfg.attackToken || null,
                boss: cfg.boss || null,
                user: cfg.user || null,
                nextAttackMs: cfg.nextAttackMs ?? null,
                serverMs: cfg.serverMs ?? null,
                pending: cfg.pending ?? false,
                sealed: cfg.sealed ?? false,
                maintenanceRemaining: cfg.maintenanceRemaining ?? null,
                useAttackWorker: cfg.useWorker ?? cfg.useAttackWorker ?? null
            };
        }

        // Fallback regex nếu JSON.parse không bắt được
        const nonceMatch = html.match(/(?:HV2|HH3DBossConfig)[\s\S]*?["']?nonce["']?\s*:\s*["']([a-f0-9]{8,})["']/i);
        const tokenMatch = html.match(/(?:HV2|HH3DBossConfig)[\s\S]*?["']?attackToken["']?\s*:\s*["']([a-f0-9]{16,})["']/i)
            || html.match(/["']?attackToken["']?\s*:\s*["']([a-f0-9]{16,})["']/i);
        if (nonceMatch || tokenMatch) {
            return {
                nonce: nonceMatch ? nonceMatch[1] : null,
                attackToken: tokenMatch ? tokenMatch[1] : null
            };
        }
        return null;
    }

    // Helper kiểm tra route quay số hợp lệ (loại bỏ đường dẫn file asset/audio/nhạc mp3)
    function isValidSpinRoute(route) {
        if (!route || typeof route !== 'string') return false;
        const trimmed = route.trim();
        if (trimmed.length === 0) return false;
        if (/\.(mp3|wav|ogg|m4a|png|jpg|jpeg|gif|webp|svg|css|js|json)$/i.test(trimmed)) return false;
        if (trimmed.includes("wp-content") || trimmed.includes("assets") || trimmed.includes("/") || trimmed.includes("\\")) return false;
        return /^[a-zA-Z0-9_-]+$/.test(trimmed);
    }

    function wakeSpinWorker() {
        forceSpinCheck = true;
        if (spinWakeController && !spinWakeController.signal.aborted) {
            spinWakeController.abort();
        }
    }

    // Giao tiếp với inject.js trong MAIN world qua allowlist command cố định
    function callPageBridge(cmd, arg = null, timeoutMs = 4000) {
        return new Promise((resolve) => {
            const id = `cmd_${Math.random().toString(16).slice(2)}_${Date.now()}`;
            let settled = false;
            const cleanup = () => {
                window.removeEventListener('message', handler);
                clearTimeout(timer);
            };
            const handler = (e) => {
                if (e.source !== window || e.origin !== window.location.origin) return;
                if (e.data && e.data.type === '__hh3d_cmd_res__' && e.data.id === id) {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (e.data.success) {
                        resolve(e.data.payload ?? null);
                    } else {
                        resolve(null);
                    }
                }
            };
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(null);
            }, timeoutMs);

            window.addEventListener('message', handler);
            window.postMessage({ type: '__hh3d_cmd__', id: id, cmd: cmd, arg: arg }, window.location.origin);
        });
    }

    // ============= ĐỌC hh3dData TỪ MAIN WORLD QUA BRIDGE =============
    async function injectAndReadHh3dData() {
        const data = await callPageBridge('readHh3dData', null, 3000);
        return data || {};
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
                            minPlayers: result.popupState.mecungConfig.minPlayers ? parseInt(result.popupState.mecungConfig.minPlayers, 10) : 5,
                            role: result.popupState.mecungConfig.role || 'member',
                            maxCap: result.popupState.mecungConfig.maxCap ? parseInt(result.popupState.mecungConfig.maxCap, 10) : null
                        };
                    }

                    // Build luyenDan config from popupState
                    let luyenDanConfig = null;
                    if (result.popupState.luyenDanConfig) {
                        luyenDanConfig = {
                            targetTier: result.popupState.luyenDanConfig.targetTier || 'auto',
                            autoDecompose: !!result.popupState.luyenDanConfig.autoDecompose,
                            decomposeTier: result.popupState.luyenDanConfig.decomposeTier || 'ha',
                            decomposeStars: result.popupState.luyenDanConfig.decomposeStars || '1-2'
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
            if (sessionAbortController) sessionAbortController.abort();
            if (spinWakeController && !spinWakeController.signal.aborted) {
                spinWakeController.abort();
                spinWakeController = null;
            }
            clearPendingQueue();
            sessionAbortController = new AbortController();
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
                CONFIG.mecungConfig.minPlayers = parseInt(config.mecungConfig.minPlayers, 10) || 5;
                CONFIG.mecungConfig.role = config.mecungConfig.role || 'member';
                CONFIG.mecungConfig.maxCap = config.mecungConfig.maxCap ? parseInt(config.mecungConfig.maxCap, 10) : null;
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
            let skippedBossTongMonDone = false;
            let skippedChestDone = false;
            for (const name of config.workers) {
                // Vòng quay (spin) có thể nhận thêm lượt trong ngày (từ Mốc 2), nên không bỏ qua khi startup
                if (name !== 'spin' && await isWorkerDone(name)) {
                    const vnNames = { chest: 'Rương', boss: 'Boss HV', bossTongMon: 'Boss TM', spin: 'Quay', tltm: 'TLTM', vanDap: 'Vấn Đáp', teLe: 'Tế Lễ', dailyReward: 'Daily', mining: 'Đào Mỏ', luyenDan: 'Luyện Đan', meCung: 'Mê Cung' };
                    log(`ℹ️ ${vnNames[name] || name} đã xong hôm nay. Bỏ qua.`, 'success');
                    if (name === 'bossTongMon') skippedBossTongMonDone = true;
                    if (name === 'chest') skippedChestDone = true;
                    continue;
                }
                activeWorkers.push(name);
            }

            await fetchNonces(activeWorkers);
            await dailyCheckIn(mySessionId);
            if (skippedBossTongMonDone) {
                await checkAndClaimBossTongMonReward().catch(() => { });
            }
            if (skippedChestDone) {
                await checkAndClaimPhucLoiMilestones().catch(() => { });
            }

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
            savedLuyenDanConfig = config.luyenDanConfig;

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

    // Global multi-tab lock: dừng toàn bộ workers ngay khi tab khác chiếm activeTabInstanceId
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes.activeTabInstanceId) return;
            const nextOwner = changes.activeTabInstanceId.newValue;
            if (isRunning && nextOwner && nextOwner !== tabInstanceId) {
                log("⚠️ Phát hiện tab khác đang chạy workers. Dừng workers ở tab này.", "warning");
                isRunning = false;
                if (sessionAbortController) {
                    sessionAbortController.abort();
                    sessionAbortController = null;
                }
                if (spinWakeController && !spinWakeController.signal.aborted) {
                    spinWakeController.abort();
                    spinWakeController = null;
                }
                clearPendingQueue();
                stopHeartbeat();
            }
        });
    }

    // Detect manual claim of Milestone 2 (Vòng Quay)
    document.addEventListener("click", (e) => {
        const target = e.target;
        if (target && (target.id === "btn2" || target.closest("#btn2"))) {
            log("🎡 Phát hiện click nhận Mốc 2, lên lịch kiểm tra vòng quay sau 3 giây...", "info");
            setTimeout(() => {
                const rc2 = document.getElementById("rc2");
                if (rc2 && rc2.classList.contains("claimed")) {
                    clearWorkerDone('spin');
                    wakeSpinWorker();
                    log("🎡 Đã nhận thành công Mốc 2 thủ công. Kích hoạt lượt quay mới!", "success");
                }
            }, 3000);
        }
    });

    // ============= HTTP CLIENT (QUEUE-BASED) =============
    // Priority queue để đảm bảo tuần tự nhưng vẫn ưu tiên tác vụ khẩn cấp (vd: điều hỏa Luyện Đan)
    const pendingQueue = [];
    let queueRunning = false;
    const REQUEST_TIMEOUT_MS = 30000;

    function clearPendingQueue(onlyAborted = false) {
        if (onlyAborted) {
            for (let i = pendingQueue.length - 1; i >= 0; i--) {
                if (pendingQueue[i].signal?.aborted) {
                    const [removed] = pendingQueue.splice(i, 1);
                    removed.resolve(false);
                }
            }
            return;
        }
        while (pendingQueue.length > 0) {
            const task = pendingQueue.shift();
            task.resolve(false);
        }
    }

    async function drainRequestQueue() {
        if (queueRunning) return;
        queueRunning = true;
        try {
            while (pendingQueue.length > 0) {
                const task = pendingQueue.shift();
                if (task.signal?.aborted) {
                    task.resolve(false);
                    continue;
                }
                const now = Date.now();
                if (now < nextRequestTime) {
                    await sleep(nextRequestTime - now, task.signal || null);
                }
                if (task.signal?.aborted) {
                    task.resolve(false);
                    continue;
                }
                nextRequestTime = Date.now() + CONFIG.delays.minRequestGap;
                task.resolve(true);
            }
        } finally {
            queueRunning = false;
        }
    }

    function enforceDelay(priority = 'normal', signal = null) {
        if (signal?.aborted) return Promise.resolve(false);
        return new Promise((resolve) => {
            const item = { priority, signal, resolve };
            if (priority === 'high') {
                const insertIdx = pendingQueue.findIndex(q => q.priority !== 'high');
                if (insertIdx === -1) pendingQueue.push(item);
                else pendingQueue.splice(insertIdx, 0, item);
            } else {
                pendingQueue.push(item);
            }
            drainRequestQueue();
        });
    }

    // Random jitter để tránh thundering herd khi retry
    const jitter = (base) => base + Math.floor(Math.random() * 2000);

    async function request(endpoint, options = {}, retryCount = 0) {
        const MAX_RETRIES = 5;
        const RETRY_DELAY = 3000; // 3 seconds base delay
        const { priority = 'normal', allowWhenStopped = false, ...fetchOptions } = options;
        const sessionSignal = allowWhenStopped ? null : (sessionAbortController?.signal || null);

        if (sessionSignal?.aborted) {
            return { success: false, aborted: true, message: 'Session stopped' };
        }

        const proceed = await enforceDelay(priority, sessionSignal);
        if (!proceed || sessionSignal?.aborted) {
            return { success: false, aborted: true, message: 'Session stopped' };
        }

        const url = endpoint.startsWith("http") ? endpoint : `${CONFIG.baseUrl}${endpoint}`;
        const reqController = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            reqController.abort();
        }, REQUEST_TIMEOUT_MS);

        const onSessionAbort = () => reqController.abort();
        if (sessionSignal) {
            if (sessionSignal.aborted) {
                clearTimeout(timeoutId);
                return { success: false, aborted: true, message: 'Session stopped' };
            }
            sessionSignal.addEventListener('abort', onSessionAbort, { once: true });
        }

        try {
            const res = await fetch(url, { credentials: "include", ...fetchOptions, signal: reqController.signal });

            // Handle 503 Service Unavailable - retry automatically
            if (res.status === 503) {
                if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
                if (retryCount < MAX_RETRIES) {
                    const delay = jitter(RETRY_DELAY * (retryCount + 1));
                    console.log(`⚠️ 503 Error - Retry ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`);
                    log(`⚠️ Server 503 - Thử lại lần ${retryCount + 1}/${MAX_RETRIES}...`, 'warning');
                    await sleep(delay, sessionSignal);
                    if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
                    return request(endpoint, options, retryCount + 1);
                } else {
                    log(`❌ Server 503 - Đã thử ${MAX_RETRIES} lần không thành công`, 'error');
                    return { success: false, message: 'Server không phản hồi sau 5 lần thử' };
                }
            }

            // Handle 429 Too Many Requests - retry automatically
            if (res.status === 429) {
                if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = res.headers.get('Retry-After');
                    const delay = retryAfter ? parseInt(retryAfter) * 1000 : jitter(RETRY_DELAY * (retryCount + 1) * 2);
                    console.log(`⚠️ 429 Too Many Requests - Retry ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`);
                    log(`⚠️ Rate Limited (429) - Thử lại lần ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`, 'warning');
                    await sleep(delay, sessionSignal);
                    if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
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
                            await sleep(3000, sessionSignal);
                            window.location.reload();
                        }
                        msg = text.substring(0, 200) || msg;
                    }
                } catch (e) {
                    console.error("Error reading error response", e);
                }

                if (typeof msg === "string" && (msg.includes("Phiên đã hết hạn") || msg.includes("Phiên hết hạn") || msg.includes("phiên đăng nhập hết hạn") || (msg.includes("IP") && msg.includes("thay đổi")))) {
                    log("🛑 ⚠️ Phát hiện phiên đăng nhập hết hạn! Đang tự động tải lại trang...", "error");
                    await sleep(3000, sessionSignal);
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
                    await sleep(3000, sessionSignal);
                    window.location.reload();
                }
            } else {
                const text = await res.text();
                if (text.includes("Phiên đã hết hạn") || text.includes("phiên đăng nhập đã hết hạn")) {
                    log("🛑 ⚠️ Phát hiện phiên đăng nhập hết hạn! Đang tự động tải lại trang...", "error");
                    await sleep(3000, sessionSignal);
                    window.location.reload();
                }
                data = JSON.parse(text);
            }
            return data;
        } catch (e) {
            if (e.name === 'AbortError') {
                if (sessionSignal?.aborted) {
                    return { success: false, aborted: true, message: 'Session stopped' };
                }
                if (timedOut && retryCount < MAX_RETRIES) {
                    const delay = jitter(RETRY_DELAY * (retryCount + 1));
                    log(`⚠️ Request timeout - Thử lại lần ${retryCount + 1}/${MAX_RETRIES}...`, 'warning');
                    await sleep(delay, sessionSignal);
                    if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
                    return request(endpoint, options, retryCount + 1);
                }
                return { success: false, message: 'Request timeout' };
            }
            // Network errors - also retry
            if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
            if (retryCount < MAX_RETRIES && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))) {
                const delay = jitter(RETRY_DELAY * (retryCount + 1));
                console.log(`⚠️ Network error - Retry ${retryCount + 1}/${MAX_RETRIES} sau ${(delay / 1000).toFixed(1)}s...`);
                log(`⚠️ Lỗi mạng - Thử lại lần ${retryCount + 1}/${MAX_RETRIES}...`, 'warning');
                await sleep(delay, sessionSignal);
                if (sessionSignal?.aborted) return { success: false, aborted: true, message: 'Session stopped' };
                return request(endpoint, options, retryCount + 1);
            }
            throw e;
        } finally {
            clearTimeout(timeoutId);
            if (sessionSignal) {
                sessionSignal.removeEventListener('abort', onSessionAbort);
            }
        }
    }

    async function postForm(endpoint, data, options = {}) {
        return request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
            body: new URLSearchParams(data),
            ...options
        });
    }

    async function postJson(endpoint, data = {}, options = {}) {
        const headers = {
            "Content-Type": "application/json",
            "X-WP-Nonce": CONFIG.nonces.wp
        };

        return request(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(data),
            ...options
        });
    }

    // ============= FETCH NONCES =============
    async function fetchNonces(activeWorkers = []) {
        console.log("🔐 Đang tải Nonces...");

        const fetchPage = async (url) => {
            for (let i = 0; i < 3; i++) {
                try {
                    await sleep(i === 0 ? 250 : 1200 * i);
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
                /["']lotterySpin["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i,
                /lotterySpin\s*:\s*["']([a-zA-Z0-9_-]+)["']/i,
                /hh3dData\.act\.lotterySpin\s*=\s*["']([a-zA-Z0-9_-]+)["']/i,
                /["'](?:luckySpin|quaySo|vongQuay|quay|lottery|spin)["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i,
            ],
            chest: [
                /open_chest_pl[^}]*security["\s:]+["']([a-f0-9]{10})["']/i,
                /phuc_loi[^}]*security["\s:]+["']([a-f0-9]{10})["']/i,
            ],
            wp: [
                /wpApiSettings\s*=\s*{[^}]*nonce\s*:\s*"([a-f0-9]{10})"/i,
                /customRestNonce\s*=\s*["']([a-f0-9]{10})["']/i,
                /"nonce"\s*:\s*"([a-f0-9]{10})"/i
            ],
            chestTimer: [
                /hh3dData\.act\.plTimer\s*=\s*["']([^"']+)["']/i,
                /["']plTimer["']\s*:\s*["']([^"']+)["']/i,
            ],
            chestOpen: [
                /hh3dData\.act\.plOpen\s*=\s*["']([^"']+)["']/i,
                /["']plOpen["']\s*:\s*["']([^"']+)["']/i,
            ],
            chestClaim: [
                /hh3dData\.act\.plClaim\s*=\s*["']([^"']+)["']/i,
                /["']plClaim["']\s*:\s*["']([^"']+)["']/i,
            ],
            tltmTimer: [
                /hh3dData\.act\.tltmTimer\s*=\s*["']([^"']+)["']/i,
                /["']tltmTimer["']\s*:\s*["']([^"']+)["']/i,
            ],
            tltmOpen: [
                /hh3dData\.act\.tltmOpen\s*=\s*["']([^"']+)["']/i,
                /["']tltmOpen["']\s*:\s*["']([^"']+)["']/i,
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
            const homeWpNonce = extractSecurity(home, patterns.wp);
            if (homeWpNonce) CONFIG.nonces.wp = homeWpNonce;
            else if (!CONFIG.nonces.wp && CONFIG.nonces.restNonce) CONFIG.nonces.wp = CONFIG.nonces.restNonce;

            // Decrypt homepage actions
            const homeDecrypted = decryptHh3dActions(home);
            if (homeDecrypted) {
                console.log("🐉 [Home Decrypted Actions]:", Object.keys(homeDecrypted));
                const spinAction = homeDecrypted.lotterySpin || homeDecrypted.spin || homeDecrypted.luckySpin || homeDecrypted.quay || homeDecrypted.quaySo || homeDecrypted.lottery || homeDecrypted.vongQuay;
                if (isValidSpinRoute(spinAction)) CONFIG.nonces.lotterySpin = spinAction;
                if (homeDecrypted.plTimer) CONFIG.nonces.chestTimerAction = homeDecrypted.plTimer;
                if (homeDecrypted.plOpen) CONFIG.nonces.chestOpenAction = homeDecrypted.plOpen;
                if (homeDecrypted.plClaim) CONFIG.nonces.chestClaimAction = homeDecrypted.plClaim;
                if (homeDecrypted.bossAttack) CONFIG.nonces.bossAttackAction = homeDecrypted.bossAttack;
                if (homeDecrypted.bossGet) CONFIG.nonces.bossGetAction = homeDecrypted.bossGet;
                if (homeDecrypted.bossTimer) CONFIG.nonces.bossTimerAction = homeDecrypted.bossTimer;
                if (homeDecrypted.bossCheckElem) CONFIG.nonces.bossCheckElemAction = homeDecrypted.bossCheckElem;
                if (homeDecrypted.bossChangeElem) CONFIG.nonces.bossChangeElemAction = homeDecrypted.bossChangeElem;
                if (homeDecrypted.tltmTimer) CONFIG.nonces.tltmTimerAction = homeDecrypted.tltmTimer;
                if (homeDecrypted.tltmOpen) CONFIG.nonces.tltmOpenAction = homeDecrypted.tltmOpen;
                if (homeDecrypted.tltmAttack) CONFIG.nonces.tltmAttackAction = homeDecrypted.tltmAttack;
                if (homeDecrypted.vdLoad) CONFIG.nonces.vdLoadAction = homeDecrypted.vdLoad;
                if (homeDecrypted.vdSave) CONFIG.nonces.vdSaveAction = homeDecrypted.vdSave;
                if (homeDecrypted.kmList) CONFIG.nonces.kmListAct = homeDecrypted.kmList;
                if (homeDecrypted.kmEnter) CONFIG.nonces.kmEnterAct = homeDecrypted.kmEnter;
                if (homeDecrypted.kmClaim) CONFIG.nonces.kmClaimAct = homeDecrypted.kmClaim;
                if (homeDecrypted.kmUsers) CONFIG.nonces.kmUsersAct = homeDecrypted.kmUsers;
                if (homeDecrypted.kmReward) CONFIG.nonces.kmRewardAct = homeDecrypted.kmReward;
                if (homeDecrypted.kmCheck) CONFIG.nonces.kmCheckAct = homeDecrypted.kmCheck;
                if (homeDecrypted.hdnReward) CONFIG.nonces.dailyRewardAction = homeDecrypted.hdnReward;
            }
            if (!isValidSpinRoute(CONFIG.nonces.lotterySpin)) {
                const extracted = extractSecurity(home, patterns.lotterySpin);
                if (isValidSpinRoute(extracted)) CONFIG.nonces.lotterySpin = extracted;
            }
        }

        if (activeWorkers.includes('spin')) {
            if (!isValidSpinRoute(CONFIG.nonces.lotterySpin)) {
                const spinPage = await fetchPage("/vong-quay-phuc-van/");
                if (spinPage) {
                    const spinDecrypted = decryptHh3dActions(spinPage);
                    const spinAction = spinDecrypted ? (spinDecrypted.lotterySpin || spinDecrypted.spin || spinDecrypted.luckySpin || spinDecrypted.quay || spinDecrypted.quaySo || spinDecrypted.lottery || spinDecrypted.vongQuay) : null;
                    if (spinDecrypted) {
                        console.log("🐉 [Spin Decrypted Actions]:", Object.keys(spinDecrypted));
                    }
                    if (isValidSpinRoute(spinAction)) {
                        CONFIG.nonces.lotterySpin = spinAction;
                        await chrome.storage.local.set({ lastKnownSpinRoute: spinAction });
                    } else {
                        const extracted = extractSecurity(spinPage, patterns.lotterySpin);
                        if (isValidSpinRoute(extracted)) {
                            CONFIG.nonces.lotterySpin = extracted;
                        }
                    }
                }
            } else {
                await chrome.storage.local.set({ lastKnownSpinRoute: CONFIG.nonces.lotterySpin });
            }

            if (!isValidSpinRoute(CONFIG.nonces.lotterySpin)) {
                CONFIG.nonces.lotterySpin = "spin";
            }

            if (CONFIG.nonces.lotterySpin === "spin") {
                const saved = await chrome.storage.local.get(['lastKnownSpinRoute']);
                if (saved.lastKnownSpinRoute) {
                    if (isValidSpinRoute(saved.lastKnownSpinRoute)) {
                        CONFIG.nonces.lotterySpin = saved.lastKnownSpinRoute;
                        console.log("🎡 [Startup] Using last known spin route from storage:", CONFIG.nonces.lotterySpin);
                    } else {
                        console.warn("🎡 [Startup] Removing invalid stored spin route:", saved.lastKnownSpinRoute);
                        await chrome.storage.local.remove(['lastKnownSpinRoute']);
                    }
                }
            }
        }

        const needBoss = activeWorkers.length === 0 || activeWorkers.includes('boss');
        if (needBoss) {
            const bossPage = await fetchPage(CONFIG.pages.boss);
            if (bossPage) {
                applyBossPageConfig(bossPage);
            }
        }

        // Extract chest actions from chest page if needed
        if (activeWorkers.includes('chest') && (!CONFIG.nonces.chestTimerAction || !CONFIG.nonces.chestOpenAction || !CONFIG.nonces.chestClaimAction)) {
            const chestPage = await fetchPage(CONFIG.pages.chest);
            if (chestPage) {
                const chestDecrypted = decryptHh3dActions(chestPage);
                if (chestDecrypted) {
                    if (chestDecrypted.plTimer) CONFIG.nonces.chestTimerAction = chestDecrypted.plTimer;
                    if (chestDecrypted.plOpen) CONFIG.nonces.chestOpenAction = chestDecrypted.plOpen;
                    if (chestDecrypted.plClaim) CONFIG.nonces.chestClaimAction = chestDecrypted.plClaim;
                }
                if (!CONFIG.nonces.chestTimerAction) {
                    CONFIG.nonces.chestTimerAction = extractSecurity(chestPage, patterns.chestTimer);
                }
                if (!CONFIG.nonces.chestOpenAction) {
                    CONFIG.nonces.chestOpenAction = extractSecurity(chestPage, patterns.chestOpen);
                }
                if (!CONFIG.nonces.chestClaimAction) {
                    CONFIG.nonces.chestClaimAction = extractSecurity(chestPage, patterns.chestClaim);
                }
            }
        }

        const needTltmActions = activeWorkers.includes('tltm') && (!CONFIG.nonces.tltmTimerAction || !CONFIG.nonces.tltmOpenAction);
        if (!CONFIG.nonces.wp || needTltmActions) {
            const wpPage = await fetchPage(CONFIG.pages.wp);
            if (wpPage) {
                const extractedWp = extractSecurity(wpPage, patterns.wp);
                if (extractedWp) CONFIG.nonces.wp = extractedWp;
                const wpDecrypted = decryptHh3dActions(wpPage);
                if (wpDecrypted) {
                    if (wpDecrypted.tltmTimer) CONFIG.nonces.tltmTimerAction = wpDecrypted.tltmTimer;
                    if (wpDecrypted.tltmOpen) CONFIG.nonces.tltmOpenAction = wpDecrypted.tltmOpen;
                    if (wpDecrypted.tltmAttack) CONFIG.nonces.tltmAttackAction = wpDecrypted.tltmAttack;
                }
                if (!CONFIG.nonces.tltmTimerAction) {
                    CONFIG.nonces.tltmTimerAction = extractSecurity(wpPage, patterns.tltmTimer);
                }
                if (!CONFIG.nonces.tltmOpenAction) {
                    CONFIG.nonces.tltmOpenAction = extractSecurity(wpPage, patterns.tltmOpen);
                }
                if (!CONFIG.nonces.tltmAttackAction) {
                    CONFIG.nonces.tltmAttackAction = extractSecurity(wpPage, patterns.tltmAttack);
                }
            }
        }

        // Fetch mining nonces if included
        if (activeWorkers.includes('mining')) {
            await fetchMiningNonces();
        }

        // Fetch daily reward action if needed
        if (activeWorkers.includes('dailyReward') && !CONFIG.nonces.dailyRewardAction) {
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
        if (needBoss && !CONFIG.nonces.boss) missing.push('Boss');
        if (!CONFIG.nonces.securityToken) missing.push('Token');
        if (needBoss && !CONFIG.nonces.bossAttackToken) missing.push('BossToken');
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
                    await sleep(i === 0 ? 250 : 1200 * i);
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

        // Fetch action strings from hh3dData + encrypted act payload
        const matchHh3d = miningPage.match(/var\s+hh3dData\s*=\s*({[^;]+})/);
        let miningAct = {};
        if (matchHh3d) {
            try {
                const pd = JSON.parse(matchHh3d[1]);
                if (pd.act) miningAct = pd.act;
            } catch (e) { }
        }
        const miningDecrypted = decryptHh3dActions(miningPage);
        if (miningDecrypted) {
            miningAct = { ...miningAct, ...miningDecrypted };
        }

        CONFIG.nonces.kmListAct = miningAct.kmList || CONFIG.nonces.kmListAct || "load_mines_by_type";
        CONFIG.nonces.kmEnterAct = miningAct.kmEnter || CONFIG.nonces.kmEnterAct || "enter_mine";
        CONFIG.nonces.kmClaimAct = miningAct.kmClaim || CONFIG.nonces.kmClaimAct || "claim_mycred_reward";
        CONFIG.nonces.kmUsersAct = miningAct.kmUsers || CONFIG.nonces.kmUsersAct || "get_users_in_mine";
        CONFIG.nonces.kmRewardAct = miningAct.kmReward || CONFIG.nonces.kmRewardAct || "claim_reward_km";
        CONFIG.nonces.kmCheckAct = miningAct.kmCheck || CONFIG.nonces.kmCheckAct || "check_and_display_reward";

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
            kmRewardNonce: [
                /hh3dData\.act\.kmReward[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /claim_reward_km[^}]*security[":\s]+["']([a-f0-9]{10})["']/i
            ],
            kmCheckNonce: [
                /hh3dData\.act\.kmCheck[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /check_and_display_reward[^}]*security[":\s]+["']([a-f0-9]{10})["']/i
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
        CONFIG.nonces.kmRewardNonce = extractSecurity(miningPage, miningPatterns.kmRewardNonce);
        CONFIG.nonces.kmCheckNonce = extractSecurity(miningPage, miningPatterns.kmCheckNonce);

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
    async function dailyCheckIn(sessionId = currentSessionId) {
        try {
            if (!isRunning || sessionId !== currentSessionId) return;
            if (await isWorkerDone('dailyCheckIn')) {
                console.log(`📅 Điểm danh đã xong ngày ${getTodayKey()}, bỏ qua`);
                return;
            }

            log("📅 Đang điểm danh...", "info");
            const result = await postJson(CONFIG.endpoints.daily, { action: "daily_check_in" });
            if (result?.aborted || !isRunning || sessionId !== currentSessionId) return;
            const msg = result?.message || '';
            if (result?.success) {
                log(`✅ Điểm danh: ${msg || 'Thành công'}`, "success");
                await markWorkerDone('dailyCheckIn');
            } else {
                log(`⚠️ Điểm danh: ${msg || 'Đã điểm danh hoặc lỗi'}`, "warning");
                if (msg.includes('đã điểm danh') || msg.includes('Đã điểm danh') || msg.includes('hôm nay')) {
                    if (isNearMidnight()) {
                        log("📅 ⚠️ Đang gần nửa đêm. Không đánh dấu điểm danh xong để tránh lỗi ngày mới. Sẽ thử lại sau 5 phút...", "warning");
                        sleep(300000).then(() => {
                            if (isRunning && sessionId === currentSessionId) {
                                dailyCheckIn(sessionId);
                            }
                        });
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
    async function checkAndClaimPhucLoiMilestones() {
        try {
            if (!CONFIG.nonces.securityToken) return 0;

            const res = await fetch(`${CONFIG.baseUrl}${CONFIG.pages.chest}`, { credentials: "include" });
            if (!res.ok) return 0;
            const html = await res.text();
            if (!html) return 0;

            if (!CONFIG.nonces.chestClaimAction) {
                const decrypted = decryptHh3dActions(html);
                if (decrypted?.plClaim) {
                    CONFIG.nonces.chestClaimAction = decrypted.plClaim;
                }
            }

            const cfg = extractAssignedJsonObject(html, ['plConfig']);
            if (!cfg) return 0;

            const points = parseInt(cfg.points, 10) || 0;
            const milestones = Array.isArray(cfg.milestones) ? cfg.milestones : [];
            const pending = Array.isArray(cfg.pending) ? cfg.pending : [];

            const readyMap = new Map();
            for (const m of milestones) {
                if (m && !m.claimed && points >= (Number(m.need) || 0)) {
                    readyMap.set(Number(m.id), m);
                }
            }
            for (const p of pending) {
                if (p && p.id != null && !readyMap.has(Number(p.id))) {
                    readyMap.set(Number(p.id), p);
                }
            }

            const readyList = Array.from(readyMap.values());
            if (readyList.length === 0) return 0;

            const actionClaim = CONFIG.nonces.chestClaimAction || "claim_bonus_reward";
            let claimedCount = 0;

            for (const m of readyList) {
                if (!isRunning) break;
                const needText = m.need != null ? `${points}/${m.need} điểm` : `${points} điểm`;
                const labelText = m.label ? ` - ${m.label}` : '';
                log(`🎁 🏆 Đủ điểm nhận rương mốc #${m.id} (${needText}${labelText}). Đang nhận thưởng...`, "info");

                const claimRes = await postForm(CONFIG.endpoints.api, {
                    action: actionClaim,
                    security_token: CONFIG.nonces.securityToken,
                    chest_id: m.id
                });

                if (claimRes?.success) {
                    claimedCount++;
                    const rewardMsg = claimRes.data?.message || claimRes.message || m.label || 'OK';
                    log(`🎁 ✅ Nhận thưởng rương mốc #${m.id} thành công: ${rewardMsg}`, "success");
                } else {
                    const errMsg = claimRes?.data?.message || claimRes?.message || JSON.stringify(claimRes);
                    log(`🎁 ⚠️ Nhận rương mốc #${m.id} thất bại: ${errMsg}`, "warning");
                }

                await sleep(3500);
            }

            return claimedCount;
        } catch (e) {
            log(`🎁 ⚠️ Lỗi kiểm tra rương mốc Phúc Lợi: ${e.message}`, "warning");
            return 0;
        }
    }

    async function runChestWorker(sessionId) {
        log("🎁 [Chest] Started", "info");

        // Use pre-fetched actions or default
        const actionTimer = CONFIG.nonces.chestTimerAction || "get_next_time_pl";
        const actionOpen = CONFIG.nonces.chestOpenAction || "open_chest_pl";
        log(`🎁 Actions: Timer='${actionTimer}', Open='${actionOpen}'`, "info");

        await checkAndClaimPhucLoiMilestones();

        while (isRunning && sessionId === currentSessionId) {
            try {
                const resp = await postForm(CONFIG.endpoints.api, {
                    action: actionTimer,
                    security_token: CONFIG.nonces.securityToken,
                });

                if (!resp?.success) {
                    const errMsg = resp?.message || resp?.data?.message || JSON.stringify(resp) || "Không có response";
                    if (errMsg.includes("hoàn thành")) {
                        await checkAndClaimPhucLoiMilestones();
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
                    await checkAndClaimPhucLoiMilestones();
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
                        await checkAndClaimPhucLoiMilestones();
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

            let parsed = null;
            const match = html.match(/var\s+hh3dData\s*=\s*({[^;]+})/);
            if (match && match[1]) {
                try {
                    parsed = JSON.parse(match[1]);
                } catch (e) { }
            }

            const decrypted = decryptHh3dActions(html);
            if (decrypted) {
                if (!parsed) parsed = {};
                parsed.act = { ...(parsed.act || {}), ...decrypted };
            }

            return parsed;
        } catch (e) {
            return null;
        }
    }

    // Helper áp dụng toàn bộ config/token/action từ HTML của trang /hoang-vuc (HV2 + hh3dData)
    function applyBossPageConfig(html) {
        if (!html) return null;

        const bossCfg = extractBossConfig(html);
        if (bossCfg?.nonce) {
            CONFIG.nonces.boss = bossCfg.nonce;
            console.log(`🛡️ ✓ Cập nhật nonce boss: ${bossCfg.nonce}`);
        } else {
            const nonceFallback = html.match(/(?:HV2|HH3DBossConfig)[\s\S]*?["']nonce["']\s*:\s*["']([a-f0-9]{8,})["']/i)
                || html.match(/boss[_-]?nonce["\':=\s]+["']([a-f0-9]{10})["']/i);
            if (nonceFallback?.[1]) {
                CONFIG.nonces.boss = nonceFallback[1];
            }
        }

        if (bossCfg?.attackToken) {
            CONFIG.nonces.bossAttackToken = bossCfg.attackToken;
            console.log("🛡️ ✓ boss_attack_token OK");
        } else {
            const tokenPatterns = [
                /(?:HV2|HH3DBossConfig)[\s\S]*?["']attackToken["']\s*:\s*["']([a-f0-9]{16,})["']/i,
                /["']attackToken["']\s*:\s*["']([a-f0-9]{16,})["']/i,
                /attackToken\s*[:=]\s*["']([a-f0-9]{16,})["']/i,
                /boss_attack_token\s*=\s*["']([a-f0-9]{16,})["']/i,
                /boss_attack_token\s*=\s*["']([^"']+)["']/i,
            ];
            for (const p of tokenPatterns) {
                const m = html.match(p);
                if (m?.[1]) {
                    CONFIG.nonces.bossAttackToken = m[1];
                    console.log("🛡️ ✓ boss_attack_token OK (fallback)");
                    break;
                }
            }
        }

        // Cập nhật securityToken mới từ hh3dData trên trang /hoang-vuc
        const secPatterns = [
            /hh3dData\.securityToken\s*=\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
            /"securityToken"\s*:\s*"([A-Za-z0-9+/=%]{30,})"/i,
            /'securityToken'\s*:\s*'([A-Za-z0-9+/=%]{30,})'/i,
        ];
        for (const p of secPatterns) {
            const m = html.match(p);
            if (m?.[1]) {
                CONFIG.nonces.securityToken = decodeURIComponent(m[1]);
                break;
            }
        }

        // Cập nhật các action đã mã hóa (bossAttack, bossGet, bossTimer, bossCheckElem, bossChangeElem)
        const bossDecrypted = decryptHh3dActions(html);
        if (bossDecrypted) {
            if (bossDecrypted.bossAttack) CONFIG.nonces.bossAttackAction = bossDecrypted.bossAttack;
            if (bossDecrypted.bossGet) CONFIG.nonces.bossGetAction = bossDecrypted.bossGet;
            if (bossDecrypted.bossTimer) CONFIG.nonces.bossTimerAction = bossDecrypted.bossTimer;
            if (bossDecrypted.bossCheckElem) CONFIG.nonces.bossCheckElemAction = bossDecrypted.bossCheckElem;
            if (bossDecrypted.bossChangeElem) CONFIG.nonces.bossChangeElemAction = bossDecrypted.bossChangeElem;
        } else {
            const actPatterns = {
                bossAttackAction: [/hh3dData\.act\.bossAttack\s*=\s*["']([^"']+)["']/i, /["']bossAttack["']\s*:\s*["']([^"']+)["']/i],
                bossGetAction: [/hh3dData\.act\.bossGet\s*=\s*["']([^"']+)["']/i, /["']bossGet["']\s*:\s*["']([^"']+)["']/i],
                bossTimerAction: [/hh3dData\.act\.bossTimer\s*=\s*["']([^"']+)["']/i, /["']bossTimer["']\s*:\s*["']([^"']+)["']/i],
                bossCheckElemAction: [/hh3dData\.act\.bossCheckElem\s*=\s*["']([^"']+)["']/i, /["']bossCheckElem["']\s*:\s*["']([^"']+)["']/i],
                bossChangeElemAction: [/hh3dData\.act\.bossChangeElem\s*=\s*["']([^"']+)["']/i, /["']bossChangeElem["']\s*:\s*["']([^"']+)["']/i],
            };
            for (const [key, list] of Object.entries(actPatterns)) {
                if (!CONFIG.nonces[key]) {
                    for (const p of list) {
                        const m = html.match(p);
                        if (m?.[1]) {
                            CONFIG.nonces[key] = m[1];
                            break;
                        }
                    }
                }
            }
        }

        if (bossCfg?.boss?.id != null) {
            const nextBossId = String(bossCfg.boss.id);
            if (nextBossId !== String(bossElementState.bossId || '')) {
                bossElementState.checkedBossId = null;
                bossElementState.bossId = nextBossId;
            }
        }
        if (bossCfg?.boss?.element) {
            bossElementState.bossElement = String(bossCfg.boss.element).toLowerCase();
        }
        if (bossCfg?.user) {
            if (bossCfg.user.element) {
                bossElementState.userElement = String(bossCfg.user.element).toLowerCase();
            }
            bossElementState.freeChange = !!bossCfg.user.freeChange;
        }

        return bossCfg;
    }

    // Hàm fetch lại boss_attack_token, nonce và securityToken từ trang /hoang-vuc
    async function fetchBossAttackToken() {
        console.log("🛡️ Đang fetch cấu hình/token từ /hoang-vuc...");
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await sleep(2000 + attempt * 1000);
                const res = await fetch(`${CONFIG.baseUrl}${CONFIG.pages.boss}`, { credentials: "include" });
                if (!res.ok) {
                    console.warn(`🛡️ HTTP ${res.status} khi fetch /hoang-vuc (lần ${attempt + 1}/3)`);
                    continue;
                }
                const html = await res.text();
                if (!html) continue;

                applyBossPageConfig(html);
                if (CONFIG.nonces.bossAttackToken) {
                    return CONFIG.nonces.bossAttackToken;
                }
                if (attempt === 2) {
                    log("🛡️ ❌ Không tìm thấy boss_attack_token trong HTML", "error");
                }
            } catch (e) {
                if (attempt === 2) {
                    log(`🛡️ ❌ Fetch boss token lỗi: ${e.message}`, "error");
                }
            }
        }
        return null;
    }

    async function claimOldBossReward() {
        log("🛡️ Đang nhận thưởng từ boss cũ...", "info");
        const claimResult = await postForm(CONFIG.endpoints.claimboss, { action: "claim_chest", nonce: CONFIG.nonces.boss });
        if (claimResult?.success) {
            log(`🛡️ Nhận thưởng thành công: ${claimResult?.message || claimResult?.data?.message || ""}`, "success");
            return true;
        }
        log(`🛡️ Nhận thưởng thất bại: ${claimResult?.message || claimResult?.data?.message || JSON.stringify(claimResult)}`, "error");
        return false;
    }

    function isBossAuthOrTokenError(errCode, msg) {
        const lower = (msg || "").toLowerCase();
        const code = (errCode || "").toLowerCase();
        if (code === "token_expired" || code === "invalid_token" || code === "invalid_nonce") return true;
        return lower.includes("token")
            || lower.includes("nonce")
            || lower.includes("bảo mật")
            || lower.includes("không hợp lệ")
            || (lower.includes("hết hạn") && !lower.includes("phiên đăng nhập"));
    }

    const BOSS_ELEMENT_COUNTERS = { kim: 'moc', moc: 'tho', tho: 'thuy', thuy: 'hoa', hoa: 'kim' };
    const BOSS_ELEMENT_NAMES = { kim: 'Kim', moc: 'Mộc', thuy: 'Thủy', hoa: 'Hỏa', tho: 'Thổ' };

    /**
     * Tự động kiểm tra và đổi Ngũ Hành miễn phí (nếu còn lượt) khi hệ hiện tại chưa khắc chế Boss Hoang Vực.
     * Không tự động tiêu tốn Tinh Thạch cho các lần đổi mất phí.
     */
    async function optimizeBossElementIfFree(bossId, bossElementFromApi) {
        try {
            const currentBossId = bossId != null ? String(bossId) : (bossElementState.bossId || '');
            if (!currentBossId || bossElementState.checkedBossId === currentBossId) return;

            if (bossElementFromApi) {
                bossElementState.bossElement = String(bossElementFromApi).toLowerCase();
            }

            if (!bossElementState.userElement || !bossElementState.bossElement || String(bossElementState.bossId || '') !== currentBossId) {
                await fetchBossAttackToken();
                if (bossElementFromApi && !bossElementState.bossElement) {
                    bossElementState.bossElement = String(bossElementFromApi).toLowerCase();
                }
            }

            bossElementState.checkedBossId = currentBossId;

            const bossEl = bossElementState.bossElement;
            const userEl = bossElementState.userElement;
            if (!bossEl || !userEl || !BOSS_ELEMENT_COUNTERS[bossEl] || !BOSS_ELEMENT_COUNTERS[userEl]) {
                return;
            }

            const bossElName = BOSS_ELEMENT_NAMES[bossEl] || bossEl;
            const userElName = BOSS_ELEMENT_NAMES[userEl] || userEl;

            if (BOSS_ELEMENT_COUNTERS[userEl] === bossEl) {
                log(`🛡️ Ngũ Hành hiện tại (${userElName}) đã khắc chế Boss (${bossElName}) ✓`, "info");
                return;
            }

            if (!bossElementState.freeChange) {
                log(`🛡️ Ngũ Hành: ${userElName} vs Boss ${bossElName} (đã dùng lượt đổi miễn phí kỳ này)`, "info");
                return;
            }

            const checkRes = await postForm(CONFIG.endpoints.api, {
                action: CONFIG.nonces.bossCheckElemAction || 'check_free_change_status',
                nonce: CONFIG.nonces.boss
            });

            if (!checkRes?.success || !checkRes?.data?.free_change) {
                bossElementState.freeChange = false;
                log(`🛡️ Ngũ Hành: ${userElName} vs Boss ${bossElName} (không còn lượt đổi miễn phí)`, "info");
                return;
            }

            const changeRes = await postForm(CONFIG.endpoints.api, {
                action: CONFIG.nonces.bossChangeElemAction || 'change_user_element',
                nonce: CONFIG.nonces.boss
            });

            if (changeRes?.success && changeRes?.data?.new_element) {
                const newEl = String(changeRes.data.new_element).toLowerCase();
                const newElName = changeRes.data.new_element_name || BOSS_ELEMENT_NAMES[newEl] || newEl;
                bossElementState.userElement = newEl;
                bossElementState.freeChange = false;

                let relation = 'trung tính';
                if (BOSS_ELEMENT_COUNTERS[newEl] === bossEl) {
                    relation = 'khắc chế Boss!';
                } else if (BOSS_ELEMENT_COUNTERS[bossEl] === newEl) {
                    relation = 'bị Boss khắc chế';
                }

                log(`🛡️ ✅ Đổi Ngũ Hành miễn phí: ${userElName} → ${newElName} (Boss: ${bossElName} — ${relation})`, "success");
            } else {
                const errMsg = changeRes?.message || changeRes?.data?.message || JSON.stringify(changeRes);
                log(`🛡️ ⚠️ Đổi Ngũ Hành miễn phí thất bại: ${errMsg}`, "warning");
            }
        } catch (e) {
            log(`🛡️ ⚠️ Lỗi kiểm tra/đổi Ngũ Hành: ${e.message}`, "warning");
        }
    }

    async function runBossWorker(sessionId) {
        log("🛡️ [Boss] Started", "info");

        if (!CONFIG.nonces.boss || !CONFIG.nonces.bossAttackToken || !CONFIG.nonces.securityToken) {
            log("🛡️ Đang tải cấu hình Boss từ Hoang Vực...", "info");
            await fetchBossAttackToken();
        }

        while (isRunning && sessionId === currentSessionId) {
            try {
                const actionGetBoss = CONFIG.nonces.bossGetAction || "get_boss";
                const actionTimer = CONFIG.nonces.bossTimerAction || "get_next_attack_time";
                const bossAttackAction = CONFIG.nonces.bossAttackAction || "attack_boss";

                if (!CONFIG.nonces.boss || !CONFIG.nonces.securityToken || !CONFIG.nonces.bossAttackToken) {
                    await fetchBossAttackToken();
                    if (!CONFIG.nonces.boss || !CONFIG.nonces.bossAttackToken) {
                        log("🛡️ ⚠️ Thiếu nonce/attackToken từ Hoang Vực! Thử lại sau...", "error");
                        await sleep(CONFIG.delays.error);
                        continue;
                    }
                }

                const boss = await postForm(CONFIG.endpoints.api, { action: actionGetBoss, nonce: CONFIG.nonces.boss });
                if (boss?.data?.attack_token) {
                    CONFIG.nonces.bossAttackToken = boss.data.attack_token;
                }
                if (!boss?.success || !boss.data?.id) {
                    const errMsg = boss?.message || boss?.data?.message || boss?.data?.error || JSON.stringify(boss) || "Không có response";
                    const errLower = errMsg.toLowerCase();
                    const errCode = boss?.data?.error_code || "";
                    if (errLower.includes("hết lượt") || errLower.includes("hoàn thành")) {
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
                    if (errLower.includes("nhận thưởng")) {
                        await claimOldBossReward();
                        await sleep(2000);
                        continue;
                    }
                    if (isBossAuthOrTokenError(errCode, errMsg)) {
                        log(`🛡️ ⚠️ Lỗi get_boss (${errMsg}), đang tải lại nonce/token từ Hoang Vực...`, "warning");
                        await fetchBossAttackToken();
                    } else {
                        log(`🛡️ get_boss lỗi: ${errMsg}`, "warning");
                    }
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const bossId = boss.data.id;
                log(`🛡️ Boss: ${boss.data.name || "?"} (ID: ${bossId})`, "info");
                await optimizeBossElementIfFree(bossId, boss.data?.element);

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
                if (!CONFIG.nonces.bossAttackToken || !CONFIG.nonces.boss || !CONFIG.nonces.securityToken) {
                    await fetchBossAttackToken();
                    if (!CONFIG.nonces.bossAttackToken) {
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
                    attack_token: CONFIG.nonces.bossAttackToken,
                    request_id: genRequestId()
                });

                if (result?.data?.attack_token) {
                    CONFIG.nonces.bossAttackToken = result.data.attack_token;
                }

                if (result?.success) {
                    log(result.data?.attack_token ? "🛡️ Attack thành công ✓ (token updated)" : "🛡️ Attack thành công ✓", "success");
                } else {
                    const msg = result?.message || result?.data?.error || result?.data?.message || "";
                    const msgLower = msg.toLowerCase();
                    const errCode = result?.data?.error_code || "";

                    if (msgLower.includes("hết lượt")) {
                        if (isNearMidnight()) {
                            log("🛡️ ⚠️ Đang gần nửa đêm. Không đánh dấu hoàn thành để tránh lỗi ngày mới. Thử lại sau 5 phút...", "warning");
                            await sleep(300000);
                            continue;
                        }
                        log("🛡️ ✅ Đã hoàn thành hôm nay", "success");
                        await markWorkerDone('boss');
                        await sleep(getMsUntilMidnight() + 5000);
                    } else if (msgLower.includes("nhận thưởng")) {
                        await claimOldBossReward();
                        log("🛡️ Sẽ thử attack lại ngay...", "info");
                        await sleep(2000);
                        continue;
                    } else if (isBossAuthOrTokenError(errCode, msg)) {
                        log(`🛡️ ⚠️ Token/Nonce lỗi (${msg || errCode}) – đang fetch mới...`, "warning");
                        const freshToken = await fetchBossAttackToken();
                        if (freshToken) {
                            log("🛡️ Đã lấy token/nonce mới, thử lại...", "info");
                        } else {
                            log("🛡️ ❌ Không lấy được token mới!", "error");
                        }
                        await sleep(2000);
                        continue;
                    } else {
                        log(`🛡️ Attack thất bại: ${msg || JSON.stringify(result)}`, "warning");
                        await sleep(CONFIG.delays.error);
                    }
                }
            } catch (e) {
                log(`🛡️ Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function fetchBossTongMonConfig() {
        try {
            const res = await fetch(`${CONFIG.baseUrl}${CONFIG.pages.wp}`, { credentials: "include" });
            if (!res.ok) return null;
            const html = await res.text();
            const cfg = extractAssignedJsonObject(html, ['BossSystemConfig']);
            if (cfg?.nonce) {
                CONFIG.nonces.wp = cfg.nonce;
            }
            return cfg;
        } catch (e) {
            return null;
        }
    }

    async function claimBossTongMonReward() {
        if (!CONFIG.nonces.wp) {
            await fetchBossTongMonConfig();
        }
        if (!CONFIG.nonces.wp) {
            log("⚔️ ⚠️ Thiếu WP Nonce, không thể nhận thưởng Boss Tông Môn", "warning");
            return false;
        }

        const result = await postJson(`${CONFIG.endpoints.tongMon}/claim-boss-reward`);
        if (result?.success) {
            const details = result.reward_details || {};
            const parts = [];
            if (details.cong_hien) parts.push(`+${details.cong_hien} Cống hiến`);
            if (details.tu_vi) parts.push(`+${details.tu_vi} Tu Vi`);
            if (details.tinh_thach) parts.push(`+${details.tinh_thach} Tinh Thạch`);
            const detailText = parts.length > 0 ? ` (${parts.join(', ')})` : '';
            log(`⚔️ 🎁 Nhận thưởng Boss Tông Môn thành công: ${result.message || 'OK'}${detailText}`, "success");
            return true;
        }

        const errMsg = result?.message || JSON.stringify(result);
        log(`⚔️ ⚠️ Nhận thưởng Boss Tông Môn thất bại: ${errMsg}`, "warning");
        return false;
    }

    async function checkAndClaimBossTongMonReward() {
        const cfg = await fetchBossTongMonConfig();
        if (cfg?.currentBoss?.has_pending_reward) {
            const rewardData = cfg.currentBoss.reward_data || {};
            const bossLabel = rewardData.boss_name ? `${rewardData.boss_name}` : 'Boss Tông Môn';
            const rankLabel = rewardData.rank_position ? ` (Hạng #${rewardData.rank_position})` : '';
            log(`⚔️ 🎁 Phát hiện thưởng ${bossLabel}${rankLabel} chưa nhận, đang nhận thưởng...`, "info");
            const claimed = await claimBossTongMonReward();
            return { claimed, cfg };
        }
        return { claimed: false, cfg };
    }

    async function runBossTongMonWorker(sessionId) {
        log("⚔️ [Boss TM] Started", "info");
        await checkAndClaimBossTongMonReward();

        while (isRunning && sessionId === currentSessionId) {
            try {
                const info = await postJson(`${CONFIG.endpoints.tongMon}/check-attack-cooldown`);

                if (info?.has_pending_reward || (info?.message || "").toLowerCase().includes("nhận thưởng")) {
                    await claimBossTongMonReward();
                    await sleep(2000);
                    continue;
                }

                if (!info?.success) {
                    const errMsg = info?.message || "";
                    const errLower = errMsg.toLowerCase();
                    if (errLower.includes("nhận thưởng") || errLower.includes("thưởng chưa nhận")) {
                        await claimBossTongMonReward();
                        await sleep(2000);
                        continue;
                    }

                    const { claimed, cfg } = await checkAndClaimBossTongMonReward();
                    if (claimed) {
                        await sleep(2000);
                        continue;
                    }
                    if (cfg?.currentBoss && !cfg.currentBoss.has_boss && !cfg.currentBoss.has_pending_reward) {
                        log("⚔️ Hiện chưa có Boss Tông Môn đang hoạt động – kiểm tra lại sau 5 phút...", "info");
                        await sleep(300000);
                        continue;
                    }

                    log(`⚔️ Lỗi check cooldown${errMsg ? `: ${errMsg}` : ''}`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                if (info.cooldown_type === "daily_limit" || info.remaining_attacks === 0) {
                    await checkAndClaimBossTongMonReward();
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
                        if (result.boss_defeated) {
                            log("⚔️ 🎉 Boss Tông Môn đã bị hạ gục! Đang nhận thưởng...", "success");
                            await sleep(3000);
                            await claimBossTongMonReward();
                        }
                    } else {
                        const errMsg = result?.message || "Unknown";
                        if (errMsg.toLowerCase().includes("nhận thưởng")) {
                            await claimBossTongMonReward();
                            await sleep(2000);
                            continue;
                        }
                        log(`⚔️ Attack thất bại: ${errMsg}`, "warning");
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
                let spinRoute = null;

                if (pageData && isValidSpinRoute(pageData.lotterySpin)) {
                    spinRoute = pageData.lotterySpin;
                } else if (isValidSpinRoute(CONFIG.nonces.lotterySpin)) {
                    spinRoute = CONFIG.nonces.lotterySpin;
                } else {
                    const saved = await chrome.storage.local.get(['lastKnownSpinRoute']);
                    if (saved.lastKnownSpinRoute && isValidSpinRoute(saved.lastKnownSpinRoute)) {
                        spinRoute = saved.lastKnownSpinRoute;
                        console.log("🎡 [Spin] Using last known spin route from storage:", spinRoute);
                    } else {
                        if (saved.lastKnownSpinRoute && !isValidSpinRoute(saved.lastKnownSpinRoute)) {
                            await chrome.storage.local.remove(['lastKnownSpinRoute']);
                        }
                        spinRoute = "spin";
                    }
                }

                if (!isValidSpinRoute(spinRoute)) {
                    spinRoute = "spin";
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
                        if (!forceSpinCheck) {
                            if (spinWakeController) spinWakeController.abort();
                            spinWakeController = new AbortController();
                            const sessSignal = sessionAbortController?.signal;
                            const onSessAbort = () => {
                                if (spinWakeController && !spinWakeController.signal.aborted) {
                                    spinWakeController.abort();
                                }
                            };
                            if (sessSignal) {
                                if (sessSignal.aborted) spinWakeController.abort();
                                else sessSignal.addEventListener('abort', onSessAbort, { once: true });
                            }
                            try {
                                await sleep(getMsUntilMidnight() + 5000, spinWakeController.signal);
                            } finally {
                                if (sessSignal) sessSignal.removeEventListener('abort', onSessAbort);
                                spinWakeController = null;
                            }
                        }
                        forceSpinCheck = false;
                    } else if (msg.includes("Cần tối thiểu") && msg.includes("Tu Vi")) {
                        log("🎡 ⚠️ Không đủ Tu Vi để quay - Dừng worker", "warning");
                        return;
                    } else if (msg.includes("Không tìm thấy đường dẫn") || msg.includes("rest_no_route")) {
                        log(`🎡 ⚠️ Route quay số không hợp lệ (${spinRoute}). Đang xóa cache và thử lại với route mặc định 'spin'...`, "warning");
                        await chrome.storage.local.remove(['lastKnownSpinRoute']);
                        CONFIG.nonces.lotterySpin = "spin";
                        if (spinRoute !== "spin") {
                            await sleep(2000);
                            continue;
                        }
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

        // Dynamically get action strings if not already resolved
        const pageData = (!CONFIG.nonces.tltmTimerAction || !CONFIG.nonces.tltmOpenAction)
            ? await fetchHh3dDataAndNonces("/thi-luyen-tong-mon-hh3d")
            : null;
        const actionTimer = pageData?.act?.tltmTimer || CONFIG.nonces.tltmTimerAction || "get_remaining_time_tltm";
        const actionOpen = pageData?.act?.tltmOpen || CONFIG.nonces.tltmOpenAction || "open_chest_tltm";
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
    let VANDAP_NORMALIZED_LIST = null;

    // Hàm load answers từ file JSON
    async function loadVanDapAnswers() {
        if (VANDAP_ANSWERS && VANDAP_NORMALIZED_LIST) return true; // Đã load rồi

        try {
            const url = chrome.runtime.getURL('answers.json');
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            VANDAP_ANSWERS = await response.json();
            VANDAP_NORMALIZED_LIST = Object.entries(VANDAP_ANSWERS).map(([k, v]) => ({
                key: k,
                normKey: normalizeString(k),
                answer: v
            }));
            log(`❓ Đã tải ${VANDAP_NORMALIZED_LIST.length} câu trả lời từ answers.json`, "success");
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

        if (!rawAnswer && VANDAP_NORMALIZED_LIST) {
            const normQuestion = normalizeString(question);
            const foundItem = VANDAP_NORMALIZED_LIST.find(item =>
                item.normKey === normQuestion || item.normKey.includes(normQuestion) || normQuestion.includes(item.normKey)
            );

            if (foundItem) {
                rawAnswer = foundItem.answer;
                log(`❓ ⚠️ Tìm thấy câu hỏi gần đúng: "${foundItem.key}"`, "info");
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
                // Dynamically get action strings if not already resolved
                const pageData = (!CONFIG.nonces.vdLoadAction || !CONFIG.nonces.vdSaveAction)
                    ? await fetchHh3dDataAndNonces("/van-dap-tong-mon")
                    : null;
                const actionVdLoad = pageData?.act?.vdLoad || CONFIG.nonces.vdLoadAction || "load_quiz_data";
                const actionVdSave = pageData?.act?.vdSave || CONFIG.nonces.vdSaveAction || "save_quiz_result";
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
                            await clearWorkerDone('spin');
                            wakeSpinWorker();
                            log("🎡 Đã nhận thành công Mốc 2 từ Auto Worker. Kích hoạt lượt quay mới!", "success");
                        }
                    } else {
                        const errMsg = result?.data?.message || result?.message || "";

                        if (errMsg.includes("đã nhận") || errMsg.includes("hoàn thành")) {
                            log(`🎁 ${stage}: Đã nhận trước đó`, "info");
                            claimedStages.add(stage);
                            if (stage === "stage2") {
                                await clearWorkerDone('spin');
                                wakeSpinWorker();
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
    function getMiningClaimIntervalMs(mineType) {
        const type = String(mineType || '').toLowerCase();
        if (type === 'gold') return 15 * 60 * 1000;   // Khoáng Thượng: tích lũy tối đa 15 phút
        if (type === 'copper') return 90 * 60 * 1000; // Khoáng Hạ: tích lũy tối đa 90 phút
        return 30 * 60 * 1000;                        // Khoáng Trung (silver) / mặc định: 30 phút
    }

    async function checkAndClaimPendingMiningReward() {
        try {
            if (!CONFIG.nonces.kmCheckNonce || !CONFIG.nonces.kmRewardNonce || !CONFIG.nonces.securityTokenMiner) {
                await fetchMiningNonces();
            }
            if (!CONFIG.nonces.kmCheckNonce || !CONFIG.nonces.kmRewardNonce || !CONFIG.nonces.securityTokenMiner) {
                return false;
            }

            const checkRes = await postForm(CONFIG.endpoints.api, {
                action: CONFIG.nonces.kmCheckAct || "check_and_display_reward",
                security: CONFIG.nonces.kmCheckNonce
            });

            if (!checkRes?.success || !checkRes?.data?.reward_html) {
                return false;
            }

            log("⛏️ Phát hiện phần thưởng Khoáng Mạch chưa nhận (bị sát hại/trục xuất) - Đang nhận...", "info");
            const rewardRes = await postForm(CONFIG.endpoints.api, {
                action: CONFIG.nonces.kmRewardAct || "claim_reward_km",
                security_token: CONFIG.nonces.securityTokenMiner,
                security: CONFIG.nonces.kmRewardNonce
            });

            if (rewardRes?.success) {
                const mineName = rewardRes.data?.mine_name || "?";
                const timeSpent = rewardRes.data?.time_spent || 0;
                const totalTuVi = rewardRes.data?.total_tuvi || 0;
                const totalTinhThach = rewardRes.data?.total_tinh_thach || 0;
                log(`⛏️ ✅ Đã nhận thưởng tồn đọng (${mineName}, ${timeSpent} phút): +${totalTuVi} Tu Vi, +${totalTinhThach} Tinh Thạch`, "success");
                return true;
            }

            const errMsg = rewardRes?.data?.message || rewardRes?.message || JSON.stringify(rewardRes);
            if (errMsg.includes("Phiên đã hết hạn") || errMsg.includes("hết hạn") || (errMsg.includes("IP") && errMsg.includes("thay đổi"))) {
                await fetchMiningNonces();
            }
            log(`⛏️ ⚠️ Nhận thưởng tồn đọng thất bại: ${errMsg}`, "warning");
            return false;
        } catch (e) {
            log(`⛏️ ⚠️ Lỗi kiểm tra thưởng tồn đọng: ${e.message}`, "warning");
            return false;
        }
    }

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
        const claimIntervalMs = getMiningClaimIntervalMs(mineType);
        const claimIntervalMinutes = Math.round(claimIntervalMs / 60000);

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

        await checkAndClaimPendingMiningReward();

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
                    log(`⛏️ Đợi ${claimIntervalMinutes} phút (tối đa tích lũy)...`, "info");
                    await sleep(claimIntervalMs);
                } else {
                    await checkAndClaimPendingMiningReward();
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

                    log(`⛏️ ✅ Đã vào mỏ thành công! Đợi ${claimIntervalMinutes} phút...`, "success");
                    await sleep(claimIntervalMs);
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

        async function callLdApi(path, method = "GET", body = null, priority = "normal") {
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
                body: body ? JSON.stringify(body) : undefined,
                priority: priority
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
                                const tuneRes = await callLdApi("/tune", "POST", {}, "high");
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
                        await sleep((timerLeftSec * 1000) + 3000);
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

                // 2. Lấy trạng thái hiện tại từ màn hình game (đọc DOM trực tiếp, chỉ gọi bridge cho biến/hàm MAIN world)
                const screenLoading = document.getElementById("screen-loading");
                const screenBattle = document.getElementById("screen-battle");
                const screenLobby = document.getElementById("screen-lobby");
                const roomPanel = document.getElementById("room-panel");
                const lobbyOverview = document.getElementById("lobby-overview");

                const inBattle = !!(screenBattle && screenBattle.classList.contains("active"));
                const inLobby = !!(screenLobby && screenLobby.classList.contains("active") && lobbyOverview && !lobbyOverview.classList.contains("hidden"));
                const inRoom = !!(screenLobby && screenLobby.classList.contains("active") && roomPanel && !roomPanel.classList.contains("hidden"));
                const isLoading = !!(screenLoading && !screenLoading.classList.contains("mc-loaded") && !inBattle && !inLobby && !inRoom);

                let isHost = false;
                const btnStart = document.getElementById("btn-start");
                if (btnStart) {
                    const txt = (btnStart.textContent || "").trim().toUpperCase();
                    if (txt.includes("BẮT ĐẦU") || txt.includes("START")) {
                        isHost = true;
                    } else if (txt.includes("SẴN SÀNG") || txt.includes("HỦY") || txt.includes("READY")) {
                        isHost = false;
                    }
                }
                let mcGlobals = null;
                if (!isHost && inRoom) {
                    mcGlobals = await callPageBridge('mcGetGlobals');
                    if (mcGlobals?.isHostFromNe) {
                        isHost = true;
                    }
                }
                if (!isHost && CONFIG.mecungConfig.role === 'host' && inRoom) {
                    if (btnStart && !btnStart.textContent.includes("SẴN SÀNG")) {
                        isHost = true;
                    }
                }
                const screenState = { isLoading, inBattle, inRoom, inLobby, isHost };

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

                // 3. Kiểm tra giới hạn Tinh Thạch ngày (Chỉ kiểm tra khi game đã load xong)
                const extractNum = (text) => {
                    if (!text) return null;
                    const match = text.match(/\d+/);
                    return match ? parseInt(match[0], 10) : null;
                };

                const usedEl = document.getElementById("mc-ht-daily-used");
                const capEl = document.getElementById("mc-ht-daily-cap");

                let used = usedEl ? extractNum(usedEl.textContent) : null;
                let cap = capEl ? extractNum(capEl.textContent) : null;

                // Fallback nếu không có ID riêng biệt
                if (used === null || cap === null) {
                    const dailyEl = document.getElementById("mc-ht-daily") ||
                        document.querySelector(".mc-ht-daily") ||
                        document.querySelector('[id*="ht-daily"]') ||
                        document.querySelector('[id*="tinh-thach"]') ||
                        document.querySelector('[class*="ht-daily"]');
                    if (dailyEl) {
                        const m = (dailyEl.textContent || "").match(/(\d+)\s*[/:]\s*(\d+)/);
                        if (m) {
                            if (used === null) used = parseInt(m[1], 10);
                            if (cap === null) cap = parseInt(m[2], 10);
                        }
                    }
                }

                // Fallback từ WP object trong game qua bridge
                if (used === null || cap === null) {
                    if (!mcGlobals) mcGlobals = await callPageBridge('mcGetGlobals');
                    if (mcGlobals) {
                        if (used === null && mcGlobals.wpDailyUsed != null) used = mcGlobals.wpDailyUsed;
                        if (cap === null && mcGlobals.wpDailyCap != null) cap = mcGlobals.wpDailyCap;
                    }
                }

                const stats = { used, cap };

                const customCap = CONFIG.mecungConfig.maxCap;
                const effectiveCap = customCap || (stats && stats.cap);

                if (stats && stats.used !== null) {
                    if (effectiveCap && stats.used >= effectiveCap) {
                        log(`⚔️ Đã đạt giới hạn Tinh Thạch trong ngày (${stats.used}/${effectiveCap}). Dừng worker Mê Cung.`, "success");
                        await markWorkerDone('meCung');
                        break;
                    }
                }

                // Kiểm tra thông báo hết lượt / đạt giới hạn Tinh Thạch từ popup thông báo trong game
                let limitNotification = false;
                const overlay = document.getElementById("confirm-overlay") || document.querySelector(".modal-alert, .modal-notify, .confirm-modal");
                if (overlay && !overlay.classList.contains("hidden")) {
                    const txt = (overlay.textContent || "").toLowerCase();
                    if ((txt.includes("đạt giới hạn") || txt.includes("hết lượt") || txt.includes("tối đa")) && (txt.includes("tinh thạch") || txt.includes("huyền tinh"))) {
                        limitNotification = true;
                    }
                }
                if (limitNotification) {
                    log("⚔️ Đã đạt giới hạn Tinh Thạch hôm nay (theo thông báo game). Dừng worker Mê Cung.", "success");
                    await markWorkerDone('meCung');
                    break;
                }

                // 4. Tự động tắt hộp thoại xác nhận khi có popups thông báo lỗi
                const confirmBtn = document.querySelector("#confirm-overlay .confirm-btn-ok");
                if (confirmBtn) {
                    confirmBtn.click();
                }

                if (screenState.inBattle) {
                    // Màn hình chiến đấu: Đảm bảo các cài đặt tự động chiến đấu luôn bật
                    const autoAttackTrack = document.getElementById("auto-attack-track");
                    if (autoAttackTrack && !autoAttackTrack.classList.contains("on")) {
                        await callPageBridge('mcCall', { fn: 'toggleAutoAttack' });
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
                        await callPageBridge('mcCall', { fn: 'backToLobby' });
                    }

                    // Nhận thưởng Boss 5 và quay lại sảnh
                    const b5RewardModal = document.getElementById("modal-b5-reward");
                    if (b5RewardModal && !b5RewardModal.classList.contains("hidden")) {
                        const backLobbyBtn = b5RewardModal.querySelector("button.btn-back-lobby");
                        if (backLobbyBtn) {
                            backLobbyBtn.click();
                        }
                    }

                    await sleep(4000);
                    continue;
                }

                if (screenState.inRoom) {
                    failedRooms.clear(); // Xóa danh sách đen phòng khi đã vào phòng thành công
                    // Màn hình phòng chờ phó bản: Bật tất cả tính năng tự động phòng chờ
                    const autoReadyTrack = document.getElementById("auto-ready-track");
                    if (autoReadyTrack && !autoReadyTrack.classList.contains("on")) {
                        await callPageBridge('mcCall', { fn: 'toggleAutoReady' });
                    }

                    const autoNextTrack = document.getElementById("auto-next-stage-track");
                    if (autoNextTrack && !autoNextTrack.classList.contains("on")) {
                        await callPageBridge('mcCall', { fn: 'toggleAutoNextStage' });
                    }

                    const autoOpenChestTrack = document.getElementById("auto-open-chest-track");
                    if (autoOpenChestTrack && !autoOpenChestTrack.classList.contains("on")) {
                        await callPageBridge('mcCall', { fn: 'toggleAutoOpenChest' });
                    }

                    const minPlayers = CONFIG.mecungConfig.minPlayers || 5;
                    const configRole = CONFIG.mecungConfig.role || 'member';

                    // Xử lý hành động trong phòng (Host hoặc Member)
                    const roomBtnStart = document.getElementById("btn-start");
                    const btnText = (roomBtnStart ? roomBtnStart.textContent : "").trim().toUpperCase();

                    let roomIsHost = btnText.includes("BẮT ĐẦU") || btnText.includes("START");
                    if (!roomIsHost && mcGlobals?.isHostFromNe) {
                        roomIsHost = true;
                    }
                    if (!roomIsHost && configRole === 'host' && !btnText.includes("SẴN SÀNG")) {
                        roomIsHost = true;
                    }

                    // Đếm số lượng người trong phòng chính xác
                    const cards = document.querySelectorAll(".player-card, .room-player-card, [class*='player-card']");
                    let filledCount = 0;
                    if (cards.length > 0) {
                        cards.forEach((card, idx) => {
                            const isFilled = card.classList.contains("filled") || card.classList.contains("is-filled") || card.classList.contains("occupied");
                            const isEmpty = card.classList.contains("empty") || card.classList.contains("slot-empty") || card.classList.contains("vacant");
                            const hasName = !!card.querySelector(".player-name, .mc-player-name, .name, [data-user-id]");
                            const hasAvatar = !!card.querySelector("img, .avatar:not(.empty-avatar)");
                            const text = (card.textContent || "").trim().toLowerCase();
                            const textEmpty = text === "" || text.includes("trống") || text === "+" || text.includes("chờ người") || text.includes("mời");

                            if (isFilled) {
                                filledCount++;
                            } else if (!isEmpty && (hasName || hasAvatar || (!textEmpty && text.length > 0))) {
                                filledCount++;
                            } else if (idx === 0 && !isEmpty) {
                                // Thẻ vị trí số 1 luôn là chủ phòng
                                filledCount++;
                            }
                        });
                    }
                    if (filledCount === 0) {
                        filledCount = document.querySelectorAll(".player-card.filled").length;
                        if (filledCount === 0) filledCount = 1;
                    }

                    let roomAction = null;
                    if (roomIsHost) {
                        const isBlocked = !!(roomBtnStart && (
                            roomBtnStart.classList.contains("blocked-start") ||
                            roomBtnStart.disabled ||
                            roomBtnStart.classList.contains("disabled")
                        ));

                        if (roomBtnStart && filledCount >= minPlayers && !isBlocked) {
                            roomBtnStart.click();
                            setTimeout(() => {
                                if (!isRunning || currentSessionId !== mySessionId) return;
                                const confirmOk = document.querySelector("#confirm-overlay .confirm-btn-ok, .modal-confirm .btn-ok, #confirm-overlay .btn-confirm");
                                if (confirmOk) confirmOk.click();
                            }, 500);
                            roomAction = { isHost: true, action: 'started', count: filledCount, minPlayers: minPlayers };
                        } else {
                            roomAction = { isHost: true, action: 'waiting', count: filledCount, minPlayers: minPlayers, isBlocked: isBlocked };
                        }
                    } else {
                        let readied = false;
                        if (roomBtnStart && roomBtnStart.textContent.includes("SẴN SÀNG") && !roomBtnStart.textContent.includes("HỦY")) {
                            roomBtnStart.click();
                            readied = true;
                        }
                        roomAction = { isHost: false, action: readied ? 'readied' : 'waiting_host', count: filledCount, minPlayers: minPlayers };
                    }

                    if (roomAction) {
                        if (roomAction.isHost) {
                            if (roomAction.action === 'started') {
                                log(`⚔️ [Chủ phòng] Đội hình đủ điều kiện (${roomAction.count}/${roomAction.minPlayers} người). Bắt đầu trận chiến!`, "success");
                            } else if (roomAction.action === 'waiting') {
                                if (roomAction.count < roomAction.minPlayers) {
                                    log(`⚔️ [Chủ phòng] Phòng hiện có ${roomAction.count}/${roomAction.minPlayers} người. Đang đợi đủ số người đã chọn...`, "info");
                                } else if (roomAction.isBlocked) {
                                    log(`⚔️ [Chủ phòng] Đã đủ ${roomAction.count}/${roomAction.minPlayers} người. Đang đợi tất cả thành viên bấm SẴN SÀNG...`, "info");
                                }
                            }
                        } else {
                            if (roomAction.action === 'readied') {
                                log(`⚔️ [Thành viên] Đã bấm SẴN SÀNG. Đang đợi chủ phòng bắt đầu trận chiến...`, "info");
                            }
                        }
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

                    const availableJoinBtns = Array.from(document.querySelectorAll(".btn-join-room:not(.disabled)")).filter(btn => {
                        const onclickAttr = btn.getAttribute('onclick') || '';
                        const firstQuote = onclickAttr.indexOf("'");
                        const secondQuote = onclickAttr.indexOf("'", firstQuote + 1);
                        const code = (firstQuote !== -1 && secondQuote !== -1) ? onclickAttr.substring(firstQuote + 1, secondQuote) : '';
                        return code && !blacklistArray.includes(code);
                    });

                    let lobbyAction = { action: 'none', success: false };
                    if (role !== 'host' && availableJoinBtns.length > 0) {
                        const btn = availableJoinBtns[0];
                        const onclickAttr = btn.getAttribute('onclick') || '';
                        const firstQuote = onclickAttr.indexOf("'");
                        const secondQuote = onclickAttr.indexOf("'", firstQuote + 1);
                        const roomCode = (firstQuote !== -1 && secondQuote !== -1) ? onclickAttr.substring(firstQuote + 1, secondQuote) : 'unknown';

                        btn.click();
                        lobbyAction = { action: 'join', success: true, roomCode: roomCode };
                    } else if (role === 'member') {
                        await callPageBridge('mcCall', { fn: 'manualRefreshLobby' });
                        lobbyAction = { action: 'refresh', success: true };
                    } else {
                        // Tạo phòng (áp dụng cho role 'host' hoặc 'auto' khi không tìm thấy phòng công khai)
                        const createBtn = document.querySelector(".btn-create-room") || document.querySelector('button[onclick="createRoom()"]');
                        if (createBtn) {
                            createBtn.click();
                            lobbyAction = { action: 'create', success: true };
                        }
                    }

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
                            const confirmCreateBtn = document.querySelector("#confirm-overlay .confirm-btn-ok");
                            if (confirmCreateBtn) {
                                confirmCreateBtn.click();
                            }
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
                        if (sessionAbortController) sessionAbortController.abort();
                        if (spinWakeController && !spinWakeController.signal.aborted) {
                            spinWakeController.abort();
                            spinWakeController = null;
                        }
                        clearPendingQueue();
                        await sleep(1000, null); // Allow old loops to see isRunning=false
                    }

                    clearPendingQueue();
                    sessionAbortController = new AbortController();
                    currentSessionId++; // New session
                    const mySessionId = currentSessionId;
                    isRunning = true;
                    await chrome.storage.local.set({ activeTabInstanceId: tabInstanceId });

                    if (message.miningConfig) {
                        CONFIG.miningConfig.mineType = message.miningConfig.mineType || "silver";
                        CONFIG.miningConfig.mineId = message.miningConfig.mineId || null;
                    }

                    if (message.mecungConfig) {
                        CONFIG.mecungConfig.minPlayers = parseInt(message.mecungConfig.minPlayers, 10) || 5;
                        CONFIG.mecungConfig.role = message.mecungConfig.role || "member";
                        CONFIG.mecungConfig.maxCap = message.mecungConfig.maxCap ? parseInt(message.mecungConfig.maxCap, 10) : null;
                    }

                    if (message.luyenDanConfig) {
                        CONFIG.luyenDanConfig.targetTier = message.luyenDanConfig.targetTier || "auto";
                        CONFIG.luyenDanConfig.autoDecompose = !!message.luyenDanConfig.autoDecompose;
                        CONFIG.luyenDanConfig.decomposeTier = message.luyenDanConfig.decomposeTier || "ha";
                        CONFIG.luyenDanConfig.decomposeStars = message.luyenDanConfig.decomposeStars || "1-2";
                    }

                    const activeWorkers = [];
                    let skippedBossTongMonDone = false;
                    let skippedChestDone = false;
                    for (const name of message.workers) {
                        // Vòng quay (spin) có thể nhận thêm lượt trong ngày (từ Mốc 2), nên không bỏ qua khi startup
                        if (name !== 'spin' && await isWorkerDone(name)) {
                            const vnNames = { chest: 'Rương', boss: 'Boss HV', bossTongMon: 'Boss TM', spin: 'Quay', tltm: 'TLTM', vanDap: 'Vấn Đáp', teLe: 'Tế Lễ', dailyReward: 'Daily', mining: 'Đào Mỏ', luyenDan: 'Luyện Đan', meCung: 'Mê Cung' };
                            log(`ℹ️ ${vnNames[name] || name} đã xong hôm nay. Bỏ qua.`, 'success');
                            if (name === 'bossTongMon') skippedBossTongMonDone = true;
                            if (name === 'chest') skippedChestDone = true;
                            continue;
                        }
                        activeWorkers.push(name);
                    }

                    await fetchNonces(activeWorkers);
                    await dailyCheckIn(mySessionId);
                    if (skippedBossTongMonDone) {
                        await checkAndClaimBossTongMonReward().catch(() => { });
                    }
                    if (skippedChestDone) {
                        await checkAndClaimPhucLoiMilestones().catch(() => { });
                    }

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
                    if (sessionAbortController) {
                        sessionAbortController.abort();
                        sessionAbortController = null;
                    }
                    if (spinWakeController && !spinWakeController.signal.aborted) {
                        spinWakeController.abort();
                        spinWakeController = null;
                    }
                    clearPendingQueue();
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
                            action: CONFIG.nonces.kmListAct || 'load_mines_by_type',
                            mine_type: mineType,
                            security: CONFIG.nonces.mining
                        }, { allowWhenStopped: true });
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
                if (route && route !== "spin" && isValidSpinRoute(route)) {
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
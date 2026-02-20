// Content script for hoathinh3d.gg - Runs in page context with cookies

// Only run in main frame, not iframes
if (window !== window.top) {
    console.log('🐉 HH3D - Skipping iframe');
} else if (window.__HH3D_INITIALIZED__) {
    // Prevent duplicate script loading and initialization
    console.log('🐉 HH3D Auto Tool - Already initialized, skipping...');
} else {
    window.__HH3D_INITIALIZED__ = true;
    console.log('🐉 HH3D Auto Tool - Content Script loaded');

    const CONFIG = {
        baseUrl: window.location.origin, // Tự động lấy domain hiện tại
        endpoints: {
            api: "/wp-content/themes/halimmovies-child/hh3d-ajax.php",
            tongMon: "/wp-json/tong-mon/v1",
            daily: "/wp-json/hh3d/v1/action",
            spin: "/wp-json/lottery/v1/spin",
            claimboss: "/wp-admin/admin-ajax.php",
            luanVo: "/wp-json/luan-vo/v1"
        },
        pages: {
            chest: "/phuc-loi-duong",
            boss: "/hoang-vuc",
            wp: "/bi-canh-tong-mon",
            mining: "/khoang-mach"
        },
        nonces: {
            chest: null,
            boss: null,
            wp: null,
            securityToken: null,
            userid: null,
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
        delays: { error: 8000, success: 4000, check: 3000, minRequestGap: 6000 },
        heartbeat: { interval: 20000, maxMissed: 3 } // 20s interval, max 3 missed
    };

    let isRunning = false;
    let workers = [];
    let activeWorkerNames = []; // Store worker names for resume
    let savedMiningConfig = null; // Store mining config for resume
    let heartbeatTimer = null;
    let missedHeartbeats = 0;
    let nextRequestTime = Date.now();
    let isResuming = false; // Flag to prevent double resume

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

    // Kiểm tra extension context còn hợp lệ
    function isExtensionValid() {
        try {
            if (typeof chrome === 'undefined' || !chrome.runtime) return false;
            const id = chrome.runtime.id;
            return !!id;
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
    async function saveWorkerConfig(workerNames, miningConfig) {
        try {
            await chrome.storage.local.set({
                savedWorkers: workerNames,
                savedMiningConfig: miningConfig,
                savedAt: Date.now()
            });
            console.log('💾 Worker config saved to storage');
        } catch (e) {
            console.error('Failed to save worker config:', e);
        }
    }

    // Clear worker config from storage
    async function clearWorkerConfig() {
        try {
            await chrome.storage.local.remove(['savedWorkers', 'savedMiningConfig', 'savedAt']);
            console.log('🗑️ Worker config cleared from storage');
        } catch (e) {
            console.error('Failed to clear worker config:', e);
        }
    }

    // Load worker config from storage
    async function loadWorkerConfig() {
        try {
            const result = await chrome.storage.local.get(['savedWorkers', 'savedMiningConfig', 'savedAt', 'popupState']);

            // First try: Load from savedWorkers (set by START command)
            if (result.savedWorkers && result.savedWorkers.length > 0) {
                // Check if config is not too old (24 hours max)
                const maxAge = 24 * 60 * 60 * 1000;
                if (result.savedAt && (Date.now() - result.savedAt) < maxAge) {
                    console.log('📦 Loading config from savedWorkers');
                    return {
                        workers: result.savedWorkers,
                        miningConfig: result.savedMiningConfig
                    };
                }
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

                    return {
                        workers: selectedWorkers,
                        miningConfig: miningConfig
                    };
                }
            }

            return null;
        } catch (e) {
            console.error('Failed to load worker config:', e);
            return null;
        }
    }

    // Resume workers from saved config
    async function resumeWorkers() {
        if (isRunning || isResuming) {
            console.log('⚠️ Already running or resuming, skip resume');
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
            isRunning = true;

            // Apply mining config if exists
            if (config.miningConfig) {
                CONFIG.miningConfig.mineType = config.miningConfig.mineType || 'silver';
                CONFIG.miningConfig.mineId = config.miningConfig.mineId || null;
                log(`⛏️ Resume Mining config: Type=${CONFIG.miningConfig.mineType}, ID=${CONFIG.miningConfig.mineId || 'Auto'}`, 'info');
            }

            // Fetch fresh nonces
            await fetchNonces();
            await dailyCheckIn();

            const workerMap = {
                chest: runChestWorker,
                boss: runBossWorker,
                bossTongMon: runBossTongMonWorker,
                spin: runSpinWorker,
                tltm: runTltmWorker,
                luanVo: runLuanVoWorker,
                vanDap: runVanDapWorker,
                teLe: runTeLeWorker,
                dailyReward: runDailyRewardWorker,
                mining: runMiningWorker
            };

            const workerNames = config.workers.map(w => {
                const names = { chest: 'Rương', boss: 'Boss HV', bossTongMon: 'Boss TM', spin: 'Quay', tltm: 'TLTM', luanVo: 'Luận Võ', vanDap: 'Vấn Đáp', teLe: 'Tế Lễ', dailyReward: 'Daily', mining: 'Đào Mỏ' };
                return names[w] || w;
            }).join(', ');
            log(`🚀 Resume ${config.workers.length} workers: ${workerNames}`, 'success');

            for (const name of config.workers) {
                if (workerMap[name]) {
                    workerMap[name]().catch(e => log(`💥 ${name} crashed: ${e.message}`, 'error'));
                }
            }

            activeWorkerNames = config.workers;
            savedMiningConfig = config.miningConfig;

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
                console.log(`⚠️ HTTP ${res.status} for ${endpoint}`);
            }

            return res.json();
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

        // Thêm x-lv-token cho các request đến endpoint luan-vo
        if (endpoint.includes('luan-vo') && CONFIG.nonces.securityToken) {
            headers["x-lv-token"] = CONFIG.nonces.securityToken;
        }

        return request(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(data)
        });
    }

    // ============= FETCH NONCES =============
    async function fetchNonces() {
        log("🔐 Đang tải Nonces...", "info");

        const fetchPage = async (url) => {
            try {
                await sleep(2000);
                const res = await fetch(`${CONFIG.baseUrl}${url}`, { credentials: "include" });
                return await res.text();
            } catch (e) { return null; }
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
            userid: [
                /hh3dData\.userId\s*=\s*["']?(\d+)["']?/i,
                /"userId"\s*:\s*"(\d+)"/i,
                /"userId"\s*:\s*(\d+)/i
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
            ]
        };

        const home = await fetchPage("/");
        if (home) {
            CONFIG.nonces.securityToken = extractSecurity(home, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
            CONFIG.nonces.userid = extractSecurity(home, patterns.userid);
        }

        const bossPage = await fetchPage(CONFIG.pages.boss);
        CONFIG.nonces.boss = extractSecurity(bossPage, patterns.boss);
        if (!CONFIG.nonces.securityToken && bossPage) {
            CONFIG.nonces.securityToken = extractSecurity(bossPage, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
        }

        const wpPage = await fetchPage(CONFIG.pages.wp);
        CONFIG.nonces.wp = extractSecurity(wpPage, patterns.wp);

        log(`✅ Nonces loaded:`, "success");
        log(`   - User ID: ${CONFIG.nonces.userid || "❌"}`, CONFIG.nonces.userid ? "success" : "error");
        log(`   - Boss: ${CONFIG.nonces.boss || "❌"}`, CONFIG.nonces.boss ? "success" : "error");
        log(`   - WP: ${CONFIG.nonces.wp || "❌"}`, CONFIG.nonces.wp ? "success" : "warning");
        log(`   - Token: ${CONFIG.nonces.securityToken ? "✓ OK" : "❌"}`, CONFIG.nonces.securityToken ? "success" : "error");

        if (!CONFIG.nonces.boss) log("⚠️ Không có Boss nonce - Worker Boss sẽ lỗi!", "error");
        if (!CONFIG.nonces.securityToken) log("⚠️ Không có Security Token - Nhiều worker sẽ lỗi!", "error");
    }

    // ============= MINING NONCES (RIÊNG BIỆT) =============
    async function fetchMiningNonces() {
        log("⛏️ Đang tải Nonces từ /khoang-mach...", "info");

        const fetchPage = async (url) => {
            try {
                await sleep(2000);
                const res = await fetch(`${CONFIG.baseUrl}${url}`, { credentials: "include" });
                return await res.text();
            } catch (e) { return null; }
        };

        const extractSecurity = (html, patterns) => {
            if (!html) return null;
            for (const p of patterns) {
                const m = html.match(p);
                if (m?.[1]) return m[1];
            }
            return null;
        };

        const miningPatterns = {
            securityToken: [
                /hh3dData\.securityToken\s*=\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
                /hh3dData\s*=\s*\{[^}]*securityToken\s*:\s*["']([A-Za-z0-9+/=%]{30,})["']/i,
                /"securityToken"\s*:\s*"([A-Za-z0-9+/=%]{30,})"/i,
            ],
            mining: [
                /load_mines_by_type[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
                /mine_type[^}]*security[":\s]+["']([a-f0-9]{10})["']/i,
            ],
            enterMine: [/enter_mine[^}]*security[":\s]+["']([a-f0-9]{10})["']/i],
            claimMine: [/claim_mycred_reward[^}]*security[":\s]+["']([a-f0-9]{10})["']/i],
            getUsersMine: [/get_users_in_mine[^}]*security[":\s]+["']([a-f0-9]{10})["']/i],
        };

        const miningPage = await fetchPage(CONFIG.pages.mining);
        if (!miningPage) {
            log("⛏️ ❌ Không thể fetch trang /khoang-mach", "error");
            return false;
        }

        CONFIG.nonces.securityTokenMiner = extractSecurity(miningPage, miningPatterns.securityToken);
        if (CONFIG.nonces.securityTokenMiner) {
            CONFIG.nonces.securityTokenMiner = decodeURIComponent(CONFIG.nonces.securityTokenMiner);
        }

        CONFIG.nonces.mining = extractSecurity(miningPage, miningPatterns.mining);
        CONFIG.nonces.enterMine = extractSecurity(miningPage, miningPatterns.enterMine);
        CONFIG.nonces.claimMine = extractSecurity(miningPage, miningPatterns.claimMine);
        CONFIG.nonces.getUsersMine = extractSecurity(miningPage, miningPatterns.getUsersMine);

        log(`⛏️ Mining Nonces:`, "success");
        log(`   - Token Miner: ${CONFIG.nonces.securityTokenMiner ? "✓ OK" : "❌"}`, CONFIG.nonces.securityTokenMiner ? "success" : "error");
        log(`   - Mining: ${CONFIG.nonces.mining || "❌"}`, CONFIG.nonces.mining ? "success" : "error");
        log(`   - Enter: ${CONFIG.nonces.enterMine || "❌"}`, CONFIG.nonces.enterMine ? "success" : "error");
        log(`   - Claim: ${CONFIG.nonces.claimMine || "❌"}`, CONFIG.nonces.claimMine ? "success" : "error");

        return true;
    }

    // ============= DAILY CHECK-IN =============
    async function dailyCheckIn() {
        try {
            log("📅 Đang điểm danh...", "info");
            const result = await postJson(CONFIG.endpoints.daily, { action: "daily_check_in" });
            if (result?.success) log(`✅ Điểm danh: ${result.message || 'Thành công'}`, "success");
            else log(`⚠️ Điểm danh: ${result?.message || 'Đã điểm danh hoặc lỗi'}`, "warning");
        } catch (e) {
            log(`❌ Điểm danh lỗi: ${e.message}`, "error");
        }
    }

    // ============= WORKER FUNCTIONS =============
    async function runChestWorker() {
        log("🎁 [Chest] Started", "info");
        while (isRunning) {
            try {
                const resp = await postForm(CONFIG.endpoints.api, {
                    action: "get_next_time_pl",
                    security_token: CONFIG.nonces.securityToken,
                });

                if (!resp?.success) {
                    const errMsg = resp?.message || resp?.data?.message || JSON.stringify(resp) || "Không có response";
                    if (errMsg.includes("hoàn thành")) {
                        log("🎁 ✅ Đã hoàn thành hôm nay", "success");
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
                    log("🎁 Đã nhận đủ 4 rương", "success");
                    await sleep(getMsUntilMidnight() + 5000);
                    continue;
                }

                const waitMs = parseTime(time);
                if (waitMs === 0) {
                    const chestName = chestNames[nextChestId] || `ID ${nextChestId}`;
                    log(`🎁 Level: ${currentLevel}. Đang mở rương ${chestName} (ID: ${nextChestId})...`, "info");

                    const result = await postForm(CONFIG.endpoints.api, {
                        action: "open_chest_pl",
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

    async function runBossWorker() {
        log("🛡️ [Boss] Started", "info");
        while (isRunning) {
            try {
                const boss = await postForm(CONFIG.endpoints.api, { action: "get_boss", nonce: CONFIG.nonces.boss });
                if (!boss?.success || !boss.data?.id) {
                    const errMsg = boss?.message || boss?.data?.message || boss?.data?.error || JSON.stringify(boss) || "Không có response";
                    if (errMsg.includes("hết lượt") || errMsg.includes("hoàn thành")) {
                        log("🛡️ ✅ Đã hoàn thành Boss Hoang Vực hôm nay", "success");
                        await sleep(getMsUntilMidnight() + 5000);
                        continue;
                    }
                    log(`🛡️ get_boss lỗi: ${errMsg}`, "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const bossId = boss.data.id;
                log(`🛡️ Lấy boss thành công – ID: ${bossId}, tên: ${boss.data.name || "?"}`, "info");

                const timeResp = await postForm(CONFIG.endpoints.api, { action: "get_next_attack_time" });
                if (timeResp?.success) {
                    const nextTs = Number(timeResp.data);
                    if (nextTs > Date.now()) {
                        const wait = nextTs - Date.now() + 1000;
                        log(`🛡️ Chưa tới giờ attack – đợi ${Math.ceil(wait / 1000)}s`, "info");
                        await sleep(wait);
                        continue;
                    }
                }

                const result = await postForm(CONFIG.endpoints.api, {
                    action: "attack_boss",
                    boss_id: String(bossId),
                    security_token: CONFIG.nonces.securityToken,
                    nonce: CONFIG.nonces.boss,
                    request_id: genRequestId()
                });

                if (result?.success) {
                    log("🛡️ Attack thành công", "success");
                } else {
                    const msg = result?.message || result?.data?.error || "";
                    if (msg.includes("hết lượt") || msg.includes("hết lượt tấn công")) {
                        log("🛡️ ✅ Đã hoàn thành hôm nay", "success");
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

    async function runBossTongMonWorker() {
        log("⚔️ [Boss TM] Started", "info");
        while (isRunning) {
            try {
                const info = await postJson(`${CONFIG.endpoints.tongMon}/check-attack-cooldown`);

                if (!info?.success) {
                    log("⚔️ Lỗi check cooldown", "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                if (info.cooldown_type === "daily_limit" || info.remaining_attacks === 0) {
                    log("⚔️ ✅ Hết lượt trong ngày – chờ đến 0h", "success");
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

    async function runSpinWorker() {
        log("🎡 [Spin] Started", "info");
        while (isRunning) {
            try {
                const result = await request(CONFIG.endpoints.spin, {
                    method: "POST",
                    headers: {
                        "X-WP-Nonce": CONFIG.nonces.wp,
                        "X-Security-Token": CONFIG.nonces.securityToken
                    }
                });
                if (result?.success) {
                    log(`🎡 Quay: ${result.message || 'OK'}`, "success");
                    await sleep(CONFIG.delays.check);
                } else {
                    const msg = result?.message || "";
                    if (msg.includes("hết lượt") || msg.includes("đã hết lượt")) {
                        log("🎡 ✅ Đã hoàn thành hôm nay", "success");
                        await sleep(getMsUntilMidnight() + 5000);
                    } else if (msg.includes("Cần tối thiểu") && msg.includes("Tu Vi")) {
                        log("🎡 ⚠️ Không đủ Tu Vi để quay - Dừng worker", "warning");
                        return;
                    } else {
                        log(`🎡 ${msg}`, "warning");
                        await sleep(CONFIG.delays.error);
                    }
                }
            } catch (e) {
                log(`🎡 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runTltmWorker() {
        log("💎 [TLTM] Started", "info");
        while (isRunning) {
            try {
                const check = await postForm(CONFIG.endpoints.api, {
                    action: "get_remaining_time_tltm",
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
                            action: "open_chest_tltm",
                            security_token: CONFIG.nonces.securityToken
                        });

                        // Check message hoàn thành sau khi mở rương
                        const resultMsg = result?.data?.message || result?.message || "";
                        if (resultMsg.includes("hoàn thành Thí Luyện Tông Môn") || resultMsg.includes("quay lại vào ngày kế tiếp")) {
                            log("💎 ✅ Đã hoàn thành hôm nay", "success");
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
                        log("💎 ✅ Đã hoàn thành hôm nay", "success");
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

    async function runLuanVoWorker() {
        log("⚔️ [Luận Võ] Started", "info");

        if (!CONFIG.nonces.securityToken) {
            log("⚔️ Không có security token → Worker bị vô hiệu hóa", "warning");
            return;
        }

        const luanVoEndpoint = CONFIG.endpoints.luanVo;

        // 1. Tham gia Luận Võ
        log("⚔️ Đang tham gia Luận Võ...", "info");
        const joinResult = await postJson(`${luanVoEndpoint}/join-battle`, {
            action: "join_battle",
            security_token: CONFIG.nonces.securityToken
        });

        if (!joinResult?.success) {
            log(`⚔️ Tham gia Luận Võ: ${joinResult?.message || "Unknown error"}`, "error");
        } else {
            log(`⚔️ Tham gia thành công: ${joinResult.message || ""}`, "success");
        }

        // 2. Bật tự động chấp nhận khiêu chiến
        log("⚔️ Đang bật tự động chấp nhận khiêu chiến...", "info");
        let autoAcceptResult = await postJson(`${luanVoEndpoint}/toggle-auto-accept`);
        if (autoAcceptResult?.message?.toLowerCase().includes("đã tắt")) {
            autoAcceptResult = await postJson(`${luanVoEndpoint}/toggle-auto-accept`);
        }
        if (autoAcceptResult?.success) {
            log(`⚔️ ${autoAcceptResult.message || "Đã bật auto-accept"}`, "success");
        } else {
            log(`⚔️ Cảnh báo: ${autoAcceptResult?.message || "Không thể bật auto-accept"}`, "warning");
        }

        // 3. Main loop - Tìm đối thủ và thách đấu
        while (isRunning) {
            try {
                log("⚔️ Đang tải danh sách người chơi...", "info");
                const participants = await postJson(`${luanVoEndpoint}/load-participants`, { page: 1 });

                if (!participants?.success || !participants?.data?.users) {
                    log("⚔️ Không thể tải danh sách người chơi", "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                const users = participants.data.users;
                log(`⚔️ Tìm thấy ${users.length} người chơi`, "info");

                // Lọc những người bật auto-accept
                const autoAcceptUsers = users.filter(user => user.auto_accept === true);

                if (autoAcceptUsers.length === 0) {
                    log("⚔️ Không tìm thấy người chơi nào bật auto-accept", "warning");
                    await sleep(CONFIG.delays.error);
                    continue;
                }

                log(`⚔️ Tìm thấy ${autoAcceptUsers.length} người chơi bật auto-accept`, "info");

                let challengeSuccess = false;

                // Thử gửi thách đấu đến từng người
                for (let i = 0; i < autoAcceptUsers.length; i++) {
                    if (!isRunning) return;

                    const target = autoAcceptUsers[i];
                    log(`⚔️ Đang gửi thách đấu đến: ${target.name} (ID: ${target.id}) - ${target.points} điểm`, "info");

                    const challengeResult = await postJson(`${luanVoEndpoint}/send-challenge`, {
                        target_user_id: String(target.id)
                    });

                    if (!challengeResult?.success) {
                        const errorMsg = challengeResult?.data || challengeResult?.message || "";

                        // Check hết lượt
                        if (errorMsg.includes("tối đa") || errorMsg.includes("hết lượt") || errorMsg.includes("đã gửi")) {
                            log(`⚔️ Hết lượt: ${errorMsg}`, "warning");

                            // Nhận thưởng trước khi dừng
                            log("⚔️ Đang nhận thưởng Luận Võ...", "info");
                            const rewardResult = await postJson(`${luanVoEndpoint}/receive-reward`, {});

                            if (rewardResult?.success && rewardResult?.data) {
                                log(`⚔️ Nhận thưởng thành công: ${rewardResult.data.message || ""}`, "success");
                            } else {
                                log(`⚔️ Không thể nhận thưởng: ${rewardResult?.data || rewardResult?.message || "Unknown"}`, "warning");
                            }

                            log("⚔️ ✅ Đã hoàn thành Luận Võ hôm nay - Chờ đến 0h", "success");
                            await sleep(getMsUntilMidnight() + 5000);
                            return;
                        }

                        // Check không cùng cấp bậc
                        if (errorMsg.includes("không cùng cấp bậc") || errorMsg.includes("cấp bậc")) {
                            log(`⚔️ Không cùng cấp với ${target.name}, thử người tiếp theo...`, "warning");
                            await sleep(2000);
                            continue;
                        }

                        log(`⚔️ Gửi thách đấu thất bại: ${errorMsg}`, "warning");
                        await sleep(CONFIG.delays.error);
                        continue;
                    }

                    // Gửi thách đấu thành công
                    if (challengeResult?.data) {
                        const { challenge_id, target_user_id, message } = challengeResult.data;
                        log(`⚔️ Gửi thách đấu thành công: ${message || ""}`, "success");

                        // Auto approve challenge
                        log(`⚔️ Đang tự động chấp nhận trận đấu (ID: ${challenge_id})...`, "info");
                        const approveResult = await postJson(`${luanVoEndpoint}/auto-approve-challenge`, {
                            target_user_id: target_user_id,
                            challenge_id: challenge_id
                        });

                        if (approveResult?.success && approveResult?.data) {
                            const { message: resultMsg, is_winner, received_remaining } = approveResult.data;

                            // Xử lý kết quả thắng/thua
                            let finalWinState = false;
                            if (typeof is_winner === 'boolean') finalWinState = is_winner;
                            else if (Number(is_winner) === 1) finalWinState = true;
                            else if (String(is_winner).toLowerCase() === 'true') finalWinState = true;

                            // Check nội dung message để sửa lại nếu API trả sai
                            const msgLower = (resultMsg || "").toLowerCase();
                            if (msgLower.includes("thiếu một chút") || msgLower.includes("đáng tiếc") || msgLower.includes("thua")) {
                                finalWinState = false;
                            } else if (msgLower.includes("chiến thắng") || msgLower.includes("chúc mừng")) {
                                finalWinState = true;
                            }

                            const status = finalWinState ? "Thắng ✓" : "Thua ✗";
                            log(`⚔️ ${status} - ${resultMsg} (Còn ${received_remaining} lượt)`, finalWinState ? "success" : "info");
                        } else {
                            log(`⚔️ Lỗi khi tự động chấp nhận: ${approveResult?.data || approveResult?.message || "Unknown"}`, "warning");
                        }

                        challengeSuccess = true;
                        break;
                    }
                }

                if (!challengeSuccess) {
                    log("⚔️ Đã thử hết danh sách người chơi nhưng không thể gửi thách đấu", "warning");
                    await sleep(6000);
                } else {
                    log("⚔️ Đợi 6 giây trước khi tìm đối thủ tiếp theo...", "info");
                    await sleep(6000);
                }

            } catch (e) {
                log(`⚔️ Error: ${e.message}`, "error");
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

    async function runVanDapWorker() {
        log("❓ [Vấn Đáp] Started", "info");

        try {
            // Load answers từ file JSON
            log("❓ Đang tải dữ liệu câu trả lời...", "info");
            const loadedAnswers = await loadVanDapAnswers();
            if (!loadedAnswers) {
                log("❓ Không thể tải file answers.json → Dừng worker", "error");
                return;
            }

            log("❓ Đang tải câu hỏi vấn đáp...", "info");
            const quizData = await postForm(CONFIG.endpoints.api, {
                action: "load_quiz_data",
                security_token: CONFIG.nonces.securityToken
            });

            if (!quizData?.success || !quizData?.data?.questions) {
                log(`❓ Không có câu hỏi hoặc lỗi: ${quizData?.message || JSON.stringify(quizData)}`, "warning");
                return;
            }

            const { questions, correct_answers, completed } = quizData.data;

            if (completed) {
                log(`❓ ✅ Đã hoàn thành vấn đáp hôm nay! Số câu đúng: ${correct_answers}`, "success");
                await sleep(getMsUntilMidnight() + 5000);
                return;
            }

            log(`❓ Có ${questions.length} câu hỏi. Đã trả lời đúng: ${correct_answers || 0} câu`, "info");

            for (const q of questions) {
                if (!isRunning) break;
                const { id, question, options } = q;

                log(`❓ --- Câu hỏi #${id} ---`, "info");
                log(`❓ ${question}`, "info");

                const answerIndex = findAnswer(question, options);
                const selectedAnswer = options[answerIndex];
                log(`❓ Đáp án tìm được: ${answerIndex}. ${selectedAnswer}`, "info");

                log(`❓ Đang gửi câu trả lời...`, "info");
                const result = await postForm(CONFIG.endpoints.api, {
                    action: "save_quiz_result",
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
            await sleep(getMsUntilMidnight() + 5000);
        } catch (e) {
            log(`❓ Error: ${e.message}`, "error");
        }
    }

    async function runTeLeWorker() {
        log("🙏 [Tế Lễ] Started", "info");
        while (isRunning) {
            try {
                const check = await postJson(`${CONFIG.endpoints.tongMon}/check-te-le-status`);

                if (check?.success === false && check?.message?.includes("chưa tế lễ")) {
                    log("🙏 Phát hiện chưa tế lễ, đang tiến hành tế lễ...", "info");

                    const result = await postJson(`${CONFIG.endpoints.tongMon}/te-le-tong-mon`, {
                        action: "te_le_tong_mon",
                        security_token: CONFIG.nonces.securityToken
                    });

                    if (result?.success) {
                        log(`🙏 Thành công: ${result.message}`, "success");
                        log(`🙏 Cống hiến: ${result.cong_hien_points} | Tông khố: ${result.treasury}`, "success");
                    } else {
                        log(`🙏 Thất bại: ${result?.message || JSON.stringify(result)}`, "warning");
                    }

                    log("🙏 Đã tế lễ xong - Chờ đến 0h", "success");
                    await sleep(getMsUntilMidnight() + 5000);
                } else if (check?.success === true) {
                    log(`🙏 Trạng thái: ${check?.message || "Đã tế lễ hoặc không cần tế lễ"}`, "success");
                    await sleep(getMsUntilMidnight() + 5000);
                } else {
                    log(`🙏 Check status thất bại: ${check?.message || JSON.stringify(check)}`, "warning");
                    await sleep(CONFIG.delays.error);
                }
            } catch (e) {
                log(`🙏 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    // ============= DAILY ACTIVITY REWARD WORKER =============
    async function runDailyRewardWorker() {
        log("🎁 [Daily Reward] Started", "info");

        const stages = ["stage1", "stage2"];
        const claimedStages = new Set();
        let luanVoRewardClaimed = false;

        while (isRunning) {
            try {
                // === PHẦN 1: Thưởng hoạt động ngày ===
                for (const stage of stages) {
                    if (!isRunning) break;
                    if (claimedStages.has(stage)) continue;

                    log(`🎁 Đang thử nhận thưởng ${stage}...`, "info");

                    const result = await postForm(CONFIG.endpoints.claimboss, {
                        action: "daily_activity_reward",
                        stage: stage,
                        security_token: CONFIG.nonces.securityToken
                    });

                    if (result?.success) {
                        const msg = result?.data?.message || "Thành công";
                        log(`🎁 ✅ ${stage}: ${msg}`, "success");
                        claimedStages.add(stage);
                    } else {
                        const errMsg = result?.data?.message || result?.message || "";

                        if (errMsg.includes("đã nhận") || errMsg.includes("hoàn thành")) {
                            log(`🎁 ${stage}: Đã nhận trước đó`, "info");
                            claimedStages.add(stage);
                        } else if (errMsg.includes("chưa đủ điều kiện") || errMsg.includes("chưa đạt")) {
                            log(`🎁 ${stage}: Chưa đủ điều kiện`, "warning");
                        } else {
                            log(`🎁 ${stage}: ${errMsg}`, "warning");
                        }
                    }

                    await sleep(2000);
                }

                // === PHẦN 2: Thưởng Luận Võ ===
                if (!luanVoRewardClaimed) {
                    log("🎁 Đang thử nhận thưởng Luận Võ...", "info");

                    const rewardResult = await postJson(`${CONFIG.endpoints.luanVo}/receive-reward`, {});

                    if (rewardResult?.success && rewardResult?.data) {
                        log(`🎁 ✅ Luận Võ: ${rewardResult.data.message || "Thành công"}`, "success");
                        luanVoRewardClaimed = true;
                    } else {
                        const errMsg = rewardResult?.data?.message || rewardResult?.message || rewardResult?.data || "";

                        if (errMsg.includes("đã nhận") || errMsg.includes("hoàn thành") || errMsg.includes("không có")) {
                            log(`🎁 Luận Võ: Đã nhận hoặc chưa có thưởng`, "info");
                            luanVoRewardClaimed = true;
                        } else if (errMsg.includes("chưa tham gia") || errMsg.includes("chưa đủ")) {
                            log(`🎁 Luận Võ: ${errMsg}`, "warning");
                        } else {
                            log(`🎁 Luận Võ: ${errMsg}`, "warning");
                        }
                    }

                    await sleep(2000);
                }

                // === CHECK HOÀN THÀNH ===
                const allDone = claimedStages.size >= stages.length && luanVoRewardClaimed;

                if (allDone) {
                    log("🎁 ✅ Đã nhận hết thưởng - Chờ đến 0h", "success");
                    await sleep(getMsUntilMidnight() + 5000);
                    // Reset cho ngày mới
                    claimedStages.clear();
                    luanVoRewardClaimed = false;
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
    async function runMiningWorker() {
        log("⛏️ [Mining] Started", "info");

        // Chỉ fetch nonces nếu chưa có
        if (!CONFIG.nonces.securityTokenMiner || !CONFIG.nonces.mining) {
            log("⛏️ Đang tải Mining Nonces...", "info");
            const noncesOk = await fetchMiningNonces();
            if (!noncesOk || !CONFIG.nonces.securityTokenMiner || !CONFIG.nonces.mining) {
                log("⛏️ ❌ Không có mining nonces", "error");
                return;
            }
        } else {
            log("⛏️ ✓ Đã có mining nonces từ trước", "success");
        }

        let mineId = CONFIG.miningConfig.mineId;
        let mineType = CONFIG.miningConfig.mineType || "silver";

        if (!mineId) {
            log(`⛏️ Đang load danh sách mỏ ${mineType}...`, "info");
            const minesResult = await postForm(CONFIG.endpoints.api, {
                action: "load_mines_by_type",
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

        while (isRunning) {
            try {
                log(`⛏️ Đang kiểm tra trạng thái mỏ ID ${mineId}...`, "info");
                const usersResult = await postForm(CONFIG.endpoints.api, {
                    action: "get_users_in_mine",
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
                        action: "claim_mycred_reward",
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
                            log(`⛏️ ✅ Đã đạt đủ thưởng ngày - Chờ đến 0h`, "success");
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
                        action: "enter_mine",
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
                            log(`⛏️ ✅ Đã đạt đủ thưởng ngày - Chờ đến 0h`, "success");
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

                    isRunning = true;

                    if (message.miningConfig) {
                        CONFIG.miningConfig.mineType = message.miningConfig.mineType || "silver";
                        CONFIG.miningConfig.mineId = message.miningConfig.mineId || null;
                        log(`⛏️ Mining config: Type=${CONFIG.miningConfig.mineType}, ID=${CONFIG.miningConfig.mineId || 'Auto'}`, "info");
                    }

                    await fetchNonces();
                    await dailyCheckIn();

                    const workerMap = {
                        chest: runChestWorker,
                        boss: runBossWorker,
                        bossTongMon: runBossTongMonWorker,
                        spin: runSpinWorker,
                        tltm: runTltmWorker,
                        luanVo: runLuanVoWorker,
                        vanDap: runVanDapWorker,
                        teLe: runTeLeWorker,
                        dailyReward: runDailyRewardWorker,
                        mining: runMiningWorker
                    };

                    for (const name of message.workers) {
                        if (workerMap[name]) {
                            workerMap[name]().catch(e => log(`💥 ${name} crashed: ${e.message}`, 'error'));
                        }
                    }
                    // Store for potential resume
                    activeWorkerNames = message.workers;
                    savedMiningConfig = message.miningConfig;

                    // Save to storage for auto-resume on tab refresh
                    await saveWorkerConfig(message.workers, message.miningConfig);

                    // Start heartbeat
                    startHeartbeat();

                    sendResponse({ success: true });
                    break;

                case 'STOP':
                    isRunning = false;
                    activeWorkerNames = [];
                    savedMiningConfig = null;
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

    // Notify that content script is ready
    safeSendMessage({ type: 'CONTENT_READY' });

} // End of if (!window.__HH3D_INITIALIZED__)

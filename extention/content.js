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
        baseUrl: "https://hoathinh3d.gg",
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
            tltm: "/thi-luyen-tong-mon-hh3d",
            wp: "/bi-canh-tong-mon",
            mining: "/khoang-mach"
        },
        nonces: {
            chest: null,
            boss: null,
            wp: null,
            tltm: null,
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
        delays: { error: 8000, success: 4000, check: 3000, minRequestGap: 6000 }
    };

    let isRunning = false;
    let workers = [];
    let nextRequestTime = Date.now();

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

    // ============= HTTP CLIENT =============
    async function enforceDelay() {
        const now = Date.now();
        if (now < nextRequestTime) await sleep(nextRequestTime - now);
        nextRequestTime = Date.now() + CONFIG.delays.minRequestGap;
    }

    async function request(endpoint, options = {}) {
        await enforceDelay();
        const url = endpoint.startsWith("http") ? endpoint : `${CONFIG.baseUrl}${endpoint}`;
        const res = await fetch(url, { credentials: "include", ...options });
        return res.json();
    }

    async function postForm(endpoint, data) {
        return request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
            body: new URLSearchParams(data)
        });
    }

    async function postJson(endpoint, data = {}) {
        return request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
            userid: [/hh3dData\.userId\s*=\s*["']?(\d+)["']?/i, /"userId"\s*:\s*(\d+)/i],
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
            tltm: [
                /open_chest_tltm[^}]*security["\s:]+["']([a-f0-9]{10})["']/i,
                /tltm_security["\s:]+["']([a-f0-9]{10})["']/i,
                /"security":"([a-f0-9]{10})"/i
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

        const chestPage = await fetchPage(CONFIG.pages.chest);
        CONFIG.nonces.chest = extractSecurity(chestPage, patterns.chest);
        if (!CONFIG.nonces.securityToken && chestPage) {
            CONFIG.nonces.securityToken = extractSecurity(chestPage, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
        }

        const bossPage = await fetchPage(CONFIG.pages.boss);
        CONFIG.nonces.boss = extractSecurity(bossPage, patterns.boss);
        if (!CONFIG.nonces.securityToken && bossPage) {
            CONFIG.nonces.securityToken = extractSecurity(bossPage, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
        }

        const tltmPage = await fetchPage(CONFIG.pages.tltm);
        CONFIG.nonces.tltm = extractSecurity(tltmPage, patterns.tltm);
        if (!CONFIG.nonces.securityToken && tltmPage) {
            CONFIG.nonces.securityToken = extractSecurity(tltmPage, patterns.securityToken);
            if (CONFIG.nonces.securityToken) CONFIG.nonces.securityToken = decodeURIComponent(CONFIG.nonces.securityToken);
        }

        const wpPage = await fetchPage(CONFIG.pages.wp);
        CONFIG.nonces.wp = extractSecurity(wpPage, patterns.wp);

        log(`✅ Nonces loaded:`, "success");
        log(`   - Chest: ${CONFIG.nonces.chest || "❌"}`, CONFIG.nonces.chest ? "success" : "error");
        log(`   - Boss: ${CONFIG.nonces.boss || "❌"}`, CONFIG.nonces.boss ? "success" : "error");
        log(`   - TLTM: ${CONFIG.nonces.tltm || "❌"}`, CONFIG.nonces.tltm ? "success" : "warning");
        log(`   - Token: ${CONFIG.nonces.securityToken ? "✓ OK" : "❌"}`, CONFIG.nonces.securityToken ? "success" : "error");

        if (!CONFIG.nonces.chest) log("⚠️ Không có Chest nonce - Worker Chest sẽ lỗi!", "error");
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
                    security: CONFIG.nonces.chest
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
                        security: CONFIG.nonces.chest,
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
                    const errMsg = boss?.message || boss?.data?.message || JSON.stringify(boss) || "Không có response";
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
                const timeResp = await postForm(CONFIG.endpoints.api, { action: "get_next_attack_time" });
                if (timeResp?.success) {
                    const nextTs = Number(timeResp.data);
                    if (nextTs > Date.now()) {
                        const wait = nextTs - Date.now() + 1000;
                        log(`🛡️ Chờ ${Math.ceil(wait / 1000)}s`, "info");
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

                if (result?.success) log("🛡️ Attack thành công", "success");
                else {
                    const msg = result?.message || "";
                    if (msg.includes("hết lượt")) {
                        log("🛡️ ✅ Đã hoàn thành hôm nay", "success");
                        await sleep(getMsUntilMidnight() + 5000);
                    } else if (msg.includes("nhận thưởng")) {
                        await postForm(CONFIG.endpoints.claimboss, { action: "claim_chest", nonce: CONFIG.nonces.boss });
                        log("🛡️ Đã nhận thưởng boss cũ", "success");
                    } else {
                        log(`🛡️ ${msg}`, "warning");
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
        if (!CONFIG.nonces.tltm) { log("⚔️ Chưa có nonce", "warning"); return; }
        while (isRunning) {
            try {
                const info = await postJson(`${CONFIG.endpoints.tongMon}/check-attack-cooldown`);
                if (info?.cooldown_type === "daily_limit" || info?.remaining_attacks === 0) {
                    log("⚔️ ✅ Đã hoàn thành hôm nay", "success");
                    await sleep(getMsUntilMidnight() + 5000);
                    continue;
                }
                if (info?.can_attack) {
                    const result = await postJson(`${CONFIG.endpoints.tongMon}/attack-boss`);
                    if (result?.success) log(`⚔️ Attack: ${result.message}`, "success");
                    else log(`⚔️ ${result?.message}`, "warning");
                    await sleep(CONFIG.delays.check);
                } else {
                    await sleep((info?.cooldown_interval || 30) * 1000 + 1000);
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
                const result = await postJson(CONFIG.endpoints.spin);
                if (result?.success) {
                    log(`🎡 Quay: ${result.message || 'OK'}`, "success");
                    await sleep(CONFIG.delays.check);
                } else {
                    const msg = result?.message || "";
                    if (msg.includes("hết lượt") || msg.includes("hoàn thành")) {
                        log("🎡 ✅ Đã hoàn thành hôm nay", "success");
                        await sleep(getMsUntilMidnight() + 5000);
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
        if (!CONFIG.nonces.tltm) { log("💎 Chưa có nonce", "warning"); return; }
        while (isRunning) {
            try {
                const check = await postForm(CONFIG.endpoints.api, {
                    action: "get_next_time_tltm",
                    security_token: CONFIG.nonces.securityToken,
                    security: CONFIG.nonces.tltm
                });

                if (check?.success) {
                    const waitMs = parseTime(check.data?.time);
                    if (waitMs === 0) {
                        const result = await postForm(CONFIG.endpoints.api, {
                            action: "open_chest_tltm",
                            security_token: CONFIG.nonces.securityToken,
                            security: CONFIG.nonces.tltm
                        });
                        if (result?.success) log(`💎 Mở rương: ${result.data?.message || 'OK'}`, "success");
                        else log(`💎 ${result?.message}`, "warning");
                        await sleep(2000);
                    } else {
                        log(`💎 Chờ ${check.data?.time}`, "info");
                        await sleep(waitMs + 1000);
                    }
                } else {
                    const msg = check?.message || "";
                    if (msg.includes("hoàn thành")) {
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
        while (isRunning) {
            try {
                const info = await postJson(`${CONFIG.endpoints.luanVo}/check-match-cooldown`);
                if (info?.cooldown_type === "daily_limit" || info?.remaining_matches === 0) {
                    log("⚔️ ✅ Đã hoàn thành Luận Võ hôm nay", "success");
                    await sleep(getMsUntilMidnight() + 5000);
                    continue;
                }
                if (info?.can_match) {
                    const result = await postJson(`${CONFIG.endpoints.luanVo}/start-match`);
                    if (result?.success) log(`⚔️ Luận Võ: ${result.message}`, "success");
                    else log(`⚔️ ${result?.message}`, "warning");
                    await sleep(CONFIG.delays.check);
                } else {
                    await sleep((info?.cooldown_interval || 30) * 1000 + 1000);
                }
            } catch (e) {
                log(`⚔️ Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    async function runVanDapWorker() {
        log("❓ [Vấn Đáp] Started", "info");
        try {
            const quiz = await postForm(CONFIG.endpoints.api, {
                action: "get_quiz_questions",
                security_token: CONFIG.nonces.securityToken
            });

            if (!quiz?.success || !quiz.data?.questions) {
                log(`❓ Không có câu hỏi hoặc đã hoàn thành`, "warning");
                return;
            }

            const questions = quiz.data.questions;
            log(`❓ Có ${questions.length} câu hỏi`, "info");

            for (const q of questions) {
                if (!isRunning) break;
                const { id, question, options } = q;
                log(`❓ Câu #${id}: ${question}`, "info");

                // Default chọn đáp án 0
                const answerIndex = 0;
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
                    log(`❓ Lỗi: ${result?.message || "Unknown"}`, "error");
                }
                await sleep(1000);
            }
            log(`❓ ✅ Đã hoàn thành trả lời`, "success");
        } catch (e) {
            log(`❓ Error: ${e.message}`, "error");
        }
    }

    async function runTeLeWorker() {
        log("🙏 [Tế Lễ] Started", "info");
        if (!CONFIG.nonces.tltm) { log("🙏 Chưa có nonce", "warning"); return; }
        while (isRunning) {
            try {
                const check = await postJson(`${CONFIG.endpoints.tongMon}/check-te-le-status`);
                if (check?.success === false && check?.message?.includes("chưa tế lễ")) {
                    const result = await postJson(`${CONFIG.endpoints.tongMon}/te-le`);
                    if (result?.success) log(`🙏 Tế Lễ: ${result.message}`, "success");
                    else log(`🙏 ${result?.message}`, "warning");
                    await sleep(CONFIG.delays.check);
                } else if (check?.success === true) {
                    log(`🙏 Đã tế lễ hoặc không cần`, "success");
                    await sleep(getMsUntilMidnight() + 5000);
                } else {
                    log(`🙏 Check status: ${check?.message || JSON.stringify(check)}`, "warning");
                    await sleep(CONFIG.delays.error);
                }
            } catch (e) {
                log(`🙏 Error: ${e.message}`, "error");
                await sleep(CONFIG.delays.error);
            }
        }
    }

    // ============= MINING WORKER =============
    async function runMiningWorker() {
        log("⛏️ [Mining] Started", "info");

        const noncesOk = await fetchMiningNonces();
        if (!noncesOk || !CONFIG.nonces.securityTokenMiner || !CONFIG.nonces.mining) {
            log("⛏️ ❌ Không có mining nonces", "error");
            return;
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
                        mining: runMiningWorker
                    };

                    for (const name of message.workers) {
                        if (workerMap[name]) {
                            workerMap[name]().catch(e => log(`💥 ${name} crashed: ${e.message}`, 'error'));
                        }
                    }
                    sendResponse({ success: true });
                    break;

                case 'STOP':
                    isRunning = false;
                    log("⏹️ Đã dừng workers", "warning");
                    sendResponse({ success: true });
                    break;

                case 'CHECK_STATUS':
                    sendResponse({ isRunning });
                    break;

                case 'PING':
                    sendResponse({ pong: true });
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
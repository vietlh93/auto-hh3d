// inject.js - Chạy trong MAIN world để đọc hh3dData và gọi allowlist lệnh Mê Cung từ content script
(function () {
    const ALLOWED_MC_FNS = {
        toggleAutoAttack: true,
        backToLobby: true,
        toggleAutoReady: true,
        toggleAutoNextStage: true,
        toggleAutoOpenChest: true,
        manualRefreshLobby: true
    };

    function readHh3dData() {
        var data = {};
        try {
            if (typeof hh3dData !== 'undefined' && hh3dData) {
                data.securityToken = hh3dData.securityToken || null;
                data.restNonce = hh3dData.restNonce || null;
                data.userId = hh3dData.userId || null;
                if (hh3dData.act) {
                    var spinCand = hh3dData.act.lotterySpin || hh3dData.act.spin || hh3dData.act.luckySpin || hh3dData.act.quay || hh3dData.act.quaySo || hh3dData.act.lottery || hh3dData.act.vongQuay || null;
                    if (spinCand && typeof spinCand === 'string' && !spinCand.includes('/') && !spinCand.includes('\\') && !spinCand.includes('.')) {
                        data.lotterySpin = spinCand;
                    }
                }
            }
            var bossConfig = typeof HV2 !== 'undefined' ? HV2 : (typeof HH3DBossConfig !== 'undefined' ? HH3DBossConfig : null);
            if (bossConfig) {
                data.bossNonce = bossConfig.nonce || null;
                data.bossAttackToken = bossConfig.attackToken || null;
            }
        } catch (e) {
            // Return partial or empty data on read error
        }
        return data;
    }

    function readMcGlobals() {
        var isHostFromNe = false;
        if (typeof Ne === 'function') {
            try {
                isHostFromNe = !!Ne();
            } catch (e) { }
        }

        var wpDailyUsed = null;
        var wpDailyCap = null;
        if (typeof WP !== 'undefined' && WP) {
            if (typeof WP.htDailyUsed !== 'undefined') {
                var parsedUsed = parseInt(WP.htDailyUsed, 10);
                if (!Number.isNaN(parsedUsed)) wpDailyUsed = parsedUsed;
            }
            if (typeof WP.htDailyCap !== 'undefined') {
                var parsedCap = parseInt(WP.htDailyCap, 10);
                if (!Number.isNaN(parsedCap)) wpDailyCap = parsedCap;
            }
        }

        return {
            isHostFromNe: isHostFromNe,
            wpDailyUsed: wpDailyUsed,
            wpDailyCap: wpDailyCap
        };
    }

    window.postMessage({ type: '__hh3d_bridge__', payload: readHh3dData() }, window.location.origin);

    // Đăng ký bộ lắng nghe bridge an toàn với allowlist cố định
    if (!window.__HH3D_BRIDGE_REGISTERED__) {
        window.__HH3D_BRIDGE_REGISTERED__ = true;
        window.addEventListener('message', (e) => {
            if (e.source !== window || e.origin !== window.location.origin) return;
            if (!e.data || e.data.type !== '__hh3d_cmd__') return;

            var id = e.data.id;
            var cmd = e.data.cmd;
            var arg = e.data.arg;

            try {
                var payload = null;
                if (cmd === 'readHh3dData') {
                    payload = readHh3dData();
                } else if (cmd === 'mcGetGlobals') {
                    payload = readMcGlobals();
                } else if (cmd === 'mcCall') {
                    var fnName = arg && typeof arg.fn === 'string' ? arg.fn : '';
                    if (Object.prototype.hasOwnProperty.call(ALLOWED_MC_FNS, fnName) && typeof window[fnName] === 'function') {
                        window[fnName]();
                        payload = { called: true };
                    } else {
                        payload = { called: false };
                    }
                } else {
                    window.postMessage({
                        type: '__hh3d_cmd_res__',
                        id: id,
                        success: false,
                        error: 'Unknown command'
                    }, window.location.origin);
                    return;
                }

                window.postMessage({
                    type: '__hh3d_cmd_res__',
                    id: id,
                    success: true,
                    payload: payload
                }, window.location.origin);
            } catch (err) {
                window.postMessage({
                    type: '__hh3d_cmd_res__',
                    id: id,
                    success: false,
                    error: err && err.message ? err.message : 'Bridge error'
                }, window.location.origin);
            }
        });
    }
})();

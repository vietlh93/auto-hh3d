// inject.js - Chạy trong MAIN world để đọc hh3dData và thực thi lệnh từ content script
(function () {
    try {
        var data = {};
        if (typeof hh3dData !== 'undefined') {
            data.securityToken = hh3dData.securityToken || null;
            data.restNonce = hh3dData.restNonce || null;
            data.userId = hh3dData.userId || null;
            if (hh3dData.act) {
                data.lotterySpin = hh3dData.act.lotterySpin || hh3dData.act.spin || hh3dData.act.luckySpin || hh3dData.act.quay || hh3dData.act.quaySo || hh3dData.act.lottery || hh3dData.act.vongQuay || null;
            }
        }
        window.postMessage({ type: '__hh3d_bridge__', payload: data }, '*');
    } catch (e) {
        window.postMessage({ type: '__hh3d_bridge__', payload: {} }, '*');
    }

    // Đăng ký bộ lắng nghe sự kiện để chạy code trong page context
    if (!window.__HH3D_EVAL_LISTENER_REGISTERED__) {
        window.__HH3D_EVAL_LISTENER_REGISTERED__ = true;
        window.addEventListener('message', async (e) => {
            if (e.data && e.data.type === '__hh3d_eval__') {
                const id = e.data.id;
                try {
                    const fn = new Function('arg', e.data.code);
                    const result = await fn(e.data.arg);
                    window.postMessage({ type: '__hh3d_eval_res__', id: id, success: true, payload: result }, '*');
                } catch (err) {
                    window.postMessage({ type: '__hh3d_eval_res__', id: id, success: false, error: err.message }, '*');
                }
            }
        });
    }
})();

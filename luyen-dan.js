(function () {
	'use strict';

	var cfg = window.LuyenDanConfig || {};
	var assets = cfg.assets || {};
	var base = assets.base || '';

	var ELEMENTS = ['kim', 'moc', 'thuy', 'hoa', 'tho'];
	var ELEMENT_LABELS = {
		kim: 'Linh Dược Kim',
		moc: 'Linh Dược Mộc',
		thuy: 'Linh Dược Thủy',
		hoa: 'Linh Dược Hỏa',
		tho: 'Linh Dược Thổ',
	};
	var TIER_LABELS = {
		ha: 'Hạ Phẩm',
		trung: 'Trung Phẩm',
		thuong: 'Thượng Phẩm',
		cuc: 'Cực Phẩm',
	};

	function ldRankNameMsg(rankName) {
		return 'Cấp bậc Luyện Đan Sư từ ' + (rankName || '—') + ' trở lên';
	}

	function ldRankGateMsg(tier) {
		var tierLabel = TIER_LABELS[tier] || tier;
		var curLv = (MOCK.danRank && MOCK.danRank.level) || 1;
		return (
			ldRankNameMsg(recipeMinRankName(tier)) +
			' mới luyện được ' +
			tierLabel +
			'. Cấp hiện tại: ' +
			resolveDanLevelName(curLv) +
			'.'
		);
	}

	function ldTuViGateMsg(tier) {
		var tierLabel = TIER_LABELS[tier] || tier;
		return (
			'Tu Vi ' +
			fmtTuVi(recipeMinTuVi(tier)) +
			' trở lên mới luyện được ' +
			tierLabel +
			'. Tu Vi hiện tại: ' +
			fmtTuVi(MOCK.tuViBalance | 0) +
			'.'
		);
	}

	var MOCK = {
		tier: 'ha',
		recipes: {},
		furnace: 'idle',
		stability: 100,
		timerTotal: 90,
		timerLeft: 0,
		craftJobId: null,
		inventory: { kim: 0, moc: 0, thuy: 0, hoa: 0, tho: 0 },
		matBundles: [],
		pills: [],
		currency: { danHuanLeft: 0, danHuanCap: 27, danHuanWallet: 0, danHuanTuneUsed: 0 },
		rankPoints: 0,
		dongSlots: [null, null],
		incomingInvite: null,
		dongInvitesIn: [],
		dongInviteCount: 0,
		dongOwnersForMe: [],
		dongServing: null,
		dongLocked: false,
		viewRole: 'owner',
		craftOwnerUserId: 0,
		craftCompanionUserId: 0,
		_inviteOwnerId: null,
		itemCatalog: {},
		serverReady: false,
		unstableLeftSec: 0,
		unstablePhaseSec: 300,
		stabilityPressure: 1,
		tuneCooldownLeft: 0,
		tuneCount: 0,
		tuneSurvivalMin: 3,
		tuneSurvivalActive: false,
		tuneEffectiveMaxPct: 68,
		tuneHuanSlotsLeft: 0,
		tienNgocBalance: 0,
		craftFinishTs: 0,
		clockSkewSec: 0,
		pityStar4: null,
	};

	var DAN_MASTER = (cfg.danMaster && typeof cfg.danMaster === 'object') ? cfg.danMaster : {};
	var AUDIO_MUTE_KEY = 'ld-audio-muted';

	var FURNACE_IMG = {
		idle: base + 'ui-lo-dan-chua-luyen.png',
		crafting: base + 'ui-lo-dan-dang-luyen.webp',
		ready: base + 'ui-lo-dan-dang-thu-dan-fix.webp',
		exploded: base + 'luyen-dan-that-bai.webp',
	};

	/** Thông báo khi lỗi mạng / server trả HTML hoặc không phải JSON */
	var LD_REST_GENERIC_ERR = 'Lỗi — tải lại trang và thử lại';
	/** HMAC phiên Luyện Đan hết hạn (Redis ld:session:*, TTL 30 phút) */
	var LD_SESSION_EXPIRED_MSG = 'Phiên đã hết hạn, hãy tải lại trang và thử lại';
	var ldSessionRefreshPromise = null;
	/** Vai người sở hữu / điều khiển luyện (thay「Chủ Lò」). */
	var LD_ALCHEMIST_LABEL = 'Luyện Dược Sư';
	/** Tên thiết bị luyện (không gọi「Lò Luyện Dược Sư」). */
	var LD_FURNACE_LABEL = 'Đan Lô';

	var state = {
		timerId: null,
		pollId: null,
		modal: null,
		dongSlotIndex: null,
		dongFriendsList: null,
		audioReady: false,
		audioMuted: false,
		tuningInFlight: false,
		collectBusy: false,
		craftRequestBusy: false,
		confirmResolver: null,
		bgmSuspendedByTab: false,
		socketReady: false,
		explosionModalOpen: false,
		explosionAckBusy: false,
		refreshDebounceId: null,
		stabilityWarnLevel: 0,
		companionIdlePollId: null,
		stableLeaveNotified: false,
		stablePhaseConfirmed: false,
		stabilityServerPct: 100,
		stabilityServerAt: 0,
		craftStartedToastShown: false,
		prevFurnaceForCompanion: 'idle',
		decomposeRewardOpen: false,
		usePillRewardOpen: false,
		usePillAnimTimer: null,
		decomposeRevealTimers: [],
	};

	var ldSocketCryptoKeyPromise = null;

	function getLdEncKey() {
		if (typeof LD_SOCKET_ENC_KEY !== 'undefined' && LD_SOCKET_ENC_KEY) {
			return LD_SOCKET_ENC_KEY;
		}
		return '';
	}

	function hexToBytes(hex) {
		if (!hex || hex.length % 2 !== 0) return null;
		var out = new Uint8Array(hex.length / 2);
		for (var i = 0; i < out.length; i++) {
			out[i] = parseInt(hex.substr(i * 2, 2), 16);
		}
		return out;
	}

	function getLdSocketCryptoKey() {
		if (!window.crypto || !window.crypto.subtle) return Promise.resolve(null);
		var keyStr = getLdEncKey();
		if (!keyStr) return Promise.resolve(null);
		if (!ldSocketCryptoKeyPromise) {
			var keyBytes = new TextEncoder().encode(keyStr);
			ldSocketCryptoKeyPromise = window.crypto.subtle
				.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
				.catch(function () {
					return null;
				});
		}
		return ldSocketCryptoKeyPromise;
	}

	function decodeLdSocketPayload(payload) {
		if (!payload || !payload._e) return Promise.resolve(payload);
		return getLdSocketCryptoKey().then(function (key) {
			if (!key) return payload;
			try {
				var parts = String(payload._e).split(':');
				if (parts.length !== 2) return payload;
				var iv = hexToBytes(parts[0]);
				if (!iv || iv.length !== 16) return payload;
				var binary = atob(parts[1]);
				var encrypted = new Uint8Array(binary.length);
				for (var i = 0; i < binary.length; i++) encrypted[i] = binary.charCodeAt(i);
				return window.crypto.subtle
					.decrypt({ name: 'AES-CBC', iv: iv }, key, encrypted)
					.then(function (plainBuf) {
						var plainText = new TextDecoder().decode(plainBuf);
						return JSON.parse(plainText);
					})
					.catch(function () {
						return payload;
					});
			} catch (e) {
				return payload;
			}
		});
	}

	function bindLdSocketEvent(socket, eventName, handler) {
		socket.on(eventName, function (raw) {
			decodeLdSocketPayload(raw).then(handler);
		});
	}

	var LD_FIRE_STATUS_CLASSES = [
		'is-idle-lack',
		'is-idle-ok',
		'is-crafting-unstable',
		'is-crafting-stable',
		'is-ready',
		'is-exploded',
	];

	function setLdFireStatus(fire, text, statusClass, titleOpt) {
		if (!fire) return;
		LD_FIRE_STATUS_CLASSES.forEach(function (c) {
			fire.classList.remove(c);
		});
		fire.textContent = text;
		fire.setAttribute('title', titleOpt != null && titleOpt !== '' ? titleOpt : text);
		if (statusClass) fire.classList.add(statusClass);
	}

	function tierVector(tier) {
		var rr = MOCK.recipes[tier];
		return rr && rr.vector ? rr.vector : {};
	}

	function recipeTienNgocCost(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.tien_ngoc_cost != null) {
			return rec.tien_ngoc_cost | 0;
		}
		if (cfg.craftTienNgocCostDefault != null) {
			return cfg.craftTienNgocCostDefault | 0;
		}
		return 0;
	}

	function applyLdSessionFromPayload(data) {
		if (!data) return;
		if (data.security_token) cfg.securityToken = String(data.security_token);
		if (data.expires_at != null) cfg.securityTokenExpires = data.expires_at | 0;
	}

	function isLdSessionTokenStale() {
		var exp = cfg.securityTokenExpires | 0;
		if (!cfg.securityToken || exp < 1) return true;
		return Math.floor(Date.now() / 1000) >= exp - 30;
	}

	function fetchLdSessionToken() {
		return ldApi('/luyen-dan/session-token', { method: 'GET', skipLdToken: true })
			.then(function (res) {
				return res.text().then(function (text) {
					var j = null;
					if (text) {
						try {
							j = JSON.parse(text);
						} catch (e) {
							throw new Error(LD_REST_GENERIC_ERR);
						}
					}
					if (!res.ok) {
						var msg =
							(j && (j.message || (j.data && j.data.message))) || LD_REST_GENERIC_ERR;
						throw new Error(String(msg));
					}
					if (j && j.data) applyLdSessionFromPayload(j.data);
					return cfg.securityToken || '';
				});
			});
	}

	function ensureLdSessionToken() {
		if (!isLdSessionTokenStale()) {
			return Promise.resolve(cfg.securityToken || '');
		}
		if (!ldSessionRefreshPromise) {
			ldSessionRefreshPromise = fetchLdSessionToken().finally(function () {
				ldSessionRefreshPromise = null;
			});
		}
		return ldSessionRefreshPromise;
	}

	function ldApi(path, options) {
		options = options || {};
		var h = options.headers || {};
		h['X-WP-Nonce'] = cfg.restNonce || '';
		if (!options.skipLdToken && cfg.securityToken) {
			h['X-LD-Token'] = cfg.securityToken;
		}
		if (
			options.body &&
			typeof options.body === 'object' &&
			!(options.body instanceof FormData) &&
			!(options.body instanceof Blob)
		) {
			h['Content-Type'] = 'application/json';
			options.body = JSON.stringify(options.body);
		}
		options.headers = h;
		options.credentials = options.credentials || 'same-origin';
		var root = (cfg.restRoot || '').replace(/\/?$/, '');
		return fetch(root + path, options);
	}

	function ldRestErrorMessage(j, res) {
		if (j && j.code === 'ld_session_expired') {
			return LD_SESSION_EXPIRED_MSG;
		}
		var msg = j && (j.message || (j.data && j.data.message));
		if (msg && String(msg).length) return String(msg);
		if (j && j.code) return String(j.code);
		if (res && !res.ok) return LD_REST_GENERIC_ERR;
		return LD_REST_GENERIC_ERR;
	}

	function ldJson(path, opt) {
		opt = opt || {};
		var prep = opt.skipLdToken ? Promise.resolve() : ensureLdSessionToken();
		return prep
			.then(function () {
				return ldApi(path, opt);
			})
			.then(function (res) {
				return res.text().then(function (text) {
					var trimmed = text != null ? String(text).trim() : '';
					var j = null;
					if (trimmed) {
						try {
							j = JSON.parse(text);
						} catch (parseErr) {
							throw new Error(LD_REST_GENERIC_ERR);
						}
					} else if (!res.ok) {
						throw new Error(LD_REST_GENERIC_ERR);
					}
					if (!res.ok) {
						throw new Error(ldRestErrorMessage(j, res));
					}
					return j || {};
				});
			})
			.catch(function (err) {
				if (err instanceof Error) {
					if (err.name === 'AbortError') {
						throw new Error(LD_REST_GENERIC_ERR);
					}
					if (err instanceof TypeError) {
						throw new Error(LD_REST_GENERIC_ERR);
					}
					var em = String(err.message || '');
					if (
						/unexpected token|is not valid json|json\.parse|syntaxerror/i.test(em) ||
						/^</.test(em)
					) {
						throw new Error(LD_REST_GENERIC_ERR);
					}
					throw err;
				}
				throw new Error(LD_REST_GENERIC_ERR);
			});
	}
	function getCraftSecondsLeft() {
		if (MOCK.craftFinishTs) {
			var estServer = Math.floor(Date.now() / 1000) + (MOCK.clockSkewSec | 0);
			return Math.max(0, MOCK.craftFinishTs - estServer);
		}
		return Math.max(0, MOCK.timerLeft | 0);
	}

	function applyServerPayload(d) {
		if (!d) return;

		var partial = d.partial === true;
		function applyKey(k) {
			return !partial || Object.prototype.hasOwnProperty.call(d, k);
		}

		if (applyKey('recipes')) {
			MOCK.recipes = d.recipes || MOCK.recipes;
			ensureUnlockedRecipeTier();
		}
		if (applyKey('pill_tier_registry')) {
			MOCK.pillTierRegistry =
				d.pill_tier_registry && typeof d.pill_tier_registry === 'object'
					? d.pill_tier_registry
					: MOCK.pillTierRegistry;
		}

		if (applyKey('materials')) {
			MOCK.inventory = Object.assign({}, d.materials || {});
		}

		if (applyKey('mat_bundles')) {
			MOCK.matBundles = Array.isArray(d.mat_bundles) ? d.mat_bundles.slice() : [];
		}

		if (applyKey('pill_stacks') || applyKey('pills')) {
			if (applyKey('pill_stacks')) {
				MOCK.pillStacks = Array.isArray(d.pill_stacks) ? d.pill_stacks.slice() : [];
			}
			if (applyKey('pills')) {
				MOCK.pills = Array.isArray(d.pills) ? d.pills.slice() : [];
			}
			if (!MOCK.pillStacks.length && MOCK.pills.length) {
				MOCK.pillStacks = getPillStacks();
			}
		}

		if (applyKey('rank_xp')) {
			MOCK.rankPoints = d.rank_xp | 0;
		}
		if (applyKey('tu_vi_balance')) {
			MOCK.tuViBalance = d.tu_vi_balance != null ? d.tu_vi_balance | 0 : MOCK.tuViBalance;
		}
		if (applyKey('phuc_loi') && d.phuc_loi != null && typeof d.phuc_loi === 'object') {
			MOCK.phucLoi = {
				eligible: !!d.phuc_loi.eligible,
				bonusPercent: d.phuc_loi.bonus_percent != null ? d.phuc_loi.bonus_percent | 0 : 0,
			};
		}
		if (applyKey('vip_craft') && d.vip_craft != null && typeof d.vip_craft === 'object') {
			MOCK.vipCraft = {
				active: !!d.vip_craft.active,
				tierName: d.vip_craft.tier_name ? String(d.vip_craft.tier_name) : '',
				tierLabel: d.vip_craft.tier_label ? String(d.vip_craft.tier_label) : '',
				reductionPct:
					d.vip_craft.reduction_pct != null ? Number(d.vip_craft.reduction_pct) : 0,
			};
		}
		if (applyKey('vip_craft_tiers') && Array.isArray(d.vip_craft_tiers)) {
			MOCK.vipCraftTiers = d.vip_craft_tiers.map(function (row) {
				return {
					name: row.name ? String(row.name) : '',
					label: row.label ? String(row.label) : '',
					reductionPct: row.reduction_pct != null ? Number(row.reduction_pct) : 0,
				};
			});
		}
		if (applyKey('craft_duration_caps') && d.craft_duration_caps != null && typeof d.craft_duration_caps === 'object') {
			MOCK.craftDurationCaps = {
				maxReductionPct:
					d.craft_duration_caps.max_reduction_pct != null
						? Number(d.craft_duration_caps.max_reduction_pct)
						: 90,
				minTimeRatioPct:
					d.craft_duration_caps.min_time_ratio_pct != null
						? Number(d.craft_duration_caps.min_time_ratio_pct)
						: 10,
				minCraftDurationSec:
					d.craft_duration_caps.min_craft_duration_sec != null
						? Number(d.craft_duration_caps.min_craft_duration_sec)
						: 600,
				unstablePhaseSec:
					d.craft_duration_caps.unstable_phase_sec != null
						? Number(d.craft_duration_caps.unstable_phase_sec)
						: 300,
			};
		}
		if (applyKey('rank_craft_duration_help') && d.rank_craft_duration_help != null && typeof d.rank_craft_duration_help === 'object') {
			var rh = d.rank_craft_duration_help;
			var rules = rh.rules && typeof rh.rules === 'object' ? rh.rules : {};
			MOCK.rankCraftDurationHelp = {
				currentRankLevel:
					rh.current_rank_level != null ? rh.current_rank_level | 0 : 0,
				currentRankName: rh.current_rank_name ? String(rh.current_rank_name) : '',
				maxRankLevel: rh.max_rank_level != null ? rh.max_rank_level | 0 : 20,
				rules: {
					atFullPct:
						rules.reduction_at_full_buff_pct != null
							? Number(rules.reduction_at_full_buff_pct)
							: 40,
					perAboveFullPct:
						rules.reduction_per_rank_above_full_pct != null
							? Number(rules.reduction_per_rank_above_full_pct)
							: 2.5,
					aboveFullCapPct:
						rules.reduction_above_full_cap_pct != null
							? Number(rules.reduction_above_full_cap_pct)
							: 30,
					maxRankOnlyPct:
						rules.max_rank_only_pct != null ? Number(rules.max_rank_only_pct) : 90,
				},
				tiers: Array.isArray(rh.tiers)
					? rh.tiers.map(function (row) {
							return {
								tier: row.tier ? String(row.tier) : '',
								label: row.label ? String(row.label) : '',
								minRank: row.min_rank != null ? row.min_rank | 0 : 0,
								minRankName: row.min_rank_name ? String(row.min_rank_name) : '',
								fullBuffRank: row.full_buff_rank != null ? row.full_buff_rank | 0 : 0,
								fullBuffRankName: row.full_buff_rank_name
									? String(row.full_buff_rank_name)
									: '',
								fullBuffReductionPct:
									row.full_buff_reduction_pct != null
										? Number(row.full_buff_reduction_pct)
										: 0,
								maxReductionPct:
									row.max_reduction_pct != null ? Number(row.max_reduction_pct) : 0,
								currentReductionPct:
									row.current_reduction_pct != null
										? Number(row.current_reduction_pct)
										: 0,
								samples: Array.isArray(row.samples)
									? row.samples.map(function (s) {
											return {
												rankLevel: s.rank_level != null ? s.rank_level | 0 : 0,
												rankName: s.rank_name ? String(s.rank_name) : '',
												reductionPct:
													s.reduction_pct != null ? Number(s.reduction_pct) : 0,
											};
									  })
									: [],
							};
					  })
					: [],
			};
		}
		if (applyKey('pill_tu_vi_gates') && d.pill_tu_vi_gates != null && typeof d.pill_tu_vi_gates === 'object') {
			MOCK.pillTuViGates = d.pill_tu_vi_gates;
		}

		if (
			applyKey('dan_huan_left') ||
			applyKey('dan_huan_cap') ||
			applyKey('dan_huan_wallet') ||
			applyKey('dan_huan_tune_used')
		) {
			MOCK.currency = MOCK.currency || {};
			if (applyKey('dan_huan_left')) {
				MOCK.currency.danHuanLeft = d.dan_huan_left != null ? d.dan_huan_left | 0 : 0;
			}
			if (applyKey('dan_huan_cap')) {
				MOCK.currency.danHuanCap = d.dan_huan_cap != null ? d.dan_huan_cap | 0 : 27;
			}
			if (applyKey('dan_huan_wallet')) {
				MOCK.currency.danHuanWallet = d.dan_huan_wallet != null ? d.dan_huan_wallet | 0 : 0;
			}
			if (applyKey('dan_huan_tune_used')) {
				MOCK.currency.danHuanTuneUsed =
					d.dan_huan_tune_used != null ? Math.max(0, d.dan_huan_tune_used | 0) : 0;
			}
		}

		if (applyKey('tien_ngoc_balance')) {
			MOCK.tienNgocBalance = d.tien_ngoc_balance != null ? d.tien_ngoc_balance | 0 : 0;
		}

		if (applyKey('item_catalog') && d.item_catalog != null && typeof d.item_catalog === 'object') {
			MOCK.itemCatalog = d.item_catalog;
		}

		if (applyKey('pill_effects') && d.pill_effects != null && typeof d.pill_effects === 'object') {
			MOCK.pillEffects = d.pill_effects;
		}
		if (applyKey('pill_usage') && d.pill_usage != null && typeof d.pill_usage === 'object') {
			MOCK.pillUsage = d.pill_usage;
		}
		if (applyKey('pill_bag') && d.pill_bag != null && typeof d.pill_bag === 'object') {
			MOCK.pillBag = d.pill_bag;
		}
		if (applyKey('bag_expand') && d.bag_expand != null && typeof d.bag_expand === 'object') {
			MOCK.bagExpand = d.bag_expand;
		}
		if (applyKey('pill_stacks') || applyKey('pill_usage') || applyKey('pill_bag') || applyKey('bag_expand')) {
			syncPillBagClient();
		}
		if (applyKey('dan_master') && d.dan_master != null && typeof d.dan_master === 'object') {
			DAN_MASTER = d.dan_master;
		}
		if (applyKey('dan_rank') && d.dan_rank != null && typeof d.dan_rank === 'object') {
			MOCK.danRank = d.dan_rank;
			MOCK.danRank.level_name = resolveDanLevelName(MOCK.danRank.level | 0);
		}

		if (applyKey('furnace')) {
			MOCK.furnace = d.furnace || 'idle';

			if (MOCK.furnace === 'idle') {
				state.craftStartedToastShown = false;
			}
		}

		if (MOCK.furnace === 'exploded') {
			if (isCompanionView()) {
				ensureCompanionCraftContext({ owner_user_id: MOCK.craftOwnerUserId || 0 });
			}
			patchDongOwnersAfterExplosion(MOCK.craftOwnerUserId || 0);
			syncDongUi();
			showExplosionModal(false);
		} else {
			closeExplosionModal(false);
		}

		if (applyKey('dong_invites_in')) {
			MOCK.dongInvitesIn = Array.isArray(d.dong_invites_in) ? d.dong_invites_in.slice() : [];
		}
		if (applyKey('dong_invite_count')) {
			MOCK.dongInviteCount = d.dong_invite_count != null ? d.dong_invite_count | 0 : 0;
		} else if (applyKey('dong_invites_in')) {
			MOCK.dongInviteCount = MOCK.dongInvitesIn.length;
		}
		if (applyKey('dong_invites_in')) {
			syncIncomingInviteFromList();
		}
		if (applyKey('dong_owners_for_me')) {
			MOCK.dongOwnersForMe = Array.isArray(d.dong_owners_for_me) ? d.dong_owners_for_me.slice() : [];
		}
		if (applyKey('dong_serving')) {
			MOCK.dongServing = d.dong_serving && typeof d.dong_serving === 'object' ? d.dong_serving : null;
		}
		if (applyKey('dong_locked')) {
			MOCK.dongLocked = !!d.dong_locked;
		}
		if (applyKey('view_role')) {
			MOCK.viewRole = d.view_role === 'companion' ? 'companion' : 'owner';
			MOCK.craftOwnerUserId = 0;
			MOCK.craftCompanionUserId = 0;
		}

		if (applyKey('craft') && d.craft && d.craft.id) {


			MOCK.craftJobId = d.craft.id;
			MOCK.craftOwnerUserId = d.craft.owner_user_id != null ? d.craft.owner_user_id | 0 : cfg.userId | 0;
			MOCK.craftCompanionUserId =
				d.craft.companion_user_id != null ? d.craft.companion_user_id | 0 : 0;

			if (d.craft.ui_tier) MOCK.tier = d.craft.ui_tier;


			MOCK.stability =
				typeof d.craft.stability_pct === 'number'
					? d.craft.stability_pct


					: parseFloat(d.craft.stability_pct) || 0;


			MOCK.timerTotal = d.craft.duration_sec || MOCK.timerTotal;

			if (d.craft.finish_at_ts > 0 && d.craft.server_now_ts != null) {
				MOCK.craftFinishTs = d.craft.finish_at_ts | 0;
				MOCK.clockSkewSec = (d.craft.server_now_ts | 0) - Math.floor(Date.now() / 1000);
				MOCK.timerLeft = getCraftSecondsLeft();
			} else {
				MOCK.craftFinishTs = 0;
				MOCK.clockSkewSec = 0;
				MOCK.timerLeft =
					d.craft.timer_left_sec != null ? Math.max(0, d.craft.timer_left_sec | 0) : 0;
			}


			MOCK.unstableLeftSec =
				d.craft.unstable_left_sec != null ? Math.max(0, parseInt(d.craft.unstable_left_sec, 10) || 0) : 0;
			applyCraftMetaFromPayload(d.craft);
			markStabilityFromServer(MOCK.stability);
			markStablePhaseConfirmed(MOCK.stability, MOCK.unstableLeftSec);


			MOCK.tuneCooldownLeft =
				d.craft.tune_cooldown_left_sec != null
					? Math.max(0, parseInt(d.craft.tune_cooldown_left_sec, 10) || 0)
					: 0;


		} else if (applyKey('craft')) {
			MOCK.craftJobId = null;

			MOCK.craftFinishTs = 0;
			MOCK.clockSkewSec = 0;

			MOCK.unstableLeftSec = 0;

			MOCK.tuneCooldownLeft = 0;

			if (MOCK.furnace === 'idle') {
				MOCK.stability = 100;

				MOCK.timerLeft = 0;
			}
		}

		if (applyKey('dong_panel_mode')) {
			MOCK.dongPanelMode = d.dong_panel_mode === 'companion' ? 'companion' : 'owner';
		}
		reconcileCraftViewAfterDongRelations();

		var ownerCraftingNow = (MOCK.dongOwnersForMe || []).some(function (o) {
			return !!o.owner_crafting;
		});
		if (
			MOCK.furnace === 'crafting' &&
			isCompanionView() &&
			state.prevFurnaceForCompanion !== 'crafting'
		) {
			toastCraftStartedForCompanion();
		} else if (
			ownerCraftingNow &&
			MOCK.furnace === 'idle' &&
			(MOCK.dongOwnersForMe || []).length > 0
		) {
			refreshStateFresh();
		}
		state.prevFurnaceForCompanion = MOCK.furnace;
		if (applyKey('dong_display_slots') || applyKey('dong_slots')) {
			MOCK.dongSlots = [null, null];
			var slotSource =
				applyKey('dong_display_slots') &&
				Array.isArray(d.dong_display_slots) &&
				d.dong_display_slots.length
					? d.dong_display_slots
					: applyKey('dong_slots')
						? d.dong_slots || []
						: [];
			slotSource.slice(0, 2).forEach(function (slot, i) {
				if (!slot) return;
				MOCK.dongSlots[i] = {
					id: String(slot.userId != null ? slot.userId : slot.id),
					userId: slot.userId,
					name: slot.name,
					avatar: slot.avatar || '??',
					avatarUrl: slot.avatarUrl || '',
					danHuanWallet:
						slot.dan_huan_wallet != null ? slot.dan_huan_wallet | 0 : 0,
					isSelf: !!slot.is_self,
					rankLevel: slot.rank_level != null ? slot.rank_level | 0 : 0,
					rankLevelName: slot.rank_level_name ? String(slot.rank_level_name) : '',
					durationReductionPctByTier:
						slot.duration_reduction_pct_by_tier &&
						typeof slot.duration_reduction_pct_by_tier === 'object'
							? slot.duration_reduction_pct_by_tier
							: {},
				};
			});
			if (!isCompanionView()) {
				syncRecipeDurationsFromDong();
			}
		}

		if (applyKey('pity_star4')) {
			MOCK.pityStar4 = d.pity_star4 != null && typeof d.pity_star4 === 'object' ? d.pity_star4 : null;
		}


		syncRecipePityHint();

		syncDongUi();
		renderDongForMeList();
		syncTierTabsUi();

		MOCK.serverReady = true;

		if (MOCK.furnace === 'crafting' || MOCK.furnace === 'ready') {
			stopCompanionIdlePoll();
		} else {
			startCompanionIdlePoll();
		}
	}

	function stopServerPoll() {
		if (state.pollId) clearInterval(state.pollId);


		state.pollId = null;


	}

	function stopCompanionIdlePoll() {
		if (state.companionIdlePollId) clearInterval(state.companionIdlePollId);
		state.companionIdlePollId = null;
	}

	/** Đan Đồng đang chờ Chủ khai lò — poll dự phòng (socket lỡ event vẫn bắt được). */
	function startCompanionIdlePoll() {
		stopCompanionIdlePoll();
		var hasDong =
			(MOCK.dongOwnersForMe || []).length > 0 || (MOCK.dongServing && MOCK.dongServing.owner_id);
		if (!hasDong || MOCK.furnace === 'crafting' || MOCK.furnace === 'ready') return;
		var intervalMs = state.socketReady ? 3000 : 8000;
		state.companionIdlePollId = setInterval(function () {
			if (MOCK.furnace === 'crafting' || MOCK.furnace === 'ready' || MOCK.furnace === 'exploded') {
				stopCompanionIdlePoll();
				return;
			}
			var ownerCrafting = (MOCK.dongOwnersForMe || []).some(function (o) {
				return !!o.owner_crafting;
			});
			if (ownerCrafting) {
				refreshStateFresh();
			} else {
				refreshState();
			}
		}, intervalMs);
	}

	function startServerPoll() {
		stopServerPoll();
		if (MOCK.furnace !== 'crafting') return;
		// Socket đã kết nối: worker + event đủ, không poll (giảm tải).
		if (state.socketReady) return;
		state.pollId = setInterval(refreshState, 25000);
	}

	function isMyCraftJob(queueId) {
		if (!queueId) return false;
		if (!MOCK.craftJobId) return false;
		return String(MOCK.craftJobId) === String(queueId);
	}

	function isCompanionView() {
		return MOCK.viewRole === 'companion';
	}

	function buddyServesOwner(ownerId) {
		var oid = ownerId | 0;
		if (!oid) return false;
		if (MOCK.dongServing && (MOCK.dongServing.owner_id | 0) === oid) return true;
		return (MOCK.dongOwnersForMe || []).some(function (o) {
			return (o.owner_id | 0) === oid;
		});
	}

	function clearCompanionCraftUi() {
		stopTimerTick();
		stopServerPoll();
		closeExplosionModal(false);
		MOCK.furnace = 'idle';
		MOCK.craftJobId = null;
		MOCK.craftOwnerUserId = 0;
		MOCK.craftCompanionUserId = 0;
		MOCK.stability = 100;
		MOCK.craftFinishTs = 0;
		MOCK.clockSkewSec = 0;
		MOCK.timerLeft = 0;
		MOCK.unstableLeftSec = 0;
		MOCK.tuneCooldownLeft = 0;
		state.stabilityWarnLevel = 0;
		state.stablePhaseConfirmed = false;
		state.stableLeaveNotified = false;
		state.craftStartedToastShown = false;
		state.prevFurnaceForCompanion = 'idle';
	}

	/** Gỡ UI mẻ Chủ khi không còn là Đan Đồng của họ (sau rời / bị kick). */
	function reconcileCraftViewAfterDongRelations() {
		var uid = cfg.userId | 0;
		var craftOwner = MOCK.craftOwnerUserId | 0;
		if (
			craftOwner > 0 &&
			craftOwner !== uid &&
			(MOCK.furnace === 'crafting' || MOCK.furnace === 'ready' || MOCK.furnace === 'exploded') &&
			!buddyServesOwner(craftOwner)
		) {
			clearCompanionCraftUi();
		}
		if (MOCK.viewRole === 'companion' && !MOCK.dongServing && !(MOCK.dongOwnersForMe || []).length) {
			MOCK.viewRole = 'owner';
			MOCK.dongPanelMode = 'owner';
			MOCK.dongLocked = false;
		}
	}

	/** Đang là / đã nhận vai Đan Đồng (kể cả khi view_role vẫn là owner). */
	function isDanDongExperience() {
		if (isCompanionView()) return true;
		if (MOCK.dongServing) return true;
		return (MOCK.dongOwnersForMe || []).length > 0;
	}

	function resolveAlchemistName(explicitName) {
		if (explicitName) return explicitName;
		if (MOCK.dongServing && MOCK.dongServing.owner_name) return MOCK.dongServing.owner_name;
		var first = (MOCK.dongOwnersForMe || [])[0];
		if (first && first.owner_name) return first.owner_name;
		return LD_ALCHEMIST_LABEL;
	}

	function isSocketPayloadForMe(payload) {
		if (!payload) return false;
		var uid = cfg.userId | 0;
		if (!uid) return false;
		if ((payload.owner_user_id | 0) === uid) return true;
		if ((payload.companion_user_id | 0) === uid) return true;
		return false;
	}

	/** Chủ Lò + Đan Đồng accepted của mẻ (kể cả khi companion_user_id trên payload là buddy khác). */
	function isLdCraftAudience(payload) {
		if (!payload) return false;
		var uid = cfg.userId | 0;
		if (!uid) return false;
		if ((payload.owner_user_id | 0) === uid) return true;
		if ((payload.companion_user_id | 0) === uid) return true;
		var oid = payload.owner_user_id | 0;
		if (!oid) return false;
		if (MOCK.dongServing && (MOCK.dongServing.owner_id | 0) === oid) return true;
		return (MOCK.dongOwnersForMe || []).some(function (o) {
			return (o.owner_id | 0) === oid;
		});
	}

	function applyCraftMetaFromPayload(data) {
		if (!data) return;
		if (data.unstable_phase_sec != null) {
			MOCK.unstablePhaseSec = Math.max(30, parseInt(data.unstable_phase_sec, 10) || 300);
		}
		if (data.stability_drain_pressure != null) {
			var p = parseFloat(data.stability_drain_pressure);
			MOCK.stabilityPressure = isNaN(p) ? 1 : Math.max(0.5, Math.min(1.5, p));
		}
		if (data.tune_count != null) {
			MOCK.tuneCount = Math.max(0, parseInt(data.tune_count, 10) || 0);
		}
		if (data.tune_survival_min != null) {
			MOCK.tuneSurvivalMin = Math.max(1, parseInt(data.tune_survival_min, 10) || 3);
		}
		if (data.tune_survival_active != null) {
			MOCK.tuneSurvivalActive = !!data.tune_survival_active;
		} else if (data.tune_count != null && data.tune_survival_min != null) {
			MOCK.tuneSurvivalActive = MOCK.tuneCount >= MOCK.tuneSurvivalMin;
		}
		if (data.tune_effective_max_pct != null) {
			MOCK.tuneEffectiveMaxPct = parseFloat(data.tune_effective_max_pct) || 68;
		}
		if (data.tune_huan_slots_left != null) {
			MOCK.tuneHuanSlotsLeft = Math.max(0, parseInt(data.tune_huan_slots_left, 10) || 0);
		}
	}

	function formatDanHuanTodayReceived(used, cap) {
		cap = cap != null ? cap | 0 : MOCK.currency.danHuanCap | 0;
		if (cap < 1) cap = 27;
		used = Math.max(0, Math.min(used | 0, cap));
		return 'Hôm nay đã nhận ' + used + '/' + cap;
	}

	function tuneDanHuanGrantedToast(granted, tr, body) {
		var cap =
			tr && tr.daily_cap != null
				? tr.daily_cap | 0
				: body && body.dan_huan_cap != null
					? body.dan_huan_cap | 0
					: MOCK.currency.danHuanCap | 0;
		var used =
			tr && tr.daily_used != null
				? tr.daily_used | 0
				: Math.max(0, cap - ((tr && tr.daily_left != null ? tr.daily_left | 0 : cap)));
		return '+' + (granted | 0) + ' Đan Huân · ' + formatDanHuanTodayReceived(used, cap);
	}

	function canCompanionHuanTune() {
		return (
			(isCompanionView() || isDanDongExperience()) &&
			(MOCK.unstableLeftSec | 0) > 0 &&
			(MOCK.tuneHuanSlotsLeft | 0) > 0
		);
	}

	function tuneSurvivalProgressLabel() {
		var n = MOCK.tuneCount | 0;
		var need = MOCK.tuneSurvivalMin | 0;
		return n + '/' + need + ' lần giữ lửa (khi % từ ' + Math.round(MOCK.tuneEffectiveMaxPct) + ' trở xuống)';
	}

	function isTuneSurvivalActive() {
		return !!MOCK.tuneSurvivalActive || (MOCK.tuneCount | 0) >= (MOCK.tuneSurvivalMin | 0);
	}

	/** Trong pha nhạy cảm: % ≤ ngưỡng catalog thì cần Điều Hỏa có hiệu lực (khớp tune_effective_max_pct). */
	function isInTuneWeakBand(pct) {
		var max = MOCK.tuneEffectiveMaxPct || 68;
		return Math.round(pct) <= Math.round(max);
	}

	function markStabilityFromServer(pct) {
		var n = Math.max(0, Math.min(100, pct));
		MOCK.stability = n;
		state.stabilityServerPct = n;
		state.stabilityServerAt = Date.now();
	}

	function tuneDrainMultiplierClient() {
		if (isTuneSurvivalActive()) return 0;
		var cnt = MOCK.tuneCount | 0;
		var min = MOCK.tuneSurvivalMin | 0;
		if (cnt <= 0 || min < 1) return 1;
		return Math.max(0, 1 - (Math.min(cnt, min) / min) * 0.85);
	}

	function tickLocalStabilityDrain() {
		if (MOCK.furnace !== 'crafting') return;
		if ((MOCK.unstableLeftSec | 0) <= 0) return;
		if (!state.stabilityServerAt) return;
		var mul = tuneDrainMultiplierClient();
		if (mul <= 0) return;
		var phase = MOCK.unstablePhaseSec || 300;
		var pressure = MOCK.stabilityPressure || 1;
		var elapsed = (Date.now() - state.stabilityServerAt) / 1000;
		if (elapsed < 0.2) return;
		var drain = ((100 / phase) * pressure * elapsed * mul);
		MOCK.stability = Math.max(0, state.stabilityServerPct - drain);
	}

	function ensureCompanionCraftContext(payload) {
		if (!payload) return;
		var uid = cfg.userId | 0;
		var oid = payload.owner_user_id | 0;
		if (!uid || !oid || oid === uid) return;
		if (!isLdCraftAudience(payload) && !isCompanionCraftForMe(payload)) return;
		MOCK.viewRole = 'companion';
		MOCK.dongPanelMode = 'companion';
		MOCK.dongLocked = true;
		if (!MOCK.dongServing || (MOCK.dongServing.owner_id | 0) !== oid) {
			MOCK.dongServing = {
				owner_id: oid,
				owner_name: payload.owner_name || LD_ALCHEMIST_LABEL,
				locked: true,
			};
		}
		MOCK.craftOwnerUserId = oid;
		MOCK.craftCompanionUserId = uid;
		if (payload.queue_id != null) MOCK.craftJobId = payload.queue_id;
	}

	function patchDongOwnersAfterExplosion(ownerId) {
		var oid = ownerId | 0;
		if (!oid) return;
		MOCK.dongOwnersForMe = (MOCK.dongOwnersForMe || []).map(function (o) {
			if ((o.owner_id | 0) !== oid) return o;
			return Object.assign({}, o, {
				owner_crafting: false,
				owner_unstable: false,
				can_leave: true,
			});
		});
		if (MOCK.dongServing && (MOCK.dongServing.owner_id | 0) === oid) {
			MOCK.dongServing = Object.assign({}, MOCK.dongServing, { locked: false });
		}
	}

	function toastCraftStartedForCompanion() {
		if ((cfg.userId | 0) === 0) return;
		if (!isCompanionView() && !MOCK.dongServing && !(MOCK.dongOwnersForMe || []).length) return;
		if (state.craftStartedToastShown) return;
		state.craftStartedToastShown = true;
		toast('Đã bắt đầu Luyện Đan', 'ok');
	}

	function matchesActiveCraftSocket(payload) {
		if (!payload || payload.queue_id == null || payload.queue_id === '') return true;
		if (!MOCK.craftJobId) return true;
		return String(payload.queue_id) === String(MOCK.craftJobId);
	}

	function canOwnerInviteDong() {
		if (isCompanionView() || isDanDongExperience()) return false;
		return MOCK.furnace !== 'crafting' && MOCK.furnace !== 'ready';
	}

	function companionCanLeaveServing() {
		if (!MOCK.dongServing) return false;
		var oid = MOCK.dongServing.owner_id | 0;
		if (MOCK.furnace === 'exploded') return true;
		if ((MOCK.unstableLeftSec | 0) > 0) return false;
		var row = (MOCK.dongOwnersForMe || []).find(function (o) {
			return (o.owner_id | 0) === oid;
		});
		if (row) return !!row.can_leave;
		return MOCK.furnace === 'crafting' || MOCK.furnace === 'ready' || MOCK.furnace === 'idle';
	}

	function notifyStableLeaveAvailable() {
		if (state.stableLeaveNotified || !isCompanionView()) return;
		if (!companionCanLeaveServing()) return;
		state.stableLeaveNotified = true;
		var msg =
			MOCK.furnace === 'exploded'
				? LD_FURNACE_LABEL + ' đã nổ — bạn có thể rời Đan Đồng'
				: 'Hết 5 phút Điều Hỏa — bạn có thể rời Đan Đồng nếu muốn';
		toast(msg, 'ok');
	}

	function onUnstablePhaseEnded(ownerId) {
		var oid = ownerId | 0;
		if (!oid) {
			oid =
				(MOCK.dongServing && (MOCK.dongServing.owner_id | 0)) ||
				(MOCK.craftOwnerUserId | 0) ||
				0;
		}
		if (!oid) return;
		patchDongOwnersLeaveFlags(oid, 0);
		notifyStableLeaveAvailable();
		renderDongForMeList();
		syncDongUi();
	}

	function patchDongOwnersLeaveFlags(ownerId, unstableLeftSec) {
		var oid = ownerId | 0;
		if (!oid) return;
		var inUnstable = (unstableLeftSec | 0) > 0;
		if (inUnstable) {
			state.stableLeaveNotified = false;
		}
		MOCK.dongOwnersForMe = (MOCK.dongOwnersForMe || []).map(function (o) {
			if ((o.owner_id | 0) !== oid) return o;
			return Object.assign({}, o, {
				can_leave: !inUnstable,
				owner_unstable: inUnstable,
				owner_crafting: inUnstable || !!o.owner_crafting,
			});
		});
		if (!inUnstable && MOCK.dongServing && (MOCK.dongServing.owner_id | 0) === oid) {
			MOCK.dongServing = Object.assign({}, MOCK.dongServing, { locked: false });
		}
	}

	function applyCraftTimerFieldsFromPayload(data) {
		if (!data) return;
		if (data.finish_at_ts > 0) {
			MOCK.craftFinishTs = data.finish_at_ts | 0;
			if (data.server_now_ts != null) {
				MOCK.clockSkewSec = (data.server_now_ts | 0) - Math.floor(Date.now() / 1000);
			} else {
				MOCK.clockSkewSec = 0;
			}
			MOCK.timerLeft = getCraftSecondsLeft();
		} else if (data.timer_left_sec != null) {
			MOCK.craftFinishTs = 0;
			MOCK.clockSkewSec = 0;
			MOCK.timerLeft = Math.max(0, data.timer_left_sec | 0);
		}
		if (data.duration_sec) MOCK.timerTotal = data.duration_sec | 0;
		if (data.ui_tier) MOCK.tier = data.ui_tier;
	}

	function bootstrapOwnerCraftingFromSocket(payload) {
		var uid = cfg.userId | 0;
		if (!payload || (payload.owner_user_id | 0) !== uid) return false;
		MOCK.viewRole = 'owner';
		MOCK.dongPanelMode = 'owner';
		MOCK.furnace = 'crafting';
		MOCK.craftJobId = payload.queue_id != null ? payload.queue_id : MOCK.craftJobId;
		MOCK.craftOwnerUserId = uid;
		MOCK.craftCompanionUserId = payload.companion_user_id | 0;
		applyCraftTimerFieldsFromPayload(payload);
		return true;
	}

	function syncCraftJobFromSocket(payload) {
		if (payload && payload.queue_id != null) {
			MOCK.craftJobId = payload.queue_id;
		}
	}

	function refreshStateFresh() {
		return ldJson('/luyen-dan/state?fresh=1', { method: 'GET' }).then(function (body) {
			applyServerPayload(body.data);
			renderInventory();
			renderDongSlots();
			syncDongUi();
			renderDongForMeList();
			syncRank();
			syncButtons();
			syncStability();
			syncTimer();
			syncTierTabsUi();
			if (MOCK.furnace === 'crafting') {
				startTimerTick();
				startServerPoll();
				stopCompanionIdlePoll();
			} else {
				stopServerPoll();
				startCompanionIdlePoll();
			}
			return body;
		});
	}

	function applySocketStability(payload) {
		if (!payload || !isLdCraftAudience(payload)) return;
		if (!matchesActiveCraftSocket(payload)) return;

		syncCraftJobFromSocket(payload);

		var pct =
			typeof payload.stability_pct === 'number'
				? payload.stability_pct
				: parseFloat(payload.stability_pct);
		if (isNaN(pct)) pct = 0;

		var craftingUi = MOCK.furnace === 'crafting' || MOCK.furnace === 'ready';

		// UI chưa vào luyện — bootstrap ngay từ socket (Đan Đồng: mọi audience, không chỉ companion_user_id trên row).
		if (!craftingUi) {
			var booted = false;
			var uid = cfg.userId | 0;
			var oid = payload.owner_user_id | 0;
			if (oid && oid !== uid && isLdCraftAudience(payload)) {
				applyCompanionCraftSocket(payload);
				booted = true;
			} else if (oid === uid) {
				bootstrapOwnerCraftingFromSocket(payload);
				booted = true;
			}
			if (!booted) {
				if (payload.source === 'craft_start') {
					refreshStateFresh();
				} else {
					scheduleRefreshState(350);
				}
				return;
			}
			craftingUi = true;
			if (payload.source === 'craft_start' && oid !== uid) {
				toastCraftStartedForCompanion();
			}
			applyCraftMetaFromPayload(payload);
			applyCraftTimerFieldsFromPayload(payload);
		}

		markStabilityFromServer(pct);
		if (payload.unstable_left_sec != null) {
			MOCK.unstableLeftSec = Math.max(0, parseInt(payload.unstable_left_sec, 10) || 0);
			patchDongOwnersLeaveFlags(payload.owner_user_id, MOCK.unstableLeftSec);
		}
		markStablePhaseConfirmed(pct, MOCK.unstableLeftSec);
		syncStability();
		syncButtons();
		renderDongForMeList();
		if (craftingUi && MOCK.furnace === 'crafting') {
			startTimerTick();
			stopCompanionIdlePoll();
			if ((MOCK.unstableLeftSec | 0) <= 0) {
				onUnstablePhaseEnded(payload.owner_user_id);
			}
		}
	}

	function applySocketExplosion(payload) {
		if (!payload || !isLdCraftAudience(payload)) return;
		if (!matchesActiveCraftSocket(payload)) return;
		ensureCompanionCraftContext(payload);
		syncCraftJobFromSocket(payload);

		stopTimerTick();
		stopServerPoll();
		stopCompanionIdlePoll();
		MOCK.furnace = 'exploded';
		MOCK.dongLocked = false;
		markStabilityFromServer(0);
		patchDongOwnersAfterExplosion(payload.owner_user_id);
		state.stableLeaveNotified = false;
		syncDongUi();
		renderDongForMeList();
		notifyStableLeaveAvailable();
		syncStability();
		syncButtons();
		syncTierTabsUi();
		showExplosionModal(true);
		if (isCompanionView()) {
			toast('Thất bại — ' + LD_FURNACE_LABEL + ' đã nổ', 'error');
		} else {
			toast('Nổ ' + LD_FURNACE_LABEL + ' — ổn định lửa về 0%', 'error');
		}
	}

	function applySocketQueueReady(payload) {
		if (!payload || !isLdCraftAudience(payload)) return;
		if (!matchesActiveCraftSocket(payload)) return;
		syncCraftJobFromSocket(payload);
		refreshState().then(function () {
			toast('Đan đã thành — có thể thu đan', 'ok');
		});
	}

	function showExplosionModal(playFx) {
		var modal = $('#ldExplosionModal');
		var bd = $('#ldExplosionBackdrop');
		if (!modal || !bd) return;
		state.explosionModalOpen = true;
		modal.hidden = false;
		bd.hidden = false;
		document.body.classList.add('ld-modal-open');
		var img = $('#ldFurnaceImg');
		if (img) img.src = FURNACE_IMG.exploded;
		var ack = getAckBtn();
		var confirm = $('#ldExplosionConfirm');
		if (isCompanionView()) {
			if (ack) {
				ack.hidden = false;
				ack.textContent = 'Đóng';
				ack.disabled = false;
			}
			if (confirm) {
				confirm.textContent = 'Đóng';
				confirm.hidden = false;
			}
		} else {
			if (ack) ack.hidden = true;
			if (confirm) {
				confirm.textContent = 'Xác Nhận';
				confirm.hidden = false;
			}
		}
		if (playFx) {
			var core = document.querySelector('.ld-furnace-core');
			if (core) {
				core.classList.remove('is-explosion-shake');
				void core.offsetWidth;
				core.classList.add('is-explosion-shake');
			}
		}
	}

	function closeExplosionModal(resetBodyClass) {
		var modal = $('#ldExplosionModal');
		var bd = $('#ldExplosionBackdrop');
		if (!modal || !bd) return;
		state.explosionModalOpen = false;
		modal.hidden = true;
		bd.hidden = true;
		if (resetBodyClass !== false) {
			document.body.classList.remove('ld-modal-open');
		}
	}

	function initExplosionModal() {
		var btn = $('#ldExplosionConfirm');
		if (!btn) return;
		btn.addEventListener('click', function () {
			if (state.explosionAckBusy) return;
			playClick();
			ackExplosion();
		});
	}

	function initLuyenDanSocket() {
		if (typeof io === 'undefined') {
			console.warn('[Luyện Đan] socket.io chưa tải — dùng poll REST dự phòng.');
			return;
		}
		var uid = cfg.userId | 0;
		if (!uid) return;

		var socket = window.ldSocket;
		if (!socket) {
			var url = cfg.socketUrl || 'https://ld.hoathinhtq.net';
			socket = io(url, {
				transports: ['websocket', 'polling'],
				reconnection: true,
				reconnectionDelay: 1000,
				reconnectionDelayMax: 3000,
				reconnectionAttempts: Infinity,
			});
			window.ldSocket = socket;
		}

		function register() {
			socket.emit('register_user', String(uid));
		}

		function bindHandlers() {
			socket.removeAllListeners('hh3d_dan_stability_update');
			socket.removeAllListeners('hh3d_dan_explosion');
			socket.removeAllListeners('hh3d_dan_queue_ready');
			socket.removeAllListeners('hh3d_dan_invite_received');
			socket.removeAllListeners('hh3d_dan_invite_cancelled');
			socket.removeAllListeners('hh3d_dan_dong_accepted');
			socket.removeAllListeners('hh3d_dan_companion_craft');
			socket.removeAllListeners('hh3d_dan_dong_left');
			socket.removeAllListeners('hh3d_dan_collect_announced');
			bindLdSocketEvent(socket, 'hh3d_dan_stability_update', onStability);
			bindLdSocketEvent(socket, 'hh3d_dan_explosion', onExplosion);
			bindLdSocketEvent(socket, 'hh3d_dan_queue_ready', onQueueReady);
			bindLdSocketEvent(socket, 'hh3d_dan_invite_received', onInviteReceived);
			bindLdSocketEvent(socket, 'hh3d_dan_invite_cancelled', onInviteCancelled);
			bindLdSocketEvent(socket, 'hh3d_dan_dong_accepted', onDongAccepted);
			bindLdSocketEvent(socket, 'hh3d_dan_dong_left', onDongLeft);
			bindLdSocketEvent(socket, 'hh3d_dan_companion_craft', onCompanionCraft);
			bindLdSocketEvent(socket, 'hh3d_dan_collect_announced', onCollectAnnounced);
		}

		function onStability(data) {
			applySocketStability(data);
		}
		function onExplosion(data) {
			applySocketExplosion(data);
		}
		function onQueueReady(data) {
			applySocketQueueReady(data);
		}
		function onInviteReceived() {
			scheduleRefreshState(300);
		}

		function onInviteCancelled(data) {
			if (!data) {
				scheduleRefreshState(300);
				return;
			}
			var oid = data.owner_user_id | 0;
			if (!oid) {
				scheduleRefreshState(300);
				return;
			}
			MOCK.dongInvitesIn = (MOCK.dongInvitesIn || []).filter(function (inv) {
				return (inv.owner_id | 0) !== oid;
			});
			syncIncomingInviteFromList();
			if (MOCK._inviteOwnerId === oid) {
				MOCK._inviteOwnerId = null;
			}
			closeInviteModal();
			syncDongNotif();
			var invitesModal = $('#ldDongInvitesModal');
			if (invitesModal && !invitesModal.hidden) {
				renderDongInvitesListModal();
			}
		}

		function patchOwnerDongSlotFromPayload(data) {
			if (!data || (data.owner_user_id | 0) !== (cfg.userId | 0)) return;
			var bid = data.companion_user_id | 0;
			if (!bid) return;
			var slot = {
				id: String(bid),
				userId: bid,
				name: data.companion_name || 'Đạo hữu',
				avatar: (data.companion_name || '??').slice(0, 2),
				avatarUrl: data.companion_avatar_url || '',
				danHuanSupported: 0,
				isSelf: false,
			};
			var placed = false;
			MOCK.dongSlots.forEach(function (s, i) {
				if (s && (s.userId | 0) === bid) {
					MOCK.dongSlots[i] = Object.assign({}, s, slot);
					placed = true;
				}
			});
			if (!placed) {
				var empty = MOCK.dongSlots.indexOf(null);
				if (empty < 0) empty = MOCK.dongSlots.indexOf(undefined);
				if (empty < 0) {
					for (var i = 0; i < MOCK.dongSlots.length; i++) {
						if (!MOCK.dongSlots[i]) {
							empty = i;
							break;
						}
					}
				}
				if (empty >= 0) MOCK.dongSlots[empty] = slot;
			}
			renderDongSlots();
		}

		function onDongAccepted(data) {
			var uid = cfg.userId | 0;
			if (!data) {
				scheduleRefreshState(300);
				return;
			}
			if ((data.owner_user_id | 0) === uid) {
				patchOwnerDongSlotFromPayload(data);
				var cname = data.companion_name || 'Đạo hữu';
				toast('「' + cname + '」đã chấp nhận làm Đan Đồng cho bạn', 'ok');
				scheduleRefreshState(400);
				return;
			}
			if ((data.companion_user_id | 0) === uid) {
				refreshState();
			}
		}

		function applyDongLeftAsBuddy(data) {
			var uid = cfg.userId | 0;
			var oid = data.owner_user_id | 0;
			if (!oid || (data.companion_user_id | 0) !== uid) return;

			MOCK.dongOwnersForMe = (MOCK.dongOwnersForMe || []).filter(function (o) {
				return (o.owner_id | 0) !== oid;
			});

			var wasServing =
				MOCK.dongServing && (MOCK.dongServing.owner_id | 0) === oid;
			var wasCraftingForOwner =
				isCompanionView() && (MOCK.craftOwnerUserId | 0) === oid;

			if (wasServing) {
				MOCK.dongServing = null;
			}

			var otherOwnerCrafting = (MOCK.dongOwnersForMe || []).some(function (o) {
				return !!o.owner_crafting;
			});
			if (
				wasCraftingForOwner ||
				(MOCK.craftOwnerUserId | 0) === oid ||
				((MOCK.furnace === 'crafting' || MOCK.furnace === 'ready' || MOCK.furnace === 'exploded') &&
					!otherOwnerCrafting)
			) {
				clearCompanionCraftUi();
			}

			if ((MOCK.dongOwnersForMe || []).length === 0) {
				MOCK.viewRole = 'owner';
				MOCK.dongPanelMode = 'owner';
				MOCK.dongLocked = false;
				MOCK.dongServing = null;
			} else {
				MOCK.dongLocked = (MOCK.dongOwnersForMe || []).some(function (o) {
					return !!o.owner_crafting;
				});
				if (wasServing) {
					var next = MOCK.dongOwnersForMe[0];
					if (next) {
						MOCK.dongServing = {
							owner_id: next.owner_id | 0,
							owner_name: next.owner_name || LD_ALCHEMIST_LABEL,
							locked: !!next.owner_crafting,
						};
						MOCK.viewRole = 'companion';
						MOCK.dongPanelMode = 'companion';
					}
				}
			}

			reconcileCraftViewAfterDongRelations();
			renderDongForMeList();
			renderDongSlots();
			syncDongUi();
			syncButtons();
			syncStability();
			syncTimer();
			syncTierTabsUi();
			if (otherOwnerCrafting) {
				scheduleRefreshState(80);
			} else {
				startCompanionIdlePoll();
			}

			var oname = data.owner_name || LD_ALCHEMIST_LABEL;
			if (data.reason === 'kicked') {
				toast('「' + oname + '」đã trục xuất bạn khỏi Đan Đồng', 'error');
			} else {
				toast('Đã rời Đan Đồng của 「' + oname + '」', 'ok');
			}

			if (!otherOwnerCrafting) {
				scheduleRefreshState(350);
			}
		}

		function onDongLeft(data) {
			var uid = cfg.userId | 0;
			if (!data) {
				scheduleRefreshState(300);
				return;
			}
			if ((data.owner_user_id | 0) === uid) {
				var bid = data.companion_user_id | 0;
				MOCK.dongSlots = MOCK.dongSlots.map(function (s) {
					return s && (s.userId | 0) === bid ? null : s;
				});
				renderDongSlots();
				if (data.reason !== 'kicked') {
					var cname = data.companion_name || 'Đạo hữu';
					toast('「' + cname + '」đã rời Đan Đồng', 'ok');
				}
				scheduleRefreshState(400);
				return;
			}
			if ((data.companion_user_id | 0) === uid) {
				applyDongLeftAsBuddy(data);
			}
		}

		function isCompanionCraftForMe(data) {
			if (!data) return false;
			var uid = cfg.userId | 0;
			if (!uid) return false;
			if ((data.companion_user_id | 0) === uid) return true;
			var oid = data.owner_user_id | 0;
			if (!oid) return false;
			if (MOCK.dongServing && (MOCK.dongServing.owner_id | 0) === oid) return true;
			return (MOCK.dongOwnersForMe || []).some(function (o) {
				return (o.owner_id | 0) === oid;
			});
		}

		function applyCompanionCraftSocket(data) {
			if (!data) return;
			var uid = cfg.userId | 0;
			var oid = data.owner_user_id | 0;
			if (!oid || oid === uid) return;
			if (!isLdCraftAudience(data) && !isCompanionCraftForMe(data)) return;
			var qid = data.queue_id || data.id;

			MOCK.viewRole = 'companion';
			MOCK.dongPanelMode = 'companion';
			var craftUx =
				data.unstable_left_sec != null
					? Math.max(0, parseInt(data.unstable_left_sec, 10) || 0)
					: MOCK.unstableLeftSec;
			var craftUnstable = (craftUx | 0) > 0;
			MOCK.furnace = 'crafting';
			MOCK.dongLocked = true;
			MOCK.dongServing = {
				owner_id: oid,
				owner_name: data.owner_name || LD_ALCHEMIST_LABEL,
				locked: craftUnstable,
			};
			MOCK.craftJobId = qid != null ? qid : MOCK.craftJobId;
			MOCK.craftOwnerUserId = oid;
			MOCK.craftCompanionUserId = uid;
			var startPct =
				typeof data.stability_pct === 'number'
					? data.stability_pct
					: parseFloat(data.stability_pct) || 100;
			markStabilityFromServer(startPct);
			MOCK.unstableLeftSec = craftUx;
			if (data.ui_tier) MOCK.tier = data.ui_tier;
			if (data.duration_sec) MOCK.timerTotal = data.duration_sec | 0;
			applyCraftMetaFromPayload(data);
			applyCraftTimerFieldsFromPayload(data);

			MOCK.dongOwnersForMe = (MOCK.dongOwnersForMe || []).map(function (o) {
				if ((o.owner_id | 0) === oid) {
					return Object.assign({}, o, {
						owner_crafting: true,
						owner_unstable: craftUnstable,
						can_leave: !craftUnstable,
					});
				}
				return o;
			});

			state.stabilityWarnLevel = 0;
			state.stableLeaveNotified = false;
			closeExplosionModal(false);
			if (!craftUnstable) {
				onUnstablePhaseEnded(oid);
			}
			syncDongUi();
			renderDongSlots();
			renderDongForMeList();
			syncButtons();
			syncStability();
			syncTimer();
			syncTierTabsUi();
			startTimerTick();
			startServerPoll();
		}

		function onCompanionCraft(data) {
			if (!data || !isLdCraftAudience(data)) return;
			applyCompanionCraftSocket(data);
			stopCompanionIdlePoll();
			toastCraftStartedForCompanion();
		}

		socket.on('connect', function () {
			state.socketReady = true;
			register();
			bindHandlers();
			if (MOCK.furnace === 'crafting') startServerPoll();
		});
		socket.on('registration_confirmed', function () {
			state.socketReady = true;
			if (MOCK.furnace === 'crafting') startServerPoll();
		});
		socket.on('disconnect', function () {
			state.socketReady = false;
			if (MOCK.furnace === 'crafting') startServerPoll();
		});
		socket.on('reconnect', function () {
			register();
		});

		bindHandlers();
		if (socket.connected) {
			state.socketReady = true;
			register();
			if (MOCK.furnace === 'crafting') startServerPoll();
		}
	}

	function scheduleRefreshState(delayMs) {
		if (state.refreshDebounceId) {
			clearTimeout(state.refreshDebounceId);
		}
		state.refreshDebounceId = setTimeout(function () {
			state.refreshDebounceId = null;
			refreshState();
		}, delayMs == null ? 450 : delayMs);
	}

	function refreshState() {


		return ldJson('/luyen-dan/state', { method: 'GET' })


			.then(function (body) {


				applyServerPayload(body.data);


				renderInventory();


				renderDongSlots();
				syncDongUi();
				renderDongForMeList();

				syncRank();


				syncButtons();


				syncStability();


				syncTimer();


				maybeInviteModal();


				syncTierTabsUi();


				if (MOCK.furnace === 'crafting') {
					startTimerTick();
					startServerPoll();
					stopCompanionIdlePoll();
					if ((MOCK.unstableLeftSec | 0) <= 0) {
						onUnstablePhaseEnded(MOCK.craftOwnerUserId || cfg.userId);
					}
				} else {
					stopTimerTick();
					stopServerPoll();
					startCompanionIdlePoll();
				}


				return body.data;


			})


			.catch(function (err) {


				toast(err && err.message ? err.message : 'Không tải được trạng thái');


			});


	}

	function syncTierTabsUi() {
		var tabsLocked = MOCK.furnace !== 'idle' || MOCK.dongLocked || isCompanionView() || isDanDongExperience();
		$$('.ld-recipe-tier').forEach(function (t) {
			var tier = t.dataset.tier;
			var craftLocked = !recipeCraftUnlocked(tier);
			t.classList.toggle('is-active', tier === MOCK.tier);
			t.classList.toggle('is-locked', craftLocked);
			t.disabled = tabsLocked || craftLocked;
			if (craftLocked) {
				t.setAttribute('title', ldCraftGateMsg(tier));
			} else {
				t.removeAttribute('title');
			}
		});
	}

	function getAcceptedDongOwnerIds() {
		return (MOCK.dongOwnersForMe || []).map(function (o) {
			return o.owner_id | 0;
		});
	}

	function getActionableDongInvites() {
		var accepted = getAcceptedDongOwnerIds();
		return (MOCK.dongInvitesIn || []).filter(function (inv) {
			var oid = inv && inv.owner_id != null ? inv.owner_id | 0 : 0;
			return oid > 0 && accepted.indexOf(oid) < 0;
		});
	}

	function syncIncomingInviteFromList() {
		var list = getActionableDongInvites();
		MOCK.incomingInvite = list[0] || null;
		MOCK.dongInviteCount = list.length;
	}

	function hasActionableDongInvite() {
		return getActionableDongInvites().length > 0;
	}

	function syncDongNotif() {
		var btn = $('#ldDongNotif');
		var badge = $('#ldDongNotifCount');
		if (!btn) return;
		syncIncomingInviteFromList();
		var n = MOCK.dongInviteCount | 0;
		btn.hidden = false;
		btn.classList.toggle('has-pending', n > 0);
		if (badge) {
			badge.hidden = n < 1;
			badge.textContent = String(n > 99 ? '99+' : n);
		}
	}

	function syncDongUi() {
		syncDongNotif();
		var ownerPanel = $('#ldDongOwnerPanel');
		var serving = $('#ldDongServingBanner');
		var ownerName = $('#ldDongServingOwner');
		var forMeWrap = $('#ldDongForMeWrap');
		var companion = isCompanionView();
		var dongPanelCompanion =
			MOCK.dongPanelMode === 'companion' || companion || (MOCK.dongOwnersForMe && MOCK.dongOwnersForMe.length > 0);
		var dongTitle = ownerPanel ? ownerPanel.querySelector('.ld-dong__title') : null;
		var dongSub = ownerPanel ? ownerPanel.querySelector('.ld-dong__sub') : null;
		var dongHint = ownerPanel ? ownerPanel.querySelector('.ld-dong__hint') : null;

		if (ownerPanel) {
			ownerPanel.hidden = false;
		}
		if (serving) {
			serving.hidden = !companion || !MOCK.dongServing;
		}
		if (ownerName && MOCK.dongServing) {
			ownerName.textContent = MOCK.dongServing.owner_name || LD_ALCHEMIST_LABEL;
		}
		var leaveBtn = $('#ldDongServingLeave');
		if (leaveBtn) {
			var canLeaveServing = companion && MOCK.dongServing && companionCanLeaveServing();
			leaveBtn.hidden = !canLeaveServing;
			if (!leaveBtn._ldBound) {
				leaveBtn._ldBound = true;
				leaveBtn.addEventListener('click', function () {
					if (!MOCK.dongServing) return;
					dongLeaveOwner(MOCK.dongServing.owner_id, MOCK.dongServing.owner_name);
				});
			}
		}
		if (forMeWrap) {
			forMeWrap.hidden = !(MOCK.dongOwnersForMe && MOCK.dongOwnersForMe.length) || companion;
		}
		if (dongTitle) {
			if (companion && MOCK.dongServing) {
				dongTitle.textContent = 'Đan Đồng · ' + (MOCK.dongServing.owner_name || LD_ALCHEMIST_LABEL);
			} else if (dongPanelCompanion) {
				dongTitle.textContent = 'Vai Đan Đồng';
			} else {
				dongTitle.textContent = 'Đan Đồng';
			}
		}
		if (dongSub) {
			dongSub.textContent = dongPanelCompanion
				? 'Hỗ trợ Điều Hỏa · ' +
					formatDanHuanTodayReceived(
						MOCK.currency.danHuanTuneUsed,
						MOCK.currency.danHuanCap
					) +
					' · lửa từ ' +
					Math.round(MOCK.tuneEffectiveMaxPct) +
					'% trở xuống'
				: 'Hợp luyện điều hỏa giúp ' + LD_FURNACE_LABEL + ' ổn định hơn';
		}
		if (dongHint) {
			dongHint.textContent = dongPanelCompanion
				? 'Ô có nhãn (bạn) là vai Đan Đồng đang đảm nhận'
				: 'Tuyển đan đồng để nhàn rỗi hơn';
		}
		document.body.classList.toggle('ld-view--companion', companion);
		document.body.classList.toggle('ld-view--dong-locked', !!MOCK.dongLocked && !companion);
		document.body.classList.toggle('ld-view--dong-panel-companion', !!dongPanelCompanion);
	}

	function renderDongForMeList() {
		var list = $('#ldDongForMeList');
		if (!list) return;
		var rows = MOCK.dongOwnersForMe || [];
		if (!rows.length) {
			list.innerHTML = '';
			return;
		}
		list.innerHTML = '';
		rows.forEach(function (row) {
			var li = document.createElement('li');
			li.className = 'ld-dong-for-me__item';
			var canLeave = !!row.can_leave;
			li.innerHTML =
				'<div class="ld-dong-for-me__who">' +
				'<strong>' +
				(row.owner_name || LD_ALCHEMIST_LABEL) +
				'</strong>' +
				(canLeave
					? '<span class="ld-dong-for-me__tag ld-dong-for-me__tag--ok">' +
						(row.owner_crafting
							? 'Hết 5 phút Điều Hỏa — có thể rời'
							: 'Chưa khai ' + LD_FURNACE_LABEL + ' — có thể rời') +
						'</span>'
					: '<span class="ld-dong-for-me__tag ld-dong-for-me__tag--lock">Đang Điều Hỏa (5 phút) — không thể rời</span>') +
				'</div>';
			if (canLeave) {
				var btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'ld-dong-for-me__leave';
				btn.textContent = 'Rời đi';
				btn.dataset.ownerId = String(row.owner_id);
				btn.addEventListener('click', function () {
					dongLeaveOwner(row.owner_id, row.owner_name);
				});
				li.appendChild(btn);
			}
			list.appendChild(li);
		});
	}

	function canOwnerKickDongSlot(data) {
		if (isCompanionView()) return false;
		if (!data || data.isSelf) return false;
		if (MOCK.furnace === 'crafting' || MOCK.furnace === 'ready') return false;
		if (MOCK.dongLocked) return false;
		return true;
	}

	function dongKickBuddy(buddyId, buddyName) {
		var bid = buddyId | 0;
		if (!bid) return;
		showConfirm({
			title: 'Trục xuất Đan Đồng',
			message:
				'Xác nhận trục xuất 「' +
				(buddyName || 'Đạo hữu') +
				'」 khỏi ' + LD_FURNACE_LABEL + '? (Chỉ được khi chưa bắt đầu luyện.)',
			confirmLabel: 'Trục xuất',
			cancelLabel: 'Giữ lại',
		}).then(function (ok) {
			if (!ok) return;
			playClick();
			ldJson('/luyen-dan/dong/kick', { method: 'POST', body: { buddy_id: bid } })
				.then(function (body) {
					applyServerPayload(body.data);
					renderDongSlots();
					syncDongUi();
					renderDongForMeList();
					syncButtons();
					syncTierTabsUi();
					toast('Đã trục xuất Đan Đồng', 'ok');
				})
				.catch(function (e) {
					toast(e.message, 'error');
				});
		});
	}

	function dongLeaveOwner(ownerId, ownerName) {
		if (!ownerId) return;
		showConfirm({
			title: 'Rời Đan Đồng',
			message:
				'Xác nhận rời Đan Đồng của 「' +
				(ownerName || LD_ALCHEMIST_LABEL) +
				'」? (Không rời trong 5 phút Điều Hỏa đầu; sau 5 phút — kể cả khi ' +
				LD_FURNACE_LABEL +
				' đã nổ — bạn được rời.)',
			confirmLabel: 'Rời đi',
			cancelLabel: 'Ở lại',
		}).then(function (ok) {
			if (!ok) return;
			playClick();
			ldJson('/luyen-dan/dong/leave', { method: 'POST', body: { owner_id: ownerId | 0 } })
				.then(function (body) {
					var leftOid = ownerId | 0;
					applyServerPayload(body.data);
					if ((MOCK.craftOwnerUserId | 0) === leftOid || !buddyServesOwner(leftOid)) {
						reconcileCraftViewAfterDongRelations();
					}
					renderDongSlots();
					syncDongUi();
					renderDongForMeList();
					syncButtons();
					syncStability();
					syncTimer();
					syncTierTabsUi();
					startCompanionIdlePoll();
					toast('Đã rời vai Đan Đồng', 'ok');
				})
				.catch(function (e) {
					toast(e.message, 'error');
				});
		});
	}

	function escHtmlLite(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function renderDongInvitesListModal() {
		var listEl = $('#ldDongInvitesList');
		var emptyEl = $('#ldDongInvitesEmpty');
		if (!listEl || !emptyEl) return;
		var list = getActionableDongInvites();
		if (!list.length) {
			listEl.innerHTML = '';
			emptyEl.hidden = false;
			return;
		}
		emptyEl.hidden = true;
		listEl.innerHTML = list
			.map(function (inv) {
				var oid = inv.owner_id | 0;
				var name = inv.owner_name || 'Đạo hữu';
				return (
					'<article class="ld-dong-invite-row" role="listitem" data-owner-id="' +
					oid +
					'">' +
					'<div class="ld-dong-invite-row__who">' +
					'<strong>' +
					escHtmlLite(name) +
					'</strong>' +
					'<span>' +
					escHtmlLite(LD_ALCHEMIST_LABEL) +
					' mời làm Đan Đồng</span>' +
					'</div>' +
					'<div class="ld-dong-invite-row__actions">' +
					'<button type="button" class="ld-dong-invite-row__btn ld-dong-invite-row__btn--accept" data-action="accept" data-owner-id="' +
					oid +
					'">Chấp nhận</button>' +
					'<button type="button" class="ld-dong-invite-row__btn ld-dong-invite-row__btn--reject" data-action="reject" data-owner-id="' +
					oid +
					'">Từ chối</button>' +
					'</div>' +
					'</article>'
				);
			})
			.join('');
		listEl.querySelectorAll('[data-action]').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var oid = btn.getAttribute('data-owner-id') | 0;
				if (!oid) return;
				if (btn.getAttribute('data-action') === 'accept') {
					acceptDongInviteByOwner(oid);
				} else {
					rejectDongInviteByOwner(oid);
				}
			});
		});
	}

	function openDongInvitesListModal() {
		renderDongInvitesListModal();
		var backdrop = $('#ldDongInvitesBackdrop');
		var modal = $('#ldDongInvitesModal');
		if (!backdrop || !modal) return;
		backdrop.hidden = false;
		modal.hidden = false;
		document.body.classList.add('ld-modal-open');
	}

	function closeDongInvitesListModal() {
		var backdrop = $('#ldDongInvitesBackdrop');
		var modal = $('#ldDongInvitesModal');
		if (backdrop) backdrop.hidden = true;
		if (modal) modal.hidden = true;
		var itemModal = $('#ldItemModal');
		var dongModal = $('#ldDongModal');
		var inviteModal = $('#ldInviteModal');
		var otherOpen =
			(itemModal && !itemModal.hidden) ||
			(dongModal && !dongModal.hidden) ||
			(inviteModal && !inviteModal.hidden);
		if (!otherOpen) {
			document.body.classList.remove('ld-modal-open');
		}
	}

	function openDongInviteFromBell() {
		playClick();
		refreshState()
			.then(function () {
				syncDongNotif();
				openDongInvitesListModal();
			})
			.catch(function () {
				syncDongNotif();
				openDongInvitesListModal();
			});
	}

	function maybeInviteModal() {
		syncDongNotif();
	}

	function rejectDongInviteByOwner(ownerId) {
		var oid = ownerId | 0;
		if (!oid) return;
		playClick();
		ldJson('/luyen-dan/dong/respond', { method: 'POST', body: { owner_id: oid, accept: false } })
			.then(function (body) {
				if (body && body.data) {
					applyServerPayload(body.data);
					syncDongUi();
				} else {
					MOCK.dongInvitesIn = (MOCK.dongInvitesIn || []).filter(function (inv) {
						return (inv.owner_id | 0) !== oid;
					});
					syncIncomingInviteFromList();
					syncDongNotif();
				}
				renderDongInvitesListModal();
				toast('Đã từ chối lời mời');
			})
			.catch(function (e) {
				toast(e.message || 'Không từ chối được');
			});
	}

	function acceptDongInviteByOwner(ownerId) {
		MOCK._inviteOwnerId = ownerId | 0;
		acceptDongInvite();
	}


	function getAckBtn() {


		var bar = $('#ldActionsBar');


		if (!bar) return null;


		var ack = $('#ldBtnAckExplosion');


		if (!ack) {


			ack = document.createElement('button');


			ack.id = 'ldBtnAckExplosion';


			ack.type = 'button';


			ack.className = 'ld-modal-btn ld-modal-btn--ghost';


			ack.textContent = 'Đã hiểu (nổ ' + LD_FURNACE_LABEL + ')';
			ack.style.marginTop = '0.5rem';


			bar.appendChild(ack);


			ack.addEventListener('click', ackExplosion);


		}


		return ack;


	}

	function ackExplosion() {
		if (state.explosionAckBusy) return;
		if (isCompanionView()) {
			state.explosionAckBusy = true;
			closeExplosionModal();
			stopTimerTick();
			stopServerPoll();
			MOCK.furnace = 'idle';
			MOCK.craftJobId = null;
			MOCK.stability = 100;
			MOCK.craftFinishTs = 0;
			MOCK.clockSkewSec = 0;
			MOCK.timerLeft = 0;
			MOCK.unstableLeftSec = 0;
			MOCK.tuneCooldownLeft = 0;
			refreshState()
				.then(function () {
					renderInventory();
					renderDongSlots();
					syncDongUi();
					renderDongForMeList();
					syncRank();
					syncButtons();
					syncStability();
					syncTimer();
					syncTierTabsUi();
					startCompanionIdlePoll();
				})
				.finally(function () {
					state.explosionAckBusy = false;
				});
			return;
		}
		state.explosionAckBusy = true;

		if (!MOCK.craftJobId) {
			state.explosionAckBusy = false;
			closeExplosionModal();
			return refreshState();
		}

		ldJson('/luyen-dan/ack-explosion', { method: 'POST', body: { job_id: MOCK.craftJobId } })
			.then(function (body) {
				closeExplosionModal();
				stopTimerTick();
				stopServerPoll();
				applyServerPayload(body.data);
				renderInventory();
				renderDongSlots();
				syncRank();
				renderRecipePreview();
				syncButtons();
				syncStability();
				syncTimer();
				syncTierTabsUi();
				toast('Có thể khai ' + LD_FURNACE_LABEL + ' luyện đan mới', 'ok');
			})


			.catch(function (e) {
				toast(e.message, 'error');
			})
			.finally(function () {
				state.explosionAckBusy = false;
			});
	}

	function $(sel, root) {


		return (root || document).querySelector(sel);


	}
	function $$(sel, root) {
		return Array.prototype.slice.call((root || document).querySelectorAll(sel));
	}

	/** Số hiển thị (locale vi-VN), không tiền tố × — dùng chung túi & modal */
	function qty(n) {
		var v = Math.max(0, parseInt(n, 10) || 0);
		return v.toLocaleString('vi-VN');
	}

	/** Mô tả nội dung khi mở túi — gói ngày: một hành; túi thường: RNG ngũ hành. */
	function matBundleOpenHint(bundle) {
		bundle = bundle || {};
		var units = bundle.total_units | 0;
		if (bundle.is_daily) {
			var label =
				bundle.element_label ||
				(bundle.element && ELEMENT_LABELS[bundle.element]) ||
				'Linh dược';
			return units > 0 ? qty(units) + ' ' + label : label;
		}
		return units > 0 ? qty(units) + ' linh dược ngũ hành ngẫu nhiên' : 'linh dược ngũ hành ngẫu nhiên';
	}

	function matQty(n) {
		return Math.max(0, parseInt(n, 10) || 0).toLocaleString('vi-VN');
	}

	function matImgFromCatalog(el) {
		var mats = (MOCK.itemCatalog && MOCK.itemCatalog.materials) || {};
		var row = mats[el];
		if (row && row.image) return base + row.image;
		return matImg(el);
	}

	function danHuanImgSrc() {
		var it = MOCK.itemCatalog && MOCK.itemCatalog.dan_huan;
		if (it && it.image) return base + it.image;
		return base + 'dan-huan.png';
	}

	function matQtyHtml(have, need) {
		var ok = have >= need;
		var cls = ok ? 'ld-mat-qty is-ok' : 'ld-mat-qty is-lack';
		var check = ok ? '<span class="ld-mat-qty__check" aria-hidden="true">✓</span>' : '';
		return (
			'<span class="' +
			cls +
			'"><span class="ld-mat-qty__have">' +
			matQty(have) +
			'</span><span class="ld-mat-qty__sep">/</span><span class="ld-mat-qty__need">' +
			matQty(need) +
			'</span>' +
			check +
			'</span>'
		);
	}

	function fmtCraftDuration(sec) {
		sec = Math.max(0, sec | 0);
		if (sec < 60) return sec + ' giây';
		var m = Math.ceil(sec / 60);
		if (m < 60) return m + ' phút';
		var h = Math.floor(m / 60);
		var rm = m % 60;
		return rm > 0 ? h + ' giờ ' + rm + ' phút' : h + ' giờ';
	}

	function fmtTuVi(n) {
		return Number(n).toLocaleString('vi-VN');
	}

	function pillTuVi(tier, stars) {
		var fx = MOCK.pillEffects || {};
		var tiers = fx.tiers || {};
		var tcfg = tiers[tier];
		var baseTv = tcfg && tcfg.tu_vi_base != null ? tcfg.tu_vi_base | 0 : 0;
		var muls = fx.star_multipliers || {};
		var sk = String(stars);
		var mul =
			muls[sk] != null ? parseFloat(muls[sk]) : muls[stars] != null ? parseFloat(muls[stars]) : 1;
		if (!isFinite(mul) || mul <= 0) mul = 1;
		return Math.round(baseTv * mul);
	}

	function pillTuViWithPhucLoi(baseTv) {
		baseTv = Math.max(0, baseTv | 0);
		var pl = MOCK.phucLoi;
		if (!pl || !pl.eligible || !pl.bonusPercent) {
			return { base: baseTv, bonus: 0, total: baseTv };
		}
		var total = Math.ceil(baseTv * (1 + pl.bonusPercent / 100));
		return { base: baseTv, bonus: Math.max(0, total - baseTv), total: total };
	}

	function formatPillTuViLine(baseTv) {
		var tv = pillTuViWithPhucLoi(baseTv);
		if (tv.bonus > 0) {
			return (
				fmtTuVi(tv.base) +
				' <span class="ld-info__tu-vi-bonus">(+' +
				fmtTuVi(tv.bonus) +
				' 🌱)</span>'
			);
		}
		return fmtTuVi(tv.base);
	}

	function pillStarLabel(stars) {
		var fx = MOCK.pillEffects || {};
		var labels = fx.star_labels || { 1: 'Kém', 2: 'Chuẩn', 3: 'Thuần', 4: 'Hoàn Hảo' };
		var sk = String(stars);
		return labels[sk] || labels[stars] || stars + '★';
	}

	function pillUsageUsed(u) {
		if (!u) return 0;
		var cap = u.cap | 0;
		if (u.used != null) return u.used | 0;
		return Math.max(0, cap - (u.remaining != null ? u.remaining | 0 : cap));
	}

	function syncPillBagClient() {
		var usage = MOCK.pillUsage;
		if (!usage || typeof usage !== 'object') {
			return;
		}
		var stored = {};
		getPillStacks().forEach(function (s) {
			if (!s || !s.tier) return;
			var t = s.tier;
			stored[t] = (stored[t] | 0) + (s.count | 0);
		});
		var out = {};
		var prevBag = MOCK.pillBag && typeof MOCK.pillBag === 'object' ? MOCK.pillBag : {};
		pillTierOrder().forEach(function (tier) {
			var u = usage[tier];
			if (!u) return;
			var prev = prevBag[tier] || {};
			var capBase = prev.cap_base != null ? prev.cap_base | 0 : u.cap | 0;
			var capBonus = prev.cap_bonus != null ? prev.cap_bonus | 0 : 0;
			var cap = prev.cap != null ? prev.cap | 0 : capBase + capBonus;
			if (cap < 1) cap = u.cap | 0;
			if (cap < 1) return;
			var st = stored[tier] | 0;
			out[tier] = {
				tier: tier,
				stored: st,
				cap: cap,
				cap_base: capBase,
				cap_bonus: capBonus,
				remaining: Math.max(0, cap - st),
				full: st >= cap,
				label: TIER_LABELS[tier] || prev.label || u.label || tier,
			};
		});
		MOCK.pillBag = out;
	}

	function pillBagRow(tier) {
		return MOCK.pillBag && MOCK.pillBag[tier] ? MOCK.pillBag[tier] : null;
	}

	function pillBagStored(tier) {
		var b = pillBagRow(tier);
		return b && b.stored != null ? b.stored | 0 : 0;
	}

	function pillBagCap(tier) {
		var b = pillBagRow(tier);
		if (b && b.cap != null) return b.cap | 0;
		var u = MOCK.pillUsage && MOCK.pillUsage[tier];
		return u && u.cap != null ? u.cap | 0 : 0;
	}

	/** Cap hấp thu Tu Vi/tháng — không cộng bonus mở rộng túi. */
	function pillUsageCap(tier) {
		var u = MOCK.pillUsage && MOCK.pillUsage[tier];
		return u && u.cap != null ? u.cap | 0 : 0;
	}

	function pillBagFull(tier) {
		var cap = pillBagCap(tier);
		if (cap < 1) return false;
		var b = pillBagRow(tier);
		if (b && b.full != null) return !!b.full;
		return pillBagStored(tier) >= cap;
	}

	function pillBagFullTitle(tier) {
		return 'Túi đan ' + (TIER_LABELS[tier] || tier) + ' đã đầy';
	}

	function pillBagFullMessage(tier) {
		return pillBagFullTitle(tier) + '. Cần sử dụng hoặc phân giải đan.';
	}

	function pillBagFullFireDetail(tier) {
		return pillBagFullTitle(tier) + ' — cần sử dụng hoặc phân giải đan trong túi.';
	}

	function pillUsageBlock(tier) {
		var u = MOCK.pillUsage && MOCK.pillUsage[tier];
		if (!u || u.cap == null) return '';
		var cap = u.cap | 0;
		var used = pillUsageUsed(u);
		var full = cap > 0 && used >= cap;
		return (
			'<span class="ld-info__usage' +
			(full ? ' is-full' : '') +
			'"><span class="ld-info__usage-val">' +
			used +
			'/' +
			cap +
			' viên</span>' +
			(full ? ' · <span class="ld-info__usage-cap">Đã đạt giới hạn tháng</span>' : '') +
			'</span>'
		);
	}

	function pillBagBlock(tier) {
		var cap = pillBagCap(tier);
		if (cap < 1) return '';
		var stored = pillBagStored(tier);
		var full = pillBagFull(tier);
		return (
			'<span class="ld-info__usage ld-info__usage--bag' +
			(full ? ' is-full' : '') +
			'"><span class="ld-info__usage-val">' +
			stored +
			'/' +
			cap +
			' viên</span>' +
			(full ? ' · <span class="ld-info__usage-cap">Túi đầy</span>' : '') +
			'</span>'
		);
	}

	function renderBagUsageRows(kind) {
		var isStored = kind === 'stored';
		var usage = MOCK.pillUsage;
		if (!usage || typeof usage !== 'object') return '';

		return pillTierOrder()
			.map(function (tier) {
				var label = TIER_LABELS[tier] || (usage[tier] && usage[tier].label) || tier;
				var cap;
				var val;
				var full;
				var title;
				if (isStored) {
					cap = pillBagCap(tier);
					if (cap < 1) return '';
					val = pillBagStored(tier);
					full = pillBagFull(tier);
					title = full
						? pillBagFullMessage(tier)
						: 'Còn ' + Math.max(0, cap - val) + ' chỗ trong túi';
				} else {
					var u = usage[tier];
					if (!u) return '';
					cap = pillUsageCap(tier);
					if (cap < 1) return '';
					val = pillUsageUsed(u);
					full = val >= cap;
					title = full ? 'Đã hết lượt hấp thu Tu Vi tháng này' : 'Còn ' + (cap - val) + ' viên hấp thu';
				}
				var pct = cap > 0 ? Math.min(100, Math.round((val / cap) * 100)) : 0;
				return (
					'<li class="ld-bag-usage__row' +
					(isStored ? ' ld-bag-usage__row--stored' : ' ld-bag-usage__row--consume') +
					(full ? ' is-full' : '') +
					'">' +
					'<span class="ld-bag-usage__name">' +
					escHtml(label) +
					'</span>' +
					'<span class="ld-bag-usage__bar" role="presentation"><span class="ld-bag-usage__fill" style="width:' +
					pct +
					'%"></span></span>' +
					'<span class="ld-bag-usage__nums' +
					(full ? ' is-full' : '') +
					'" title="' +
					escHtml(title) +
					'">' +
					val +
					'/' +
					cap +
					'</span>' +
					'</li>'
				);
			})
			.filter(Boolean)
			.join('');
	}

	function fmtLdNum(n) {
		return (n | 0).toLocaleString('vi-VN');
	}

	function bagExpandOffer(tier) {
		return MOCK.bagExpand && MOCK.bagExpand[tier] ? MOCK.bagExpand[tier] : null;
	}

	function buildBagExpandListHtml() {
		var offers = MOCK.bagExpand;
		if (!offers || typeof offers !== 'object') return '';
		return pillTierOrder()
			.map(function (tier) {
				var o = offers[tier];
				if (!o || (o.cap | 0) < 1) return '';
				var label = TIER_LABELS[tier] || o.label || tier;
				var bonus = o.cap_bonus != null ? o.cap_bonus | 0 : 0;
				var total = o.cap | 0;
				var atMax = !!o.at_max;
				var maxBonus = o.max_bonus_slots != null ? o.max_bonus_slots | 0 : 0;
				var room = o.bonus_remaining != null ? o.bonus_remaining | 0 : 0;
				var capLine =
					total +
					' viên' +
					(bonus > 0
						? ' <span class="ld-bag-expand__cap-bonus">(+' +
						  fmtLdNum(bonus) +
						  ' mở rộng)</span>'
						: '') +
					(!atMax && maxBonus > 0
						? ' <span class="ld-bag-expand__cap-room">· còn +' +
						  fmtLdNum(room) +
						  '</span>'
						: '');
				var cost = o.tien_ngoc_cost | 0;
				var add = o.slots_add_next != null ? o.slots_add_next | 0 : o.slots_per_purchase | 0;
				var canBuy = !!o.can_purchase && !atMax;
				var lackTn = !!o.lack_tien_ngoc && !atMax;
				var actionHtml;
				if (atMax) {
					actionHtml = '<span class="ld-bag-expand__status is-maxed">Đã tối đa</span>';
				} else {
					actionHtml =
						'<button type="button" class="ld-bag-expand__buy' +
						(canBuy ? '' : ' is-disabled') +
						'" data-tier="' +
						escHtml(tier) +
						'"' +
						(canBuy ? '' : ' disabled') +
						(lackTn ? ' title="Không đủ Tiên Ngọc"' : '') +
						'>' +
						'<span class="ld-bag-expand__buy-add">+' +
						fmtLdNum(add) +
						'</span>' +
						'<span class="ld-bag-expand__buy-cost">' +
						fmtLdNum(cost) +
						' TN</span>' +
						'</button>';
				}
				return (
					'<li class="ld-bag-expand__row' +
					(atMax ? ' is-maxed' : '') +
					(lackTn ? ' is-lack-tn' : '') +
					'">' +
					'<div class="ld-bag-expand__main">' +
					'<span class="ld-bag-expand__name">' +
					escHtml(label) +
					'</span>' +
					'<span class="ld-bag-expand__cap">' +
					capLine +
					'</span>' +
					'</div>' +
					actionHtml +
					'</li>'
				);
			})
			.filter(Boolean)
			.join('');
	}

	function refreshBagExpandModal() {
		var list = $('#ldBagExpandList');
		if (list) list.innerHTML = buildBagExpandListHtml();
		bindBagExpandBuyButtons();
	}

	function bindBagExpandBuyButtons() {
		var list = $('#ldBagExpandList');
		if (!list) return;
		list.querySelectorAll('.ld-bag-expand__buy[data-tier]').forEach(function (btn) {
			if (btn._ldBagExpandBound) return;
			btn._ldBagExpandBound = true;
			btn.addEventListener('click', function () {
				var tier = btn.getAttribute('data-tier');
				if (tier) purchaseBagExpandTier(tier);
			});
		});
	}

	function purchaseBagExpandTier(tier) {
		var o = bagExpandOffer(tier);
		if (!o || o.at_max) {
			toast('Đã đạt trần mở rộng phẩm này', 'error');
			return;
		}
		if (!o.can_purchase) {
			toast(
				o.lack_tien_ngoc
					? 'Không đủ Tiên Ngọc (cần ' + fmtLdNum(o.tien_ngoc_cost | 0) + ')'
					: 'Không thể mở rộng lúc này',
				'error'
			);
			return;
		}
		var label = TIER_LABELS[tier] || o.label || tier;
		var shortLabel = String(label).replace(/\s+Đan\s*$/i, '').trim() || label;
		var cost = o.tien_ngoc_cost | 0;
		var add = o.slots_add_next != null ? o.slots_add_next | 0 : o.slots_per_purchase | 0;
		showConfirm({
			title: 'Xác nhận mở rộng',
			message:
				'Xác định dùng ' +
				fmtLdNum(cost) +
				' Tiên Ngọc mở rộng thêm ' +
				fmtLdNum(add) +
				' slot ' +
				shortLabel +
				'?',
			confirmLabel: 'Xác định',
			cancelLabel: 'Hủy',
		}).then(function (ok) {
			if (!ok) return;
			ldJson('/luyen-dan/bag-expand', { method: 'POST', body: { tier: tier } })
				.then(function (body) {
					if (body && body.data) applyServerPayload(body.data);
					renderInventory();
					renderBagPillUsage();
					refreshBagExpandModal();
					var msg =
						body && body.bag_expand_purchase && body.bag_expand_purchase.message
							? body.bag_expand_purchase.message
							: body && body.message
							  ? body.message
							  : 'Đã mở rộng túi';
					toast(msg, 'success');
				})
				.catch(function (e) {
					toast(e && e.message ? e.message : 'Lỗi mở rộng túi', 'error');
				});
		});
	}

	function openBagExpandModal() {
		refreshBagExpandModal();
		$('#ldBagExpandBackdrop').hidden = false;
		$('#ldBagExpandModal').hidden = false;
	}

	function closeBagExpandModal() {
		$('#ldBagExpandBackdrop').hidden = true;
		$('#ldBagExpandModal').hidden = true;
	}

	function renderBagPillStats() {
		var root = $('#ldBagPillStats');
		if (!root) return;
		var usage = MOCK.pillUsage;
		if (!usage || typeof usage !== 'object') {
			root.hidden = true;
			root.innerHTML = '';
			return;
		}
		var storedRows = renderBagUsageRows('stored');
		var usedRows = renderBagUsageRows('used');
		if (!storedRows && !usedRows) {
			root.hidden = true;
			root.innerHTML = '';
			return;
		}
		root.hidden = false;
		var html =
			'<div class="ld-bag-expand-bar">' +
			'<button type="button" class="ld-bag-expand-btn" id="ldBagExpandBtn" aria-haspopup="dialog" aria-controls="ldBagExpandModal">' +
			'<i class="fa-solid fa-box-open" aria-hidden="true"></i> Mở rộng túi' +
			'</button>' +
			'</div>';
		if (storedRows) {
			html +=
				'<section class="ld-bag-usage ld-bag-usage--stored">' +
				'<h3 class="ld-bag-usage__title">Đan trong túi</h3>' +
				'<ul class="ld-bag-usage__list">' +
				storedRows +
				'</ul>' +
				'</section>';
		}
		if (usedRows) {
			html +=
				'<section class="ld-bag-usage ld-bag-usage--consume">' +
				'<h3 class="ld-bag-usage__title">Đã sử dụng tháng này</h3>' +
				'<ul class="ld-bag-usage__list">' +
				usedRows +
				'</ul>' +
				'<p class="ld-bag-usage__note">Làm mới mỗi tháng.</p>' +
				'</section>';
		}
		root.innerHTML = html;
		var expandBtn = $('#ldBagExpandBtn');
		if (expandBtn && !expandBtn._ldBound) {
			expandBtn._ldBound = true;
			expandBtn.addEventListener('click', openBagExpandModal);
		}
	}

	function renderBagPillUsage() {
		renderBagPillStats();
	}

	function playClick() {
		if (state.audioMuted) return;
		var sfx = $('#ldSfxClick');
		if (!sfx) return;
		try {
			sfx.currentTime = 0;
			var p = sfx.play();
			if (p && p.catch) p.catch(function () {});
		} catch (e) {}
	}

	function playSfx(elId) {
		if (state.audioMuted) return;
		var sfx = $(elId);
		if (!sfx) return;
		try {
			sfx.currentTime = 0;
			var p = sfx.play();
			if (p && p.catch) p.catch(function () {});
		} catch (e) {}
	}

	function playCollectSfx() {
		playSfx('#ldSfxCollect');
	}

	function playStartCraftSfx() {
		playSfx('#ldSfxStartCraft');
	}

	function playTuneSfx() {
		playSfx('#ldSfxTune');
	}

	function pillModalTitle(tier) {
		var base = TIER_LABELS[tier] || tier;
		return base + ' Đan Dược';
	}

	function pillStackConfirmLabel(stack) {
		var tier = stack.tier || '';
		var label = TIER_LABELS[tier] || pillModalTitle(tier);
		return label + ' · ' + (stack.stars | 0) + ' sao';
	}

	function formatPillTuViPlain(baseTv) {
		var tv = pillTuViWithPhucLoi(baseTv);
		if (tv.bonus > 0) {
			return (
				'Tu Vi: +' +
				fmtTuVi(tv.total) +
				' (gốc +' +
				fmtTuVi(tv.base) +
				', +' +
				fmtTuVi(tv.bonus) +
				' Tân Thủ)'
			);
		}
		return 'Tu Vi: +' + fmtTuVi(tv.total);
	}

	function confirmUsePill(stack) {
		var tv = pillTuVi(stack.tier, stack.stars);
		var cap = pillUsageCap(stack.tier);
		var used = 0;
		var u = MOCK.pillUsage && MOCK.pillUsage[stack.tier];
		if (u) used = pillUsageUsed(u);
		var msg =
			'Xác định hấp thu 1 viên ' +
			pillStackConfirmLabel(stack) +
			'?\n\n' +
			formatPillTuViPlain(tv);
		if (cap > 0) {
			msg += '\nĐã dùng tháng này: ' + used + '/' + cap + ' viên.';
		}
		return showConfirm({
			title: 'Xác nhận sử dụng đan',
			message: msg,
			confirmLabel: 'Sử dụng',
			cancelLabel: 'Hủy',
		});
	}

	function confirmDecomposePill(stack) {
		return showConfirm({
			title: 'Xác nhận phân giải',
			message:
				'Xác định phân giải 1 viên ' +
				pillStackConfirmLabel(stack) +
				'? Hoàn ~90% tổng linh dược (chia ngẫu nhiên giữa các hành theo công thức phẩm).',
			confirmLabel: 'Phân giải',
			cancelLabel: 'Hủy',
		});
	}

	function bindClickSound(el) {
		if (!el || el._ldSfx) return;
		el._ldSfx = true;
		el.addEventListener('click', playClick);
	}

	function applyAudioMute(muted) {
		state.audioMuted = !!muted;
		try {
			localStorage.setItem(AUDIO_MUTE_KEY, state.audioMuted ? '1' : '0');
		} catch (e) {}
		var bgm = $('#ldBgm');
		if (bgm) {
			if (state.audioMuted) {
				bgm.pause();
			} else if (state.audioReady && !document.hidden) {
				bgm.play().catch(function () {});
			}
		}
		var btn = $('#ldAudioToggle');
		var icon = $('#ldAudioIcon');
		if (btn) {
			btn.setAttribute('aria-pressed', state.audioMuted ? 'true' : 'false');
			btn.classList.toggle('is-muted', state.audioMuted);
		}
		if (icon) {
			icon.className = state.audioMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
		}
	}

	function initAudio() {
		var bgm = $('#ldBgm');
		if (!bgm) return;
		bgm.volume = 0.22;
		try {
			state.audioMuted = localStorage.getItem(AUDIO_MUTE_KEY) === '1';
		} catch (e) {
			state.audioMuted = false;
		}
		applyAudioMute(state.audioMuted);
		var tryBgm = function () {
			if (state.audioReady || state.audioMuted || document.hidden) return;
			var p = bgm.play();
			if (p && p.then) {
				p.then(function () {
					state.audioReady = true;
				}).catch(function () {});
			}
		};
		document.addEventListener('pointerdown', tryBgm, { once: true });
		document.addEventListener('keydown', tryBgm, { once: true });
		var muteBtn = $('#ldAudioToggle');
		if (muteBtn) {
			muteBtn.addEventListener('click', function () {
				applyAudioMute(!state.audioMuted);
				if (!state.audioMuted && !state.audioReady && !document.hidden) {
					var p = bgm.play();
					if (p && p.then) {
						p.then(function () {
							state.audioReady = true;
						}).catch(function () {});
					}
				}
			});
		}

		function onLuyenDanTabVisibility() {
			if (document.hidden) {
				if (!bgm.paused) {
					state.bgmSuspendedByTab = true;
					bgm.pause();
				}
			} else {
				if (state.bgmSuspendedByTab && !state.audioMuted && state.audioReady) {
					bgm.play().catch(function () {});
				}
				state.bgmSuspendedByTab = false;
				if (!state.audioMuted && state.audioReady && bgm.paused) {
					bgm.play().catch(function () {});
				}
			}
		}

		document.addEventListener('visibilitychange', onLuyenDanTabVisibility);
	}

	function toast(msg, kind, duration) {
		var container = $('#ldToastContainer');
		if (!container) return;

		var type = kind === 'error' ? 'error' : kind === 'ok' || kind === 'success' ? 'success' : 'info';
		var textLen = (msg && String(msg).length) || 0;
		var dur =
			duration != null
				? Math.max(1200, duration | 0)
				: type === 'error'
					? 3600
					: 3200;
		if (textLen > 48) {
			dur = Math.max(dur, 2800 + Math.min(textLen * 28, 3200));
		}
		var iconMap = { success: '✓', error: '✕', info: 'i' };

		var el = document.createElement('div');
		el.className = 'ld-toast ld-toast--' + type;
		el.setAttribute('role', 'status');
		el.innerHTML =
			'<span class="ld-toast__icon" aria-hidden="true">' +
			(iconMap[type] || 'i') +
			'</span>' +
			'<span class="ld-toast__text"></span>' +
			'<span class="ld-toast__bar" aria-hidden="true"></span>';
		el.querySelector('.ld-toast__text').textContent = msg || '';

		var bar = el.querySelector('.ld-toast__bar');
		if (bar) bar.style.animationDuration = dur + 'ms';

		while (container.children.length >= 4) {
			container.removeChild(container.firstChild);
		}
		container.appendChild(el);

		var dismissTimer = null;
		var dismissAt = Date.now() + dur;
		var hoverPaused = false;

		function clearDismissTimer() {
			if (dismissTimer) {
				window.clearTimeout(dismissTimer);
				dismissTimer = null;
			}
		}

		function dismiss() {
			if (!el.parentNode) return;
			clearDismissTimer();
			el.classList.add('is-out');
			window.setTimeout(function () {
				if (el.parentNode) el.parentNode.removeChild(el);
			}, 280);
		}

		function scheduleDismiss() {
			clearDismissTimer();
			var ms = dismissAt - Date.now();
			if (ms < 1) {
				dismiss();
				return;
			}
			dismissTimer = window.setTimeout(dismiss, ms);
		}

		function pauseToastDismiss() {
			if (hoverPaused || el.classList.contains('is-out')) return;
			hoverPaused = true;
			clearDismissTimer();
			if (bar) bar.style.animationPlayState = 'paused';
			el.classList.add('is-paused');
		}

		function resumeToastDismiss() {
			if (!hoverPaused || el.classList.contains('is-out')) return;
			hoverPaused = false;
			if (bar) bar.style.animationPlayState = 'running';
			el.classList.remove('is-paused');
			scheduleDismiss();
		}

		el.addEventListener('click', dismiss);
		el.addEventListener('mouseenter', pauseToastDismiss);
		el.addEventListener('mouseleave', resumeToastDismiss);
		el.addEventListener('focusin', pauseToastDismiss);
		el.addEventListener('focusout', resumeToastDismiss);
		scheduleDismiss();
	}

	function closeConfirmDialog(result) {
		var backdrop = $('#ldConfirmBackdrop');
		var modal = $('#ldConfirmModal');
		if (modal) modal.classList.remove('is-open');
		document.body.classList.remove('ld-confirm-open');

		window.setTimeout(function () {
			if (backdrop) backdrop.hidden = true;
			if (modal) modal.hidden = true;
			var res = state.confirmResolver;
			state.confirmResolver = null;
			if (typeof res === 'function') {
				res(!!result);
			}
		}, 220);
	}

	function showConfirm(opts) {
		opts = opts || {};
		return new Promise(function (resolve) {
			var backdrop = $('#ldConfirmBackdrop');
			var modal = $('#ldConfirmModal');
			var titleEl = $('#ldConfirmTitle');
			var msgEl = $('#ldConfirmMsg');
			var okBtn = $('#ldConfirmOk');
			var cancelBtn = $('#ldConfirmCancel');
			if (!backdrop || !modal || !titleEl || !msgEl || !okBtn || !cancelBtn) {
				resolve(window.confirm(opts.message || opts.title || ''));
				return;
			}

			titleEl.textContent = opts.title || 'Xác nhận';
			msgEl.textContent = opts.message || '';
			okBtn.textContent = opts.confirmLabel || 'Đồng ý';
			cancelBtn.textContent = opts.cancelLabel || 'Hủy';

			state.confirmResolver = resolve;
			backdrop.hidden = false;
			modal.hidden = false;
			document.body.classList.add('ld-confirm-open');
			requestAnimationFrame(function () {
				modal.classList.add('is-open');
			});
		});
	}

	function initConfirmDialog() {
		var okBtn = $('#ldConfirmOk');
		var cancelBtn = $('#ldConfirmCancel');
		var backdrop = $('#ldConfirmBackdrop');
		if (okBtn) okBtn.addEventListener('click', function () { closeConfirmDialog(true); });
		if (cancelBtn) cancelBtn.addEventListener('click', function () { closeConfirmDialog(false); });
		if (backdrop) backdrop.addEventListener('click', function () { closeConfirmDialog(false); });
		document.addEventListener('keydown', function (e) {
			if (e.key !== 'Escape' || typeof state.confirmResolver !== 'function') return;
			e.preventDefault();
			closeConfirmDialog(false);
		});
	}

	function furnaceMouthClientXY() {
		var fx = $('#ldFurnaceFx');
		var img = $('#ldFurnaceImg');
		if (!fx || !img) {
			return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
		}
		var ir = img.getBoundingClientRect();
		return {
			x: ir.left + ir.width * 0.5,
			y: ir.top + ir.height * 0.46 + 40,
		};
	}

	function runPillFlyToBag(pill, done) {
		if (!pill) {
			if (typeof done === 'function') done();
			return;
		}
		var img = document.createElement('img');
		img.className = 'ld-fx-pill-emerge';
		img.src = pillImg(pill.tier, pill.stars | 0);
		img.alt = '';
		var m = furnaceMouthClientXY();
		var w = Math.min(96, Math.max(64, window.innerWidth * 0.17));
		img.style.width = w + 'px';
		img.style.height = w + 'px';
		img.style.left = m.x + 'px';
		img.style.top = m.y + 'px';
		document.body.appendChild(img);

		window.requestAnimationFrame(function () {
			window.requestAnimationFrame(function () {
				img.classList.add('is-visible');
			});
		});

		window.setTimeout(function () {
			img.classList.add('is-fadeout');
			window.setTimeout(function () {
				if (img.parentNode) img.parentNode.removeChild(img);
				if (typeof done === 'function') done();
			}, 480);
		}, 780);
	}

	function furnaceMouthXY() {
		var fx = $('#ldFurnaceFx');
		var img = $('#ldFurnaceImg');
		if (!fx || !img) return { x: 0, y: 0 };
		var fr = fx.getBoundingClientRect();
		var ir = img.getBoundingClientRect();
		var mx = 0.5;
		var my = 0.46;
		var mouthYOffset = 40;
		return {
			x: ir.left - fr.left + ir.width * mx,
			y: ir.top - fr.top + ir.height * my + mouthYOffset,
		};
	}

	function spawnOneMaterialToss(fx, el, target) {
		var sx;
		var sy;
		var fr = fx.getBoundingClientRect();
		var liList = document.querySelectorAll('#ldRecipeMats li');
		var found = null;
		for (var i = 0; i < liList.length; i++) {
			var im = liList[i].querySelector('img');
			if (im && im.src.indexOf('linh-duoc-' + el) !== -1) {
				found = im;
				break;
			}
		}
		if (found) {
			var sr = found.getBoundingClientRect();
			sx = sr.left - fr.left + sr.width / 2;
			sy = sr.top - fr.top + sr.height / 2;
		} else {
			var ang = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
			sx = fr.width / 2 + Math.cos(ang) * fr.width * 0.38;
			sy = fr.height * 0.08 + Math.sin(ang) * fr.height * 0.12;
		}

		var node = document.createElement('div');
		node.className = 'ld-fx-toss';
		var tossIm = document.createElement('img');
		tossIm.src = matImgFromCatalog(el);
		tossIm.alt = '';
		node.appendChild(tossIm);
		node.style.opacity = '1';
		node.style.transform =
			'translate(' + sx + 'px,' + sy + 'px) translate(-50%, -50%) scale(1.18)';
		fx.appendChild(node);

		window.requestAnimationFrame(function () {
			window.requestAnimationFrame(function () {
				node.style.transform =
					'translate(' +
					target.x +
					'px,' +
					target.y +
					'px) translate(-50%, -50%) scale(0.38)';
				node.style.opacity = '0.18';
			});
		});

		window.setTimeout(function () {
			if (node.parentNode) node.parentNode.removeChild(node);
		}, 1100);
	}

	function runMaterialTossAnimation(done) {
		var fx = $('#ldFurnaceFx');
		if (!fx || typeof done !== 'function') {
			if (typeof done === 'function') {
				done();
			}
			return;
		}
		fx.innerHTML = '';

		var vec = tierVector(MOCK.tier);
		var items = [];
		ELEMENTS.forEach(function (el) {
			if ((vec[el] | 0) > 0) {
				items.push(el);
			}
		});

		if (!items.length) {
			window.setTimeout(done, 0);
			return;
		}

		var target = furnaceMouthXY();
		var stagger = 128;
		var lastT = 0;
		items.forEach(function (el, idx) {
			window.setTimeout(function () {
				spawnOneMaterialToss(fx, el, target);
			}, idx * stagger);
			lastT = idx * stagger + 920;
		});

		window.setTimeout(function () {
			var core = document.querySelector('.ld-furnace-core');
			if (core) {
				core.classList.add('ld-toss-flash');
				window.setTimeout(function () {
					core.classList.remove('ld-toss-flash');
				}, 400);
			}
			done();
		}, lastT + 90);
	}

	function pillImg(tier, stars) {
		return base + 'dan-duoc-' + tier + '-pham-' + stars + 's.webp';
	}
	function matImg(el) {
		return base + 'linh-duoc-' + el + '.webp';
	}

	function masterLevelCurve(m) {
		m = m || {};
		var maxLevel = Math.max(1, m.max_level | 0 || 10);
		var perLevel = {};
		var steps = m.level_xp && typeof m.level_xp === 'object';
		var l;
		if (steps) {
			for (l = 1; l < maxLevel; l++) {
				var sk = String(l);
				var need = m.level_xp[sk] != null ? m.level_xp[sk] : m.level_xp[l];
				perLevel[l] = Math.max(1, need | 0);
			}
		} else {
			var flat = Math.max(1, m.xp_per_level | 0 || 1000);
			for (l = 1; l < maxLevel; l++) perLevel[l] = flat;
		}
		var floors = { 1: 0 };
		var acc = 0;
		for (l = 1; l < maxLevel; l++) {
			acc += perLevel[l] || 1000;
			floors[l + 1] = acc;
		}
		return { max_level: maxLevel, per_level: perLevel, floors: floors };
	}

	function resolveDanLevelName(level) {
		level = Math.max(1, level | 0);
		var m = DAN_MASTER || {};
		var table = m.level_meta || {};
		var row = table[String(level)];
		if (row && row.display && String(row.display).trim() !== '') {
			return String(row.display).trim();
		}
		var names = m.level_names || {};
		if (names[String(level)] != null && String(names[String(level)]).trim() !== '') {
			return String(names[String(level)]).trim();
		}
		return 'Luyện Đan Sư · Bậc ' + level;
	}

	function resolveDanRankMeta(level) {
		level = Math.max(1, level | 0);
		if (MOCK.danRank && MOCK.danRank.rank_meta && (MOCK.danRank.level | 0) === level) {
			return MOCK.danRank.rank_meta;
		}
		var m = DAN_MASTER || {};
		var table = m.level_meta || {};
		var row = table[String(level)];
		if (row && typeof row === 'object') {
			return row;
		}
		return {
			realm_label: '',
			sub_tier_label: '',
			title: 'Bậc ' + level,
			display: resolveDanLevelName(level),
		};
	}

	function formatDanRankStage(meta, level) {
		if (!meta || typeof meta !== 'object') {
			return resolveDanLevelName(level);
		}
		if (meta.title && String(meta.title).trim() !== '') {
			return String(meta.title).trim();
		}
		if (meta.display && String(meta.display).trim() !== '') {
			return String(meta.display).trim();
		}
		return resolveDanLevelName(level);
	}

	function syncRankTitles(level) {
		var meta = resolveDanRankMeta(level);
		var realmEl = $('#ldRankRealm');
		var stageEl = $('#ldRankStage');
		var titlesEl = $('#ldRankTitles');
		if (realmEl) {
			if (meta.realm_label) {
				realmEl.textContent = meta.realm_label;
				realmEl.hidden = false;
			} else {
				realmEl.hidden = true;
			}
		}
		if (stageEl) {
			stageEl.textContent = formatDanRankStage(meta, level);
			stageEl.classList.toggle('is-apex', meta.realm_key === 'than' || (level | 0) >= 20);
		}
		if (titlesEl) {
			titlesEl.classList.toggle('is-linh', meta.realm_key === 'linh' || meta.realm_key === 'tien');
			titlesEl.classList.toggle('is-pham', meta.realm_key === 'pham');
			titlesEl.classList.toggle('is-apex', meta.realm_key === 'than' || (level | 0) >= 20);
		}
	}

	function computeDanRank(pts) {
		if (MOCK.danRank && MOCK.rankPoints === (MOCK.danRank.xp_total | 0)) {
			var cached = Object.assign({}, MOCK.danRank);
			cached.level_name = resolveDanLevelName(cached.level | 0);
			return cached;
		}
		var m = DAN_MASTER || {};
		var curve = masterLevelCurve(m);
		var maxLevel = curve.max_level;
		var floors = curve.floors;
		var perLevel = curve.per_level;
		var xp = Math.max(0, pts | 0);
		var level = 1;
		for (var lv = maxLevel; lv >= 1; lv--) {
			if (xp >= (floors[lv] | 0)) {
				level = lv;
				break;
			}
		}
		var isMax = level >= maxLevel;
		var floor = floors[level] | 0;
		var xpIn, per, pct, xpToNext;
		if (isMax) {
			per = Math.max(1, perLevel[maxLevel - 1] | 0 || 1);
			xpIn = Math.max(0, xp - floor);
			pct = 100;
			xpToNext = 0;
		} else {
			var next = floors[level + 1] | 0;
			per = Math.max(1, next - floor);
			xpIn = xp - floor;
			pct = Math.min(100, Math.max(0, (xpIn / per) * 100));
			xpToNext = Math.max(0, next - xp);
		}
		return {
			level: level,
			xp_total: xp,
			xp_in_level: xpIn,
			xp_per_level: per,
			xp_to_next: xpToNext,
			pct: pct,
			max_level: maxLevel,
			level_name: resolveDanLevelName(level),
			rank_meta: resolveDanRankMeta(level),
			is_max: isMax,
		};
	}

	function pillTierOrder() {
		var reg = MOCK.pillTierRegistry;
		if (reg && reg.order && reg.order.length) {
			return reg.order.slice();
		}
		return ['ha', 'trung', 'thuong', 'cuc'];
	}

	function masterTierGateDefaults() {
		return {
			ha: { min_rank: 1, full_buff_rank: 3 },
			trung: { min_rank: 3, full_buff_rank: 6 },
			thuong: { min_rank: 6, full_buff_rank: 11 },
			cuc: { min_rank: 11, full_buff_rank: 17 },
		};
	}

	function masterTierGate(tier) {
		var def = masterTierGateDefaults();
		var reg = MOCK.pillTierRegistry;
		if (reg && reg.tiers && reg.tiers[tier]) {
			var row = reg.tiers[tier];
			var minR = Math.max(1, row.min_rank | 0 || 1);
			var fullR = Math.max(minR, row.full_buff_rank | 0 || minR);
			return { min_rank: minR, full_buff_rank: fullR };
		}
		var m = DAN_MASTER || {};
		var raw =
			m.rng && m.rng.pill_tier_gates && typeof m.rng.pill_tier_gates === 'object'
				? m.rng.pill_tier_gates
				: {};
		var src = raw[tier] || def[tier] || def.ha;
		var min = Math.max(1, src.min_rank | 0 || src.min_rank_level | 0 || 1);
		var full = Math.max(min, src.full_buff_rank | 0 || min);
		return { min_rank: min, full_buff_rank: full };
	}

	function recipeRankUnlocked(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.rank_unlocked != null) return !!rec.rank_unlocked;
		var lv = (MOCK.danRank && MOCK.danRank.level) || 1;
		return lv >= masterTierGate(tier).min_rank;
	}

	function recipeMinTuVi(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.min_tu_vi != null) return Math.max(0, rec.min_tu_vi | 0);
		var reg = MOCK.pillTierRegistry && MOCK.pillTierRegistry.tiers ? MOCK.pillTierRegistry.tiers[tier] : null;
		if (reg && reg.min_tu_vi != null) return Math.max(0, reg.min_tu_vi | 0);
		return 0;
	}

	function recipeTuViUnlocked(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.tu_vi_unlocked != null) return !!rec.tu_vi_unlocked;
		return (MOCK.tuViBalance | 0) >= recipeMinTuVi(tier);
	}

	function recipeCraftUnlocked(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.craft_unlocked != null) return !!rec.craft_unlocked;
		return recipeRankUnlocked(tier) && recipeTuViUnlocked(tier);
	}

	function recipeMinRankName(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.min_rank_name) return String(rec.min_rank_name);
		var min = rec && rec.min_rank != null ? rec.min_rank | 0 : masterTierGate(tier).min_rank;
		return resolveDanLevelName(min);
	}

	function recipeMinTuViLabel(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (rec && rec.min_tu_vi_label) return String(rec.min_tu_vi_label);
		var reg = MOCK.pillTierRegistry && MOCK.pillTierRegistry.tiers ? MOCK.pillTierRegistry.tiers[tier] : null;
		if (reg && reg.min_tu_vi_label) return String(reg.min_tu_vi_label);
		return '';
	}

	function ldTuViMsg(tier) {
		return 'Tu Vi ' + fmtTuVi(recipeMinTuVi(tier)) + ' trở lên';
	}

	function recipeTuViGateShort(tier) {
		return fmtTuVi(recipeMinTuVi(tier));
	}

	function buildPillTuViTableHtml() {
		var fx = MOCK.pillEffects || {};
		var tiers = fx.tiers || {};
		var muls = fx.star_multipliers || {};
		var labels = fx.star_labels || { 1: 'Kém', 2: 'Chuẩn', 3: 'Thuần', 4: 'Hoàn Hảo' };
		var order = pillTierOrder();
		var headStars = [1, 2, 3, 4]
			.map(function (s) {
				var lbl = labels[String(s)] || labels[s] || '';
				return (
					'<th>★' +
					s +
					(lbl ? '<span class="ld-rank-help__th-sub">' + escHtml(lbl) + '</span>' : '') +
					'</th>'
				);
			})
			.join('');
		var rows = order
			.map(function (tier) {
				var tcfg = tiers[tier];
				if (!tcfg) return '';
				var label = tcfg.label || TIER_LABELS[tier] || tier;
				var cells = [1, 2, 3, 4]
					.map(function (s) {
						var tv = pillTuVi(tier, s);
						return '<td><strong>' + escHtml(fmtTuVi(tv)) + '</strong></td>';
					})
					.join('');
				return '<tr><td>' + escHtml(label) + '</td>' + cells + '</tr>';
			})
			.join('');
		var pl = MOCK.phucLoi;
		var plNote =
			pl && pl.eligible && pl.bonusPercent
				? '<p class="ld-rank-help__note">Phúc Lợi Tân Thủ (Tu Vi &lt; 1.000.000): cộng thêm <strong>+' +
					(pl.bonusPercent | 0) +
					'%</strong> Tu Vi khi dùng đan (áp trên số trong bảng).</p>'
				: '<p class="ld-rank-help__note">Tu sĩ Tu Vi &lt; 1.000.000 có thể được <strong>Phúc Lợi Tân Thủ</strong> — % bonus phụ thuộc khoảng cách với Top 1 server.</p>';

		return (
			'<section class="ld-rank-help__section">' +
			'<h4>Tu Vi khi dùng đan (theo phẩm · sao)</h4>' +
			'<table class="ld-rank-help__table ld-rank-help__table--tuvi"><thead><tr><th>Phẩm đan</th>' +
			headStars +
			'</tr></thead><tbody>' +
			rows +
			'</tbody></table>' +
			plNote +
			'</section>'
		);
	}

	function buildTuViGateListHtml() {
		return pillTierOrder()
			.map(function (t) {
				var label = TIER_LABELS[t] || t;
				return (
					'<li>' +
					escHtml(label) +
					' — từ ' +
					escHtml(fmtTuVi(recipeMinTuVi(t))) +
					' Tu Vi</li>'
				);
			})
			.join('');
	}

	function ldCraftGateMsg(tier) {
		var parts = [];
		if (!recipeRankUnlocked(tier)) parts.push(ldRankGateMsg(tier));
		if (!recipeTuViUnlocked(tier)) parts.push(ldTuViGateMsg(tier));
		return parts.join(' ');
	}

	function ensureUnlockedRecipeTier() {
		if (recipeCraftUnlocked(MOCK.tier)) return;
		pillTierOrder().some(function (t) {
			if (recipeCraftUnlocked(t)) {
				MOCK.tier = t;
				return true;
			}
			return false;
		});
	}

	function computeRankRngClient(level, tier) {
		tier = tier || MOCK.tier || 'ha';
		var m = DAN_MASTER || {};
		var rng = m.rng && typeof m.rng === 'object' ? m.rng : {};
		var shiftPer = Number(rng.shift_per_battu_above_1);
		if (!shiftPer && shiftPer !== 0) shiftPer = 1;
		var capAbs = Number(rng.star_4_bonus_cap_abs);
		if (!capAbs && capAbs !== 0) capAbs = 3;
		var lv = Math.max(1, level | 0);
		var gate = masterTierGate(tier);
		var baseShift = Math.max(0, lv - 1) * shiftPer;
		var factor = 0;
		if (lv >= gate.min_rank) {
			factor = lv >= gate.full_buff_rank ? 1 : (lv - gate.min_rank) / Math.max(1, gate.full_buff_rank - gate.min_rank);
		}
		var shift = baseShift * factor;

		return {
			star4_base_pct: 5,
			star4_current_pct: 5,
			star4_bonus_pct: 0,
			star2_bonus_pct: 0,
			star3_bonus_pct: 0,
			shift_pts: shift,
			shift_pts_base: baseShift,
			tier_buff_factor: factor,
			min_rank: gate.min_rank,
			full_buff_rank: gate.full_buff_rank,
			rank_unlocked: lv >= gate.min_rank,
			rank_full_buff: lv >= gate.full_buff_rank,
			star4_master_cap_pct: 5 + capAbs,
		};
	}

	function getDanRankRng(r, tier) {
		tier = tier || MOCK.tier || 'ha';
		if (MOCK.danRank && MOCK.danRank.rng_by_tier && MOCK.danRank.rng_by_tier[tier]) {
			return MOCK.danRank.rng_by_tier[tier];
		}
		if (r && r.rng_by_tier && r.rng_by_tier[tier]) {
			return r.rng_by_tier[tier];
		}
		return computeRankRngClient(r ? r.level : 1, tier);
	}

	function rankPerkPitySuffix(pityT) {
		if (!pityT) return '';
		if (pityT.next_guaranteed_4) return ' · Thu kế: chắc nhận 4★';
		if (pityT.approx_pct_4star != null) {
			var extra = Math.round(Number(pityT.approx_pct_4star) * 10) / 10;
			return ' · Tỉ lệ thêm hiện tại: ~' + extra + '% nhận 4★';
		}
		return '';
	}

	function syncRankPerk(r) {
		var perk = $('#ldRankPerk');
		var titleEl = $('#ldRankPerkTitle');
		var subEl = $('#ldRankPerkSub');
		if (!perk || !titleEl || !subEl) return;

		var tier = MOCK.tier || 'ha';
		var rng = getDanRankRng(r, tier);
		if (!rng) {
			perk.hidden = true;
			return;
		}

		var bonus = Number(rng.star4_bonus_pct) || 0;
		var cur = Number(rng.star4_current_pct);
		if (cur == null || isNaN(cur)) cur = Number(rng.star4_base_pct) || 5;
		cur = Math.round(cur * 10) / 10;
		var tierLabel = TIER_LABELS[tier] || tier;
		var rankUnlocked = rng.rank_unlocked !== false;
		var rankFullBuff = !!rng.rank_full_buff;
		var pityT =
			MOCK.pityStar4 && MOCK.pityStar4.per_tier && MOCK.pityStar4.per_tier[tier]
				? MOCK.pityStar4.per_tier[tier]
				: null;
		var pityNote = rankPerkPitySuffix(pityT);

		perk.hidden = false;
		perk.classList.toggle('is-maxed', !!(r && r.is_max));

		if (!recipeCraftUnlocked(tier)) {
			titleEl.innerHTML =
				escHtml(tierLabel) + ' — <span class="ld-rank__perk-val">chưa mở luyện</span>';
			subEl.textContent = ldCraftGateMsg(tier);
			return;
		}

		titleEl.innerHTML =
			escHtml(tierLabel) +
			' · 4★ <span class="ld-rank__perk-val">~' +
			cur +
			'%</span> khi Thu';

		if (rankFullBuff) {
			if (bonus > 0) {
				var aboveFull = rng.rank_above_full != null ? rng.rank_above_full | 0 : 0;
				if (aboveFull > 0 && r && (r.level | 0) >= (rng.full_buff_rank | 0)) {
					subEl.textContent =
						'Cấp nghề +' +
						bonus +
						'% tỉ lệ 4★ so với tân thủ (+' +
						aboveFull +
						' cấp vượt mốc phẩm)' +
						pityNote;
				} else {
					subEl.textContent = 'Cấp nghề +' + bonus + '% tỉ lệ 4★ so với tân thủ' + pityNote;
				}
			} else if (r && r.is_max) {
				subEl.textContent = 'Buff tối đa phẩm này' + pityNote;
			} else {
				var nextRank =
					r && (r.level | 0) < 20 ? resolveDanLevelName((r.level | 0) + 1) : 'cấp cao hơn';
				subEl.textContent = 'Lên ' + nextRank + ' để tăng tỉ lệ 4★' + pityNote;
			}
		} else if (rankUnlocked) {
			subEl.textContent =
				'Lên ' +
				resolveDanLevelName(rng.full_buff_rank | 0) +
				' để tăng tỉ lệ 4★' +
				pityNote;
		} else {
			subEl.textContent = ldCraftGateMsg(tier) + pityNote;
		}
	}

	function escHtml(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function ldTuBaoCacUrl() {
		if (cfg.tuBaoCacUrl) return String(cfg.tuBaoCacUrl);
		return homeUrl('/tu-bao-cac-hh3d/');
	}

	function ldTuBaoCacSourceHtml() {
		return (
			'<a class="ld-info__source-link" href="' +
			escHtml(ldTuBaoCacUrl()) +
			'" target="_blank" rel="noopener noreferrer">' +
			'<span class="ld-info__source-link-text">Tụ Bảo Các</span>' +
			'<i class="fa-solid fa-arrow-up-right-from-square ld-info__source-link-ico" aria-hidden="true"></i>' +
			'</a>'
		);
	}

	function homeUrl(path) {
		var base = (cfg.homeUrl || '/').replace(/\/$/, '');
		path = String(path || '');
		if (!path) return base + '/';
		if (path.indexOf('http') === 0) return path;
		if (path.charAt(0) !== '/') path = '/' + path;
		return base + path;
	}

	function buildRankCraftDurationHelpSection(viewTier) {
		var h = MOCK.rankCraftDurationHelp;
		var caps = MOCK.craftDurationCaps || {
			maxReductionPct: 90,
			minTimeRatioPct: 10,
			minCraftDurationSec: 600,
			unstablePhaseSec: 300,
		};
		if (!h || !h.tiers || !h.tiers.length) {
			return (
				'<section class="ld-rank-help__section">' +
				'<h4>Cấp LĐS — rút thời gian luyện</h4>' +
				'<p>Chưa có dữ liệu — tải lại trang.</p></section>'
			);
		}
		var rules = h.rules || {};
		var rows = h.tiers
			.map(function (row) {
				var isView = viewTier && row.tier === viewTier;
				var isCur = h.currentRankLevel >= row.minRank;
				var tag = '';
				if (isView) {
					tag = '<span class="ld-rank-help__tag is-ok">phẩm đang xem</span>';
				} else if (!isCur) {
					tag = '<span class="ld-rank-help__tag is-lock">chưa đủ cấp</span>';
				}
				return (
					'<tr' +
					(isView ? ' class="is-current"' : '') +
					'><td>' +
					escHtml(row.label) +
					'</td><td>' +
					escHtml(row.fullBuffRankName) +
					' (cấp ' +
					escHtml(row.fullBuffRank) +
					')</td><td><strong>−' +
					escHtml(row.fullBuffReductionPct) +
					'%</strong></td><td>−' +
					escHtml(row.maxReductionPct) +
					'%</td><td><strong>−' +
					escHtml(row.currentReductionPct) +
					'%</strong></td><td>' +
					tag +
					'</td></tr>'
				);
			})
			.join('');
		var sampleTier = h.tiers.filter(function (row) {
			return viewTier && row.tier === viewTier;
		})[0];
		if (!sampleTier && h.tiers[0]) {
			sampleTier = h.tiers[0];
		}
		var sampleRows = '';
		if (sampleTier && sampleTier.samples && sampleTier.samples.length) {
			sampleRows = sampleTier.samples
				.map(function (s) {
					var isYou = h.currentRankLevel === s.rankLevel;
					return (
						'<tr' +
						(isYou ? ' class="is-current"' : '') +
						'><td>' +
						escHtml(s.rankName) +
						' (cấp ' +
						escHtml(s.rankLevel) +
						')</td><td><strong>−' +
						escHtml(s.reductionPct) +
						'%</strong></td><td>' +
						(isYou ? '<span class="ld-rank-help__tag is-ok">bạn</span>' : '') +
						'</td></tr>'
					);
				})
				.join('');
		}
		return (
			'<section class="ld-rank-help__section">' +
			'<h4>Cấp LĐS — rút thời gian luyện</h4>' +
			'<p>Buff theo <strong>phẩm đan đang luyện</strong>: cấp LĐS càng cao so với ngưỡng phẩm đó thì mẻ càng nhanh. Cấp cao luyện <strong>phẩm thấp</strong> thường rút giờ mạnh hơn nhiều.</p>' +
			'<div class="ld-rank-help__dong-tip">' +
			'<p><strong>Đan Đồng</strong> giúp đạo hữu luyện nhanh hơn: mỗi người đang hợp tác (tối đa <strong>2</strong>) mang thêm phần <strong>giảm thời gian</strong> theo <strong>cấp Luyện Đan Sư</strong> của họ — cấp càng cao, giúp càng nhiều. Khi mời xong, xem ngay dưới ô Đan Đồng bên phải lò.</p>' +
			'<p>Dù cộng đủ mọi buff (bạn + VIP + Đan Đồng), mỗi mẻ vẫn <strong>không ngắn hơn 10 phút</strong> — đủ thời gian cho pha <strong>Điều Hỏa</strong> đầu.</p>' +
			'</div>' +
			'<ul class="ld-rank-help__rules">' +
			'<li>Từ cấp tối thiểu → <strong>buff đủ</strong> (cột «Buff đủ tại»): tăng dần tới <strong>−' +
			escHtml(rules.atFullPct) +
			'%</strong>.</li>' +
			'<li>Mỗi cấp <strong>vượt buff đủ</strong>: thêm <strong>−' +
			escHtml(rules.perAboveFullPct) +
			'%</strong> (tối đa thêm <strong>−' +
			escHtml(rules.aboveFullCapPct) +
			'%</strong>).</li>' +
			'<li>Trần chỉ riêng nghề: <strong>−' +
			escHtml(rules.maxRankOnlyPct) +
			'%</strong> (trước khi cộng VIP).</li>' +
			'<li>Cộng thêm <strong>VIP</strong> và buff từ <strong>Đan Đồng</strong>; trần tổng <strong>−' +
			escHtml(caps.maxReductionPct) +
			'%</strong>, sàn <strong>' +
			escHtml(caps.minTimeRatioPct) +
			'%</strong> giờ gốc.</li>' +
			'<li>Mỗi mẻ tối thiểu <strong>' +
			escHtml(Math.round((caps.minCraftDurationSec || 600) / 60)) +
			' phút</strong> (pha <strong>Điều Hỏa</strong> ~' +
			escHtml(Math.round((caps.unstablePhaseSec || 300) / 60)) +
			' phút đầu).</li>' +
			'</ul>' +
			'<p>Cấp của bạn: <strong>' +
			escHtml(h.currentRankName) +
			'</strong> (cấp ' +
			escHtml(h.currentRankLevel) +
			' / ' +
			escHtml(h.maxRankLevel) +
			').</p>' +
			'<table class="ld-rank-help__table"><thead><tr><th>Phẩm</th><th>Buff đủ tại</th><th>−% tại buff đủ</th><th>−% tối đa (cấp ' +
			escHtml(h.maxRankLevel) +
			')</th><th>Bạn (−%)</th><th></th></tr></thead><tbody>' +
			rows +
			'</tbody></table>' +
			(sampleTier
				? '<p class="ld-rank-help__subhd">Ví dụ theo cấp — <strong>' +
					escHtml(sampleTier.label) +
					'</strong></p>' +
					'<table class="ld-rank-help__table ld-rank-help__table--compact"><thead><tr><th>Cấp LĐS</th><th>Rút giờ</th><th></th></tr></thead><tbody>' +
					sampleRows +
					'</tbody></table>'
				: '') +
			'</section>'
		);
	}

	function buildVipCraftHelpSection() {
		var caps = MOCK.craftDurationCaps || {
			maxReductionPct: 90,
			minTimeRatioPct: 10,
			minCraftDurationSec: 600,
			unstablePhaseSec: 300,
		};
		var tiers = MOCK.vipCraftTiers || [];
		var cur = MOCK.vipCraft || {};
		var rows = tiers
			.map(function (t) {
				var isCur = !!(cur.active && cur.tierName && t.name && cur.tierName === t.name);
				var tag = isCur ? '<span class="ld-rank-help__tag is-ok">mốc của bạn</span>' : '';
				return (
					'<tr' +
					(isCur ? ' class="is-current"' : '') +
					'><td>' +
					escHtml(t.label || t.name) +
					'</td><td><strong>−' +
					escHtml(t.reductionPct) +
					'%</strong></td><td>' +
					tag +
					'</td></tr>'
				);
			})
			.join('');
		if (!rows) {
			rows =
				'<tr><td colspan="3">Chưa có dữ liệu mốc — tải lại trang (state).</td></tr>';
		}
		return (
			'<section class="ld-rank-help__section">' +
			'<h4>VIP — rút thời gian luyện (13 mốc)</h4>' +
			'<p>Đồng bộ gói <strong>VIP HH3D</strong>. % dưới đây <strong>cộng thêm</strong> sau buff <strong>cấp LĐS</strong>; trần tổng <strong>−' +
			escHtml(caps.maxReductionPct) +
			'%</strong>, mỗi mẻ luôn còn ít nhất <strong>' +
			escHtml(caps.minTimeRatioPct) +
			'%</strong> giờ gốc; tối thiểu <strong>' +
			escHtml(Math.round((caps.minCraftDurationSec || 600) / 60)) +
			' phút</strong>/mẻ (Điều Hỏa).</p>' +
			'<table class="ld-rank-help__table ld-rank-help__table--vip"><thead><tr><th>Mốc VIP</th><th>Rút giờ luyện</th><th></th></tr></thead><tbody>' +
			rows +
			'</tbody></table>' +
			(cur.active
				? '<p>Gói của bạn: <strong>' +
					escHtml(cur.tierLabel) +
					'</strong> — đang −<strong>' +
					escHtml(cur.reductionPct) +
					'%</strong> giờ mỗi mẻ.</p>'
				: '<p>Chưa kích hoạt VIP — khi mua gói, % theo đúng hàng trong bảng.</p>') +
			'</section>'
		);
	}

	function buildRankHelpHtml() {
		var r = computeDanRank(MOCK.rankPoints || 0);
		var tier = MOCK.tier || 'ha';
		var rng = getDanRankRng(r, tier);
		var tiers = pillTierOrder();
		var rows = tiers
			.map(function (t) {
				var regRow = MOCK.pillTierRegistry && MOCK.pillTierRegistry.tiers ? MOCK.pillTierRegistry.tiers[t] : null;
				var gate = masterTierGate(t);
				var unlocked = recipeCraftUnlocked(t);
				var full = (r.level | 0) >= gate.full_buff_rank;
				var label = (regRow && regRow.label) || TIER_LABELS[t] || t;
				var tag = unlocked
					? full
						? '<span class="ld-rank-help__tag is-ok">Đủ cấp buff</span>'
						: '<span class="ld-rank-help__tag">Buff một phần</span>'
					: '<span class="ld-rank-help__tag is-lock">Chưa đủ điều kiện</span>';
				return (
					'<tr><td>' +
					escHtml(label) +
					'</td><td>' +
					escHtml(recipeMinRankName(t)) +
					'</td><td>' +
					escHtml(recipeTuViGateShort(t)) +
					'</td><td>' +
					escHtml(resolveDanLevelName(gate.full_buff_rank)) +
					'</td><td>' +
					tag +
					'</td></tr>'
				);
			})
			.join('');
		var pityLine = '';
		var pityT =
			MOCK.pityStar4 && MOCK.pityStar4.per_tier && MOCK.pityStar4.per_tier[tier]
				? MOCK.pityStar4.per_tier[tier]
				: null;
		if (pityT && pityT.next_guaranteed_4) {
			pityLine = 'Lần <strong>Thu kế chắc nhận 4★</strong> (linh khí đầy).';
		} else if (pityT && pityT.approx_pct_4star != null) {
			pityLine =
				'Tỉ lệ thêm hiện tại: ~<strong>' +
				escHtml(Math.round(Number(pityT.approx_pct_4star) * 10) / 10) +
				'%</strong> nhận 4★ lần Thu kế.';
		}

		return (
			'<section class="ld-rank-help__section">' +
			'<h4>Nghề Luyện Đan Sư</h4>' +
			'<p><strong>Luyện Đan Sư</strong> là con đường luyện dược trong Luyện Đan Đường. Tu sĩ mua linh dược tại <strong>Tụ Bảo Các</strong> để tiến hành luyện đan; khi thu đan, <strong>dược khí</strong> ngẫu nhiên từ <strong>1★–4★</strong> — sao càng nhiều thì Tu Vi càng nhiều khi sử dụng, và độ khó luyện được cũng cao hơn.</p>' +
			'<p>Tu sĩ <strong>Tu Vi &lt; 1.000.000</strong> được <strong>Phúc Lợi Tân Thủ</strong> khi dùng đan: thêm % Tu Vi (càng thấp Tu Vi so với Top 1 server, bonus càng cao).</p>' +
			'<p><strong>Cấp bậc Luyện Đan Sư</strong> và <strong>Tu Vi tu luyện</strong> cùng quyết định loại đan dược có thể luyện — thiếu một trong hai thì tab phẩm bị khóa. <strong>XP nghề</strong> tích khi <strong>Thu đan</strong>.</p>' +
			'</section>' +
			'<section class="ld-rank-help__section">' +
			'<h4>Ngưỡng Tu Vi mở luyện</h4>' +
			'<ul class="ld-rank-help__gates">' +
			buildTuViGateListHtml() +
			'</ul>' +
			'</section>' +
			buildPillTuViTableHtml() +
			'<section class="ld-rank-help__section">' +
			'<h4>Bốn cảnh giới · 20 cấp bậc</h4>' +
			'<ul>' +
			'<li><strong>Phàm cấp</strong> (1–5) — Đan Đồng → Đan Sĩ → Đan Sư → Đại Đan Sư → Đan Tông</li>' +
			'<li><strong>Linh cấp</strong> (6–10) — Linh Đan Sư → Huyền Đan Sư → Địa Đan Sư → Thiên Đan Sư → Vương Đan Sư</li>' +
			'<li><strong>Tiên cấp</strong> (11–15) — Thánh Đan Sư → Tiên Đan Sư → Kim Đan Tông Sư → Đế Đan Sư → Đạo Đan Sư</li>' +
			'<li><strong>Thần cấp</strong> (16–20) — Thần Đan Sư → Cổ Đan Sư → Hồng Hoang Đan Tổ → Vạn Cổ Đan Đế → <strong>Thiên Đạo Đan Thánh</strong></li>' +
			'</ul>' +
			'</section>' +
			'<section class="ld-rank-help__section">' +
			'<h4>Phẩm đan — cấp nào luyện được?</h4>' +
			'<table class="ld-rank-help__table"><thead><tr><th>Phẩm</th><th>Cấp LĐS tối thiểu</th><th>Tu Vi tối thiểu</th><th>Bậc LĐS</th><th>Trạng thái</th></tr></thead><tbody>' +
			rows +
			'</tbody></table>' +
			'<p>Cần đạt đủ 2 điều kiện Tu Vi và Cấp bậc luyện đan sư mới có thể luyện được đan dược cấp cao.</p>' +
			'</section>' +
			'<section class="ld-rank-help__section">' +
			'<h4>Tụ Linh Đan Khí</h4>' +
			'<p>Linh ấn ngưng tụ theo <strong>từng phẩm</strong> (Hạ / Trung / Thượng / Cực), không dùng chung.</p>' +
			'<p>Thu đan chưa ra dược khí 4★ thì linh khí tích dần; thanh đầy — lần <strong>Thu kế cùng phẩm</strong> ắt sinh 4★. Đã thu 4★ thì Tụ Linh tan.</p>' +
			'<p>Đây là <strong>thiên duyên tích lũy</strong>, không phải buff nghề thuần túy.</p>' +
			'</section>' +
			buildRankCraftDurationHelpSection(tier) +
			buildVipCraftHelpSection() +
			'<section class="ld-rank-help__section">' +
			'<h4>Dược khí &amp; buff nghề</h4>' +
			'<ul>' +
			'<li>Mỗi viên: <strong>dược khí 1★–4★</strong> (thấp → cao).</li>' +
			'<li>Dòng dưới thanh cấp: <strong>tỉ lệ ~4★ khi Thu</strong> theo phẩm đang chọn — cấp nghề càng cao, % càng tốt.</li>' +
			'<li><strong>Thời gian luyện:</strong> phẩm cao lâu hơn; xem mục <strong>Cấp LĐS</strong> (kèm Đan Đồng) và <strong>VIP</strong> phía trên.</li>' +
			'<li>Linh khí (Tụ Linh): tích khi trượt 4★; đầy thì Thu kế chắc 4★ — <em>riêng từng phẩm</em>.</li>' +
			'</ul>' +
			'</section>' +
			'<section class="ld-rank-help__section">' +
			'<h4>Đan Đồng</h4>' +
			'<p>Chủ Lò mời tối đa 2 <strong>Đan Đồng</strong> hỗ trợ <strong>Điều Hỏa</strong>. Đan Đồng nhận <strong>Đan Huân</strong> khi giữ lửa; cấp LĐS của họ còn giúp Chủ <strong>luyện nhanh hơn</strong> (chi tiết ở mục <strong>Cấp LĐS — rút thời gian</strong>).</p>' +
			'<p>Nút chuông trên thanh công cụ: xem / chấp nhận / từ chối lời mời. Chấp nhận một lời hủy các lời khác.</p>' +
			'</section>' +
			'<section class="ld-rank-help__section ld-rank-help__now">' +
			'<h4>Trạng thái hiện tại</h4>' +
			'<p>Cấp bậc LĐS: <strong>' +
			escHtml(resolveDanLevelName(r.level | 0)) +
			'</strong>' +
			(r.is_max
				? ' · <span class="ld-rank-help__tag is-ok">Thiên Đạo Đan Thánh</span>'
				: '') +
			'</p>' +
			'<p>Tu Vi tu luyện: <strong>' +
			escHtml(fmtTuVi(MOCK.tuViBalance | 0)) +
			'</strong> · Phẩm đang xem: <strong>' +
			escHtml(TIER_LABELS[tier] || tier) +
			'</strong> — ' +
			(recipeCraftUnlocked(tier)
				? '<span class="ld-rank-help__tag is-ok">đủ điều kiện luyện</span>'
				: '<span class="ld-rank-help__tag is-lock">' + escHtml(ldCraftGateMsg(tier)) + '</span>') +
			'</p>' +
			'<p>Dược khí 4★ (phẩm đang xem): ~<strong>' +
			escHtml(rng.star4_current_pct != null ? rng.star4_current_pct : '—') +
			'%</strong> khi Thu' +
			(rng.star4_bonus_pct > 0
				? ' (+' + escHtml(rng.star4_bonus_pct) + '% từ cấp nghề)'
				: '') +
			'</p>' +
			(pityLine ? '<p>' + pityLine + '</p>' : '') +
			'</section>' +
			'<section class="ld-rank-help__section">' +
			'<h4>Phân giải đan</h4>' +
			'<p>Trong túi, chọn viên đan → <strong>Phân giải</strong>: ngẫu nhiên nhận lại <strong>~90%</strong> linh dược.</p>' +
			'</section>' +
			'<section class="ld-rank-help__section">' +
			'<h4>Mẹo</h4>' +
			'<p>Đổi tab phẩm ở <strong>Công Thức</strong> để xem Tụ Linh và buff tương ứng. Nút <strong>?</strong> trên thanh công cụ mở lại hướng dẫn này.</p>' +
			'</section>'
		);
	}

	function decomposeRefundItems(d) {
		if (!d || !d.materials || typeof d.materials !== 'object') {
			return [];
		}
		var items = [];
		ELEMENTS.forEach(function (el) {
			var n = d.materials[el] != null ? d.materials[el] | 0 : 0;
			if (n > 0) {
				items.push({ element: el, qty: n });
			}
		});
		return items;
	}

	function clearDecomposeRevealTimers() {
		if (!state.decomposeRevealTimers || !state.decomposeRevealTimers.length) {
			return;
		}
		state.decomposeRevealTimers.forEach(function (tid) {
			window.clearTimeout(tid);
		});
		state.decomposeRevealTimers = [];
	}

	function createDecomposeLootCell(el, amount) {
		var mats = (MOCK.itemCatalog && MOCK.itemCatalog.materials) || {};
		var label = (mats[el] && mats[el].label) || ELEMENT_LABELS[el] || el;
		var cell = document.createElement('div');
		cell.className = 'ld-cell ld-cell--mat ld-decompose-loot__cell';
		cell.setAttribute('role', 'listitem');
		cell.dataset.element = el;
		cell.title = label;
		cell.innerHTML =
			'<img src="' +
			matImgFromCatalog(el) +
			'" alt="" decoding="async" draggable="false" />' +
			'<span class="ld-qty ld-decompose-loot__qty">+' +
			qty(amount) +
			'</span>' +
			'<span class="ld-decompose-loot__name">' +
			label +
			'</span>';
		return cell;
	}

	function closeDecomposeRewardModal() {
		clearDecomposeRevealTimers();
		state.decomposeRewardOpen = false;
		var backdrop = $('#ldDecomposeRewardBackdrop');
		var modal = $('#ldDecomposeRewardModal');
		if (backdrop) backdrop.hidden = true;
		if (modal) modal.hidden = true;
		document.body.classList.remove('ld-decompose-reward-open');
		var grid = $('#ldDecomposeLootGrid');
		if (grid) grid.innerHTML = '';
		var summary = $('#ldDecomposeLootSummary');
		if (summary) {
			summary.hidden = true;
			summary.textContent = '';
		}
	}

	function runDecomposeLootReveal(items, onComplete) {
		var grid = $('#ldDecomposeLootGrid');
		var okBtn = $('#ldDecomposeRewardOk');
		if (!grid) {
			if (typeof onComplete === 'function') onComplete();
			return;
		}
		grid.innerHTML = '';
		clearDecomposeRevealTimers();
		state.decomposeRevealTimers = [];

		if (!items.length) {
			var empty = document.createElement('p');
			empty.className = 'ld-decompose-loot__empty';
			empty.textContent = 'Không có linh dược hoàn trả.';
			grid.appendChild(empty);
			if (okBtn) {
				okBtn.disabled = false;
				okBtn.textContent = 'Đóng';
			}
			if (typeof onComplete === 'function') onComplete();
			return;
		}

		if (okBtn) {
			okBtn.disabled = true;
			okBtn.textContent = 'Đợi…';
		}

		var stagger = 340;
		items.forEach(function (item, idx) {
			var tid = window.setTimeout(function () {
				var cell = createDecomposeLootCell(item.element, item.qty);
				grid.appendChild(cell);
				window.requestAnimationFrame(function () {
					window.requestAnimationFrame(function () {
						cell.classList.add('is-revealed');
					});
				});
				playCollectSfx();

				if (idx === items.length - 1) {
					var doneTid = window.setTimeout(function () {
						if (okBtn) {
							okBtn.disabled = false;
							okBtn.textContent = 'Đóng';
						}
						var summary = $('#ldDecomposeLootSummary');
						if (summary) {
							var total = 0;
							items.forEach(function (it) {
								total += it.qty;
							});
							summary.textContent =
								total > 0 ? 'Tổng +' + qty(total) + ' linh dược đã cộng vào túi' : '';
							summary.hidden = false;
						}
						if (typeof onComplete === 'function') onComplete();
					}, 420);
					state.decomposeRevealTimers.push(doneTid);
				}
			}, idx * stagger);
			state.decomposeRevealTimers.push(tid);
		});
	}

	function setLootRewardModalMode(mode) {
		var titleEl = $('#ldDecomposeRewardTitle');
		var lootLabel = document.querySelector('#ldDecomposeRewardModal .ld-decompose-loot__label');
		if (mode === 'bundle') {
			if (titleEl) titleEl.textContent = 'Mở túi thành công';
			if (lootLabel) lootLabel.textContent = 'Linh dược nhận được';
		} else {
			if (titleEl) titleEl.textContent = 'Phân giải thành công';
			if (lootLabel) lootLabel.textContent = 'Linh dược nhận lại';
		}
	}

	function openDecomposeRewardModal(stack, decomposeData) {
		setLootRewardModalMode('decompose');
		var d = decomposeData || {};
		var tier = d.tier || (stack && stack.tier);
		var stars = d.stars != null ? d.stars | 0 : stack ? stack.stars | 0 : 0;
		var pct = d.material_ratio != null ? Math.round(Number(d.material_ratio) * 100) : 90;
		var preview = $('#ldDecomposeRewardPreview');
		if (preview && tier) {
			preview.hidden = false;
			preview.innerHTML =
				'<img src="' + pillImg(tier, stars) + '" alt="" decoding="async" />';
			preview.className = 'ld-modal__preview ld-decompose-reward__pill ld-tier-' + tier;
		}
		var sub = $('#ldDecomposeRewardSub');
		if (sub) {
			sub.textContent =
				(TIER_LABELS[tier] || tier) +
				' · ' +
				stars +
				'★ — Hoàn khoảng ' +
				pct +
				'% nguyên liệu luyện';
		}
		var summary = $('#ldDecomposeLootSummary');
		if (summary) {
			summary.hidden = true;
			summary.textContent = '';
		}
		var grid = $('#ldDecomposeLootGrid');
		if (grid) grid.innerHTML = '';
		var backdrop = $('#ldDecomposeRewardBackdrop');
		var modal = $('#ldDecomposeRewardModal');
		if (backdrop) backdrop.hidden = false;
		if (modal) modal.hidden = false;
		document.body.classList.add('ld-decompose-reward-open');
		state.decomposeRewardOpen = true;
		runDecomposeLootReveal(decomposeRefundItems(d));
	}

	function finishDecomposeRewardModal() {
		renderInventory();
		closeDecomposeRewardModal();
		playClick();
	}

	function initDecomposeRewardModal() {
		var okBtn = $('#ldDecomposeRewardOk');
		var backdrop = $('#ldDecomposeRewardBackdrop');
		var closeBtn = $('#ldDecomposeRewardClose');
		if (okBtn) {
			okBtn.addEventListener('click', function () {
				if (okBtn.disabled) return;
				finishDecomposeRewardModal();
			});
		}
		if (backdrop) {
			backdrop.addEventListener('click', function () {
				if (okBtn && okBtn.disabled) return;
				finishDecomposeRewardModal();
			});
		}
		if (closeBtn) {
			closeBtn.addEventListener('click', function () {
				if (okBtn && okBtn.disabled) return;
				finishDecomposeRewardModal();
			});
		}
		document.addEventListener('keydown', function (e) {
			if (e.key !== 'Escape' || !state.decomposeRewardOpen) return;
			var btn = $('#ldDecomposeRewardOk');
			if (btn && btn.disabled) return;
			e.preventDefault();
			finishDecomposeRewardModal();
		});
	}

	function clearUsePillAnimTimer() {
		if (state.usePillAnimTimer) {
			clearInterval(state.usePillAnimTimer);
			state.usePillAnimTimer = null;
		}
	}

	function animateTuViCounter(el, fromVal, toVal, durationMs, onDone) {
		if (!el) {
			if (onDone) onDone();
			return;
		}
		clearUsePillAnimTimer();
		fromVal = fromVal | 0;
		toVal = toVal | 0;
		if (fromVal === toVal || durationMs < 1) {
			el.textContent = fmtTuVi(toVal);
			if (onDone) onDone();
			return;
		}
		var start = performance.now();
		var span = toVal - fromVal;
		state.usePillAnimTimer = setInterval(function () {
			var t = Math.min(1, (performance.now() - start) / durationMs);
			var eased = 1 - Math.pow(1 - t, 3);
			el.textContent = fmtTuVi(Math.round(fromVal + span * eased));
			if (t >= 1) {
				clearUsePillAnimTimer();
				el.textContent = fmtTuVi(toVal);
				if (onDone) onDone();
			}
		}, 32);
	}

	function closeUsePillRewardModal() {
		clearUsePillAnimTimer();
		state.usePillRewardOpen = false;
		var backdrop = $('#ldUsePillBackdrop');
		var modal = $('#ldUsePillModal');
		if (backdrop) backdrop.hidden = true;
		if (modal) modal.hidden = true;
		document.body.classList.remove('ld-use-pill-reward-open');
		var tuVi = $('#ldUsePillTuVi');
		if (tuVi) tuVi.classList.remove('is-animated');
	}

	function finishUsePillRewardModal(afterTuVi) {
		if (afterTuVi != null) {
			MOCK.tuViBalance = afterTuVi | 0;
		}
		closeUsePillRewardModal();
		playClick();
	}

	function runUsePillHaloEffect(stack, done) {
		if (!stack) {
			if (typeof done === 'function') done();
			return;
		}
		var tier = stack.tier || 'ha';
		var stars = stack.stars | 0;
		var root = document.createElement('div');
		root.className = 'ld-use-pill-halo ld-tier-' + tier;
		root.setAttribute('role', 'presentation');
		root.innerHTML =
			'<div class="ld-use-pill-halo__backdrop" aria-hidden="true"></div>' +
			'<div class="ld-use-pill-halo__stage">' +
			'<span class="ld-use-pill-halo__ring ld-use-pill-halo__ring--1" aria-hidden="true"></span>' +
			'<span class="ld-use-pill-halo__ring ld-use-pill-halo__ring--2" aria-hidden="true"></span>' +
			'<span class="ld-use-pill-halo__ring ld-use-pill-halo__ring--3" aria-hidden="true"></span>' +
			'<div class="ld-use-pill-halo__pill">' +
			'<img src="' +
			pillImg(tier, stars) +
			'" alt="" decoding="async" />' +
			'</div>' +
			'</div>';
		document.body.appendChild(root);
		document.body.classList.add('ld-use-pill-halo-open');
		playCollectSfx();

		window.requestAnimationFrame(function () {
			window.requestAnimationFrame(function () {
				root.classList.add('is-active');
			});
		});

		var reducedMotion =
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		var holdMs = reducedMotion ? 280 : 1280;
		var fadeMs = reducedMotion ? 120 : 420;
		window.setTimeout(function () {
			root.classList.add('is-out');
			window.setTimeout(function () {
				if (root.parentNode) root.parentNode.removeChild(root);
				document.body.classList.remove('ld-use-pill-halo-open');
				if (typeof done === 'function') done();
			}, fadeMs);
		}, holdMs);
	}

	function openUsePillRewardModal(stack, useData) {
		var u = useData || {};
		var tier = u.tier || (stack && stack.tier);
		var stars = u.stars != null ? u.stars | 0 : stack ? stack.stars | 0 : 0;
		var granted =
			u.tu_vi_granted != null
				? u.tu_vi_granted | 0
				: (u.tu_vi_base | 0) + (u.tu_vi_bonus | 0);
		var before =
			u.tu_vi_before != null ? u.tu_vi_before | 0 : Math.max(0, (MOCK.tuViBalance | 0) - granted);
		var after = u.tu_vi_after != null ? u.tu_vi_after | 0 : before + granted;
		var baseTv = u.tu_vi_base != null ? u.tu_vi_base | 0 : granted;
		var bonusTv = u.tu_vi_bonus != null ? u.tu_vi_bonus | 0 : 0;
		var plMsg = u.phuc_loi_msg ? String(u.phuc_loi_msg).trim() : '';

		var preview = $('#ldUsePillPreview');
		if (preview && tier) {
			preview.innerHTML =
				'<img src="' + pillImg(tier, stars) + '" alt="" decoding="async" />';
			preview.className = 'ld-modal__preview ld-use-pill__pill ld-tier-' + tier;
		}
		var sub = $('#ldUsePillSub');
		if (sub) {
			sub.textContent = (TIER_LABELS[tier] || tier) + ' · ' + stars + '★ dược khí';
		}
		var beforeEl = $('#ldUsePillBefore');
		var gainEl = $('#ldUsePillGain');
		var afterEl = $('#ldUsePillAfter');
		if (beforeEl) beforeEl.textContent = fmtTuVi(before);
		if (gainEl) gainEl.textContent = '+' + fmtTuVi(granted);
		if (afterEl) afterEl.textContent = fmtTuVi(before);

		var bonusEl = $('#ldUsePillBonus');
		if (bonusEl) {
			if (bonusTv > 0) {
				bonusEl.hidden = false;
				bonusEl.textContent =
					plMsg ||
					'Phúc lợi tân thủ: +' + fmtTuVi(bonusTv) + ' Tu Vi (gốc hấp thu ' + fmtTuVi(baseTv) + ')';
			} else {
				bonusEl.hidden = true;
				bonusEl.textContent = '';
			}
		}

		var backdrop = $('#ldUsePillBackdrop');
		var modal = $('#ldUsePillModal');
		if (backdrop) backdrop.hidden = false;
		if (modal) modal.hidden = false;
		document.body.classList.add('ld-use-pill-reward-open');
		state.usePillRewardOpen = true;
		state.usePillRewardAfter = after;

		var tuVi = $('#ldUsePillTuVi');
		if (tuVi) {
			tuVi.classList.remove('is-animated');
			void tuVi.offsetWidth;
			tuVi.classList.add('is-animated');
		}

		window.setTimeout(function () {
			animateTuViCounter(afterEl, before, after, 900);
		}, 420);
	}

	function initUsePillRewardModal() {
		var okBtn = $('#ldUsePillOk');
		var backdrop = $('#ldUsePillBackdrop');
		var closeBtn = $('#ldUsePillClose');
		if (okBtn) {
			okBtn.addEventListener('click', function () {
				var after =
					state.usePillRewardAfter != null ? state.usePillRewardAfter | 0 : MOCK.tuViBalance | 0;
				finishUsePillRewardModal(after);
			});
		}
		if (backdrop) {
			backdrop.addEventListener('click', function () {
				var after =
					state.usePillRewardAfter != null ? state.usePillRewardAfter | 0 : MOCK.tuViBalance | 0;
				finishUsePillRewardModal(after);
			});
		}
		if (closeBtn) {
			closeBtn.addEventListener('click', function () {
				var after =
					state.usePillRewardAfter != null ? state.usePillRewardAfter | 0 : MOCK.tuViBalance | 0;
				finishUsePillRewardModal(after);
			});
		}
		document.addEventListener('keydown', function (e) {
			if (e.key !== 'Escape' || !state.usePillRewardOpen) return;
			e.preventDefault();
			var after =
				state.usePillRewardAfter != null ? state.usePillRewardAfter | 0 : MOCK.tuViBalance | 0;
			finishUsePillRewardModal(after);
		});
	}

	function openRankHelpModal() {
		var body = $('#ldRankHelpBody');
		if (body) {
			body.innerHTML = buildRankHelpHtml();
		}
		$('#ldRankHelpBackdrop').hidden = false;
		$('#ldRankHelpModal').hidden = false;
		document.body.classList.add('ld-modal-open');
		playClick();
	}

	function closeRankHelpModal() {
		$('#ldRankHelpBackdrop').hidden = true;
		$('#ldRankHelpModal').hidden = true;
		var itemModal = $('#ldItemModal');
		var dongModal = $('#ldDongModal');
		var invitesModal = $('#ldDongInvitesModal');
		var inviteModal = $('#ldInviteModal');
		var otherOpen =
			(itemModal && !itemModal.hidden) ||
			(dongModal && !dongModal.hidden) ||
			(invitesModal && !invitesModal.hidden) ||
			(inviteModal && !inviteModal.hidden);
		if (!otherOpen) {
			document.body.classList.remove('ld-modal-open');
		}
	}

	function initBagExpandModal() {
		var closeBtn = $('#ldBagExpandClose');
		var okBtn = $('#ldBagExpandOk');
		var backdrop = $('#ldBagExpandBackdrop');
		if (closeBtn) closeBtn.addEventListener('click', closeBagExpandModal);
		if (okBtn) okBtn.addEventListener('click', closeBagExpandModal);
		if (backdrop) {
			backdrop.addEventListener('click', function (e) {
				if (e.target === backdrop) closeBagExpandModal();
			});
		}
	}

	function initRankHelpModal() {
		var btn = $('#ldHelpQuickBtn') || $('#ldRankHelpBtn');
		var closeBtn = $('#ldRankHelpClose');
		var okBtn = $('#ldRankHelpOk');
		var backdrop = $('#ldRankHelpBackdrop');
		if (btn) {
			btn.addEventListener('click', openRankHelpModal);
		}
		if (closeBtn) {
			closeBtn.addEventListener('click', closeRankHelpModal);
		}
		if (okBtn) {
			okBtn.addEventListener('click', closeRankHelpModal);
		}
		if (backdrop) {
			backdrop.addEventListener('click', closeRankHelpModal);
		}
	}

	function syncRank() {
		var pts = MOCK.rankPoints || 0;
		var r = computeDanRank(pts);
		var fillEl = $('#ldRankFill');
		var xpEl = $('#ldRankXp');
		var bar = $('.ld-rank__bar');
		syncRankTitles(r.level | 0);
		if (fillEl) fillEl.style.width = r.pct + '%';
		if (bar) bar.setAttribute('aria-valuenow', String(Math.round(r.pct)));
		if (xpEl) {
			if (r.is_max) {
				xpEl.textContent = fmtTuVi(pts) + ' · Tối đa';
			} else {
				xpEl.textContent = fmtTuVi(r.xp_in_level) + ' / ' + fmtTuVi(r.xp_per_level);
			}
		}
		syncRankPerk(r);
	}

	function getPillStacks() {
		if (MOCK.pillStacks && MOCK.pillStacks.length) {
			return MOCK.pillStacks.map(function (s) {
				return {
					tier: s.tier,
					stars: s.stars | 0,
					count: s.count | 0,
					stack_id: s.stack_id || s.tier + ':' + s.stars,
				};
			});
		}
		var map = {};
		MOCK.pills.forEach(function (p) {
			var sid = p.id || p.tier + ':' + p.stars;
			var key = p.tier + '-' + p.stars;
			if (!map[key]) {
				map[key] = { tier: p.tier, stars: p.stars, count: 0, stack_id: sid };
			}
			map[key].count++;
		});
		return Object.keys(map).map(function (k) {
			return map[k];
		});
	}

	function pillStackId(stack) {
		return stack.stack_id || stack.tier + ':' + stack.stars;
	}

	function snapshotPillStackMap() {
		var map = {};
		getPillStacks().forEach(function (s) {
			var key = s.tier + ':' + (s.stars | 0);
			map[key] = (map[key] | 0) + (s.count | 0);
		});
		return map;
	}

	/** Đan vừa thu (so sánh túi trước/sau collect). */
	function diffCollectedPill(beforeMap) {
		var gained = null;
		getPillStacks().forEach(function (s) {
			var key = s.tier + ':' + (s.stars | 0);
			var prev = beforeMap[key] | 0;
			var now = s.count | 0;
			if (now > prev) {
				var delta = now - prev;
				if (!gained || delta >= (gained.count | 0)) {
					gained = { tier: s.tier, stars: s.stars | 0, count: delta };
				}
			}
		});
		return gained;
	}

	function recipeComplete() {
		var vec = tierVector(MOCK.tier);


		var ok = true;


		ELEMENTS.forEach(function (el) {


			var need = vec[el] != null ? vec[el] | 0 : 0;


			if ((MOCK.inventory[el] || 0) < need) ok = false;


		});


		return ok;


	}

	function toggleEl(el, show) {
		if (!el) return;
		el.hidden = !show;
	}

	function syncButtons() {
		var idle = MOCK.furnace === 'idle';
		var crafting = MOCK.furnace === 'crafting';
		var ready = MOCK.furnace === 'ready';
		var exploded = MOCK.furnace === 'exploded';
		var companion = isCompanionView();
		var danDong = isDanDongExperience();
		var dongBlock = MOCK.dongLocked && !companion;
		var bagFullCraft = idle && pillBagFull(MOCK.tier);
		var canCraft =
			idle &&
			recipeComplete() &&
			recipeCraftUnlocked(MOCK.tier) &&
			!dongBlock &&
			!companion &&
			!danDong &&
			!bagFullCraft;

		var craftBtn = $('#ldBtnCraft');
		if (craftBtn) {
			craftBtn.hidden = !(idle && !exploded) || companion || dongBlock || danDong;
			var craftLock = !canCraft || state.craftRequestBusy;
			craftBtn.classList.toggle('is-ready', canCraft && !state.craftRequestBusy);
			craftBtn.classList.toggle('is-disabled', craftLock);
			craftBtn.disabled = craftLock;
			if ((dongBlock || danDong) && idle) {
				craftBtn.setAttribute(
					'title',
					'Đang là Đan Đồng — không thể tự luyện. Rời vai trước khi ' +
						LD_ALCHEMIST_LABEL +
						' bắt đầu luyện đan.'
				);
			} else if (companion || danDong) {
				craftBtn.setAttribute(
					'title',
					'Bạn đang hỗ trợ ' + LD_ALCHEMIST_LABEL + ' — dùng Điều Hỏa, không tự khai ' + LD_FURNACE_LABEL + '.'
				);
			} else if (idle && bagFullCraft) {
				craftBtn.setAttribute('title', pillBagFullMessage(MOCK.tier));
			} else if (idle && !recipeCraftUnlocked(MOCK.tier)) {
				craftBtn.setAttribute('title', ldCraftGateMsg(MOCK.tier));
			} else {
				craftBtn.removeAttribute('title');
			}
		}

		var ackBtn = getAckBtn();


		if (ackBtn) {
			if (companion && exploded) {
				ackBtn.hidden = state.explosionModalOpen;
				ackBtn.disabled = false;
				ackBtn.textContent = 'Đóng';
			} else {
				ackBtn.hidden = !exploded || state.explosionModalOpen;
				ackBtn.disabled = !exploded || state.explosionModalOpen;
				ackBtn.textContent = 'Đã hiểu (nổ ' + LD_FURNACE_LABEL + ')';
			}
		}

		var colBtn = $('#ldBtnCollect');
		var showCollect = ready && !companion;
		toggleEl(colBtn, showCollect);
		if (colBtn && showCollect) {
			var collectBagFull = pillBagFull(MOCK.tier);
			var collectLock = !!state.collectBusy || collectBagFull;
			colBtn.disabled = collectLock;
			colBtn.classList.toggle('is-disabled', collectLock);
			colBtn.setAttribute('aria-busy', collectLock ? 'true' : 'false');
			if (collectBagFull && !state.collectBusy) {
				colBtn.setAttribute('title', pillBagFullMessage(MOCK.tier));
			} else if (!state.collectBusy) {
				colBtn.removeAttribute('title');
			}
		} else if (colBtn) {
			colBtn.classList.remove('is-disabled');
			colBtn.removeAttribute('aria-busy');
		}


		toggleEl($('#ldBtnTune'), crafting);


		var tuneBtn = $('#ldBtnTune');


		if (tuneBtn && crafting) {


			var atFullStability = MOCK.stability >= 99.99;

			var tuneLock =
				atFullStability ||
				((MOCK.tuneCooldownLeft | 0) > 0) ||
				!!state.tuningInFlight;


			tuneBtn.disabled = tuneLock;


			tuneBtn.classList.toggle('is-tune-lock', tuneLock);


			tuneBtn.setAttribute('aria-busy', state.tuningInFlight ? 'true' : 'false');


		} else if (tuneBtn) {


			tuneBtn.classList.remove('is-tune-lock');


			tuneBtn.removeAttribute('aria-busy');


		}


		toggleEl($('#ldStabilityWrap'), crafting);

		var img = $('#ldFurnaceImg');
		if (img) {
			var src = FURNACE_IMG.idle;
			if (exploded) {
				src = FURNACE_IMG.exploded;
			} else if (crafting) {
				src = FURNACE_IMG.crafting;
			} else if (ready) {
				src = state.collectBusy ? FURNACE_IMG.ready : FURNACE_IMG.crafting;
			}
			img.src = src;
		}

		var timerWrap = $('#ldTimerWrap');
		if (timerWrap) timerWrap.hidden = exploded || !(crafting || ready);


		var fire = $('#ldFireStatus');


		if (fire) {


			if (idle && danDong) {
				var owners = MOCK.dongOwnersForMe || [];
				var ownerCrafting = owners.some(function (o) {
					return !!o.owner_crafting;
				});
				var alchemist = resolveAlchemistName();
				if (ownerCrafting) {
					setLdFireStatus(
						fire,
						LD_ALCHEMIST_LABEL + ' đang luyện — hãy hỗ trợ Điều Hỏa',
						'is-crafting-unstable',
						'「' +
							alchemist +
							'」đã bắt đầu luyện đan — mở lại trang hoặc chờ đồng bộ để Điều Hỏa.'
					);
				} else {
					setLdFireStatus(
						fire,
						'Chờ Luyện Dược Sư bắt đầu luyện đan',
						'is-idle-ok',
						'「' +
							alchemist +
							'」chưa khai ' +
							LD_FURNACE_LABEL +
							' — khi bắt đầu hãy Điều Hỏa trong 5 phút đầu. Có thể rời vai nếu chưa bắt đầu luyện.'
					);
				}
			} else if (idle && bagFullCraft) {
				setLdFireStatus(fire, pillBagFullTitle(MOCK.tier), 'is-idle-lack', pillBagFullFireDetail(MOCK.tier));
			} else if (idle && !recipeCraftUnlocked(MOCK.tier)) {
				setLdFireStatus(fire, 'Chưa đủ điều kiện', 'is-idle-lack', ldCraftGateMsg(MOCK.tier));
			} else if (idle && !recipeComplete()) {
				setLdFireStatus(
					fire,
					'Chưa đủ linh dược',
					'is-idle-lack',
					'Thu thập đủ linh dược Ngũ Hành trong túi theo công thức.'
				);
			} else if (idle && canCraft) {
				setLdFireStatus(
					fire,
					'Đủ linh dược — có thể khai ' + LD_FURNACE_LABEL,
					'is-idle-ok',
					'Đủ linh dược theo công thức — có thể luyện đan.'
				);
			} else if (crafting) {
				var ux = MOCK.unstableLeftSec | 0;
				var stablePhase = isStableCraftPhase();
				if (companion || danDong) {
					setLdFireStatus(
						fire,
						ux > 0
							? 'Đan Đồng: giữ ổn định lửa — Điều Hỏa'
							: stablePhase
								? LD_FURNACE_LABEL + ' đang ổn — chờ ' + LD_ALCHEMIST_LABEL + ' thu đan'
								: 'Đang đồng bộ trạng thái ' + LD_FURNACE_LABEL + '…',
						ux > 0 ? 'is-crafting-unstable' : stablePhase ? 'is-crafting-stable' : 'is-crafting-unstable',
						ux > 0
							? '5 phút đầu: % về 0 sẽ nổ ' + LD_FURNACE_LABEL + ' — bạn và ' + LD_ALCHEMIST_LABEL + ' cùng Điều Hỏa.'
							: stablePhase
								? 'Giai đoạn nhạy cảm đã qua — chờ ' + LD_ALCHEMIST_LABEL + ' thu đan.'
								: 'Chờ server xác nhận ' + LD_FURNACE_LABEL + ' đã qua giai đoạn nhạy cảm.'
					);
				} else {
					setLdFireStatus(
						fire,
						ux > 0
							? 'Giai đoạn đầu: giữ ổn định lửa — về 0% thất bại'
							: stablePhase
								? 'Lửa ổn định — chờ đan thành hình'
								: 'Đang đồng bộ trạng thái ' + LD_FURNACE_LABEL + '…',
						ux > 0 ? 'is-crafting-unstable' : stablePhase ? 'is-crafting-stable' : 'is-crafting-unstable',
						ux > 0
							? 'Trong 5 phút đầu mẻ, giữ ổn định lửa — về 0% sẽ nổ ' + LD_FURNACE_LABEL + '.'
							: stablePhase
								? 'Trạng thái đã ổn định, chỉ còn chờ đan dược thành hình.'
								: 'Chờ server xác nhận — tránh báo ổn khi ' + LD_FURNACE_LABEL + ' vẫn có thể nổ.'
					);
				}
			} else if (ready) {
				if (companion || danDong) {
					setLdFireStatus(
						fire,
						'Đan đã thành — chờ ' + LD_ALCHEMIST_LABEL + ' thu',
						'is-ready',
						LD_ALCHEMIST_LABEL + ' sẽ thu đan. Bạn đã hoàn thành vai trò Đan Đồng mẻ này.'
					);
				} else {
					setLdFireStatus(fire, 'Đan thành — thu đan về túi', 'is-ready', 'Đan đã thành — bấm Thu đan để nhận vào túi.');
				}
			} else if (exploded) {
				if (companion || danDong) {
					setLdFireStatus(
						fire,
						'Nổ ' + LD_FURNACE_LABEL + ' — luyện thất bại',
						'is-exploded',
						LD_FURNACE_LABEL + ' đã nổ. Bấm Đóng để tiếp tục theo dõi.'
					);
				} else {
					setLdFireStatus(
						fire,
						'Nổ ' + LD_FURNACE_LABEL + ' — bấm 「Đã hiểu」để tiếp tục',
						'is-exploded',
						'Nổ ' + LD_FURNACE_LABEL + ' — bấm nút xác nhận để tiếp tục.'
					);
				}
			}


		}
	}

	function formatUnstableCountdown(sec) {
		sec = Math.max(0, Math.floor(sec));
		var m = Math.floor(sec / 60);
		var s = sec % 60;
		return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
	}

	function markStablePhaseConfirmed(pct, unstableSec) {
		if ((unstableSec | 0) <= 0 && pct >= 99) {
			state.stablePhaseConfirmed = true;
		}
		if ((unstableSec | 0) > 0) {
			state.stablePhaseConfirmed = false;
		}
	}

	function isStableCraftPhase() {
		return (MOCK.unstableLeftSec | 0) <= 0 && (state.stablePhaseConfirmed || MOCK.stability >= 99);
	}

	function syncStabilityPressureUi(pct, unstableSec) {
		markStablePhaseConfirmed(pct, unstableSec);
		var wrap = $('#ldStabilityWrap');
		var hint = $('#ldUnstableHint');
		var tuneBtn = $('#ldBtnTune');
		var inUnstable = unstableSec > 0;
		var stablePhase = isStableCraftPhase();

		if (wrap) {
			wrap.classList.toggle('is-pressure', inUnstable && pct < 45);
			wrap.classList.toggle('is-critical', inUnstable && pct < 20);
		}
		if (hint) {
			if (MOCK.furnace === 'crafting' && stablePhase) {
				hint.hidden = false;
				hint.textContent = LD_FURNACE_LABEL + ' đã ổn định — không cần Điều Hỏa';
			} else if (MOCK.furnace === 'crafting' && !inUnstable && !stablePhase) {
				hint.hidden = false;
				hint.textContent = 'Đang đồng bộ trạng thái ' + LD_FURNACE_LABEL + '…';
			} else if (inUnstable && isTuneSurvivalActive()) {
				hint.hidden = false;
				hint.textContent =
					'Đã giữ lửa đủ ' +
					(MOCK.tuneSurvivalMin | 0) +
					' lần — ' +
					LD_FURNACE_LABEL +
					' an toàn, không lo nổ lò.';
			} else if (inUnstable && (MOCK.tuneCount | 0) > 0) {
				hint.hidden = false;
				hint.textContent =
					'Giữ lửa: ' +
					tuneSurvivalProgressLabel() +
					' · còn ' +
					formatUnstableCountdown(unstableSec);
			} else if (inUnstable) {
				hint.hidden = false;
				hint.textContent =
					'Còn ' +
					formatUnstableCountdown(unstableSec) +
					' — cần ' +
					(MOCK.tuneSurvivalMin | 0) +
					' lần Điều Hỏa khi % ≤ ' +
					Math.round(MOCK.tuneEffectiveMaxPct || 68);
			} else {
				hint.hidden = true;
				hint.textContent = '';
			}
		}
		if (tuneBtn) {
			tuneBtn.classList.toggle('is-tune-urgent', inUnstable && pct < 55 && !tuneBtn.disabled);
		}

		if (!inUnstable) {
			state.stabilityWarnLevel = 0;
			return;
		}
		var level = 0;
		if (pct < 15) level = 3;
		else if (pct < 25) level = 2;
		else if (pct < 40) level = 1;
		if (level > state.stabilityWarnLevel) {
			if (level === 1) toast('Lửa suy yếu — hãy Điều Hỏa ngay', 'error');
			else if (level === 2) toast('Sắp mất ổn định — Điều Hỏa liên tục!', 'error');
			else if (level === 3) toast('Nguy hiểm! ' + LD_FURNACE_LABEL + ' sắp nổ', 'error');
			state.stabilityWarnLevel = level;
		}
	}

	function syncStability() {
		var pct = Math.max(0, Math.min(100, MOCK.stability));
		var unstableSec = MOCK.unstableLeftSec | 0;
		var inUnstable = unstableSec > 0;
		var survival = isTuneSurvivalActive();
		var weakBand = isInTuneWeakBand(pct);
		var wrap = $('#ldStabilityWrap');
		var fill = $('#ldStabilityFill');
		var bar = $('#ldStabilityBar');
		var label = $('#ldStabilityPct');
		var badge = $('#ldStabilityBadge');
		var danger = pct <= 25;
		var warn = pct <= 50 && pct > 25;
		var stable = pct > 50;

		if (inUnstable && !survival) {
			if (weakBand) {
				stable = false;
				warn = pct > 25;
				danger = pct <= 25;
			}
		} else if (inUnstable && survival) {
			stable = true;
			warn = false;
			danger = false;
		}

		if (fill) {
			fill.style.width = pct + '%';
			fill.classList.toggle('is-warn', warn);
			fill.classList.toggle('is-danger', danger);
		}
		if (wrap) {
			wrap.classList.toggle('is-stable', stable);
			wrap.classList.toggle('is-warn', warn);
			wrap.classList.toggle('is-danger', danger);
			wrap.classList.toggle('is-tune-weak', inUnstable && !survival && weakBand);
		}
		if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
		if (label) label.textContent = Math.round(pct) + '%';
		if (badge) {
			if (inUnstable && survival) {
				badge.textContent = 'Giữ hỏa';
			} else if (inUnstable && !survival) {
				if (danger) {
					badge.textContent = 'Sắp nổ';
				} else if (weakBand) {
					badge.textContent = 'Hỏa yếu';
				} else if (warn) {
					badge.textContent = 'Yếu dần';
				} else {
					badge.textContent = 'Điều hỏa';
				}
			} else if (danger) {
				badge.textContent = 'Sắp nổ';
			} else if (pct <= 35) {
				badge.textContent = 'Rất yếu';
			} else if (warn) {
				badge.textContent = 'Yếu dần';
			} else if (pct >= 85) {
				badge.textContent = 'Hỏa vững';
			} else {
				badge.textContent = 'Ổn định';
			}
		}
		syncStabilityPressureUi(pct, unstableSec);
	}

	function formatCountdownHms(sec) {
		sec = Math.max(0, Math.floor(sec));
		var h = Math.floor(sec / 3600);
		var m = Math.floor((sec % 3600) / 60);
		var s = sec % 60;
		function z(n) {
			return (n < 10 ? '0' : '') + n;
		}
		return z(h) + ':' + z(m) + ':' + z(s);
	}

	function syncTimer() {
		var fill = $('#ldTimerFill');
		var bar = $('.ld-timer-bar');
		var text = $('#ldTimerText');
		var total = MOCK.timerTotal || 1;
		var left = MOCK.craftFinishTs ? getCraftSecondsLeft() : MOCK.timerLeft;
		MOCK.timerLeft = left;
		var pct = Math.max(0, Math.min(100, (left / total) * 100));
		if (fill) fill.style.width = pct + '%';
		if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
		if (text) text.textContent = formatCountdownHms(left);
	}

	function dongDurationReductionPct(slot, tier) {
		if (!slot || !tier) return 0;
		var map = slot.durationReductionPctByTier;
		if (!map || typeof map !== 'object') return 0;
		if (map[tier] != null) return Number(map[tier]);
		return 0;
	}

	function recipeDurationReductionTotal(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (!rec) return 0;
		var rank =
			rec.duration_reduction_rank_pct != null ? Number(rec.duration_reduction_rank_pct) : 0;
		var vip =
			rec.duration_reduction_vip_pct != null ? Number(rec.duration_reduction_vip_pct) : 0;
		var dong = 0;
		(MOCK.dongSlots || []).forEach(function (s) {
			dong += dongDurationReductionPct(s, tier);
		});
		var cap = 90;
		if (MOCK.craftDurationCaps && MOCK.craftDurationCaps.maxReductionPct != null) {
			cap = Number(MOCK.craftDurationCaps.maxReductionPct);
		}
		return Math.min(cap, rank + vip + dong);
	}

	function effectiveRecipeDurationSec(tier) {
		var rec = MOCK.recipes && MOCK.recipes[tier];
		if (!rec || rec.duration_sec_base == null) return 0;
		var base = rec.duration_sec_base | 0;
		var totalPct = recipeDurationReductionTotal(tier);
		var minRatio = 0.1;
		var minSec = 600;
		if (MOCK.craftDurationCaps) {
			if (MOCK.craftDurationCaps.minTimeRatioPct != null) {
				minRatio = Number(MOCK.craftDurationCaps.minTimeRatioPct) / 100;
			}
			if (MOCK.craftDurationCaps.minCraftDurationSec != null) {
				minSec = MOCK.craftDurationCaps.minCraftDurationSec | 0;
			}
		}
		var sec = Math.round(base * Math.max(minRatio, 1 - totalPct / 100));
		return Math.max(minSec, sec);
	}

	/** Cập nhật preview thời gian luyện khi Đan Đồng vào/rời (Chủ Lò). */
	function syncRecipeDurationsFromDong() {
		if (!MOCK.recipes || isCompanionView()) return;
		Object.keys(MOCK.recipes).forEach(function (tier) {
			var rec = MOCK.recipes[tier];
			if (!rec || rec.duration_sec_base == null) return;
			var dong = 0;
			(MOCK.dongSlots || []).forEach(function (s) {
				dong += dongDurationReductionPct(s, tier);
			});
			rec.duration_reduction_companion_pct = dong;
			rec.duration_reduction_pct = recipeDurationReductionTotal(tier);
			rec.duration_sec = effectiveRecipeDurationSec(tier);
		});
	}

	function syncRecipePityHint() {
		var wrap = $('#ldDanKhiWrap');
		var fill = $('#ldDanKhiFill');
		var pctEl = $('#ldDanKhiPct');
		var subEl = $('#ldDanKhiSub');
		var rollEl = $('#ldDanKhiRoll');
		var bar = $('#ldDanKhiBar');
		var tag = $('#ldDanKhiTag');
		var p4 = MOCK.pityStar4;
		if (!wrap || !fill || !pctEl) return;
		if (!p4 || !p4.per_tier) {
			wrap.hidden = true;
			if (tag) {
				tag.hidden = true;
				tag.textContent = '';
			}
			if (rollEl) rollEl.hidden = true;
			return;
		}
		var t = MOCK.tier;
		var pt = p4.per_tier[t];
		if (!pt) {
			wrap.hidden = true;
			if (tag) {
				tag.hidden = true;
				tag.textContent = '';
			}
			if (rollEl) rollEl.hidden = true;
			return;
		}
		wrap.hidden = false;
		var miss = pt.miss_streak | 0;
		var hard = p4.hard_after_misses != null ? p4.hard_after_misses | 0 : 4;
		if (hard < 1) hard = 4;
		var guar = !!pt.next_guaranteed_4;
		var prog = guar ? 100 : Math.min(100, Math.round((100 * miss) / hard));
		fill.style.width = prog + '%';
		pctEl.textContent = guar ? hard + '/' + hard : miss + '/' + hard;
		if (subEl) {
			subEl.textContent = guar ? 'Tụ Linh đầy' : 'Tiến độ tích lũy · ' + prog + '%';
		}
		if (bar) {
			bar.setAttribute('aria-valuenow', String(prog));
			bar.setAttribute(
				'aria-valuetext',
				guar
					? 'Tụ Linh đầy — lần Thu kế chắc 4 sao'
					: 'Tụ Linh ' + miss + ' trên ' + hard + ' lần chưa 4 sao'
			);
		}
		if (rollEl) {
			var approx = pt.approx_pct_4star != null ? Number(pt.approx_pct_4star) : null;
			if (guar) {
				rollEl.textContent = 'Lần Thu kế: chắc chắn dược khí 4★';
				rollEl.hidden = false;
			} else if (approx != null && !isNaN(approx)) {
				rollEl.textContent = 'Xác suất Thu kế ra 4★ ngay: ~' + approx + '% (khác với tiến độ trên)';
				rollEl.hidden = false;
			} else {
				rollEl.hidden = true;
				rollEl.textContent = '';
			}
		}
		if (tag) {
			if (guar) {
				tag.textContent = 'Lần Thu kế chắc 4★';
				tag.hidden = false;
			} else {
				tag.textContent = '';
				tag.hidden = true;
			}
		}
		wrap.classList.toggle('is-full', prog >= 100);
		syncRankPerk(computeDanRank(MOCK.rankPoints || 0));
	}

	function renderRecipePreview() {
		var vec = tierVector(MOCK.tier);


		var pillStrip = $('#ldRecipePillStars');


		var pillName = $('#ldRecipePillName');


		var mats = $('#ldRecipeMats');


		if (pillStrip) {


			pillStrip.innerHTML = '';


			for (var sv = 1; sv <= 4; sv++) {
				var slot = document.createElement('button');
				slot.type = 'button';
				slot.className = 'ld-recipe-pill__star-slot ld-recipe-pill__star-slot--tap';
				slot.dataset.stars = String(sv);
				slot.setAttribute('aria-label', sv + ' sao — xem Tu Vi');
				var im = document.createElement('img');
				im.src = pillImg(MOCK.tier, sv);
				im.alt = '';
				im.decoding = 'async';
				slot.appendChild(im);
				pillStrip.appendChild(slot);
			}


		}


		if (pillName) pillName.textContent = TIER_LABELS[MOCK.tier];

		var durEl = $('#ldRecipeDuration');
		if (durEl) {
			if (!isCompanionView()) {
				syncRecipeDurationsFromDong();
			}
			var recDur = MOCK.recipes && MOCK.recipes[MOCK.tier];
			var eff =
				!isCompanionView() && recDur
					? effectiveRecipeDurationSec(MOCK.tier)
					: recDur && recDur.duration_sec != null
						? recDur.duration_sec | 0
						: 0;
			var redPct = !isCompanionView()
				? recipeDurationReductionTotal(MOCK.tier)
				: recDur && recDur.duration_reduction_pct != null
					? Number(recDur.duration_reduction_pct)
					: 0;
			if (eff > 0) {
				durEl.textContent = formatRecipeDurationLine(eff, redPct);
				durEl.hidden = false;
			} else {
				durEl.textContent = '';
				durEl.hidden = true;
			}
		}

		var rankXpEl = $('#ldRecipeRankXp');
		if (rankXpEl) {
			var recXp = MOCK.recipes && MOCK.recipes[MOCK.tier];
			var byStar = recXp && recXp.rank_xp_by_star ? recXp.rank_xp_by_star : null;
			if (byStar) {
				var x1 = byStar[1] != null ? byStar[1] | 0 : byStar['1'] | 0;
				var x4 = byStar[4] != null ? byStar[4] | 0 : byStar['4'] | 0;
				rankXpEl.textContent =
					'XP nghề khi Thu: ' +
					fmtTuVi(x1) +
					' (1★) → ' +
					fmtTuVi(x4) +
					' (4★) · dược khí càng cao, XP càng nhiều';
				rankXpEl.hidden = false;
			} else if (recXp && recXp.rank_xp_collect) {
				rankXpEl.textContent = 'XP nghề cơ bản khi Thu: ' + fmtTuVi(recXp.rank_xp_collect | 0) + ' (1★)';
				rankXpEl.hidden = false;
			} else {
				rankXpEl.textContent = '';
				rankXpEl.hidden = true;
			}
		}

		if (mats) {
			mats.innerHTML = '';

			if (isDanDongExperience()) {
				var hintLi = document.createElement('li');
				hintLi.className = 'ld-recipe-dong-hint';
				hintLi.textContent =
					'Bạn là Đan Đồng — ' +
					LD_ALCHEMIST_LABEL +
					' chuẩn bị nguyên liệu. Khi khai ' +
					LD_FURNACE_LABEL +
					', hãy Điều Hỏa khi lửa yếu (dưới ' +
					Math.round(MOCK.tuneEffectiveMaxPct) +
					'%). ' +
					MOCK.tuneSurvivalMin +
					' lần có ích thì ' +
					LD_FURNACE_LABEL +
					' không nổ.';
				mats.appendChild(hintLi);
			} else {

				ELEMENTS.forEach(function (el) {
			var have = MOCK.inventory[el] || 0;


			var need = vec[el] != null ? vec[el] | 0 : 0;


			var ok = have >= need;


			var matsCat = (MOCK.itemCatalog && MOCK.itemCatalog.materials) || {};


			var lbl = (matsCat[el] && matsCat[el].label) || ELEMENT_LABELS[el];


			var li = document.createElement('li');
			li.className = 'ld-recipe-mat ld-recipe-mat--tap' + (ok ? ' is-ok' : ' is-lack');
			li.dataset.element = el;
			li.setAttribute('role', 'button');
			li.tabIndex = 0;
			li.setAttribute('aria-label', lbl + ' — xem thông tin');

			li.innerHTML =


				'<img src="' +


				matImgFromCatalog(el) +


				'" alt="" decoding="async" /><span class="ld-recipe-mat__label">' +


				lbl +


				'</span>' +


				matQtyHtml(have, need);


					mats.appendChild(li);
				});
			}
		}

		bindRecipePreviewEvents();
		syncRecipePityHint();
		syncButtons();
	}

	function bindRecipePreviewEvents() {
		var mats = $('#ldRecipeMats');
		if (mats) {
			$$('.ld-recipe-mat[data-element]', mats).forEach(function (li) {
				if (li._ldTap) return;
				li._ldTap = true;
				var open = function () {
					openMaterialModal(li.dataset.element, { fromRecipe: true });
				};
				li.addEventListener('click', open);
				li.addEventListener('keydown', function (e) {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						open();
					}
				});
			});
		}
		var strip = $('#ldRecipePillStars');
		if (strip) {
			$$('.ld-recipe-pill__star-slot[data-stars]', strip).forEach(function (slot) {
				if (slot._ldTap) return;
				slot._ldTap = true;
				slot.addEventListener('click', function () {
					openRecipePillInfoModal(MOCK.tier, parseInt(slot.dataset.stars, 10));
				});
			});
		}
	}

	function dongSlotDurationHelpText(pct, compact) {
		var n = Math.round(pct);
		if (n < 1) return '';
		if (compact) {
			return 'Giảm ' + n + '% thời gian luyện';
		}
		return 'Đan đồng này giúp đạo hữu giảm ' + n + '% thời gian luyện.';
	}

	function renderDongSlots() {
		var inviteBlocked = !canOwnerInviteDong();
		var slotsRoot = $('#ldDongSlots');
		var filledCount = (MOCK.dongSlots || []).filter(function (s) {
			return !!s;
		}).length;
		if (slotsRoot) {
			slotsRoot.classList.toggle('ld-dong__slots--dual', filledCount >= 2);
		}
		var compactHelp = filledCount >= 2;
		$$('.ld-dong-slot-wrap').forEach(function (wrap) {
			var btn = wrap.querySelector('.ld-dong-slot');
			if (!btn) return;
			var idx = parseInt(wrap.dataset.dongSlot, 10);
			var data = MOCK.dongSlots[idx];
			var foot = wrap.querySelector('.ld-dong-slot__foot');
			wrap.classList.toggle('is-filled', !!data);
			btn.classList.toggle('is-filled', !!data);
			btn.classList.toggle('is-self', !!(data && data.isSelf));
			btn.classList.toggle('is-invite-locked', !data && inviteBlocked);
			btn.disabled = !!(data && data.isSelf) || (!data && inviteBlocked);
			btn.querySelectorAll(
				'.ld-dong-slot__avatar, .ld-dong-slot__name, .ld-dong-slot__self-tag, .ld-dong-slot__kick'
			).forEach(function (n) {
				n.remove();
			});
			if (foot) {
				foot.innerHTML = '';
				foot.hidden = true;
			}
			if (!data) {
				if (inviteBlocked) {
					btn.setAttribute('title', 'Đang luyện — không thể mời Đan Đồng');
				} else {
					btn.removeAttribute('title');
				}
				return;
			}
			if (data.avatarUrl) {
				var im = document.createElement('img');
				im.className = 'ld-dong-slot__avatar';
				im.src = data.avatarUrl;
				im.alt = data.name || '';
				im.decoding = 'async';
				im.referrerPolicy = 'no-referrer';
				btn.appendChild(im);
			} else {
				var av = document.createElement('span');
				av.className = 'ld-dong-slot__avatar ld-dong-slot__avatar--glyph';
				av.textContent = data.avatar || '?';
				av.setAttribute('aria-hidden', 'true');
				btn.appendChild(av);
			}
			if (data.isSelf) {
				var selfTag = document.createElement('span');
				selfTag.className = 'ld-dong-slot__self-tag';
				selfTag.textContent = 'Bạn';
				btn.appendChild(selfTag);
			}
			btn.setAttribute(
				'title',
				data.isSelf ? 'Vai Đan Đồng của bạn' : data.name || 'Đan Đồng'
			);

			if (canOwnerKickDongSlot(data)) {
				var kickBtn = document.createElement('button');
				kickBtn.type = 'button';
				kickBtn.className = 'ld-dong-slot__kick';
				kickBtn.setAttribute('aria-label', 'Trục xuất ' + (data.name || 'Đan Đồng'));
				kickBtn.textContent = '×';
				kickBtn.addEventListener('click', function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					dongKickBuddy(data.userId, data.name);
				});
				btn.appendChild(kickBtn);
			}
			if (foot) {
				var nmFoot = document.createElement('span');
				nmFoot.className = 'ld-dong-slot__name';
				nmFoot.textContent = data.name || 'Đan Đồng';
				foot.appendChild(nmFoot);
				if (data.rankLevelName) {
					var rankEl = document.createElement('span');
					rankEl.className = 'ld-dong-slot__rank';
					rankEl.textContent = data.rankLevelName;
					foot.appendChild(rankEl);
				}
				var dongPct = dongDurationReductionPct(data, MOCK.tier);
				var helpLine = dongSlotDurationHelpText(dongPct, compactHelp);
				if (helpLine) {
					var helpEl = document.createElement('p');
					helpEl.className = 'ld-dong-slot__duration-help';
					helpEl.textContent = helpLine;
					foot.appendChild(helpEl);
				}
				foot.hidden = false;
			}
		});
		if (!isCompanionView()) {
			syncRecipeDurationsFromDong();
			var durEl = $('#ldRecipeDuration');
			if (durEl && MOCK.recipes && MOCK.recipes[MOCK.tier]) {
				var eff = effectiveRecipeDurationSec(MOCK.tier);
				var redPct = recipeDurationReductionTotal(MOCK.tier);
				if (eff > 0) {
					durEl.textContent = formatRecipeDurationLine(eff, redPct);
					durEl.hidden = false;
				}
			}
		}
	}

	function formatRecipeDurationLine(eff, redPct) {
		var line = 'Thời gian luyện: ~' + fmtCraftDuration(eff);
		if (redPct > 0) {
			line += ' · Đã giảm: ' + Math.round(redPct) + '%';
		}
		var minSec =
			MOCK.craftDurationCaps && MOCK.craftDurationCaps.minCraftDurationSec != null
				? MOCK.craftDurationCaps.minCraftDurationSec | 0
				: 600;
		if (minSec > 0 && (eff | 0) <= minSec + 1) {
			line += ' (tối thiểu ' + fmtCraftDuration(minSec) + ')';
		}
		return line;
	}

	function getMatBundles() {
		return Array.isArray(MOCK.matBundles) ? MOCK.matBundles : [];
	}

	function renderInventory() {
		var grid = $('#ldInventory');
		if (!grid) return;
		grid.innerHTML = '';

		var cells = [];

		ELEMENTS.forEach(function (el) {
			var n = MOCK.inventory[el] || 0;
			cells.push({ kind: 'material', element: el, count: n });
		});

		getMatBundles().forEach(function (b) {
			if (!b || !b.bundle_key) return;
			cells.push({
				kind: 'mat_bundle',
				bundle_key: b.bundle_key,
				count: b.qty | 0,
				label: b.label || b.bundle_key,
				image: b.image || '',
				total_units: b.total_units | 0,
			});
		});

		var w = MOCK.currency.danHuanWallet != null ? MOCK.currency.danHuanWallet : 0;
		cells.push({ kind: 'danhuan', count: w, img: danHuanImgSrc() });

		getPillStacks().forEach(function (s) {
			cells.push({ kind: 'pill', tier: s.tier, stars: s.stars, count: s.count });
		});

		cells.forEach(function (c) {
			var node = document.createElement('div');
			if (c.kind === 'material') {
				node.className = 'ld-cell ld-cell--mat' + ((c.count | 0) < 1 ? ' ld-cell--empty' : '');
				node.dataset.kind = 'material';
				node.dataset.element = c.element;
				node.innerHTML =
					'<img src="' +
					matImgFromCatalog(c.element) +
					'" alt="" decoding="async" draggable="false" /><span class="ld-qty">' +
					qty(c.count) +
					'</span>';
			} else if (c.kind === 'pill') {
				node.className =
					'ld-cell ld-cell--pill ld-tier-' +
					c.tier +
					' ld-stars-' +
					(c.stars | 0) +
					'';
				node.dataset.kind = 'pill';
				node.dataset.tier = c.tier;
				node.dataset.stars = String(c.stars);
				var bagFullThisTier = pillBagFull(c.tier);
				node.title =
					(pillModalTitle(c.tier) || '') +
					' ' +
					(c.stars | 0) +
					'★ · túi ' +
					pillBagStored(c.tier) +
					'/' +
					pillBagCap(c.tier) +
					(bagFullThisTier ? ' — ' + pillBagFullTitle(c.tier) : '') +
					' — chạm để xem';
				node.innerHTML =
					'<img src="' + pillImg(c.tier, c.stars) + '" alt="" decoding="async" draggable="false" /><span class="ld-qty">' + qty(c.count) + '</span>';
			} else if (c.kind === 'mat_bundle') {
				node.className = 'ld-cell ld-cell--mat-bundle';
				node.dataset.kind = 'mat_bundle';
				node.dataset.bundleKey = c.bundle_key;
				node.title =
					(c.label || 'Túi linh dược') +
					(c.total_units > 0 ? ' — ' + matBundleOpenHint(c) : '') +
					' — chạm để mở';
				node.innerHTML =
					'<img src="' +
					(c.image || '') +
					'" alt="" decoding="async" draggable="false" /><span class="ld-qty">' +
					qty(c.count) +
					'</span>';
			} else if (c.kind === 'danhuan') {
				node.className = 'ld-cell ld-cell--danhuan ld-cell--currency-bag';
				node.dataset.kind = 'danhuan';
				node.title = 'Đan Huân — chạm xem chi tiết';
				node.innerHTML =
					'<img src="' +
					c.img +
					'" alt="" decoding="async" draggable="false" /><span class="ld-qty">' +
					qty(c.count) +
					'</span>';
			}
			grid.appendChild(node);
		});

		bindGridEvents(grid);
		renderBagPillUsage();
		renderRecipePreview();
	}

	function bindGridEvents(root) {
		$$('.ld-cell--mat', root).forEach(function (cell) {
			if (cell._ldTap) return;
			cell._ldTap = true;
			cell.addEventListener('click', function () {
				openMaterialModal(cell.dataset.element);
			});
		});

		$$('.ld-cell--pill', root).forEach(function (cell) {
			if (cell._ldTap) return;
			cell._ldTap = true;
			cell.addEventListener('click', function () {
				var tier = cell.dataset.tier;
				var stars = parseInt(cell.dataset.stars, 10);
				var stack = getPillStacks().find(function (s) {
					return s.tier === tier && s.stars === stars;
				});
				if (stack) openPillModal(stack);
			});
		});

		$$('.ld-cell--mat-bundle', root).forEach(function (cell) {
			if (cell._ldTap) return;
			cell._ldTap = true;
			cell.addEventListener('click', function () {
				var key = cell.dataset.bundleKey;
				var bundle = getMatBundles().find(function (b) {
					return b.bundle_key === key;
				});
				if (bundle) openMatBundleModal(bundle);
			});
		});

		$$('.ld-cell--danhuan', root).forEach(function (cell) {
			if (cell._ldTap) return;
			cell._ldTap = true;
			cell.addEventListener('click', openCurrencyModal);
		});

	}

	function openModal() {
		$('#ldModalBackdrop').hidden = false;
		$('#ldItemModal').hidden = false;
		document.body.classList.add('ld-modal-open');
		playClick();
	}

	function closeModal() {
		state.modal = null;
		$('#ldModalBackdrop').hidden = true;
		$('#ldItemModal').hidden = true;
		document.body.classList.remove('ld-modal-open');
	}

	function filterDongFriends(raw, q) {
		q = String(q || '')
			.trim()
			.toLowerCase()
			.replace(/\s+/g, ' ');
		if (!q) {
			return raw.slice();
		}
		var qDigits = q.replace(/\D/g, '');
		return raw.filter(function (f) {
			var uid = f.userId != null ? f.userId : parseInt(f.id, 10);
			var name = (f.name || '').toLowerCase();
			if (name.indexOf(q) !== -1) {
				return true;
			}
			if (qDigits && String(uid).indexOf(qDigits) !== -1) {
				return true;
			}
			return false;
		});
	}

	function fillDongFriendList(listEl, friends) {
		listEl.innerHTML = '';
		if (!friends.length) {
			listEl.innerHTML = '<p class="ld-grid-empty">Không tìm thấy đạo hữu phù hợp</p>';
			return;
		}
		friends.forEach(function (f) {
			var uid = f.userId != null ? f.userId : parseInt(f.id, 10);
			var already = MOCK.dongSlots.some(function (s) {
				return s && String(s.userId || s.id) === String(uid);
			});
			if (already) {
				return;
			}

			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'ld-friend';
			var avUrl = f.avatarUrl || '';
			if (avUrl) {
				var avImg = document.createElement('img');
				avImg.className = 'ld-friend__avatar';
				avImg.src = avUrl;
				avImg.alt = '';
				avImg.decoding = 'async';
				btn.appendChild(avImg);
			} else {
				var avSp = document.createElement('span');
				avSp.className = 'ld-friend__avatar';
				avSp.textContent = f.avatar || '??';
				btn.appendChild(avSp);
			}
			var textWrap = document.createElement('span');
			textWrap.className = 'ld-friend__text';
			var nameEl = document.createElement('span');
			nameEl.className = 'ld-friend__name';
			nameEl.textContent = (f.name && String(f.name).trim()) ? f.name : 'Đạo hữu #' + uid;
			textWrap.appendChild(nameEl);
			btn.appendChild(textWrap);
			btn.addEventListener('click', function () {
				sendDongInvite(f);
			});
			listEl.appendChild(btn);
		});

		if (!listEl.children.length) {
			listEl.innerHTML = '<p class="ld-grid-empty">Không tìm thấy đạo hữu phù hợp</p>';
		}
	}

	function renderDongFriendsList(query) {
		var list = $('#ldFriendList');
		if (!list || !state.dongFriendsList) {
			return;
		}
		fillDongFriendList(list, filterDongFriends(state.dongFriendsList, query));
	}

	function openDongModal() {
		var modal = $('#ldDongModal');
		var backdrop = $('#ldModalBackdrop');
		var list = $('#ldFriendList');
		var search = $('#ldDongSearch');
		if (!modal || !list) {
			return;
		}
		state.dongFriendsList = null;
		list.innerHTML = '<p class="ld-grid-empty">Đang tải…</p>';
		if (search) {
			search.value = '';
			if (!search._ldBound) {
				search._ldBound = true;
				search.addEventListener('input', function () {
					renderDongFriendsList(this.value);
				});
			}
		}

		ldJson('/luyen-dan/friends', { method: 'GET' })
			.then(function (body) {
				var friends = (body.data && body.data.friends) || [];
				var av = [];
				friends.forEach(function (f) {
					var uid = f.userId != null ? f.userId : parseInt(f.id, 10);
					var already = MOCK.dongSlots.some(function (s) {
						return s && String(s.userId || s.id) === String(uid);
					});
					if (!already) {
						av.push(f);
					}
				});
				state.dongFriendsList = av;
				if (!av.length) {
					list.innerHTML = '<p class="ld-grid-empty">Không còn đạo hữu khả mời</p>';
				} else {
					renderDongFriendsList(search ? search.value : '');
				}
			})
			.catch(function (e) {
				list.innerHTML = '<p class="ld-grid-empty">Lỗi tải danh sách</p>';
				toast(e.message);
			});

		if (backdrop) {
			backdrop.hidden = false;
		}
		modal.hidden = false;
		document.body.classList.add('ld-modal-open');
		playClick();
	}

	function closeDongModal() {
		$('#ldDongModal').hidden = true;
		var itemOpen = $('#ldItemModal') && !$('#ldItemModal').hidden;
		var inviteOpen = $('#ldInviteModal') && !$('#ldInviteModal').hidden;
		if (!itemOpen && !inviteOpen) {
			$('#ldModalBackdrop').hidden = true;
			document.body.classList.remove('ld-modal-open');
		}
		state.dongSlotIndex = null;
	}

	function sendDongInvite(friend) {
		if (!friend) {
			return;
		}
		if (!canOwnerInviteDong()) {
			toast('Đang luyện — không thể mời Đan Đồng thêm', 'error');
			return;
		}
		var bid = friend.userId != null ? friend.userId : parseInt(friend.id, 10);
		var nm = String(friend.name || '').trim() || 'Đạo hữu #' + bid;
		showConfirm({
			title: 'Mời Đan Đồng',
			message: 'Xác nhận mời 「' + nm + '」làm Đan Đồng?',
			confirmLabel: 'Mời',
			cancelLabel: 'Hủy',
		}).then(function (ok) {
			if (!ok) {
				return;
			}
			playClick();
			closeDongModal();
			ldJson('/luyen-dan/dong/invite', { method: 'POST', body: { buddy_id: bid } })
				.then(function (body) {
					applyServerPayload(body.data);
					renderDongSlots();
					toast('Đã gửi lời mời Đan Đồng');
				})
				.catch(function (e) {
					toast(e.message);
				});
		});
	}

	function closeInviteModal() {
		$('#ldInviteBackdrop').hidden = true;
		$('#ldInviteModal').hidden = true;
		MOCK._inviteOwnerId = null;
		closeDongInvitesListModal();
	}

	function acceptDongInvite() {
		var oid = MOCK._inviteOwnerId;
		if (!oid) {
			closeInviteModal();
			return;
		}
		playClick();
		ldJson('/luyen-dan/dong/respond', { method: 'POST', body: { owner_id: oid, accept: true } })
			.then(function (body) {
				closeInviteModal();
				closeDongInvitesListModal();
				if (body && body.data) {
					applyServerPayload(body.data);
					syncDongUi();
				}
				MOCK.dongInvitesIn = [];
				MOCK.incomingInvite = null;
				MOCK.dongInviteCount = 0;
				syncDongNotif();
				toast('Đã nhận làm Đan Đồng', 'ok');
				return refreshState();
			})
			.catch(function (e) {
				toast(e.message);
			});
	}

	function openMatBundleLootModal(bundleLabel, granted) {
		setLootRewardModalMode('bundle');
		var preview = $('#ldDecomposeRewardPreview');
		if (preview) {
			preview.hidden = true;
			preview.innerHTML = '';
		}
		var sub = $('#ldDecomposeRewardSub');
		if (sub) {
			sub.textContent = bundleLabel || '';
		}
		var summary = $('#ldDecomposeLootSummary');
		if (summary) {
			summary.hidden = true;
			summary.textContent = '';
		}
		var grid = $('#ldDecomposeLootGrid');
		if (grid) grid.innerHTML = '';
		var backdrop = $('#ldDecomposeRewardBackdrop');
		var modal = $('#ldDecomposeRewardModal');
		if (backdrop) backdrop.hidden = false;
		if (modal) modal.hidden = false;
		document.body.classList.add('ld-decompose-reward-open');
		state.decomposeRewardOpen = true;
		runDecomposeLootReveal(decomposeRefundItems({ materials: granted || {} }));
	}

	function openMatBundleModal(bundle) {
		bundle = bundle || {};
		state.modal = { type: 'mat_bundle', bundle: bundle };
		var preview = $('#ldModalPreview');
		var title = $('#ldModalTitle');
		var body = $('#ldModalBody');
		var actions = $('#ldModalActions');
		var label = bundle.label || 'Túi linh dược';
		var units = bundle.total_units | 0;

		if (preview) {
			preview.hidden = false;
			preview.innerHTML =
				'<img class="ld-modal__preview-img" src="' +
				(bundle.image || '') +
				'" alt="" decoding="async" />';
		}
		if (title) title.textContent = label;
		if (body) {
			body.innerHTML =
				'<dl class="ld-info">' +
				'<dt>Số lượng trong túi</dt><dd>' +
				qty(bundle.qty | 0) +
				'</dd>' +
				(units > 0
					? '<dt>Tổng viên khi mở</dt><dd>' + matBundleOpenHint(bundle) + '</dd>'
					: '') +
				'<dt>Nhận ở đâu</dt><dd class="ld-info__source">' + ldTuBaoCacSourceHtml() + '</dd>' +
				'</dl>' +
				(!bundle.is_daily
					? '<p class="ld-modal__hint">Mở túi để nhận ngẫu nhiên linh dược ngũ hành.</p>'
					: '');
		}
		if (actions) {
			actions.innerHTML =
				'<button type="button" class="ld-modal-btn ld-modal-btn--use" id="ldModalOpenBundle">Mở túi</button>' +
				'<button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>';
			$('#ldModalOpenBundle').addEventListener('click', function () {
				ldJson('/luyen-dan/open-mat-bundle', {
					method: 'POST',
					body: { bundle_key: String(bundle.bundle_key || '') },
				})
					.then(function (body) {
						applyServerPayload(body.data);
						closeModal();
						openMatBundleLootModal(label, body.granted);
					})
					.catch(function (e) {
						toast(e.message);
					});
			});
			$('#ldModalCloseBtn').addEventListener('click', closeModal);
		}
		openModal();
	}

	function openMaterialModal(element, opts) {
		opts = opts || {};
		var n = MOCK.inventory[element] || 0;
		state.modal = { type: 'material', element: element };
		var mats = (MOCK.itemCatalog && MOCK.itemCatalog.materials) || {};
		var row = mats[element] || {};
		var label = row.label || ELEMENT_LABELS[element] || element;
		var preview = $('#ldModalPreview');
		var title = $('#ldModalTitle');
		var body = $('#ldModalBody');
		var actions = $('#ldModalActions');
		var vec = opts.fromRecipe ? tierVector(MOCK.tier) : null;
		var need = vec && vec[element] != null ? vec[element] | 0 : 0;

		if (preview) {
			preview.hidden = false;
			preview.innerHTML =
				'<img class="ld-modal__preview-img" src="' +
				matImgFromCatalog(element) +
				'" alt="" decoding="async" />';
		}
		if (title) title.textContent = label;
		if (body) {
			body.innerHTML =
				'<dl class="ld-info">' +
				'<dt>Loại</dt><dd>Nguyên liệu Ngũ Hành</dd>' +
				(opts.fromRecipe && need > 0
					? '<dt>Cần cho mẻ luyện</dt><dd>' + qty(need) + ' viên</dd>'
					: '') +
				'<dt>Số lượng trong túi</dt><dd>' +
				qty(n) +
				'</dd>' +
				'<dt>Nhận ở đâu</dt><dd class="ld-info__source">' + ldTuBaoCacSourceHtml() + '</dd>' +
				(!opts.fromRecipe
					? '<dt class="ld-info__dt-sub">Khác</dt><dd class="ld-info__dd-sub">Phân giải đan trong túi</dd>'
					: '') +
				'</dl>';
		}
		if (actions) {
			actions.innerHTML =
				'<button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>';
			$('#ldModalCloseBtn').addEventListener('click', closeModal);
		}
		openModal();
	}

	function openRecipePillInfoModal(tier, stars) {
		stars = stars | 0;
		tier = tier || MOCK.tier;
		var tv = pillTuVi(tier, stars);
		state.modal = { type: 'recipe_pill', tier: tier, stars: stars };
		var preview = $('#ldModalPreview');
		var title = $('#ldModalTitle');
		var body = $('#ldModalBody');
		var actions = $('#ldModalActions');

		if (preview) {
			preview.hidden = false;
			preview.innerHTML =
				'<img class="ld-modal__preview-img" src="' +
				pillImg(tier, stars) +
				'" alt="" decoding="async" />';
		}
		if (title) {
			title.textContent = pillModalTitle(tier) + ' · ' + stars + '★';
		}
		if (body) {
			body.innerHTML =
				'<dl class="ld-info ld-info--pill">' +
				'<dt>Dược khí</dt><dd>' +
				stars +
				' sao · ' +
				escHtml(pillStarLabel(stars)) +
				'</dd>' +
				'<dt>Tu Vi khi sử dụng</dt><dd class="ld-info__tu-vi">' +
				formatPillTuViLine(tv) +
				'</dd>' +
				'<dt>Nhận ở đâu</dt><dd>Luyện đan tại <strong>Luyện Đan Đường</strong></dd>' +
				'</dl>' +
				'<p class="ld-modal__hint ld-modal__hint--recipe-pill">Dược khí 1★–4★ ngẫu nhiên khi Thu; sao càng cao, Tu Vi càng nhiều.</p>';
		}
		if (actions) {
			actions.innerHTML =
				'<button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>';
			$('#ldModalCloseBtn').addEventListener('click', closeModal);
		}
		openModal();
	}

	function openPillModal(stack, opts) {
		opts = opts || {};
		var viewOnly = !!(opts.viewOnly || opts.fromCollect);
		state.modal = { type: 'pill', stack: stack, viewOnly: viewOnly };
		var tv = pillTuVi(stack.tier, stack.stars);
		var preview = $('#ldModalPreview');
		var title = $('#ldModalTitle');
		var body = $('#ldModalBody');
		var actions = $('#ldModalActions');

		if (preview) {
			preview.hidden = false;
			preview.innerHTML =
				'<img class="ld-modal__preview-img" src="' +
				pillImg(stack.tier, stack.stars) +
				'" alt="" decoding="async" />';
		}
		if (title) title.textContent = pillModalTitle(stack.tier);
		if (body) {
			var usageHtml = pillUsageBlock(stack.tier);
			var bagHtml = pillBagBlock(stack.tier);
			body.innerHTML =
				'<dl class="ld-info ld-info--pill">' +
				'<dt>Dược khí</dt><dd>' +
				stack.stars +
				' sao</dd>' +
				'<dt>Số lượng ô này</dt><dd>' +
				qty(stack.count) +
				'</dd>' +
				(bagHtml ? '<dt>Đan trong túi (phẩm)</dt><dd>' + bagHtml + '</dd>' : '') +
				'<dt>Tu Vi / lần dùng</dt><dd class="ld-info__tu-vi">' +
				formatPillTuViLine(tv) +
				'</dd>' +
				(usageHtml
					? '<dt>Đã sử dụng tháng này</dt><dd>' + usageHtml + '</dd>'
					: '') +
				'</dl>' +
				(viewOnly
					? '<p class="ld-modal__hint ld-modal__hint--pill-collect">Đan đã vào túi — mở ô đan trong <strong>Túi</strong> bên dưới để Sử dụng hoặc Phân giải.</p>'
					: '');
		}
		if (actions) {
			if (viewOnly) {
				actions.innerHTML =
					'<button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>';
				$('#ldModalCloseBtn').addEventListener('click', closeModal);
			} else {
			actions.innerHTML =
				'<button type="button" class="ld-modal-btn ld-modal-btn--use" id="ldModalUse">Sử dụng</button>' +
				'<button type="button" class="ld-modal-btn ld-modal-btn--decompose" id="ldModalDecompose">Phân giải</button>' +
				'<button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>';
			$('#ldModalUse').addEventListener('click', function () {
				confirmUsePill(stack).then(function (ok) {
					if (!ok) return;
					var pid = pillStackId(stack);
					ldJson('/luyen-dan/use-pill', { method: 'POST', body: { pill_id: String(pid) } })
						.then(function (body) {
							applyServerPayload(body.data);
							closeModal();
							renderInventory();
							runUsePillHaloEffect(stack, function () {
								openUsePillRewardModal(stack, body.use);
							});
						})
						.catch(function (e) {
							toast(e.message);
						});
				});
			});
			$('#ldModalDecompose').addEventListener('click', function () {
				confirmDecomposePill(stack).then(function (ok) {
					if (!ok) return;
					var pid = pillStackId(stack);
					ldJson('/luyen-dan/decompose', { method: 'POST', body: { pill_id: String(pid) } })
						.then(function (body) {
							applyServerPayload(body.data);
							syncRank();
							closeModal();
							renderInventory();
							openDecomposeRewardModal(stack, body.decompose);
						})
						.catch(function (e) {
							toast(e.message);
						});
				});
			});
			$('#ldModalCloseBtn').addEventListener('click', closeModal);
			}
		}
		openModal();
	}

	function openCurrencyModal() {
		state.modal = { type: 'currency' };

		var w = MOCK.currency.danHuanWallet != null ? MOCK.currency.danHuanWallet : 0;
		var dhLabel =
			(MOCK.itemCatalog && MOCK.itemCatalog.dan_huan && MOCK.itemCatalog.dan_huan.label) || 'Đan Huân';

		var preview = $('#ldModalPreview');
		if (preview) {
			preview.hidden = false;
			preview.innerHTML =
				'<img class="ld-modal__preview-img ld-modal__preview-img--danhuan" src="' +
				danHuanImgSrc() +
				'" alt="Đan Huân" decoding="async" />';
		}
		if ($('#ldModalTitle')) $('#ldModalTitle').textContent = dhLabel;

		if ($('#ldModalBody')) {
			$('#ldModalBody').innerHTML =
				'<div class="ld-danhuan-card">' +
				'<p class="ld-danhuan-card__qty">Số lượng: <strong>' +
				qty(w) +
				'</strong></p>' +
				'<p class="ld-danhuan-card__use">Dùng để đổi khung, danh hiệu,... trong tương lai.</p>' +
				'</div>';
		}

		if ($('#ldModalActions')) {
			$('#ldModalActions').innerHTML =
				'<button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>';
			$('#ldModalCloseBtn').addEventListener('click', closeModal);
		}

		openModal();
	}

	function initModal() {


		$('#ldModalClose').addEventListener('click', closeModal);


		$('#ldModalBackdrop').addEventListener('click', closeModal);


		$('#ldDongModalClose').addEventListener('click', closeDongModal);


		$('#ldInviteAccept').addEventListener('click', acceptDongInvite);


		$('#ldInviteReject').addEventListener('click', function () {


			var oid = MOCK._inviteOwnerId;


			if (oid) {


				ldJson('/luyen-dan/dong/respond', {
					method: 'POST',
					body: { owner_id: oid, accept: false },
				})
					.then(function (body) {
						if (body && body.data) {
							applyServerPayload(body.data);
							syncDongUi();
						}
					})
					.catch(function () {});
			} else {
				MOCK.incomingInvite = null;
				MOCK.dongInviteCount = Math.max(0, (MOCK.dongInviteCount | 0) - 1);
				syncDongNotif();
			}

			closeInviteModal();
			toast('Đã từ chối lời mời');


			playClick();


		});
		$('#ldInviteBackdrop').addEventListener('click', closeInviteModal);

		var dongInvClose = $('#ldDongInvitesClose');
		var dongInvBackdrop = $('#ldDongInvitesBackdrop');
		if (dongInvClose) dongInvClose.addEventListener('click', closeDongInvitesListModal);
		if (dongInvBackdrop) dongInvBackdrop.addEventListener('click', closeDongInvitesListModal);
	}

	function doStartCraftRequest() {
		if (state.craftRequestBusy) return;
		state.craftRequestBusy = true;
		syncButtons();

		playStartCraftSfx();

		ldJson('/luyen-dan/start', { method: 'POST', body: { tier: MOCK.tier } })
			.then(function (body) {
				stopTimerTick();
				applyServerPayload(body.data);
				renderInventory();
				renderDongSlots();
				syncDongUi();
				renderDongForMeList();
				syncRank();
				syncButtons();
				syncStability();
				syncTimer();
				syncTierTabsUi();
				startTimerTick();
				startServerPoll();
				toast('Khai lô — linh hỏa bốc lên', 'ok');
			})
			.catch(function (e) {
				toast(e.message, 'error');
			})
			.then(function () {
				state.craftRequestBusy = false;
				syncButtons();
			});
	}

	function startCraft() {
		if (isCompanionView()) {
			toast('Bạn đang là Đan Đồng — không thể tự khai ' + LD_FURNACE_LABEL, 'error');
			return;
		}
		if (MOCK.dongLocked) {
			toast('Đang là Đan Đồng — rời vai trước khi tự luyện', 'error');
			return;
		}
		if (pillBagFull(MOCK.tier)) {
			toast(pillBagFullMessage(MOCK.tier), 'error');
			return;
		}
		if (!recipeComplete()) {
			toast('Chưa đủ linh dược', 'error');
			return;
		}
		if (MOCK.furnace === 'exploded') {
			toast('Hãy xác nhận nổ ' + LD_FURNACE_LABEL + ' trước', 'error');
			return;
		}
		if (state.craftRequestBusy) return;

		var tierLabel = TIER_LABELS[MOCK.tier] || MOCK.tier;
		var tnCost = recipeTienNgocCost(MOCK.tier);
		showConfirm({
			title: 'Khai ' + LD_FURNACE_LABEL + ' luyện đan',
			message:
				'Dùng linh dược Ngũ Hành trong túi theo công thức 「' +
				tierLabel +
				'」, xác nhận dùng ' +
				tnCost +
				' Tiên Ngọc để bắt đầu luyện?',
			confirmLabel: 'Luyện đan',
			cancelLabel: 'Hủy',
		}).then(function (ok) {
			if (!ok) return;
			playClick();
			runMaterialTossAnimation(function () {
				doStartCraftRequest();
			});
		});
	}

	function collectDan() {
		if (MOCK.furnace !== 'ready' || !MOCK.craftJobId || state.collectBusy) return;
		if (pillBagFull(MOCK.tier)) {
			toast(pillBagFullMessage(MOCK.tier), 'error');
			return;
		}

		state.collectBusy = true;
		var colBtn = $('#ldBtnCollect');
		if (colBtn) {
			colBtn.disabled = true;
			colBtn.classList.add('is-disabled');
			colBtn.setAttribute('aria-busy', 'true');
		}
		var beforeStacks = snapshotPillStackMap();

		var core = document.querySelector('.ld-furnace-core');
		var img = $('#ldFurnaceImg');
		if (img) img.src = FURNACE_IMG.ready;
		if (core) {
			core.classList.remove('is-collect-dramatic');
			void core.offsetWidth;
			core.classList.add('is-collect-dramatic');
		}
		syncButtons();

		playCollectSfx();

		window.setTimeout(function () {
			ldJson('/luyen-dan/collect', { method: 'POST', body: { job_id: MOCK.craftJobId } })
				.then(function (body) {
					if (colBtn) {
						colBtn.disabled = true;
						colBtn.classList.add('is-disabled');
					}
					stopTimerTick();
					stopServerPoll();
					applyServerPayload(body.data);
					renderInventory();
					renderDongSlots();
					syncRank();
					renderRecipePreview();
					syncButtons();
					syncStability();
					syncTimer();
					syncTierTabsUi();

					if (core) core.classList.remove('is-collect-dramatic');

					var newPill = diffCollectedPill(beforeStacks);
					var lc = body.data && body.data.last_collect ? body.data.last_collect : null;
					var xpNote =
						lc && lc.rank_xp_gained
							? ' · +' + fmtTuVi(lc.rank_xp_gained | 0) + ' XP nghề'
							: '';
					if (newPill) {
						runPillFlyToBag(newPill, function () {
							openPillModal(
								{
									tier: newPill.tier,
									stars: newPill.stars | 0,
									count: newPill.count | 0,
								},
								{ fromCollect: true }
							);
							if (xpNote) {
								toast('Thu đan ' + (newPill.stars | 0) + '★' + xpNote, 'ok');
							}
						});
					} else {
						toast('Thu đan vào túi' + xpNote, 'ok');
					}
					var mi = body.data && body.data.marquee_item ? body.data.marquee_item : null;
					if (mi) pushLdMarqueeItem(mi);
				})
				.catch(function (e) {
					if (core) core.classList.remove('is-collect-dramatic');
					toast(e.message, 'error');
				})
				.then(function () {
					state.collectBusy = false;
					syncButtons();
				});
		}, 3000);
	}

	function applyTunePayload(d) {
		if (!d) return;
		if (d.craft && d.craft.id) {
			MOCK.craftJobId = d.craft.id;
			var tunePct =
				typeof d.craft.stability_pct === 'number'
					? d.craft.stability_pct
					: parseFloat(d.craft.stability_pct) || MOCK.stability;
			markStabilityFromServer(tunePct);
			applyCraftMetaFromPayload(d.craft);
			MOCK.unstableLeftSec =
				d.craft.unstable_left_sec != null
					? Math.max(0, parseInt(d.craft.unstable_left_sec, 10) || 0)
					: MOCK.unstableLeftSec;
			applyCraftMetaFromPayload(d.craft);
			MOCK.tuneCooldownLeft =
				d.craft.tune_cooldown_left_sec != null
					? Math.max(0, parseInt(d.craft.tune_cooldown_left_sec, 10) || 0)
					: 0;
			if (d.craft.finish_at_ts > 0 && d.craft.server_now_ts != null) {
				MOCK.craftFinishTs = d.craft.finish_at_ts | 0;
				MOCK.clockSkewSec = (d.craft.server_now_ts | 0) - Math.floor(Date.now() / 1000);
				MOCK.timerLeft = getCraftSecondsLeft();
			}
		}
		if (d.dan_huan_wallet != null) {
			MOCK.currency.danHuanWallet = d.dan_huan_wallet | 0;
		}
		if (d.dan_huan_cap != null) {
			MOCK.currency.danHuanCap = Math.max(0, d.dan_huan_cap | 0);
		}
		if (d.dan_huan_tune_used != null) {
			MOCK.currency.danHuanTuneUsed = Math.max(0, d.dan_huan_tune_used | 0);
		}
		var tr = d.tune_reward;
		if (tr) {
			if (tr.daily_cap != null) {
				MOCK.currency.danHuanCap = Math.max(0, tr.daily_cap | 0);
			}
			if (tr.daily_used != null) {
				MOCK.currency.danHuanTuneUsed = Math.max(0, tr.daily_used | 0);
			}
		}
	}

	function tuneFire() {
		if (MOCK.furnace !== 'crafting') return;
		if (isStableCraftPhase()) {
			toast('Lửa đã ổn định — không cần điều hỏa', 'error');
			return;
		}
		if (MOCK.stability >= 99.99) {
			toast('Lửa đang ổn định, chưa cần thiết lắm', 'error');
			return;
		}
		if ((MOCK.tuneCooldownLeft | 0) > 0 || state.tuningInFlight) return;

		state.tuningInFlight = true;
		syncButtons();
		playTuneSfx();

		ldJson('/luyen-dan/tune', { method: 'POST', body: {} })

			.then(function (body) {
				var prevSurvival = isTuneSurvivalActive();
				applyTunePayload(body.data);
				syncStability();
				syncTimer();
				syncButtons();
				if (!prevSurvival && isTuneSurvivalActive()) {
					toast(
						'Đã giữ lửa đủ ' +
							(MOCK.tuneSurvivalMin | 0) +
							' lần — ' +
							LD_FURNACE_LABEL +
							' an toàn không lo nổ lò.',
						'ok'
					);
				} else if (body.data && body.data.tune_effective === false) {
					toast(
						'Lửa còn cao — lần này không tính vào mốc giữ lò (cần từ ' +
							Math.round(
								body.data.tune_effective_max_pct != null
									? body.data.tune_effective_max_pct
									: MOCK.tuneEffectiveMaxPct
							) +
							'% trở xuống)',
						'ok'
					);
				} else if (body.data && body.data.tune_effective && !isTuneSurvivalActive()) {
					toast('Giữ lửa: ' + tuneSurvivalProgressLabel(), 'ok');
				}
				var tr = body.data && body.data.tune_reward;
				if (tr && (tr.granted_bag | 0) > 0) {
					toast(tuneDanHuanGrantedToast(tr.granted_bag, tr, body.data), 'ok');
				} else if (
					tr &&
					tr.no_reward &&
					tr.message &&
					body.data &&
					body.data.tune_huan_eligible === false
				) {
					toast(tr.message, 'ok');
				} else if (tr && tr.no_reward && tr.message && tr.reward_skip !== 'craft_cap') {
					toast(tr.message, 'error');
				} else {
					toast('Điều hỏa thành công', 'ok');
				}
			})

			.catch(function (e) {
				toast(String(e.message || 'Điều hỏa thất bại'), 'error');
			})

			.then(function () {
				state.tuningInFlight = false;
				syncButtons();
			});
	}

	function startTimerTick() {


		stopTimerTick();


		state.timerId = setInterval(function () {


			if (MOCK.furnace !== 'crafting') return;


			if (MOCK.craftFinishTs) {
				MOCK.timerLeft = getCraftSecondsLeft();
			} else {
				MOCK.timerLeft = Math.max(0, MOCK.timerLeft - 1);
			}


			if ((MOCK.unstableLeftSec | 0) > 0) {
				var prevUx = MOCK.unstableLeftSec | 0;
				MOCK.unstableLeftSec = Math.max(0, MOCK.unstableLeftSec - 1);
				if (prevUx > 0 && (MOCK.unstableLeftSec | 0) === 0) {
					state.stablePhaseConfirmed = false;
					scheduleRefreshState(80);
					onUnstablePhaseEnded(MOCK.craftOwnerUserId || (MOCK.dongServing && MOCK.dongServing.owner_id));
				}
				tickLocalStabilityDrain();
				syncStability();
				syncButtons();
			}


			if ((MOCK.tuneCooldownLeft | 0) > 0) {


				MOCK.tuneCooldownLeft = Math.max(0, MOCK.tuneCooldownLeft - 1);


				syncButtons();


			}


			syncTimer();


			if (MOCK.timerLeft <= 0) {


				refreshState();


			}


		}, 1000);


	}

	function stopTimerTick() {
		if (state.timerId) clearInterval(state.timerId);
		state.timerId = null;
	}

	function initTierTabs() {
		$$('.ld-recipe-tier').forEach(function (tab) {
			tab.addEventListener('click', function () {
				if (MOCK.furnace !== 'idle') {
					toast('Không đổi công thức khi đang luyện');


					return;


				}
				var nextTier = tab.dataset.tier;
				if (!recipeCraftUnlocked(nextTier)) {
					toast(ldCraftGateMsg(nextTier));
					return;
				}
				MOCK.tier = nextTier;


				syncTierTabsUi();


				renderRecipePreview();
				renderDongSlots();


				playClick();


			});


		});


	}


	function initDongSlots() {
		$$('.ld-dong-slot-wrap').forEach(function (wrap) {
			var btn = wrap.querySelector('.ld-dong-slot');
			if (!btn) return;
			btn.addEventListener('click', function () {
				var idx = parseInt(wrap.dataset.dongSlot, 10);
				if (MOCK.dongSlots[idx]) {
					if (MOCK.dongSlots[idx].isSelf) {
						playClick();
						return;
					}
					playClick();
					return;
				}
				if (!canOwnerInviteDong()) {
					toast('Đang luyện — không thể mời Đan Đồng thêm', 'error');
					playClick();
					return;
				}
				state.dongSlotIndex = idx;
				openDongModal();
			});
		});
	}

	function initActions() {
		var bCraft = $('#ldBtnCraft');
		var bCol = $('#ldBtnCollect');
		var bTune = $('#ldBtnTune');
		if (bCraft) bCraft.addEventListener('click', startCraft);
		if (bCol) bCol.addEventListener('click', collectDan);
		if (bTune) bTune.addEventListener('click', tuneFire);
	}

	function initAdminPanel() {
		if (!cfg.canManageOptions) return;


		var fab = $('#ldAdminFab');


		var modal = $('#ldAdminModal');


		var bd = $('#ldAdminBackdrop');


		var btnClose = $('#ldAdminModalClose');


		var btnMats = $('#ldAdminBulkMats');


		var btnHuan = $('#ldAdminGrantHuan');
		var btnRank = $('#ldAdminSetRank');

		var btnReset = $('#ldAdminResetLd');
		var btnRebuild = $('#ldAdminRebuildSchema');

		var chkDong = $('#ldAdminWipeDong');

		var msg = $('#ldAdminMsg');

		if (!fab || !modal || !bd || !btnMats || !btnHuan || !btnReset) return;


		function setAdminMsg(t) {
			if (msg) msg.textContent = t || '';
		}


		function openAdminModal() {


			modal.hidden = false;


			bd.hidden = false;


			document.body.classList.add('ld-modal-open');


			fab.setAttribute('aria-expanded', 'true');


			setAdminMsg('');


			btnClose.focus();


		}


		function closeAdminModal() {


			modal.hidden = true;


			bd.hidden = true;


			document.body.classList.remove('ld-modal-open');


			fab.setAttribute('aria-expanded', 'false');


		}


		fab.setAttribute('aria-expanded', 'false');


		fab.addEventListener('click', openAdminModal);


		if (btnClose) btnClose.addEventListener('click', closeAdminModal);


		bd.addEventListener('click', closeAdminModal);


		var fr = modal.querySelector('.ld-modal__frame');


		if (fr) {


			fr.addEventListener('click', function (ev) {


				ev.stopPropagation();


			});


		}


		btnMats.addEventListener('click', function () {


			var uidEl = $('#ldAdminTargetUser');


			var amtEl = $('#ldAdminBulkAmt');


			var uid = uidEl ? parseInt(uidEl.value, 10) : 0;


			var amt = amtEl ? parseInt(amtEl.value, 10) : 0;


			if (!uid || amt < 1) {


				toast('Nhập User ID và số lượng hợp lệ.');


				return;


			}


			setAdminMsg('Đang xử lý…');


			ldJson('/luyen-dan/admin/grant', {


				method: 'POST',


				body: { target_user_id: uid, bulk_all: amt },


			})


				.then(function () {


					setAdminMsg('Đã cộng linh dược cho user #' + uid + '.');


					toast('Đã cộng linh dược.');


					if (cfg.userId == uid) refreshState();


				})


				.catch(function (e) {


					setAdminMsg('');


					toast(e.message || 'Lỗi');


				});


		});


		if (btnRank) {
			btnRank.addEventListener('click', function () {
				var uidEl = $('#ldAdminTargetUser');
				var lvEl = $('#ldAdminRankLevel');
				var uid = uidEl ? parseInt(uidEl.value, 10) : 0;
				var lv = lvEl ? parseInt(lvEl.value, 10) : 0;
				if (!uid || lv < 1 || lv > 20) {
					toast('Nhập User ID và cấp 1–20.');
					return;
				}
				setAdminMsg('Đang đặt cấp nghề…');
				ldJson('/luyen-dan/admin/grant', {
					method: 'POST',
					body: { target_user_id: uid, rank_level: lv },
				})
					.then(function (body) {
						var r = body.rank || {};
						var msg =
							'User #' +
							uid +
							': ' +
							(r.level_name || 'bậc ' + lv) +
							' (level ' +
							(r.level | 0) +
							', rank_xp ' +
							(r.xp_total != null ? fmtTuVi(r.xp_total) : '—') +
							').';
						setAdminMsg(msg);
						toast('Đã đặt cấp nghề.', 'ok');
						if (cfg.userId == uid) refreshState();
					})
					.catch(function (e) {
						setAdminMsg('');
						toast(e.message || 'Lỗi', 'error');
					});
			});
		}

		btnHuan.addEventListener('click', function () {


			var uidEl = $('#ldAdminTargetUser');


			var hEl = $('#ldAdminHuanAmt');


			var uid = uidEl ? parseInt(uidEl.value, 10) : 0;


			var h = hEl ? parseInt(hEl.value, 10) : 0;


			if (!uid || h < 1) {


				toast('Nhập User ID và Đan Huân > 0.');


				return;


			}


			setAdminMsg('Đang xử lý…');


			ldJson('/luyen-dan/admin/grant', {


				method: 'POST',


				body: { target_user_id: uid, dan_huan_wallet_add: h },


			})


				.then(function () {


					setAdminMsg('Đã cộng Đan Huân túi cho user #' + uid + '.');


					toast('Đã cộng Đan Huân.');


					if (cfg.userId == uid) refreshState();


				})


				.catch(function (e) {


					setAdminMsg('');


					toast(e.message || 'Lỗi');


				});


		});


		btnReset.addEventListener('click', function () {


			var uidEl = $('#ldAdminTargetUser');


			var uid = uidEl ? parseInt(uidEl.value, 10) : 0;


			if (!uid) {


				toast('Chọn User ID.');


				return;


			}


			var wd = !!(chkDong && chkDong.checked);


			var cnf = window.confirm(
				'RESET Luyện Đan cho user #' +
					uid +
					'? Xóa bảng túi (bag), mẻ craft, reset XP/pity/daily trên bảng player' +
					(wd ? '; xóa luôn toàn bộ quan hệ Đan Đồng của user đó.' : '.')
			);


			if (!cnf) return;


			setAdminMsg('Đang reset…');


			ldJson('/luyen-dan/admin/reset-testing', {


				method: 'POST',


				body: { target_user_id: uid, wipe_dong: wd },


			})


				.then(function () {


					setAdminMsg('Đã reset xong.');


					toast('Đã reset Luyện Đan (test).');


					if (cfg.userId == uid) refreshState();


					closeAdminModal();


				})


				.catch(function (e) {


					setAdminMsg('');


					toast(e.message || 'Lỗi reset');


				});
		});

		if (btnRebuild) {
			btnRebuild.addEventListener('click', function () {
				var cnf = window.confirm(
					'DROP và tạo lại TOÀN BỘ bảng Luyện Đan (player, bag, craft, usage, dong)? Mọi dữ liệu test sẽ mất.'
				);
				if (!cnf) return;
				setAdminMsg('Đang tạo lại bảng…');
				ldJson('/luyen-dan/admin/reset-testing', {
					method: 'POST',
					body: { rebuild_schema: true },
				})
					.then(function (body) {
						setAdminMsg(body.message || 'Đã tạo lại bảng v5.');
						toast('Đã DROP & tạo lại bảng DB', 'ok');
						refreshState();
					})
					.catch(function (e) {
						setAdminMsg('');
						toast(e.message || 'Lỗi tạo lại bảng');
					});
			});
		}
	}

	function bindUiSounds() {
		$$(
			'.ld-recipe-tier, .ld-btn-splash, .ld-header__back, .ld-dong-slot, .ld-modal__close, .ld-quick-btn, .ld-dong-invite-row__btn, .ld-admin-fab'
		).forEach(bindClickSound);
	}

	function initDongNotif() {
		var bell = $('#ldDongNotif');
		if (!bell) return;
		bell.addEventListener('click', openDongInviteFromBell);
	}

	var ldMarqueeItems = [];
	var ldMarqueeSeen = {};

	function ldMarqueeItemInner(it) {
		if (it && it.html) {
			return String(it.html);
		}
		return escHtml(it && it.text ? String(it.text) : '');
	}

	function ldMarqueeChunkHtml(items) {
		var html = '';
		items.forEach(function (it, i) {
			if (i) html += '<span class="ld-marquee__sep" aria-hidden="true"> ◆ </span>';
			var hl = it && it.highlight ? ' is-highlight' : '';
			html +=
				'<span class="ld-marquee__item' +
				hl +
				'">' +
				ldMarqueeItemInner(it) +
				'</span>';
		});
		return html;
	}

	function applyLdMarqueeTiming() {
		var track = $('#ldMarqueeTrack');
		if (!track) return;

		var measure = function () {
			var inner = track.querySelector('.ld-marquee__inner');
			if (!inner) return;

			var w = inner.scrollWidth || inner.offsetWidth || 0;
			var count = inner.querySelectorAll('.ld-marquee__item').length;
			if (count < 1) count = 1;

			// ~38px/s — đủ chậm để đọc; tối thiểu theo số tin + theo độ dài dòng.
			var pxPerSec = 38;
			var byWidth = w > 0 ? w / pxPerSec : 0;
			var byCount = 14 + count * 5.5;
			var sec = Math.max(byCount, byWidth, 22);
			sec = Math.min(100, sec);

			track.style.setProperty('--ld-marquee-duration', sec.toFixed(1) + 's');
		};

		requestAnimationFrame(function () {
			requestAnimationFrame(measure);
		});
	}

	function renderLdMarquee() {
		var track = $('#ldMarqueeTrack');
		if (!track) return;
		var fallback = [
			{
				text: 'Chào mừng đạo hữu đến với Luyện Đan Đường, chúc đạo hữu may mắn.',
				highlight: false,
			},
		];
		var items = ldMarqueeItems.length ? ldMarqueeItems : fallback;
		var chunk = ldMarqueeChunkHtml(items);
		track.innerHTML =
			'<div class="ld-marquee__inner">' +
			chunk +
			'</div><div class="ld-marquee__inner" aria-hidden="true">' +
			chunk +
			'</div>';
		applyLdMarqueeTiming();
	}

	function pushLdMarqueeItem(item) {
		if (!item || !item.text) return;
		var id = item.id ? String(item.id) : '';
		if (id && ldMarqueeSeen[id]) return;
		if (id) ldMarqueeSeen[id] = true;
		ldMarqueeItems.unshift(item);
		if (ldMarqueeItems.length > 30) ldMarqueeItems.length = 30;
		renderLdMarquee();
	}

	function onCollectAnnounced(data) {
		if (data && data.text) pushLdMarqueeItem(data);
	}

	function initLdMarquee() {
		var track = $('#ldMarqueeTrack');
		if (!track) return;
		var seed = cfg.marqueeItems;
		if (Array.isArray(seed) && seed.length) {
			ldMarqueeItems = seed.slice();
			ldMarqueeSeen = {};
			ldMarqueeItems.forEach(function (it) {
				if (it && it.id) ldMarqueeSeen[String(it.id)] = true;
			});
		}
		applyLdMarqueeTiming();

		var resizeTimer = null;
		window.addEventListener('resize', function () {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(applyLdMarqueeTiming, 200);
		});

		track.addEventListener('mouseenter', function () {
			track.classList.add('is-paused');
		});
		track.addEventListener('mouseleave', function () {
			track.classList.remove('is-paused');
		});
	}

	function init() {
		if (!document.getElementById('ld-app')) return;

		initAudio();
		initTierTabs();
		initDongSlots();
		initDongNotif();
		syncDongNotif();
		initLdMarquee();
		initActions();
		initExplosionModal();
		initLuyenDanSocket();
		initAdminPanel();
		initModal();
		initDecomposeRewardModal();
		initUsePillRewardModal();
		initRankHelpModal();
		initBagExpandModal();
		initConfirmDialog();
		bindUiSounds();
		// Đồng bộ XP/bậc từ danMaster (page) trước API — tránh nháy số placeholder HTML cũ.
		syncRank();
		ensureLdSessionToken()
			.then(function () {
				return refreshState();
			})
			.catch(function (e) {
				toast(e && e.message ? e.message : LD_SESSION_EXPIRED_MSG, 'error');
			});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();

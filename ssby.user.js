// ==UserScript==
// @name         桃趣乐友叔叔不约小助手
// @namespace    https://www.shushubuyue.net/
// @version      2.9
// @description  桃趣乐友叔叔不约小助手，关注“桃趣乐友”公众号享受最新版本。
// @author       桃趣乐友
// @match        *://shushubuyue.net/*
// @match        *://*.shushubuyue.net/*
// @match        *://shushubuyue.com/*
// @match        *://*.shushubuyue.com/*
// @match        *://pingzishuo.com/*
// @match        *://*.pingzishuo.com/*
// @include      *://shushubuyue.net/*
// @include      *://*.shushubuyue.net/*
// @include      *://shushubuyue.com/*
// @include      *://*.shushubuyue.com/*
// @include      *://pingzishuo.com/*
// @include      *://*.pingzishuo.com/*
// @grant        none
// @run-at       document-start
// @inject-into  page
// @license      Apache License 2.0
// ==/UserScript==

(function() {
    'use strict';

    // ============ 日志开关 ============
    // 开发调试时改成 true 输出全部日志；日常使用保持 false
    // 仅静默本脚本日志（统一以 [SSBY] 开头），不影响站点与其它脚本的输出
    const DEBUG = false;
    if (!DEBUG) {
        try {
            const nativeLog = console.log;
            // 只静默本脚本的日志（统一以 [SSBY] 开头），站点与其它脚本的输出原样透传
            console.log = function () {
                const first = arguments.length > 0 ? arguments[0] : '';
                if (typeof first === 'string' && first.indexOf('[SSBY]') === 0) return;
                nativeLog.apply(console, arguments);
            };
        } catch (e) { /* 某些环境 console 不可写，忽略，仅影响日志静默 */ }
    }

    // SocketBridge：通过 WebSocket 接口层加速切换与读取对方信息，接口不可用时回退 DOM 逻辑。
    const SocketBridge = (function () {
        'use strict';

        // 常量
        const ENGINE_MESSAGE = '4';        // Engine.IO message 帧前缀
        const FRAME_EVENT = '2';           // Socket.IO EVENT
        const FRAME_ACK = '3';             // Socket.IO ACK
        const MIN_REMATCH_DELAY_MS = 500;  // 结束确认后、重发 new 前的最小间隔
        const END_ACK_TIMEOUT_MS = 3000;   // 结束回执超时，超时回退 DOM
        const PARTNER_CACHE_TTL_MS = 8000;    // 搭档资料有效期，防跨会话串场
        // 不算"对方反馈"的事件：心跳类，以及自己消息的回声（clientMessage）
        const ACTIVITY_IGNORE_EVENTS = ['heartbeat', 'heartBeat', 'ping', 'pong',
            'sysHeartbeat', 'heartbeatAck', 'keepAlive', 'clientMessage'];

        function isIgnoredActivityEvent(event) {
            return ACTIVITY_IGNORE_EVENTS.indexOf(String(event)) >= 0;
        }

        const deps = {
            isOn: function () { return false; }, // 主循环是否开启
            fallbackLeave: null,                 // 纯 DOM 离开函数
            onRawFrame: null,                    // 非 syscmd 事件帧 / 二进制帧交给外部处理
            onPartnerMessage: null,              // 收到对方消息（strangerMessage 事件）时通知外部
            onPartnerActivity: null              // 收到对方任意反馈（除心跳）时通知外部
        };

        let bridgeInstalled = false; // 是否已成功钩住 WebSocket
        let bridgeVerified = false;  // 是否解析到过业务帧
        let socketOpen = false;
        let socketCurrent = null;
        let socketPacketId = 0;      // 自建 ackId 自增计数
        let socketNewPayload = null; // 捕获的 new 载荷
        let partnerCache = null;     // { chatId, gender, userId, ts }
        let partnerUserId = '';      // 当前对方用户ID（从 connected 帧提取，跨会话稳定）
        let socketFlowOwned = false;
        let socketMatchInProgress = false;
        let socketEndPending = false;
        let socketEndPacketId = null;
        let socketHandledChatId = null;
        let endTimeoutTimer = null;
        let partnerSession = null;   // 当前会话 { chatId, userId, at }，at 为本会话准确的开始时间

        function socketDisabled() {
            try { return localStorage.getItem('ssby_socket_disabled') === 'true'; }
            catch (e) { return false; }
        }

        function parseSocketIoPacket(data) {
            if (typeof data !== 'string') return null;
            let packet = data;
            if (packet.charAt(0) === ENGINE_MESSAGE) packet = packet.slice(1);
            const type = packet.charAt(0);
            if (type !== FRAME_EVENT && type !== FRAME_ACK) return null;
            packet = packet.slice(1);
            const idx = packet.indexOf('[');
            if (idx < 0) return null;
            const idText = packet.slice(0, idx);
            try {
                const payload = JSON.parse(packet.slice(idx));
                if (!Array.isArray(payload)) return null;
                if (type === FRAME_EVENT && typeof payload[0] !== 'string') return null;
                return {
                    type: type === FRAME_EVENT ? 'event' : 'ack',
                    event: payload[0],
                    args: payload.slice(1),
                    packetId: /^\d+$/.test(idText) ? Number(idText) : null
                };
            } catch (e) {
                return null;
            }
        }

        function isOpen() { return socketOpen && !!socketCurrent; }

        function sendEvent(event, payload, requestAck) {
            if (!isOpen()) return false;
            const id = requestAck ? ++socketPacketId : null;
            const frame = ENGINE_MESSAGE + FRAME_EVENT +
                (id === null ? '' : String(id)) +
                JSON.stringify([event, payload]);
            try { socketCurrent.send(frame); return true; }
            catch (e) { return false; }
        }

        function sendEnd(chatId) {
            if (!chatId || !isOpen()) return false;
            const id = ++socketPacketId;
            const frame = ENGINE_MESSAGE + FRAME_EVENT + String(id) +
                JSON.stringify(['syscmd', { msg: 'end', chatId: chatId, countTalked: true }]);
            try { socketCurrent.send(frame); socketEndPacketId = id; return true; }
            catch (e) { return false; }
        }

        // 对方用户ID的候选字段名（connected 帧实测为顶层 partnerIdEncrypted，放首位）
        const PARTNER_ID_KEYS = ['partnerIdEncrypted', 'userId', 'strUserId', 'uid', 'strUid',
            'userNo', 'strUserNo', 'strNumber', 'strAccount', 'accountId', 'strAccountId',
            'partnerUserId', 'strPartnerUserId', 'targetUserId'];
        // 顶层字段用更严格的候选，避免误取通用 id
        const PARTNER_ID_KEYS_TOP = ['partnerIdEncrypted', 'userId', 'strUserId', 'partnerUserId',
            'targetUserId', 'strPartnerUserId', 'uid', 'strUid', 'userNo', 'strUserNo'];

        function pickPartnerId(source, keys) {
            if (!source || typeof source !== 'object') return '';
            for (let i = 0; i < keys.length; i++) {
                const v = source[keys[i]];
                if (v != null && String(v).trim()) return String(v).trim();
            }
            return '';
        }

        function parsePartner(command) {
            const info = command && typeof command === 'object' ? command : {};
            const pInfo = info.partnerInfoObj && typeof info.partnerInfoObj === 'object'
                ? info.partnerInfoObj : {};
            const gRaw = pInfo.strGender != null ? pInfo.strGender : info.strGender;
            const chatId = typeof info.chatId === 'string' ? info.chatId : '';
            const userId = pickPartnerId(pInfo, PARTNER_ID_KEYS) || pickPartnerId(info, PARTNER_ID_KEYS_TOP);
            const g = String(gRaw == null ? '' : gRaw).trim().toLowerCase();
            let gender = '';
            if (g === 'm' || g.indexOf('男') >= 0) gender = '男';
            else if (g === 'f' || g.indexOf('女') >= 0) gender = '女';
            if (!gender || !chatId) return null;
            return { gender: gender, chatId: chatId, userId: userId };
        }

        function onEndAck() {
            if (!socketEndPending) return;
            socketEndPending = false;
            socketEndPacketId = null;
            if (endTimeoutTimer) { clearTimeout(endTimeoutTimer); endTimeoutTimer = null; }
            if (!socketNewPayload) {
                console.log('[SSBY] 接口结束已确认，但未捕获 new 载荷，回退 DOM');
                if (deps.fallbackLeave) deps.fallbackLeave();
                return;
            }
            setTimeout(function () {
                if (!isActive()) {
                    console.log('[SSBY] 重发 new 前接口已失效，回退 DOM');
                    if (deps.fallbackLeave) deps.fallbackLeave();
                    return;
                }
                const payload = socketNewPayload;
                socketMatchInProgress = true;
                socketHandledChatId = null;
                partnerCache = null;
                partnerUserId = '';
                partnerSession = null;
                if (!sendEvent('syscmd', payload, false)) {
                    console.log('[SSBY] 重发 new 失败，回退 DOM');
                    if (deps.fallbackLeave) deps.fallbackLeave();
                } else {
                    console.log('[SSBY] 接口已发起重新匹配');
                }
            }, MIN_REMATCH_DELAY_MS);
        }

        function onMessage(data) {
            if (typeof data !== 'string') {
                if (deps.onRawFrame) deps.onRawFrame(null, data, 'in');
                return;
            }
            const pkt = parseSocketIoPacket(data);
            if (!pkt) return;
            if (pkt.type === 'ack') {
                if (pkt.packetId === socketEndPacketId) onEndAck();
                return;
            }
            if (pkt.event !== 'syscmd') {
                // 协议已确认：strangerMessage = 对方发来的消息，用于统计对方说了几句
                if (pkt.event === 'strangerMessage' && deps.onPartnerMessage) {
                    deps.onPartnerMessage(pkt.args && pkt.args[0]);
                }
                // 除心跳和自己消息回声外，任何收到的业务事件都算"对方有反馈"
                if (deps.onPartnerActivity && !isIgnoredActivityEvent(pkt.event)) {
                    deps.onPartnerActivity(pkt.event);
                }
                if (deps.onRawFrame) deps.onRawFrame(pkt, null, 'in');
                return;
            }
            const cmd = pkt.args[0];
            const msg = typeof cmd === 'string' ? cmd : (cmd && cmd.msg);
            if (!msg) return;
            if (!bridgeVerified) {
                bridgeVerified = true;
                console.log('[SSBY] Socket Bridge 已识别业务帧，接口加速启用');
            }
            if (msg === 'connected') {
                socketMatchInProgress = false;
                const partner = parsePartner(cmd);
                // 提取对方用户ID：chatId 是随机会话号，只有 partnerIdEncrypted 稳定
                const cmdInfo = cmd && typeof cmd === 'object' ? cmd : {};
                const cmdPInfo = cmdInfo.partnerInfoObj && typeof cmdInfo.partnerInfoObj === 'object'
                    ? cmdInfo.partnerInfoObj : {};
                partnerUserId = pickPartnerId(cmdPInfo, PARTNER_ID_KEYS)
                    || pickPartnerId(cmdInfo, PARTNER_ID_KEYS_TOP);
                const pInfoKeys = (cmd && cmd.partnerInfoObj && typeof cmd.partnerInfoObj === 'object')
                    ? Object.keys(cmd.partnerInfoObj) : [];
                console.log('[SSBY] connected 解析: 对方资料字段=[' + pInfoKeys.join(',') +
                    '] 顶层字段=[' + Object.keys(cmd || {}).join(',') + '] 提取ID=' + (partnerUserId || '(空)'));
                try {
                    // 需要核对完整字段时：localStorage.setItem('ssby_dump_connected','true') 后刷新网页
                    if (localStorage.getItem('ssby_dump_connected') === 'true') {
                        let dump = '';
                        try { dump = JSON.stringify(cmd); } catch (e) { dump = '[无法序列化]'; }
                        console.log('[SSBY][connected 原始帧]', dump);
                    }
                } catch (e) {}
                // 记录本会话准确的开始时间（以会话ID标识，供呼吸灯计时校准）
                const sessionChatId = partner ? partner.chatId
                    : (typeof cmd.chatId === 'string' ? cmd.chatId : '');
                partnerSession = { chatId: sessionChatId, userId: partnerUserId, at: Date.now() };
                if (partner) {
                    partnerCache = { chatId: partner.chatId, gender: partner.gender, userId: partner.userId, ts: Date.now() };
                    socketHandledChatId = partner.chatId;
                }
            } else if (msg === 'end' || msg === 'endByPartner') {
                // 服务端以 event 帧形式回执结束（部分实现无独立 ack）
                if (socketEndPending) onEndAck();
            }
        }

        function install() {
            if (bridgeInstalled) return;
            const proto = window.WebSocket && window.WebSocket.prototype;
            if (!proto) { bridgeInstalled = true; return; }
            if (proto.__ssbyBridgeInstalled) { bridgeInstalled = true; return; }
            const nativeSend = proto.send;
            const nativeAdd = proto.addEventListener;
            const tracked = new WeakSet();

            function track(sock) {
                if (tracked.has(sock)) return;
                tracked.add(sock);
                socketCurrent = sock;
                socketOpen = true;
                nativeAdd.call(sock, 'open', function () {
                    if (socketCurrent === sock) socketOpen = true;
                });
                nativeAdd.call(sock, 'message', function (e) { onMessage(e.data); });
                nativeAdd.call(sock, 'close', function () {
                    if (socketCurrent !== sock) return;
                    socketOpen = false;
                    socketFlowOwned = false;
                    socketMatchInProgress = false;
                    // 断线后会话信息不可信，清掉，避免旧会话的时间/身份被误用
                    partnerSession = null;
                    partnerUserId = '';
                    if (socketEndPending) {
                        socketEndPending = false;
                        socketEndPacketId = null;
                        console.log('[SSBY] Socket 断开且等待结束确认，回退 DOM');
                        if (deps.fallbackLeave) deps.fallbackLeave();
                    } else {
                        console.log('[SSBY] Socket 连接已断开，回退 DOM 检测');
                    }
                });
            }

            proto.send = function (data) {
                track(this);
                if (typeof data !== 'string') {
                    if (deps.onRawFrame) deps.onRawFrame(null, data, 'out');
                    return nativeSend.call(this, data);
                }
                const pkt = parseSocketIoPacket(data);
                if (pkt && pkt.packetId != null) {
                    socketPacketId = Math.max(socketPacketId, pkt.packetId);
                }
                if (pkt && pkt.type === 'event' && pkt.event === 'syscmd') {
                    const cmd = pkt.args[0];
                    const m = typeof cmd === 'string' ? cmd : (cmd && cmd.msg);
                    if (m === 'new') {
                        socketNewPayload = JSON.parse(JSON.stringify(cmd));
                        socketMatchInProgress = true;
                        socketFlowOwned = true;
                        socketEndPending = false;
                        socketHandledChatId = null;
                        partnerCache = null;
                        partnerUserId = '';
                        partnerSession = null;
                        console.log('[SSBY] 已捕获 new 载荷，准备接口加速');
                    }
                } else if (pkt) {
                    if (deps.onRawFrame) deps.onRawFrame(pkt, null, 'out');
                }
                return nativeSend.call(this, data);
            };
            try {
                Object.defineProperty(proto, '__ssbyBridgeInstalled', {
                    configurable: false, enumerable: false, value: true, writable: false
                });
            } catch (e) { /* 某些引擎 defineProperty 受限，忽略 */ }
            bridgeInstalled = true;
        }

        function isActive() {
            return bridgeInstalled && bridgeVerified && !socketDisabled() && deps.isOn();
        }

        function takePartner() {
            if (!isActive()) return null;
            if (!partnerCache) return null;
            if (Date.now() - partnerCache.ts > PARTNER_CACHE_TTL_MS) {
                partnerCache = null;
                return null;
            }
            return partnerCache;
        }

        function consumePartner() {
            partnerCache = null;
            partnerUserId = '';
            partnerSession = null; // 会话结束，旧会话开始时间随之失效
            socketHandledChatId = null;
        }

        function endAndRematch() {
            if (!isActive()) return false;
            if (!isOpen()) return false;
            const chatId = socketHandledChatId || (partnerCache && partnerCache.chatId);
            if (!chatId) return false;
            if (!sendEnd(chatId)) return false;
            socketFlowOwned = true;
            socketEndPending = true;
            consumePartner();
            if (endTimeoutTimer) clearTimeout(endTimeoutTimer);
            endTimeoutTimer = setTimeout(function () {
                endTimeoutTimer = null;
                if (!socketEndPending) return;
                socketEndPending = false;
                socketEndPacketId = null;
                console.log('[SSBY] 接口结束未收到确认，回退 DOM 离开');
                if (deps.fallbackLeave) deps.fallbackLeave();
            }, END_ACK_TIMEOUT_MS);
            return true;
        }

        function reset() {
            socketFlowOwned = false;
            socketMatchInProgress = false;
            socketEndPending = false;
            socketEndPacketId = null;
            socketHandledChatId = null;
            partnerCache = null;
            partnerUserId = '';
            partnerSession = null;
            if (endTimeoutTimer) { clearTimeout(endTimeoutTimer); endTimeoutTimer = null; }
        }

        function bind(d) {
            if (d) Object.assign(deps, d);
        }

        return {
            install: install,
            isActive: isActive,
            takePartner: takePartner,
            endAndRematch: endAndRematch,
            consumePartner: consumePartner,
            reset: reset,
            bind: bind,
            // 读取当前对方用户ID（从 connected 帧提取，不消费、不受主循环开关影响）
            getPartnerUserId: function () { return partnerUserId; },
            // 读取当前会话开始信息 { chatId, userId, at }；会话结束后清空
            getSessionStart: function () { return partnerSession; }
        };
    })();
    SocketBridge.install();
    console.log('[SSBY] 接口桥已安装，等待业务帧以启用加速');

    // ============ 图片抢存 ============
    // WS 帧到达瞬间抓图，把聊天框里临时签名地址换成本地 Blob URL
    const ImageVault = (function () {
        'use strict';

        const MAX_ITEMS = 30;       // 最多缓存的张数，超出按最旧的淘汰
        const APPLY_WINDOW = 10000; // 新存的图在 10 秒内持续尝试替换 DOM

        // 提取用（带 g，仅用于 match）
        const URL_G = /https?:\/\/[^\s"'\\<>,;)\]]+/gi;
        // 判定用（不带 g，避免 lastIndex 串味）
        const IMG_EXT = /\.(?:jpe?g|png|gif|webp|bmp|avif)(?:\?|#|$)/i;

        const store = new Map();   // 原图 URL -> { blob, objectUrl, ts }
        const inflight = new Set(); // 已发起、尚未落库的 URL
        let enabled = true;
        try { enabled = localStorage.getItem('ssby_img_vault') !== 'false'; } catch (e) {}

        // 抓包模式：true 时记录每一帧，默认只记每种事件的第一帧
        let probe = false;
        try { probe = localStorage.getItem('ssby_probe') === 'true'; } catch (e) {}

        const eventHits = new Map(); // 协议探针：事件名 -> 已记录次数
        const logBuf = [];           // 日志缓冲，供 __ssbyImgLog() 一次性导出
        let observer = null;
        let scheduled = false;
        let lastStaleScan = 0;       // 陈旧图（存库超 10 秒）上次全量扫描时间，用于低频兜底

        // 日志脱敏：URL 只保留主机，路径打码，避免日志暴露图片地址
        function maskUrl(s) {
            return String(s).replace(
                /((?:https?:\/\/)?[\w.-]+\.[a-z]{2,})\/[^\s"'<>]+/gi,
                '$1/***'
            );
        }

        function log() {
            let line;
            try {
                const ts = new Date().toTimeString().slice(0, 8);
                line = '[SSBY][图][' + ts + '] ' + Array.prototype.slice.call(arguments).join(' ');
                line = maskUrl(line);
            }
            catch (e) { return; }
            logBuf.push(line);
            if (logBuf.length > 800) logBuf.shift();
            try { console.log(line); } catch (e) {}
        }

        // 站方图床目录（域名可变），/chatImage/ 下即使无扩展名也按图片处理
        const IMG_PATH = /^https?:\/\/[^\/\s]+\/chatImage\//i;

        // 裸域名 URL（content 无协议头）：/chatImage/ 目录 或 任意域名的图片扩展名
        const BARE_IMG_RE =
            /(?:[\w.-]+\/chatImage\/[^\s"'\\<>,;)\]]+|(?:[\w-]+\.)+[a-z]{2,}\/[^\s"'\\<>,;)\]]+\.(?:jpe?g|png|gif|webp|bmp|avif)(?:[?#][^\s"'\\<>,;)\]]*)?)/i;

        // 把裸域名 URL 补成完整地址（DOM 里的 <img> 用的是带协议的完整地址，key 必须跟它对上）
        function normalizeUrl(u) {
            if (typeof u === 'string' && u.indexOf('http') !== 0 && BARE_IMG_RE.test(u)) {
                return 'https://' + u.match(BARE_IMG_RE)[0];
            }
            return u;
        }

        function isImageUrl(u) {
            if (typeof u !== 'string' || u.indexOf('http') !== 0) return false;
            return IMG_EXT.test(u) || IMG_PATH.test(u);
        }

        // 递归翻载荷，把所有像图片的 URL 捞出来。不依赖具体字段名，协议变了也能用。
        function extract(value, out, depth) {
            if (!value || depth > 6) return;
            if (typeof value === 'string') {
                const hits = value.match(URL_G);
                if (hits) {
                    for (let i = 0; i < hits.length; i++) {
                        if (IMG_EXT.test(hits[i])) out.push(hits[i]);
                    }
                }
                // 图片 URL 可能省略协议头（strangerMessage 的 content 就是裸域名）
                const bare = value.match(BARE_IMG_RE);
                if (bare) {
                    const norm = 'https://' + bare[0];
                    if (out.indexOf(norm) < 0) out.push(norm);
                }
                return;
            }
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) extract(value[i], out, depth + 1);
                return;
            }
            if (typeof value === 'object') {
                for (const k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) extract(value[k], out, depth + 1);
                }
            }
        }

        function save(url, blob) {
            const old = store.get(url);
            if (old) URL.revokeObjectURL(old.objectUrl);
            const objectUrl = URL.createObjectURL(blob);
            store.set(url, { blob: blob, objectUrl: objectUrl, ts: Date.now() });
            while (store.size > MAX_ITEMS) {
                const oldest = store.keys().next().value;
                const dropped = store.get(oldest);
                URL.revokeObjectURL(dropped.objectUrl);
                store.delete(oldest);
            }
            log('已存 ' + (blob.size / 1024).toFixed(1) + 'KB 共' + store.size + '张 ' + url.slice(0, 70));
        }

        // 把原 URL 换成本地 Blob URL（uni-image 会写 <img src> 和 background-image 两处）
        function applyOne(url) {
            const item = store.get(url);
            if (!item) return false;
            let hit = 0;

            const imgs = document.querySelectorAll('img');
            for (let i = 0; i < imgs.length; i++) {
                const el = imgs[i];
                if (el.getAttribute('src') === url || el.src === url) {
                    el.src = item.objectUrl;
                    hit++;
                }
            }

            const bgs = document.querySelectorAll('[style*="background-image"]');
            for (let i = 0; i < bgs.length; i++) {
                const el = bgs[i];
                const bg = el.style && el.style.backgroundImage;
                // 属性值里 URL 可能带引号，所以用 indexOf 找子串；split/join 避免 $& 被当成替换模式
                if (bg && bg.indexOf(url) >= 0) {
                    el.style.backgroundImage = bg.split(url).join(item.objectUrl);
                    hit++;
                }
            }

            if (hit) {
                // 挪到末尾，LRU 淘汰时优先保住刚用过的
                store.delete(url);
                store.set(url, item);
                log('已替换 DOM 图片 ' + hit + ' 处 ' + url.slice(0, 70));
            }
            return hit > 0;
        }

        function applyRecent() {
            if (!store.size) return;
            const now = Date.now();
            const fresh = []; // 10 秒内的新图：每次 DOM 变化都试
            const stale = []; // 更早的图：低频兜底，保证"过一会儿才点开聊天"也能替换
            store.forEach(function (item, url) {
                if (now - item.ts < APPLY_WINDOW) fresh.push(url);
                else stale.push(url);
            });
            for (let i = 0; i < fresh.length; i++) applyOne(fresh[i]);
            if (stale.length && now - lastStaleScan > 2500) {
                lastStaleScan = now;
                for (let i = 0; i < stale.length; i++) applyOne(stale[i]);
            }
        }

        // 摘掉"点击查看"遮罩（纯 CSS 层，摘掉即露图，不模拟点击）
        function unmask() {
            let removed = 0;
            const nodes = document.querySelectorAll('uni-text, span');
            for (let i = 0; i < nodes.length; i++) {
                const t = nodes[i];
                if (t.children.length) continue;               // 只看叶子，避免父节点重复匹配
                if (!/点击查看/.test(t.textContent || '')) continue;
                let el = t.parentElement;
                for (let hops = 0; el && hops < 6; hops++, el = el.parentElement) {
                    const st = el.style;
                    if (!st) continue;
                    const blur = st.backdropFilter || st.webkitBackdropFilter || '';
                    const bg = (st.background || '') + (st.backgroundColor || '');
                    // 命中遮罩特征：backdrop blur，或半透明黑底
                    if (/blur\(/.test(blur) || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.\d+/.test(bg)) {
                        el.remove();
                        removed++;
                        break;
                    }
                    if (el.tagName === 'UNI-IMAGE') break;      // 走过头了，放弃这张
                }
            }
            if (removed) log('已自动摘除"点击查看"遮罩 ' + removed + ' 处');
        }

        function scheduleApply() {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(function () {
                scheduled = false;
                unmask();      // 遮罩随消息一起渲染，先摘掉再看要不要换图
                applyRecent();
            });
        }

        // document-start 阶段 documentElement 还不存在，等它出现再挂
        function ensureObserver() {
            if (observer || typeof MutationObserver === 'undefined') return;
            if (!document.documentElement) return;
            observer = new MutationObserver(scheduleApply);
            observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['src', 'style']
            });
        }

        function capture(url) {
            url = normalizeUrl(url);
            if (!enabled || !isImageUrl(url)) return;
            if (store.has(url) || inflight.has(url)) return;
            inflight.add(url);
            log('开始抓取 ' + url.slice(0, 120));

            // 第一路：原生图片管线预热 HTTP 缓存，不设 crossOrigin，不受 CORS 限制
            const warm = new Image();
            if ('decoding' in warm) warm.decoding = 'async';
            warm.src = url;

            // 第二路：并行取 blob 做长期保留。需要 CORS，失败就只留页面缓存，不影响显示。
            fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
                .then(function (r) {
                    return r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status));
                })
                .then(function (blob) {
                    if (blob && blob.size) {
                        save(url, blob);
                        applyOne(url);
                    }
                })
                .catch(function (e) {
                    log('blob 获取失败（多半是无 CORS，仅保留页面缓存）', url.slice(0, 70), e && e.message);
                })
                .then(function () { inflight.delete(url); });
        }

        return {
            // 由 SocketBridge 的 onRawFrame 回调驱动
            onFrame: function (pkt, binary, direction) {
                const dir = direction === 'out' ? '发' : '收';
                ensureObserver();
                if (binary) {
                    log('[探针] 方向=' + dir + ' 二进制帧 大小=' +
                        ((binary && binary.size) || (binary && binary.byteLength) || '?'));
                    return;
                }
                if (!pkt) return;

                // 探针：默认每种事件只记第一帧，开抓包模式后每帧都记
                const n = (eventHits.get(pkt.event) || 0) + 1;
                eventHits.set(pkt.event, n);
                if (probe || n === 1) {
                    let dump = '';
                    try { dump = JSON.stringify(pkt.args); } catch (e) { dump = '[无法序列化]'; }
                    if (dump.length > 1500) dump = dump.slice(0, 1500) + '...[截断]';
                    log('[探针] 方向=' + dir + ' 第' + n + '帧 类型=' + pkt.type +
                        ' 事件=' + pkt.event + ' 载荷=' + dump);
                }

                if (!enabled) return;
                const urls = [];
                if (pkt.event === 'strangerMessage' || pkt.event === 'clientMessage') {
                    // 协议已确认：对方(strangerMessage)/自己(clientMessage)图片消息都是
                    // { msgId, content, options:{ isImage, chatId, pulp } }，用 isImage 判断
                    const m = pkt.args && pkt.args[0] && typeof pkt.args[0] === 'object' ? pkt.args[0] : {};
                    if (m && m.options && m.options.isImage && typeof m.content === 'string' && m.content) {
                        urls.push(m.content);
                    }
                } else {
                    extract(pkt.args, urls, 0);
                }
                if (!urls.length) return;
                log('方向=' + dir + ' 事件=' + pkt.event + ' 命中图片 ' + urls.length + ' 个 -> ' + urls.join(' , '));
                for (let i = 0; i < urls.length; i++) capture(urls[i]);
            },

            // 确需要 base64 时再用它，日常显示走 Blob URL 更快更省内存
            toBase64: function (url) {
                return new Promise(function (resolve, reject) {
                    const item = store.get(url);
                    if (!item) { reject(new Error('未缓存该图片')); return; }
                    const fr = new FileReader();
                    fr.onload = function () { resolve(fr.result); };
                    fr.onerror = reject;
                    fr.readAsDataURL(item.blob);
                });
            },

            dumpLog: function () { return logBuf.join('\n'); },

            clear: function () {
                store.forEach(function (item) { URL.revokeObjectURL(item.objectUrl); });
                store.clear();
                inflight.clear();
            }
        };
    })();
    SocketBridge.bind({
        onRawFrame: function (pkt, binary, direction) { ImageVault.onFrame(pkt, binary, direction); }
    });

    // 日志导出：控制台执行 __ssbyImgLogCopy() 直接复制到剪贴板，或 __ssbyImgLog() 拿到纯文本
    window.__ssbyImgLog = function () { return ImageVault.dumpLog(); };
    window.__ssbyImgLogCopy = function () {
        const text = ImageVault.dumpLog();
        const lines = text ? text.split('\n').length : 0;
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok ? ('已复制 ' + lines + ' 行到剪贴板') : '复制失败，请手动选中控制台输出';
        } catch (e) {
            return '复制失败：' + e.message;
        }
    };

    function createAssistiveTouchMenu() {
        const style = document.createElement('style');
        style.textContent = `
        .at-menu-root {
            position: fixed;
            top: 32px;
            left: calc(100vw - 92px);
            z-index: 999999;
            user-select: none;
            touch-action: none;
        }
        .at-menu-btn {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: rgba(34,34,34,0.85); /* 外圈透明黑色 */
            box-shadow: 0 4px 24px 0 rgba(0,0,0,0.18);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: box-shadow 0.2s, background 0.2s;
            position: relative;
        }
        /* 扩大触摸热区 */
        .at-menu-btn::before {
            content: '';
            position: absolute;
            top: -22px;
            left: -22px;
            right: -22px;
            bottom: -22px;
            border-radius: 50%;
        }
        .at-menu-btn-inner {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: #111; /* 中间纯黑色 */
            box-shadow: 0 1.5px 4px 0 #0004 inset;
        }
        .at-menu-btn.breath {
            animation: at-breath 1.8s infinite alternate;
            box-shadow: 0 0 24px 8px #3a7afe66, 0 4px 24px 0 rgba(0,0,0,0.18);
        }
        @keyframes at-breath {
            0% { box-shadow: 0 0 16px 4px #3a7afe33, 0 4px 24px 0 rgba(0,0,0,0.18); }
            100% { box-shadow: 0 0 32px 16px #3a7afe99, 0 4px 24px 0 rgba(0,0,0,0.18); }
        }
        .at-menu-btn.green-breath {
            animation: at-green-breath 1.8s infinite alternate;
            box-shadow: 0 0 24px 8px #22c55e66, 0 4px 24px 0 rgba(0,0,0,0.18);
        }
        @keyframes at-green-breath {
            0% { box-shadow: 0 0 16px 4px #22c55e33, 0 4px 24px 0 rgba(0,0,0,0.18); }
            100% { box-shadow: 0 0 32px 16px #22c55e99, 0 4px 24px 0 rgba(0,0,0,0.18); }
        }
        .at-menu-panel {
            position: absolute;
            top: 0;
            right: 76px;
            left: auto;
            display: flex;
            flex-direction: column;
            gap: 20px;
            opacity: 0;
            pointer-events: none;
            transform: scale(0.8) translateY(-10px);
            transition: all 0.28s cubic-bezier(.4,2,.6,1);
        }
        .at-menu-root.panel-left .at-menu-panel {
            right: auto;
            left: 76px;
        }
        .at-menu-root.open .at-menu-panel {
            opacity: 1;
            pointer-events: auto;
            transform: scale(1) translateY(0);
        }
        .at-menu-item {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(145deg, #f0f0f3 60%, #e0e0e0 100%);
            color: #888;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.10), 0 1px 2px #fff inset;
            cursor: pointer;
            transition: box-shadow 0.2s, background 0.2s, transform 0.2s;
        }
        .at-menu-item:active {
            background: #e6f0ff;
        }
        .at-menu-item.breath {
            animation: at-breath 1.8s infinite alternate;
            box-shadow: 0 0 18px 6px #3a7afe66, 0 2px 8px rgba(0,0,0,0.10);
        }
        .at-menu-item.green-breath {
            animation: at-green-breath 1.8s infinite alternate !important;
            box-shadow: 0 0 24px 8px #22c55e66, 0 4px 24px 0 rgba(0,0,0,0.18) !important;
        }
        .at-menu-item:hover {
            background: #eef4ff;
            box-shadow: 0 4px 14px rgba(0,0,0,0.16), 0 1px 2px #fff inset;
            transform: translateY(-1px);
        }
        /* 已拉黑状态：整颗按钮变红即可，不加发散光效 */
        .at-menu-item.blocked {
            background: linear-gradient(145deg, #ff6b6b 60%, #e53935 100%);
            box-shadow: 0 2px 8px rgba(0,0,0,0.16);
        }
        .at-menu-item.blocked:hover {
            background: linear-gradient(145deg, #ff7b7b 60%, #ef5350 100%);
            box-shadow: 0 4px 12px rgba(0,0,0,0.20);
        }
        .at-menu-item.blocked svg path,
        .at-menu-item.blocked svg circle {
            stroke: #fff;
        }
        /* 设置面板样式 */
        .at-modal-mask {
            position: fixed;
            left: 0; top: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.18);
            z-index: 1000000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .at-modal {
            background: #fff;
            border-radius: 18px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.18);
            min-width: 320px;
            max-width: 90vw;
            padding: 28px 24px 20px 24px;
            position: relative;
            animation: at-modal-in 0.25s cubic-bezier(.4,2,.6,1);
        }
        @keyframes at-modal-in {
            0% { transform: scale(0.8) translateY(40px); opacity: 0; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .at-modal-close {
            position: absolute;
            right: 18px;
            top: 12px;
            font-size: 22px;
            color: #bbb;
            cursor: pointer;
            transition: color 0.2s;
        }
        .at-modal-close:hover {
            color: #3a7afe;
        }
        .at-modal-title {
            font-size: 20px;
            font-weight: 600;
            color: #222;
            margin-bottom: 18px;
            text-align: center;
        }
        .at-modal-content {
            font-size: 15px;
            color: #444;
            margin-bottom: 10px;
        }
        .at-vip-modal-qr {
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-bottom: 12px;
        }
        .at-vip-modal-qr img {
            width: 160px;
            height: 160px;
            border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.10);
            background: #f8f8f8;
            margin-bottom: 10px;
            cursor: pointer;
            transition: box-shadow 0.2s;
        }
        .at-vip-modal-qr img:active {
            box-shadow: 0 0 0 4px #3a7afe33;
        }
        .at-vip-modal-btn {
            display: inline-block;
            padding: 6px 18px;
            background: #3a7afe;
            color: #fff;
            border-radius: 8px;
            font-size: 15px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.2s;
            border: none;
            user-select: none;
        }
        .at-vip-modal-btn:active {
            background: #2563eb;
        }
        .at-vip-modal-tip {
            color: #444;
            font-size: 15px;
            text-align: center;
            margin-top: 6px;
            cursor: pointer;
            user-select: none;
        }
        .at-vip-modal-tip .at-vip-copy {
            color: #3a7afe;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
        }
        .at-vip-modal-title-copy {
            color: #3a7afe;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
        }
        /* 大图预览样式 */
        .at-vip-img-preview-mask {
            position: fixed;
            left: 0; top: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 1000001;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .at-vip-img-preview {
            max-width: 90vw;
            max-height: 90vh;
            border-radius: 16px;
            box-shadow: 0 4px 32px rgba(0,0,0,0.25);
            background: #fff;
        }
        .at-auto-leave-switch {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 12px;
            gap: 12px;
        }
        .at-auto-leave-switch-label {
            font-size: 15px;
            color: #444;
        }
        .at-auto-leave-switch-toggle {
            position: relative;
            width: 50px;
            height: 26px;
            border-radius: 13px;
            background: #ddd;
            cursor: pointer;
            transition: background 0.18s;
            flex-shrink: 0;
            outline: none;
        }
        .at-auto-leave-switch-toggle:after {
            content: '';
            position: absolute;
            top: 3px;
            left: 3px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
            transition: transform 0.18s;
        }
        .at-auto-leave-switch-toggle.active {
            background: #3a7afe;
        }
        .at-auto-leave-switch-toggle.active:after {
            transform: translateX(24px);
        }
        .at-auto-leave-switch-toggle:focus {
            box-shadow: 0 0 0 4px rgba(58,122,254,0.14);
        }
        /* 设置面板-问候语列表样式 */
        .at-settings-section {
            margin-bottom: 20px;
        }
        .at-settings-section-title {
            font-size: 17px;
            font-weight: 600;
            color: #222;
            margin-bottom: 4px;
        }
        .at-settings-section-desc {
            font-size: 13px;
            color: #888;
            margin-bottom: 12px;
        }
        .at-greeting-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 8px;
        }
        .at-greeting-item {
            display: flex;
            align-items: center;
            background: #fff;
            border: 1px solid #e8e8e8;
            border-radius: 10px;
            padding: 12px 14px;
            gap: 10px;
        }
        .at-greeting-drag {
            cursor: grab;
            color: #bbb;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            flex-shrink: 0;
            user-select: none;
        }
        .at-greeting-drag:active {
            cursor: grabbing;
        }
        .at-greeting-text {
            flex: 1;
            font-size: 15px;
            color: #333;
            outline: none;
            border: none;
            background: transparent;
            min-width: 0;
        }
        .at-greeting-delete {
            color: #ff4d4f;
            font-size: 14px;
            cursor: pointer;
            flex-shrink: 0;
            user-select: none;
            padding: 2px 6px;
        }
        .at-greeting-add-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            border: 1.5px dashed #b8c8d8;
            border-radius: 10px;
            padding: 12px;
            color: #3a7afe;
            font-size: 15px;
            cursor: pointer;
            background: #fff;
            transition: all 0.2s;
            user-select: none;
        }
        .at-greeting-add-btn:hover {
            border-color: #3a7afe;
            background: #f0f7ff;
        }
        .at-greeting-tip {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            color: #aaa;
            margin-top: 8px;
        }
        .at-modal-footer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid #f0f0f0;
        }
        .at-modal-btn {
            padding: 10px 36px;
            border-radius: 10px;
            font-size: 15px;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
            user-select: none;
        }
        .at-modal-btn-cancel {
            background: #f5f5f5;
            color: #555;
        }
        .at-modal-btn-cancel:hover {
            background: #eee;
        }
        .at-modal-btn-primary {
            background: #3a7afe;
            color: #fff;
        }
        .at-modal-btn-primary:hover {
            background: #2563eb;
        }
        .at-modal-btn-danger {
            background: #ff4d4f;
            color: #fff;
        }
        .at-modal-btn-danger:hover {
            background: #e53935;
        }
        /* 重置黑名单按钮 */
        .at-block-reset-btn {
            padding: 7px 16px;
            border-radius: 8px;
            border: 1px solid #ffccc7;
            background: #fff1f0;
            color: #ff4d4f;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            user-select: none;
        }
        .at-block-reset-btn:hover {
            background: #ff4d4f;
            border-color: #ff4d4f;
            color: #fff;
        }
        /* 跳过不说话女生：超时时间输入框 */
        .at-silent-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        .at-silent-timeout-input {
            width: 62px;
            padding: 6px 8px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
            color: #333;
            text-align: center;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .at-silent-timeout-input:focus {
            border-color: #3a7afe;
            box-shadow: 0 0 0 3px rgba(58,122,254,0.12);
        }
        .at-silent-unit {
            font-size: 13px;
            color: #888;
        }
        /* 二次确认弹框遮罩（叠在设置弹框之上） */
        .at-confirm-mask {
            position: fixed;
            left: 0; top: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.28);
            z-index: 1000004;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        /* 双击提示样式 */
        .at-double-click-tip {
            position: fixed;
            left: 50%;
            top: 40%;
            transform: translate(-50%, -50%) scale(0.9);
            background: rgba(34,34,34,0.92);
            color: #fff;
            padding: 12px 28px;
            border-radius: 14px;
            font-size: 15px;
            z-index: 1000002;
            box-shadow: 0 6px 24px rgba(0,0,0,0.22);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease, transform 0.3s cubic-bezier(.4,2,.6,1);
            white-space: nowrap;
            letter-spacing: 0.5px;
        }
        .at-double-click-tip.show {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
        `;
        document.head.appendChild(style);

        // 创建菜单DOM
        const root = document.createElement('div');
        root.className = 'at-menu-root';

        // 主按钮
        const mainBtn = document.createElement('div');
        mainBtn.className = 'at-menu-btn';
        const innerDot = document.createElement('div');
        innerDot.className = 'at-menu-btn-inner';
        mainBtn.appendChild(innerDot);

        // 菜单面板
        const panel = document.createElement('div');
        panel.className = 'at-menu-panel';

        // 状态变量
        let isOpen = false;
        let isOn = false;
        // 默认问候语（初始化与保存兜底共用，避免清空后只剩一条、导致“永远随机到同一条”）
        const DEFAULT_GREETINGS = ['哈喽', '你好呀', '很高兴认识你！', '嗨～'];
        // 清洗问候语列表：只保留非空字符串，全部无效时回退默认
        function normalizeGreetingList(list) {
            if (!Array.isArray(list)) return DEFAULT_GREETINGS.slice();
            const out = [];
            for (let i = 0; i < list.length; i++) {
                const v = list[i];
                if (typeof v === 'string' && v.trim()) out.push(v.trim());
            }
            return out.length > 0 ? out : DEFAULT_GREETINGS.slice();
        }
        // 问候语（JSON数组）
        let greetingList = DEFAULT_GREETINGS.slice();
        try {
            const saved = localStorage.getItem('ssby_greeting_list');
            if (saved) {
                greetingList = normalizeGreetingList(JSON.parse(saved));
            }
        } catch (e) {
            greetingList = DEFAULT_GREETINGS.slice();
        }
        // 循环定时器
        let timer = null;
        let state = 'blue';
        let greenTimer = null;
        let silentTimer = null; // 跳过不说话女生的超时计时器
        let disconnectTipShown = false; // 断连提示是否已弹过（弹框消失后复位）
        // 当前选中的问候语（固定住，避免每轮循环随机变化）
        let currentGreeting = '';

        // 连续单击计数（用于检测误操作提示双击）
        let singleClickCount = 0;
        let singleClickTimer = null;
        // 是否已经提示过（首次双击提示，之后才真正响应）
        let hasShownTip = false;

        // 性能优化：缓存状态
        let lastGenderInfo = null;
        let lastPartnerLeft = false;
        let lastGreeted = false;
        let lastSelfMessageCount = 0;
        let loopCount = 0;
        let partnerMessageCount = 0; // 本轮对方发来的消息条数（决定何时降频）
        let partnerActivityCount = 0; // 本轮对方任意反馈次数（除心跳），用于超时跳过判定
        let currentLoopInterval = 1000; // 当前循环间隔
        const PARTNER_REPLY_THRESHOLD = 2; // 对方回复达到该条数后才降低循环频率
        const SLOW_LOOP_INTERVAL = 5000; // 慢速循环间隔（对方已回复后）
        const FAST_LOOP_INTERVAL = 1000; // 快速循环间隔

        // 女生离开继续刷开关（从localStorage读取）
        let autoLeaveEnabled = false;
        try {
            autoLeaveEnabled = localStorage.getItem('autoLeaveEnabled') === 'true';
            console.log('[SSBY] 女生离开继续刷开关:', autoLeaveEnabled);
        } catch (e) {
            console.log('[SSBY] 读取autoLeaveEnabled失败:', e);
        }

        // 网络不稳定兼容模式：开启后只用 DOM 切换，避免接口重连抢线
        let netCompatEnabled = false;
        try {
            netCompatEnabled = localStorage.getItem('netCompatEnabled') === 'true';
            console.log('[SSBY] 网络不稳定兼容模式:', netCompatEnabled);
        } catch (e) {
            console.log('[SSBY] 读取netCompatEnabled失败:', e);
        }

        // 跳过不说话女生：默认关闭；开场白发出后超时内对方没说话就跳过，默认 10 秒
        let skipSilentEnabled = false;
        try {
            skipSilentEnabled = localStorage.getItem('skipSilentEnabled') === 'true';
            console.log('[SSBY] 跳过不说话女生:', skipSilentEnabled);
        } catch (e) {
            console.log('[SSBY] 读取skipSilentEnabled失败:', e);
        }
        let skipSilentTimeoutSec = 10;
        try {
            const savedTimeout = parseInt(localStorage.getItem('skipSilentTimeout'), 10);
            if (savedTimeout >= 3 && savedTimeout <= 120) skipSilentTimeoutSec = savedTimeout;
        } catch (e) {
            console.log('[SSBY] 读取skipSilentTimeout失败:', e);
        }

        // 黑名单：用户手动拉黑的对方ID，存 localStorage 持久化
        const BLOCK_LIST_KEY = 'ssby_block_list';
        let blockList = [];
        try {
            const savedBlock = localStorage.getItem(BLOCK_LIST_KEY);
            if (savedBlock) {
                const arr = JSON.parse(savedBlock);
                if (Array.isArray(arr)) {
                    blockList = arr.filter(function (id) { return id != null && String(id); })
                        .map(function (id) { return String(id); });
                }
            }
            console.log('[SSBY] 黑名单已加载:', blockList);
        } catch (e) {
            blockList = [];
            console.log('[SSBY] 读取黑名单失败:', e);
        }
        // 刚手动拉黑的当前会话ID：当前对话先不踢，等本轮结束再遇到才跳过，方便用户反悔取消
        let blockJustNowChatId = null;

        const switchBtn = document.createElement('div');
        switchBtn.className = 'at-menu-item';
        switchBtn.title = '开关';
        switchBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2v10" stroke="#888" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="14" r="7" fill="none" stroke="#888" stroke-width="2"/></svg>';
        const settingBtn = document.createElement('div');
        settingBtn.className = 'at-menu-item';
        settingBtn.title = '设置';
        settingBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" stroke="#888" stroke-width="2" fill="none"/><g stroke="#888" stroke-width="2" fill="none"><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.93 19.07l1.41-1.41"/><path d="M17.66 6.34l1.41-1.41"/></g></svg>';
        // 会员按钮
        const vipBtn = document.createElement('div');
        vipBtn.className = 'at-menu-item';
        vipBtn.title = '购买会员';
        // 礼物/皇冠图标
        vipBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2l2.09 6.26L20 9.27l-5 3.64L16.18 20 12 16.77 7.82 20l1.18-7.09-5-3.64 5.91-.99z" fill="none" stroke="#888" stroke-width="2"/></svg>';
        // 拉黑按钮（第四个图标）
        const blockBtn = document.createElement('div');
        blockBtn.className = 'at-menu-item';
        blockBtn.title = '拉黑对方';
        blockBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="#888" stroke-width="2" fill="none"/><path d="M5.6 5.6l12.8 12.8" stroke="#888" stroke-width="2" stroke-linecap="round"/></svg>';

        function updateBreath(state) {
            mainBtn.classList.remove('breath', 'green-breath');
            innerDot.classList.remove('breath', 'green-breath');
            switchBtn.classList.remove('breath', 'green-breath');
            if (isOn) {
                if (state === 'blue') {
                    mainBtn.classList.add('breath');
                    innerDot.classList.add('breath');
                    switchBtn.classList.add('breath');
                } else {
                    mainBtn.classList.add('green-breath');
                    innerDot.classList.add('green-breath');
                    switchBtn.classList.add('green-breath');
                }
            }
        }

        // 切换开关
        switchBtn.onclick = function() {
            console.log('[SSBY] 开关按钮被点击，当前状态:', isOn);
            isOn = !isOn;
            console.log('[SSBY] 切换后状态:', isOn);
            if (isOn && !timer) {
                console.log('[SSBY] 启动自动聊天循环');
                state = 'blue';
                currentLoopInterval = FAST_LOOP_INTERVAL; // 与实际定时器保持一致，避免降频判断失效
                partnerMessageCount = 0;  // 重新开始统计本轮数据
                partnerActivityCount = 0;
                autoChatLoop();
                timer = setInterval(autoChatLoop, 1000);
                updateBreath(state);
            } else {
                console.log('[SSBY] 停止自动聊天循环');
                // 停止循环
                if (timer) {
                    state = 'blue';
                    clearInterval(timer);
                    timer = null;
                }
                if (greenTimer) {
                    clearTimeout(greenTimer);
                    greenTimer = null;
                }
                clearSilentTimer(); // 关脚本时一并停掉"不说话跳过"计时，避免残留触发离开
                updateBreath('blue');
                SocketBridge.reset();
            }
        };

        // 设置面板弹窗
        function showSettingModal() {
            if (document.querySelector('.at-modal-mask')) return;
            const mask = document.createElement('div');
            mask.className = 'at-modal-mask';
            const modal = document.createElement('div');
            modal.className = 'at-modal';

            // 编辑期间只改草稿，取消/关闭不污染真实列表
            let draftList = greetingList.slice();

            // 转义 HTML，避免问候语里的 < > & " 破坏弹窗结构
            function escapeHtml(str) {
                return String(str).replace(/[&<>"']/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
                });
            }

            // 构建问候语列表HTML
            function buildGreetingListHTML() {
                let html = '';
                draftList.forEach((item, index) => {
                    html += `
                        <div class="at-greeting-item" data-index="${index}">
                            <span class="at-greeting-drag">⋮⋮</span>
                            <input class="at-greeting-text" type="text" value="${escapeHtml(item)}" maxlength="20" />
                            <span class="at-greeting-delete" data-index="${index}">删除</span>
                        </div>`;
                });
                return html;
            }

            modal.innerHTML = `
                <div class="at-modal-close" title="关闭">&times;</div>
                <div class="at-modal-title">设置</div>
                <div class="at-settings-section">
                    <div class="at-settings-section-title">打招呼问候语</div>
                    <div class="at-settings-section-desc">设置多条问候语，系统将随机使用一条进行打招呼</div>
                    <div class="at-greeting-list" id="atGreetingList">
                        ${buildGreetingListHTML()}
                    </div>
                    <div class="at-greeting-add-btn" id="atGreetingAddBtn">
                        <span>+</span><span>添加问候语</span>
                    </div>
                    <div class="at-greeting-tip">
                        <span>💡</span><span>最多可添加 6 条问候语</span>
                    </div>
                </div>
                <div class="at-auto-leave-switch">
                    <span class="at-auto-leave-switch-label">女生离开继续刷：</span>
                    <div id="autoLeaveToggle" class="at-auto-leave-switch-toggle" role="switch" tabindex="0" aria-checked="false"></div>
                </div>
                <div class="at-auto-leave-switch">
                    <span class="at-auto-leave-switch-label">网络不稳定兼容模式：</span>
                    <div id="netCompatToggle" class="at-auto-leave-switch-toggle" role="switch" tabindex="0" aria-checked="false"></div>
                </div>
                <div class="at-auto-leave-switch">
                    <span class="at-auto-leave-switch-label">跳过不说话女生：</span>
                    <div class="at-silent-controls">
                        <input id="skipSilentTimeout" class="at-silent-timeout-input" type="number" min="3" max="120" step="1" inputmode="numeric" value="${skipSilentTimeoutSec}" />
                        <span class="at-silent-unit">秒</span>
                        <div id="skipSilentToggle" class="at-auto-leave-switch-toggle" role="switch" tabindex="0" aria-checked="false"></div>
                    </div>
                </div>
                <div class="at-auto-leave-switch">
                    <span class="at-auto-leave-switch-label">重置黑名单：</span>
                    <button class="at-block-reset-btn" id="atResetBlockBtn">清空（${blockList.length}）</button>
                </div>
            `;
            mask.appendChild(modal);
            document.body.appendChild(mask);

            // 关闭面板即保存问候语改动（其余设置均为即时生效，无需取消/保存按钮）
            function saveGreetingsAndClose() {
                // 收集所有输入框的值
                const inputs = modal.querySelectorAll('.at-greeting-text');
                const newList = [];
                inputs.forEach(input => {
                    const val = input.value.trim();
                    if (val) newList.push(val);
                });
                greetingList = normalizeGreetingList(newList);
                try {
                    localStorage.setItem('ssby_greeting_list', JSON.stringify(greetingList));
                    console.log('[SSBY] 问候语列表已保存:', greetingList);
                } catch (e) {}
                // 本轮已选中的问候语若被删除或改掉，下轮重新随机
                if (currentGreeting && greetingList.indexOf(currentGreeting) === -1) {
                    currentGreeting = '';
                }
                mask.remove();
            }

            // 关闭事件（右上角× / 点击遮罩）
            modal.querySelector('.at-modal-close').onclick = saveGreetingsAndClose;
            mask.onclick = e => { if (e.target === mask) saveGreetingsAndClose(); };

            // 添加问候语
            modal.querySelector('#atGreetingAddBtn').onclick = function() {
                if (draftList.length >= 6) return;
                draftList.push('');
                renderGreetingList();
            };

            // 渲染问候语列表
            function renderGreetingList() {
                const container = modal.querySelector('#atGreetingList');
                container.innerHTML = buildGreetingListHTML();
                bindGreetingEvents();
            }

            // 绑定问候语事件
            function bindGreetingEvents() {
                // 删除按钮
                modal.querySelectorAll('.at-greeting-delete').forEach(btn => {
                    btn.onclick = function() {
                        const idx = parseInt(this.dataset.index, 10);
                        draftList.splice(idx, 1);
                        renderGreetingList();
                    };
                });
                // 输入框变化时同步到草稿（不 trim，保存时再 trim，避免输入中空格被吃掉）
                modal.querySelectorAll('.at-greeting-text').forEach(input => {
                    input.oninput = function() {
                        const item = this.closest('.at-greeting-item');
                        const idx = parseInt(item.dataset.index, 10);
                        draftList[idx] = this.value;
                    };
                });
            }

            bindGreetingEvents();

            const toggle = modal.querySelector('#autoLeaveToggle');
            if (toggle) {
                try {
                    const enabled = localStorage.getItem('autoLeaveEnabled') === 'true';
                    if (enabled) {
                        toggle.classList.add('active');
                        toggle.setAttribute('aria-checked', 'true');
                    } else {
                        toggle.classList.remove('active');
                        toggle.setAttribute('aria-checked', 'false');
                    }
                } catch (e) {
                    toggle.classList.remove('active');
                    toggle.setAttribute('aria-checked', 'false');
                }

                toggle.addEventListener('click', function() {
                    const next = !toggle.classList.contains('active');
                    toggle.classList.toggle('active', next);
                    toggle.setAttribute('aria-checked', next ? 'true' : 'false');
                    try {
                        localStorage.setItem('autoLeaveEnabled', next ? 'true' : 'false');
                        autoLeaveEnabled = next;
                        console.log('[SSBY] 女生离开继续刷开关已切换:', next);
                    } catch (e) {
                        console.log('[SSBY] 保存autoLeaveEnabled失败:', e);
                    }
                });

            }

            const netToggle = modal.querySelector('#netCompatToggle');
            if (netToggle) {
                netToggle.classList.toggle('active', netCompatEnabled);
                netToggle.setAttribute('aria-checked', netCompatEnabled ? 'true' : 'false');

                netToggle.addEventListener('click', function() {
                    const next = !netToggle.classList.contains('active');
                    netToggle.classList.toggle('active', next);
                    netToggle.setAttribute('aria-checked', next ? 'true' : 'false');
                    try {
                        localStorage.setItem('netCompatEnabled', next ? 'true' : 'false');
                        netCompatEnabled = next;
                        console.log('[SSBY] 网络不稳定兼容模式已切换:', next);
                    } catch (e) {
                        console.log('[SSBY] 保存netCompatEnabled失败:', e);
                    }
                    showToast(next ? '已开启兼容模式' : '已关闭兼容模式');
                });
            }

            const silentToggle = modal.querySelector('#skipSilentToggle');
            const silentInput = modal.querySelector('#skipSilentTimeout');
            if (silentToggle) {
                silentToggle.classList.toggle('active', skipSilentEnabled);
                silentToggle.setAttribute('aria-checked', skipSilentEnabled ? 'true' : 'false');
                silentToggle.addEventListener('click', function() {
                    const next = !silentToggle.classList.contains('active');
                    silentToggle.classList.toggle('active', next);
                    silentToggle.setAttribute('aria-checked', next ? 'true' : 'false');
                    try {
                        localStorage.setItem('skipSilentEnabled', next ? 'true' : 'false');
                        skipSilentEnabled = next;
                        console.log('[SSBY] 跳过不说话女生已切换:', next);
                    } catch (e) {
                        console.log('[SSBY] 保存skipSilentEnabled失败:', e);
                    }
                    showToast(next ? '已开启：超时无回应将跳过' : '已关闭跳过不说话');
                    if (!next) clearSilentTimer();
                });
            }
            if (silentInput) {
                // 失焦或回车即保存，限制在 3~120 秒
                silentInput.addEventListener('change', function() {
                    let sec = parseInt(silentInput.value, 10);
                    if (!(sec >= 3)) sec = 3;
                    if (sec > 120) sec = 120;
                    silentInput.value = sec;
                    skipSilentTimeoutSec = sec;
                    try { localStorage.setItem('skipSilentTimeout', String(sec)); } catch (e) {}
                    console.log('[SSBY] 不说话超时时间已保存:', sec, '秒');
                });
            }

            const resetBlockBtn = modal.querySelector('#atResetBlockBtn');
            if (resetBlockBtn) {
                // 点击后弹二次确认，确认才清空
                resetBlockBtn.onclick = function () {
                    showResetBlockConfirm();
                };
            }

        }
        settingBtn.onclick = showSettingModal;

        // 会员宣传面板弹窗
        function showVipModal() {
            if (document.querySelector('.at-modal-mask')) return;
            const mask = document.createElement('div');
            mask.className = 'at-modal-mask';
            const modal = document.createElement('div');
            modal.className = 'at-modal';
            modal.innerHTML = `
                <div class="at-modal-close" title="关闭">&times;</div>
                <div class="at-modal-title">购买<span class="at-vip-modal-title-copy">会员</span></div>
                <div class="at-vip-modal-qr">
                    <img id="at-vip-qr-img" src="https://gpt-api.qnaivety.com/qrcode_for_gh_748844eb9ce6_258.jpg" alt="公众号二维码" />
                    <button class="at-vip-modal-btn" id="at-vip-save-btn">保存二维码</button>
                </div>
                <div class="at-vip-modal-tip">关注“<span class="at-vip-copy">桃趣乐友</span>”购买<span class="at-vip-modal-title-copy">大客户会员</span></div>
            `;
            mask.appendChild(modal);
            document.body.appendChild(mask);
            // 关闭事件
            modal.querySelector('.at-modal-close').onclick = () => mask.remove();
            mask.onclick = e => { if (e.target === mask) mask.remove(); };
            // 保存二维码
            modal.querySelector('#at-vip-save-btn').onclick = function() {
                const img = modal.querySelector('#at-vip-qr-img');
                // 兼容移动端和PC端保存
                if (window.navigator.userAgent.toLowerCase().includes('mobile')) {
                    // 移动端直接新开图片，长按可保存
                    window.open(img.src, '_blank');
                } else {
                    const a = document.createElement('a');
                    a.href = img.src;
                    a.download = '桃趣乐友-会员二维码.png';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
            };
            // 点击二维码图片大图预览
            const qrImg = modal.querySelector('#at-vip-qr-img');
            qrImg.onclick = function() {
                if (document.querySelector('.at-vip-img-preview-mask')) return;
                const previewMask = document.createElement('div');
                previewMask.className = 'at-vip-img-preview-mask';
                const previewImg = document.createElement('img');
                previewImg.className = 'at-vip-img-preview';
                previewImg.src = qrImg.src;
                previewMask.appendChild(previewImg);
                document.body.appendChild(previewMask);
                previewMask.onclick = () => previewMask.remove();
                // 长按保存（移动端）
                let pressTimer = null;
                previewImg.addEventListener('touchstart', function(e) {
                    pressTimer = setTimeout(() => {
                        window.open(previewImg.src, '_blank');
                    }, 600);
                });
                previewImg.addEventListener('touchend', function(e) {
                    clearTimeout(pressTimer);
                });
            };
            // 长按二维码图片保存（移动端）
            let pressTimer = null;
            qrImg.addEventListener('touchstart', function(e) {
                pressTimer = setTimeout(() => {
                    window.open(qrImg.src, '_blank');
                }, 600);
            });
            qrImg.addEventListener('touchend', function(e) {
                clearTimeout(pressTimer);
            });
            // 复制“桃趣乐友”到剪贴板
            function copyTQLY() {
                const text = '桃趣乐友';
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(text).then(function() {
                        showCopyTip('桃趣乐友，已复制');
                    }, function() {
                        fallbackCopyTextToClipboard(text);
                    });
                } else {
                    fallbackCopyTextToClipboard(text);
                }
            }
            function fallbackCopyTextToClipboard(text) {
                const input = document.createElement('input');
                input.value = text;
                document.body.appendChild(input);
                input.select();
                try {
                    document.execCommand('copy');
                    showCopyTip('桃趣乐友，已复制');
                } catch (err) {
                    showCopyTip('复制失败，请手动复制');
                }
                document.body.removeChild(input);
            }
            function showCopyTip(msg) {
                let tip = document.createElement('div');
                tip.textContent = msg;
                tip.style.position = 'fixed';
                tip.style.left = '50%';
                tip.style.top = '40%';
                tip.style.transform = 'translate(-50%, -50%)';
                tip.style.background = 'rgba(34,34,34,0.92)';
                tip.style.color = '#fff';
                tip.style.padding = '10px 22px';
                tip.style.borderRadius = '10px';
                tip.style.fontSize = '16px';
                tip.style.zIndex = 1000002;
                tip.style.boxShadow = '0 2px 12px rgba(0,0,0,0.18)';
                document.body.appendChild(tip);
                setTimeout(() => { tip.remove(); }, 1200);
            }
            modal.querySelectorAll('.at-vip-copy, .at-vip-modal-title-copy').forEach(function (el) {
                el.onclick = copyTQLY;
            });
        }
        vipBtn.onclick = showVipModal;

        // 一次性输入问候语
        function typeGreeting(element, text, callback) {
            console.log('[SSBY] typeGreeting 开始，文本:', text);
            if (!element) {
                console.log('[SSBY] typeGreeting: 元素不存在');
                if (callback) callback();
                return;
            }
            element.value = text;
            element.focus();
            // 触发input事件，让uni-app更新
            const inputEvent = new Event('input', { bubbles: true });
            element.dispatchEvent(inputEvent);
            console.log('[SSBY] typeGreeting 完成');
            if (callback) callback();
        }

        // 判断是否已经说过话（通过DOM检测）
        function hasSentMessage() {
            const messagesContainer = document.querySelector('.messages-container');
            if (!messagesContainer) {
                return false;
            }
            // 查找所有自己发送的消息（右对齐的消息）
            const selfMessages = messagesContainer.querySelectorAll('.self-message-bubble');
            const count = selfMessages.length;
            
            // 检测消息数量变化
            if (count !== lastSelfMessageCount) {
                console.log('[SSBY] 自己的消息数量变化:', lastSelfMessageCount, '->', count);
                lastSelfMessageCount = count;
            }
            
            return count > 0;
        }

        // 呼吸灯变绿所需聊天时长（3 分 10 秒）
        const GREEN_DELAY_MS = 190000;

        // 重置呼吸灯为蓝色并清掉变绿定时器
        function resetGreenState() {
            if (greenTimer) {
                clearTimeout(greenTimer);
                greenTimer = null;
            }
            if (state !== 'blue') {
                state = 'blue';
                updateBreath(state);
            }
        }

        // 启动变绿计时：以当前会话ID的开始时间为准；拿不到会话信息就从此刻起算，绝不沿用旧会话的时长
        function startGreenTimer() {
            if (greenTimer || state === 'green') return;
            const session = SocketBridge.getSessionStart ? SocketBridge.getSessionStart() : null;
            const sessionKey = session ? String(session.chatId || '') : '';
            const startAt = session && session.at ? session.at : Date.now();
            const delay = Math.max(0, GREEN_DELAY_MS - (Date.now() - startAt));
            console.log('[SSBY] 启动变绿计时: ' + delay + 'ms 后变绿（会话=' + (sessionKey || '未知') +
                '，接口校正=' + (session && session.at ? '是' : '否') + '）');
            greenTimer = setTimeout(function () {
                greenTimer = null;
                // 到点时再次核对会话：会话已切换或已结束，本次计时作废
                const nowSession = SocketBridge.getSessionStart ? SocketBridge.getSessionStart() : null;
                const nowKey = nowSession ? String(nowSession.chatId || '') : '';
                if (sessionKey && nowKey && nowKey !== sessionKey) {
                    console.log('[SSBY] 会话已切换，放弃本次变绿');
                    return;
                }
                state = 'green';
                updateBreath(state);
            }, delay);
        }

        // 跳过不说话女生：开场白发出后开始计时，对方在超时时间内没说话就离开
        function startSilentTimer() {
            clearSilentTimer();
            if (!skipSilentEnabled) return;
            if (partnerActivityCount > 0) {
                console.log('[SSBY] 对方已有反馈，不启动超时跳过');
                return;
            }
            const session = SocketBridge.getSessionStart ? SocketBridge.getSessionStart() : null;
            const sessionKey = session ? String(session.chatId || '') : '';
            const timeoutMs = Math.max(3, skipSilentTimeoutSec) * 1000;
            console.log('[SSBY] 启动不说话超时计时: ' + skipSilentTimeoutSec + 's（会话=' + (sessionKey || '未知') + '）');
            silentTimer = setTimeout(function () {
                silentTimer = null;
                if (!skipSilentEnabled) return;
                if (partnerActivityCount > 0) {
                    console.log('[SSBY] 对方已有反馈，取消超时跳过');
                    return;
                }
                // 会话已切换则本次超时作废
                const nowSession = SocketBridge.getSessionStart ? SocketBridge.getSessionStart() : null;
                const nowKey = nowSession ? String(nowSession.chatId || '') : '';
                if (nowKey !== sessionKey) {
                    console.log('[SSBY] 会话已切换，取消超时跳过');
                    return;
                }
                console.log('[SSBY] 超时内对方未说话，跳过继续刷');
                leave();
                loopCount = 0;
            }, timeoutMs);
        }

        function clearSilentTimer() {
            if (silentTimer) {
                clearTimeout(silentTimer);
                silentTimer = null;
            }
        }

        // 打招呼
        function stay() {
            console.log('[SSBY] stay() 函数被调用');

            // 打招呼前再拦一次，防止接口帧晚于 DOM 时给黑名单用户白发消息
            if (isPartnerBlocked()) {
                console.log('[SSBY] 打招呼前命中黑名单，跳过');
                leave();
                loopCount = 0;
                return;
            }

            // 检查是否已经说过话
            if (hasSentMessage()) {
                console.log('[SSBY] 已说过话，跳过');
                lastGreeted = true;
                return;
            }

            const msgInput = document.querySelector('#messageTextarea textarea') ||
                document.querySelector('.message-input textarea');
            console.log('[SSBY] 输入框:', msgInput);

            // 仅在首次时随机选择一条问候语，之后固定使用（避免每轮循环换一条）
            if (!currentGreeting) {
                greetingList = normalizeGreetingList(greetingList);
                currentGreeting = greetingList[Math.floor(Math.random() * greetingList.length)];
            }
            console.log('[SSBY] 开始输入问候语:', currentGreeting);
            typeGreeting(msgInput, currentGreeting, function() {
                console.log('[SSBY] 问候语输入完成，当前值:', msgInput.value);
                if (msgInput.value === currentGreeting) {
                    // 查找发送按钮并点击
                    const sendBtn = document.querySelector('.send-btn');
                    console.log('[SSBY] 发送按钮:', sendBtn);
                    if (sendBtn) {
                        console.log('[SSBY] 点击发送按钮');
                        sendBtn.click();
                        lastGreeted = true;
                        startSilentTimer(); // 开场白已发出，开始"不说话就跳过"计时
                    }
                }
                startGreenTimer();
            });
        }

        // 重置本轮状态（离开时必须调用，否则问候语会一直沿用第一次随机到的那条）
        function resetRoundState() {
            clearSilentTimer();
            lastGenderInfo = null;
            SocketBridge.consumePartner(); // 清掉接口层缓存的搭档资料，避免下轮误读旧性别重复离开
            lastGreeted = false;
            lastSelfMessageCount = 0;
            partnerMessageCount = 0; // 新对话从零开始统计对方消息
            partnerActivityCount = 0; // 新对话从零开始统计对方反馈
            blockJustNowChatId = null; // 会话已结束，之后遇到黑名单用户正常跳过
            currentGreeting = ''; // 重置问候语，下次打招呼重新随机选一条
        }

        // 离开
        function leave() {
            console.log('[SSBY] leave() 函数被调用');
            // 兼容模式开启时只用 DOM 切换；否则优先用接口结束并重新匹配
            if (!netCompatEnabled && SocketBridge.isActive()) {
                const p = SocketBridge.takePartner();
                const chatId = p ? p.chatId : null;
                if (chatId && SocketBridge.endAndRematch()) {
                    console.log('[SSBY] 接口切换已发起，跳过 DOM 离开流程');
                    resetGreenState();
                    resetRoundState(); // 接口分支不会走 domLeave，这里必须单独重置
                    return;
                }
                console.log('[SSBY] 接口切换不可用，回退 DOM 离开流程');
            }
            SocketBridge.consumePartner();
            domLeave();
        }

        // 接口不可用时的纯 DOM 离开兜底
        function domLeave() {
            resetGreenState();

            adjustLoopSpeed(false);

            resetRoundState();

            // 尝试点击离开聊天按钮
            const clicked = clickLeaveChatButton();
            if (clicked) {
                console.log('[SSBY] 点击离开聊天按钮完成，等待2秒后点击重新匹配');
                // 延迟2秒后点击重新匹配按钮（等待广告加载）
                setTimeout(() => {
                    console.log('[SSBY] 开始查找重新匹配按钮');
                    autoClickRematch();
                }, 2000);
            } else {
                console.log('[SSBY] 未找到离开聊天按钮，直接点击重新匹配');
                // 直接点击重新匹配按钮
                setTimeout(() => {
                    console.log('[SSBY] 开始查找重新匹配按钮');
                    autoClickRematch();
                }, 500);
            }
        }

        // 站点"连接已断开"弹框是否可见
        function isDisconnectedPopupVisible() {
            const dialogs = document.querySelectorAll('.custom-popup-dialog');
            for (let i = 0; i < dialogs.length; i++) {
                const el = dialogs[i];
                if (!el.textContent || el.textContent.indexOf('连接已断开') < 0) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return true;
            }
            return false;
        }

        // 一键开启兼容模式（与设置里的开关共用同一状态）
        function enableNetCompat() {
            netCompatEnabled = true;
            try { localStorage.setItem('netCompatEnabled', 'true'); } catch (e) {}
            const t = document.querySelector('#netCompatToggle');
            if (t) {
                t.classList.add('active');
                t.setAttribute('aria-checked', 'true');
            }
            console.log('[SSBY] 已通过断连提示开启兼容模式');
            showToast('已开启兼容模式');
        }

        // 检测到断连弹框时，引导用户开启兼容模式
        function showDisconnectTip() {
            if (document.querySelector('.at-disconnect-tip-mask')) return;
            const mask = document.createElement('div');
            mask.className = 'at-confirm-mask at-disconnect-tip-mask';
            const modal = document.createElement('div');
            modal.className = 'at-modal';
            modal.innerHTML = `
                <div class="at-modal-title">检测到连接断开</div>
                <div class="at-modal-content">可能是网络不稳定或浏览器多开导致。开启「网络不稳定兼容模式」后，脚本会改用页面点击方式切换，可明显减少断连。<br><br>也可以先点页面上的「确认」恢复后再决定。</div>
                <div class="at-modal-footer">
                    <button class="at-modal-btn at-modal-btn-cancel" id="atDisconnectLaterBtn">稍后</button>
                    <button class="at-modal-btn at-modal-btn-primary" id="atDisconnectEnableBtn">开启兼容模式</button>
                </div>
            `;
            mask.appendChild(modal);
            document.body.appendChild(mask);
            mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
            modal.querySelector('#atDisconnectLaterBtn').onclick = function () { mask.remove(); };
            modal.querySelector('#atDisconnectEnableBtn').onclick = function () {
                enableNetCompat();
                mask.remove();
            };
        }

        // 读取当前对方ID：只认 WS 帧里的 partnerIdEncrypted（chatId 是随机会话号，不能当身份用）
        function getCurrentPartnerId() {
            const uid = SocketBridge.getPartnerUserId ? SocketBridge.getPartnerUserId() : '';
            return uid ? String(uid) : null;
        }

        // 当前对方是否已被拉黑（刚手动拉黑的当前会话先放行，避免把正在看的人立即踢掉）
        function isPartnerBlocked() {
            const id = getCurrentPartnerId();
            if (!id) return false;
            if (id === blockJustNowChatId) return false;
            return blockList.indexOf(id) >= 0;
        }

        function saveBlockList() {
            try {
                localStorage.setItem(BLOCK_LIST_KEY, JSON.stringify(blockList));
            } catch (e) {
                console.log('[SSBY] 保存黑名单失败:', e);
            }
        }

        // 拉黑 / 取消拉黑当前对方
        function togglePartnerBlock() {
            const id = getCurrentPartnerId();
            if (!id) {
                showToast('未检测到对方ID，无法拉黑');
                return;
            }
            const idx = blockList.indexOf(id);
            if (idx >= 0) {
                blockList.splice(idx, 1);
                if (blockJustNowChatId === id) blockJustNowChatId = null;
                saveBlockList();
                console.log('[SSBY] 已取消拉黑:', id);
                showToast('已取消拉黑');
            } else {
                blockList.push(id);
                blockJustNowChatId = id; // 当前会话暂不跳过，等本轮结束再遇到才生效
                saveBlockList();
                console.log('[SSBY] 已拉黑:', id);
                showToast('已拉黑该用户');
            }
            updateBlockBtnState();
        }

        // 同步拉黑按钮的视觉状态（红色 = 当前对方已在黑名单）
        function updateBlockBtnState() {
            const id = getCurrentPartnerId();
            const blocked = !!id && blockList.indexOf(id) >= 0;
            blockBtn.classList.toggle('blocked', blocked);
            blockBtn.title = blocked ? '取消拉黑' : '拉黑对方';
        }

        // 自动聊天逻辑（性能优化版）
        function autoChatLoop() {
            loopCount++;
            console.log('[SSBY] ========== autoChatLoop() 开始 (第', loopCount, '次) ==========');
            console.log('[SSBY] 状态: 接口加速=' + (SocketBridge.isActive() ? '启用' : '未启用'));

            // 检测站点"连接已断开"弹框：已是兼容模式则完全不检测、不提示
            if (!netCompatEnabled) {
                const disconnected = isDisconnectedPopupVisible();
                if (!disconnected) {
                    disconnectTipShown = false; // 弹框已消失，下次再出现可再次提示
                } else if (!disconnectTipShown) {
                    disconnectTipShown = true;
                    showDisconnectTip();
                }
            }

            // 命中黑名单：直接跳过继续刷（刚手动拉黑的当前会话除外）
            if (isPartnerBlocked()) {
                console.log('[SSBY] 命中黑名单，跳过继续刷:', getCurrentPartnerId());
                leave();
                loopCount = 0;
                console.log('[SSBY] ========== autoChatLoop() 结束 ==========');
                return;
            }

            // 获取性别信息（带缓存）
            const genderInfo = getGenderInfo();

            // 判断女生
            if (genderInfo && genderInfo.includes("女生")) {
                console.log('[SSBY] 检测到女生');

                if (isPartnerLeft()) {
                    // 女生离开，检查是否开启继续刷
                    if (autoLeaveEnabled) {
                        console.log('[SSBY] 女生离开，继续刷');
                        leave();
                        loopCount = 0;
                    } else {
                        console.log('[SSBY] 女生离开，但开关未开启，不执行离开');
                    }
                } else {
                    // 检查是否已经打过招呼
                    const currentGreeted = hasSentMessage();

                    // 检测打招呼状态变化
                    if (currentGreeted !== lastGreeted) {
                        console.log('[SSBY] 打招呼状态变化:', lastGreeted, '->', currentGreeted);
                        lastGreeted = currentGreeted;
                    }

                    if (currentGreeted) {
                        console.log('[SSBY] 已经打过招呼，跳过');
                        // 只有对方真正聊了两句以上才降频；否则保持快速，方便对方秒退后立刻重刷
                        if (partnerMessageCount >= PARTNER_REPLY_THRESHOLD) {
                            console.log('[SSBY] 对方已回复', partnerMessageCount, '条，降低循环频率');
                            adjustLoopSpeed(true);
                        } else {
                            console.log('[SSBY] 对方仅回复', partnerMessageCount, '条，保持快速循环');
                            adjustLoopSpeed(false);
                        }
                    } else {
                        console.log('[SSBY] 留下并打招呼');
                        stay();
                        // 调整为快速循环
                        adjustLoopSpeed(false);
                    }
                }
            } else if (genderInfo && genderInfo.includes("男生")) {
                console.log('[SSBY] 检测到男生，执行离开');
                leave();
                loopCount = 0;
            } else {
                console.log('[SSBY] 未检测到性别信息');
            }
            console.log('[SSBY] ========== autoChatLoop() 结束 ==========');
        }

        // 调整循环速度
        function adjustLoopSpeed(slowMode) {
            if (!timer) return;
            
            const newInterval = slowMode ? SLOW_LOOP_INTERVAL : FAST_LOOP_INTERVAL;
            
            // 如果已经是目标间隔，不调整
            if (currentLoopInterval === newInterval) return;
            
            // 清除旧定时器，启动新定时器
            clearInterval(timer);
            currentLoopInterval = newInterval;
            timer = setInterval(autoChatLoop, newInterval);
            console.log('[SSBY] 调整循环速度:', newInterval, 'ms');
        }

        // 自动点击重新匹配按钮
        function autoClickRematch() {
            console.log('[SSBY] autoClickRematch() 函数被调用');
            // 方法1：通过类名查找
            const rematchBtns = document.querySelectorAll('.rematch-btn');
            console.log('[SSBY] 找到', rematchBtns.length, '个rematch-btn元素');
            for (let btn of rematchBtns) {
                const text = btn.textContent || '';
                console.log('[SSBY] rematch-btn 文本:', text);
                if (text.includes('重新匹配')) {
                    console.log('[SSBY] 找到重新匹配按钮（通过类名），准备点击');
                    btn.click();
                    return;
                }
            }

            // 方法2：遍历所有uni-view查找包含"重新匹配"的按钮
            const allViews = document.querySelectorAll('uni-view');
            console.log('[SSBY] 遍历', allViews.length, '个uni-view元素查找重新匹配按钮');
            for (let btn of allViews) {
                const text = btn.textContent || '';
                if (text === '重新匹配' || (text.includes('重新匹配') && text.trim() === '重新匹配')) {
                    console.log('[SSBY] 找到重新匹配按钮（通过遍历），准备点击');
                    btn.click();
                    return;
                }
            }
            console.log('[SSBY] 未找到重新匹配按钮');
        }

        // 点击离开聊天按钮
        function clickLeaveChatButton() {
            console.log('[SSBY] clickLeaveChatButton() 函数被调用');
            // 只在 partner-left-controls 容器内查找"离开聊天"按钮
            const controlsContainer = document.querySelector('.partner-left-controls');
            console.log('[SSBY] partner-left-controls 容器:', controlsContainer);
            if (controlsContainer) {
                const views = controlsContainer.querySelectorAll('uni-view');
                console.log('[SSBY] 在容器内找到', views.length, '个uni-view元素');
                for (let btn of views) {
                    const text = btn.textContent || '';
                    console.log('[SSBY] 检查按钮文本:', text);
                    if (text === '离开聊天' || text.includes('离开聊天')) {
                        console.log('[SSBY] 找到离开聊天按钮，准备点击');
                        btn.click();
                        return true;
                    }
                }
            }
            return clickLeaveButton();
        }

// 点击离开按钮（聊天界面中的"离开"按钮）
        function clickLeaveButton() {
            console.log('[SSBY] clickLeaveButton() 函数被调用');
            // 通过类名查找"离开"按钮
            const leaveBtn = document.querySelector('.leave-btn');
            console.log('[SSBY] leave-btn 元素:', leaveBtn);
            if (leaveBtn) {
                const text = leaveBtn.textContent || '';
                console.log('[SSBY] leave-btn 文本:', text);
                if (text === '离开' || text.includes('离开')) {
                    console.log('[SSBY] 找到离开按钮，准备点击');
                    leaveBtn.click();

                    // 延迟点击确认离开按钮（等待弹窗显示）
                    setTimeout(() => {
                        console.log('[SSBY] 开始查找确认离开弹窗按钮');
                        const confirmBtns = document.querySelectorAll('.uni-modal__btn_primary');
                        console.log('[SSBY] 找到', confirmBtns.length, '个uni-modal__btn_primary元素');
                        for (let btn of confirmBtns) {
                            const btnText = btn.textContent || '';
                            console.log('[SSBY] 按钮文本:', btnText);
                            if (btnText === '确认离开' || btnText.includes('确认离开')) {
                                console.log('[SSBY] 找到确认离开按钮，准备点击');
                                btn.click();
                                return true;
                            }
                        }
                        console.log('[SSBY] 未找到确认离开按钮');
                    }, 500); // 延迟500毫秒等待弹窗显示

                    return true;
                }
            }
            console.log('[SSBY] 未找到离开按钮');
            return false;
        }


        // 获取性别信息（带缓存）
        function getGenderInfo() {
            // 接口快通道：优先读取 socket 搭档资料
            if (SocketBridge.isActive()) {
                const p = SocketBridge.takePartner();
                if (p) {
                    if (p.gender === '男') adjustLoopSpeed(false);
                    console.log('[SSBY] 接口快通道读取性别:', p.gender === '男' ? '男生' : '女生');
                    return p.gender === '男' ? '男生' : '女生';
                }
                console.log('[SSBY] 接口缓存为空，回退 DOM 扫描性别');
            }
            const spans = document.querySelectorAll('span');
            console.log('[SSBY] 找到', spans.length, '个span元素');

            // 遍历查找性别信息
            for (let span of spans) {
                const text = span.textContent || '';
                if (text.includes('女生') || text.includes('男生')) {
                    console.log('[SSBY] 找到性别信息:', text);
                    console.log('[SSBY] 性别来源: DOM 扫描');

                    // 检查性别是否变化
                    if (lastGenderInfo !== text) {
                        console.log('[SSBY] 性别信息变化:', lastGenderInfo, '->', text);
                        lastGenderInfo = text;

                        // 如果是男生，立即设置为快速循环
                        if (text.includes('男生')) {
                            adjustLoopSpeed(false);
                        }
                    }
                    return text;
                }
            }

            // 如果之前有性别信息但现在找不到，清空缓存
            if (lastGenderInfo) {
                console.log('[SSBY] 性别信息消失，清空缓存');
                lastGenderInfo = null;
            }

            console.log('[SSBY] 未找到性别信息');
            return null;
        }

        // 对方是否已离开
        function isPartnerLeft() {
            const noticeEl = document.querySelector('.notice-message');
            if (noticeEl) {
                const text = noticeEl.textContent;
                const leftMessages = [
                    '对方离开了',
                    '您断开了连线',
                ];
                const result = leftMessages.some(msg => text.includes(msg));

                // 状态变化时才输出日志
                if (result !== lastPartnerLeft) {
                    console.log('[SSBY] 对方离开状态变化:', lastPartnerLeft, '->', result);
                    lastPartnerLeft = result;
                }
                return result;
            }
            return false;
        }

        // 获取消息输入框
        function getMsgInput() {
            return document.querySelector('#messageTextarea textarea') ||
                document.querySelector('.message-input textarea');
        }

        // 拖动逻辑
        let isDragging = false;
        let dragStarted = false;
        let dragStartX = 0, dragStartY = 0;
        let rootStartX = 0, rootStartY = 0;
        let lastTouchTs = 0; // 最近一次触摸时间，用于忽略触摸后浏览器补发的合成鼠标事件
        const DRAG_THRESHOLD = 5; // 超过5px才算拖动

        // 不恢复保存的位置，每次都使用CSS定义的固定初始位置（仍可拖动移动）
        // 初始化面板方向（需要在DOM添加后执行，这里先声明，在appendChild后调用）

        function clampPosition(x, y) {
            const w = root.offsetWidth || 64;
            const h = root.offsetHeight || 64;
            const maxX = window.innerWidth - w;
            const maxY = window.innerHeight - h;
            return {
                left: Math.max(0, Math.min(x, maxX)),
                top: Math.max(0, Math.min(y, maxY))
            };
        }

        function onDragStart(clientX, clientY) {
            isDragging = true;
            dragStarted = false;
            dragStartX = clientX;
            dragStartY = clientY;
            rootStartX = root.offsetLeft;
            rootStartY = root.offsetTop;
        }

        function onDragMove(clientX, clientY) {
            if (!isDragging) return;
            const dx = clientX - dragStartX;
            const dy = clientY - dragStartY;
            if (!dragStarted && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                dragStarted = true;
            }
            if (dragStarted) {
                const pos = clampPosition(rootStartX + dx, rootStartY + dy);
                root.style.left = pos.left + 'px';
                root.style.top = pos.top + 'px';
            }
        }

        function updatePanelDirection() {
            const centerX = root.offsetLeft + (root.offsetWidth || 64) / 2;
            if (centerX < window.innerWidth / 2) {
                root.classList.add('panel-left');
            } else {
                root.classList.remove('panel-left');
            }
        }

        function onDragEnd() {
            if (!isDragging) return;
            isDragging = false;
            if (dragStarted) {
                // 拖动了，重置单击计数
                singleClickCount = 0;
                if (singleClickTimer) { clearTimeout(singleClickTimer); singleClickTimer = null; }
                // 不保存位置，下次打开重置到固定初始位置
                updatePanelDirection();
                // 拖动了就不触发点击
                return;
            }
            // 没拖动则视为单击
            singleClickCount++;
            // 清除之前的定时器
            if (singleClickTimer) clearTimeout(singleClickTimer);
            // 800ms内累计点击，超时重置
            singleClickTimer = setTimeout(() => {
                singleClickCount = 0;
                singleClickTimer = null;
            }, 800);
            // 偶数次 = 完成一次双击
            if (singleClickCount % 2 === 1) {
                // 奇数次（第1、3、5...次），等待下一次点击
            } else {
                // 偶数次（第2、4...次）= 双击完成
                if (!hasShownTip) {
                    // 首次双击 → 提示用户，不打开菜单
                    showDoubleClickTip();
                    hasShownTip = true;
                } else {
                    // 之后的双击 → 正常打开/关闭菜单
                    updatePanelDirection();
                    isOpen = !isOpen;
                    root.classList.toggle('open', isOpen);
                    if (isOpen) updateBlockBtnState(); // 打开菜单时同步拉黑按钮状态
                }
                singleClickCount = 0;
                if (singleClickTimer) { clearTimeout(singleClickTimer); singleClickTimer = null; }
            }
        }

        // 显示双击提示
        function showDoubleClickTip() {
            if (document.querySelector('.at-double-click-tip')) return;
            const tip = document.createElement('div');
            tip.className = 'at-double-click-tip';
            tip.textContent = '👆 双击可打开菜单 拖拽可移动';
            document.body.appendChild(tip);
            // 触发动画
            requestAnimationFrame(() => {
                tip.classList.add('show');
            });
            // 2秒后自动消失
            setTimeout(() => {
                tip.classList.remove('show');
                setTimeout(() => { tip.remove(); }, 300);
            }, 2000);
        }

        // 通用轻提示（复用双击提示的样式，保证反馈风格统一）
        function showToast(text) {
            const old = document.querySelector('.at-double-click-tip');
            if (old) old.remove();
            const tip = document.createElement('div');
            tip.className = 'at-double-click-tip';
            tip.textContent = text;
            document.body.appendChild(tip);
            requestAnimationFrame(() => { tip.classList.add('show'); });
            setTimeout(() => {
                tip.classList.remove('show');
                setTimeout(() => { tip.remove(); }, 300);
            }, 1800);
        }

        // 重置黑名单的二次确认弹框
        function showResetBlockConfirm() {
            if (document.querySelector('.at-confirm-mask')) return;
            const mask = document.createElement('div');
            mask.className = 'at-confirm-mask';
            const modal = document.createElement('div');
            modal.className = 'at-modal';
            modal.innerHTML = `
                <div class="at-modal-title">重置黑名单</div>
                <div class="at-modal-content">确定要清空黑名单吗？清空后，已拉黑的用户将不再被自动跳过。</div>
                <div class="at-modal-footer">
                    <button class="at-modal-btn at-modal-btn-cancel" id="atConfirmCancelBtn">取消</button>
                    <button class="at-modal-btn at-modal-btn-danger" id="atConfirmOkBtn">确认清空</button>
                </div>
            `;
            mask.appendChild(modal);
            document.body.appendChild(mask);
            mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
            modal.querySelector('#atConfirmCancelBtn').onclick = function () { mask.remove(); };
            modal.querySelector('#atConfirmOkBtn').onclick = function () {
                blockList = [];
                saveBlockList();
                mask.remove();
                // 设置弹框仍开着，同步按钮上的数量
                const btn = document.querySelector('#atResetBlockBtn');
                if (btn) btn.textContent = '清空（0）';
                console.log('[SSBY] 黑名单已清空');
                showToast('黑名单已清空');
            };
        }

        // 鼠标事件
        mainBtn.addEventListener('mousedown', function(e) {
            // 触摸后浏览器补发的合成鼠标事件，忽略，避免单击被重复计数成"双击"
            if (Date.now() - lastTouchTs < 600) return;
            e.preventDefault();
            onDragStart(e.clientX, e.clientY);
        });
        document.addEventListener('mousemove', function(e) {
            if (isDragging) {
                e.preventDefault();
                onDragMove(e.clientX, e.clientY);
            }
        });
        document.addEventListener('mouseup', function() {
            // 触摸后浏览器补发的合成鼠标事件，忽略
            if (Date.now() - lastTouchTs < 600) return;
            onDragEnd();
        });

        // 触摸事件
        mainBtn.addEventListener('touchstart', function(e) {
            lastTouchTs = Date.now();
            if (e.touches.length === 1) {
                const t = e.touches[0];
                onDragStart(t.clientX, t.clientY);
            }
        }, { passive: true });
        document.addEventListener('touchmove', function(e) {
            if (isDragging && dragStarted) {
                e.preventDefault();
            }
            if (isDragging && e.touches.length === 1) {
                const t = e.touches[0];
                onDragMove(t.clientX, t.clientY);
            }
        }, { passive: false });
        document.addEventListener('touchend', function() {
            lastTouchTs = Date.now();
            onDragEnd();
        });

        // 组装
        panel.appendChild(switchBtn);
        panel.appendChild(settingBtn);
        panel.appendChild(vipBtn);
        panel.appendChild(blockBtn);
        blockBtn.onclick = togglePartnerBlock;
        root.appendChild(mainBtn);
        root.appendChild(panel);
        document.body.appendChild(root);
        SocketBridge.bind({
            isOn: function () { return isOn; },
            fallbackLeave: domLeave,
            // 累计对方发来的消息条数，用于判断是否已聊够两句再降频
            // 只有当前会话已建立（收到 connected）才统计对方行为，避免匹配期间的服务端事件污染计数
            onPartnerMessage: function () {
                if (!SocketBridge.getSessionStart || !SocketBridge.getSessionStart()) return;
                partnerMessageCount++;
                console.log('[SSBY] 对方消息计数:', partnerMessageCount);
            },
            // 对方任意反馈（除心跳）都算有回应，取消超时跳过
            onPartnerActivity: function (event) {
                if (!SocketBridge.getSessionStart || !SocketBridge.getSessionStart()) return;
                partnerActivityCount++;
                if (silentTimer) {
                    console.log('[SSBY] 对方有反馈（' + event + '），取消超时跳过');
                }
                clearSilentTimer();
            }
        });
        // 初始化呼吸光
        updateBreath(state);
        // 初始化面板展开方向
        updatePanelDirection();
    }

    // 初始化
    console.log('[SSBY] ========== 脚本开始初始化 ==========');
    // document-start 下需等 body 就绪再挂载悬浮球（接口桥接已在顶部提前安装）
    if (document.body) {
        createAssistiveTouchMenu();
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            createAssistiveTouchMenu();
        }, { once: true });
    }
    console.log('[SSBY] ========== 脚本初始化完成 ==========');
})();


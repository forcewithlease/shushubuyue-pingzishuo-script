// ==UserScript==
// @name         桃趣乐友叔叔不约小助手
// @namespace    https://www.shushubuyue.net/
// @version      2.4
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
// @license      Apache License 2.0
// ==/UserScript==

(function() {
    'use strict';

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
            transition: box-shadow 0.2s, background 0.2s;
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
        .at-modal-btn-save {
            background: #3a7afe;
            color: #fff;
        }
        .at-modal-btn-save:hover {
            background: #2563eb;
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
        // 问候语（JSON数组）
        let greetingList = [];
        try {
            const saved = localStorage.getItem('ssby_greeting_list');
            if (saved) {
                greetingList = JSON.parse(saved);
            }
        } catch (e) {}
        if (!Array.isArray(greetingList) || greetingList.length === 0) {
            greetingList = ['哈喽', '你好呀', '很高兴认识你！', '嗨～'];
        }
        // 循环定时器
        let timer = null;
        let state = 'blue';
        let greenTimer = null;
        let isTyping = false;
        // 当前选中的问候语（固定住，避免每轮循环随机变化）
        let currentGreeting = '';

        // 连续单击计数（用于检测误操作提示双击）
        let singleClickCount = 0;
        let singleClickTimer = null;
        // 是否已经提示过（首次双击提示，之后才真正响应）
        let hasShownTip = false;

        // 性能优化：缓存状态
        let lastChatId = null;
        let lastGenderInfo = null;
        let lastPartnerLeft = false;
        let lastGreeted = false;
        let lastSelfMessageCount = 0;
        let loopCount = 0;
        let currentLoopInterval = 1000; // 当前循环间隔
        const SLOW_LOOP_INTERVAL = 5000; // 慢速循环间隔（已打招呼后）
        const FAST_LOOP_INTERVAL = 1000; // 快速循环间隔

        // 女生离开继续刷开关（从localStorage读取）
        let autoLeaveEnabled = false;
        try {
            autoLeaveEnabled = localStorage.getItem('autoLeaveEnabled') === 'true';
            console.log('[SSBY] 女生离开继续刷开关:', autoLeaveEnabled);
        } catch (e) {
            console.log('[SSBY] 读取autoLeaveEnabled失败:', e);
        }

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
                updateBreath('blue');
            }
        };

        // 设置面板弹窗
        function showSettingModal() {
            if (document.querySelector('.at-modal-mask')) return;
            const mask = document.createElement('div');
            mask.className = 'at-modal-mask';
            const modal = document.createElement('div');
            modal.className = 'at-modal';

            // 构建问候语列表HTML
            function buildGreetingListHTML() {
                let html = '';
                greetingList.forEach((item, index) => {
                    html += `
                        <div class="at-greeting-item" data-index="${index}">
                            <span class="at-greeting-drag">⋮⋮</span>
                            <input class="at-greeting-text" type="text" value="${item.replace(/"/g, '&quot;')}" maxlength="20" />
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
                        <span>💡</span><span>最多可添加 6 条问候语，拖动可调整顺序</span>
                    </div>
                </div>
                <div class="at-auto-leave-switch">
                    <span class="at-auto-leave-switch-label">女生离开继续刷：</span>
                    <div id="autoLeaveToggle" class="at-auto-leave-switch-toggle" role="switch" tabindex="0" aria-checked="false"></div>
                </div>
                <div class="at-modal-footer">
                    <button class="at-modal-btn at-modal-btn-cancel" id="atSettingsCancelBtn">取消</button>
                    <button class="at-modal-btn at-modal-btn-save" id="atSettingsSaveBtn">保存</button>
                </div>
            `;
            mask.appendChild(modal);
            document.body.appendChild(mask);

            // 关闭事件
            modal.querySelector('.at-modal-close').onclick = () => mask.remove();
            mask.onclick = e => { if (e.target === mask) mask.remove(); };

            // 取消按钮
            modal.querySelector('#atSettingsCancelBtn').onclick = () => mask.remove();

            // 保存按钮
            modal.querySelector('#atSettingsSaveBtn').onclick = function() {
                // 收集所有输入框的值
                const inputs = modal.querySelectorAll('.at-greeting-text');
                const newList = [];
                inputs.forEach(input => {
                    const val = input.value.trim();
                    if (val) newList.push(val);
                });
                greetingList = newList.length > 0 ? newList : ['哈喽'];
                try {
                    localStorage.setItem('ssby_greeting_list', JSON.stringify(greetingList));
                    console.log('[SSBY] 问候语列表已保存:', greetingList);
                } catch (e) {}
                mask.remove();
            };

            // 添加问候语
            modal.querySelector('#atGreetingAddBtn').onclick = function() {
                if (greetingList.length >= 6) return;
                greetingList.push('');
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
                        const idx = parseInt(this.dataset.index);
                        greetingList.splice(idx, 1);
                        renderGreetingList();
                    };
                });
                // 输入框变化时同步到greetingList
                modal.querySelectorAll('.at-greeting-text').forEach(input => {
                    input.oninput = function() {
                        const item = this.closest('.at-greeting-item');
                        const idx = parseInt(item.dataset.index);
                        greetingList[idx] = this.value.trim();
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
            modal.querySelector('.at-vip-copy').onclick = copyTQLY;
            modal.querySelector('.at-vip-modal-title-copy').onclick = copyTQLY;
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

        // 打招呼
        function stay() {
            console.log('[SSBY] stay() 函数被调用');
            if (isTyping) {
                console.log('[SSBY] 正在输入中，跳过');
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
                if (!Array.isArray(greetingList) || greetingList.length === 0) {
                    greetingList = ['哈喽', '你好呀', '很高兴认识你！', '嗨～'];
                }
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
                    }
                }
                if (state === 'green') {
                    state = 'blue';
                    updateBreath(state);
                }
                if (!greenTimer && state !== 'green') {
                    greenTimer = setTimeout(() => {
                        state = 'green';
                        updateBreath(state);
                    }, 210000);
                }
            });
        }

        // 离开
        function leave() {
            console.log('[SSBY] leave() 函数被调用');
            if (greenTimer) {
                clearTimeout(greenTimer);
                greenTimer = null;
            }
            if (state !== 'blue') {
                state = 'blue';
                updateBreath(state);
            }

            adjustLoopSpeed(false);

            // 重置缓存
            lastChatId = null;
            lastGenderInfo = null;
            lastGreeted = false;
            lastSelfMessageCount = 0;
            currentGreeting = ''; // 重置问候语，下次打招呼重新随机选一条

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

        // 是否离开了
        function isPartnerLeft() {
            const noticeEl = document.querySelector('.notice-message');
            if (noticeEl) {
                const text = noticeEl.textContent;
                const leftMessages = [
                    '对方离开了',
                    '您断开了连线',
                ];
                const result = leftMessages.some(msg => text.includes(msg));
                // 只在状态变化时输出日志
                if (result !== lastPartnerLeft) {
                    console.log('[SSBY] 对方离开状态变化:', lastPartnerLeft, '->', result);
                    lastPartnerLeft = result;
                }
                return result;
            }
            return false;
        }

        // 自动聊天逻辑（性能优化版）
        function autoChatLoop() {
            loopCount++;
            console.log('[SSBY] ========== autoChatLoop() 开始 (第', loopCount, '次) ==========');

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
                        // 如果已经打招呼，降低循环频率
                        adjustLoopSpeed(true);
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
            clickLeaveButton()

            return false;
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


        // 判断是否已经打过招呼（localStorage标记 + DOM检测）
        function hasGreeted() {
            const chatStateKey = 'bottle_chat_state';
            let chatId = null;
            try {
                const stateData = localStorage.getItem(chatStateKey);
                if (stateData) {
                    const chatState = JSON.parse(stateData);
                    chatId = chatState?.chatId || null;
                    console.log('[SSBY] 当前chatId:', chatId);
                    if (chatId) {
                        const greetedKey = `bottle_chat_${chatId}`;
                        const hasGreeted = localStorage.getItem(greetedKey) === 'true';
                        console.log('[SSBY] localStorage标记已打招呼:', hasGreeted);
                        if (hasGreeted) {
                            return true;
                        }
                    }
                }
            } catch (e) {
                console.log('[SSBY] 解析chatState失败:', e);
            }
            
            // 方法2：通过DOM检测
            if (hasSentMessage()) {
                console.log('[SSBY] DOM检测已说过话，更新localStorage标记');
                // 同时更新localStorage标记
                if (chatId) {
                    localStorage.setItem(`bottle_chat_${chatId}`, 'true');
                }
                return true;
            }
            
            return false;
        }

        // 获取性别信息（带缓存）
        function getGenderInfo() {
            const spans = document.querySelectorAll('span');
            console.log('[SSBY] 找到', spans.length, '个span元素');

            // 遍历查找性别信息
            for (let span of spans) {
                const text = span.textContent || '';
                if (text.includes('女生') || text.includes('男生')) {
                    console.log('[SSBY] 找到性别信息:', text);

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

        // 是否离开了（带缓存）
        function isPartnerLeft() {
            const noticeEl = document.querySelector('.notice-message');
            if (noticeEl) {
                const text = noticeEl.textContent;
                const leftMessages = [
                    '对方离开了',
                    '您断开了连线',
                ];
                const result = leftMessages.some(msg => text.includes(msg));
                
                // 检测到状态变化才输出日志
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

        // 鼠标事件
        mainBtn.addEventListener('mousedown', function(e) {
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
            onDragEnd();
        });

        // 触摸事件
        mainBtn.addEventListener('touchstart', function(e) {
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
            onDragEnd();
        });

        // 组装
        panel.appendChild(switchBtn);
        panel.appendChild(settingBtn);
        panel.appendChild(vipBtn);
        root.appendChild(mainBtn);
        root.appendChild(panel);
        document.body.appendChild(root);
        // 初始化呼吸光
        updateBreath(state);
        // 初始化面板展开方向
        updatePanelDirection();
    }

    // 初始化
    console.log('[SSBY] ========== 脚本开始初始化 ==========');
    createAssistiveTouchMenu();
    console.log('[SSBY] ========== 脚本初始化完成 ==========');
})();


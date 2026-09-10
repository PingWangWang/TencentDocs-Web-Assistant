// ==UserScript==
// @name         Tencent Docs Web Assistant — 腾讯文档Web助手
// @namespace    https://github.com/PingWangWang
// @version      1.6.5
// @description  腾讯文档网页增强助手：①桌面版(desktop)左侧目录栏可拖拽调宽，内层目录自适应不截断文字；②文档页(doc)左侧大纲面板可拖拽调宽，正文内容同步右移不遮挡；③宽度自动记忆，双击分隔条恢复默认；④右下角齿轮悬浮按钮打开设置面板，可一键开关"自动关闭 AI 助手面板"，点击立即生效；齿轮可自由拖动摆放（位置自动记忆），避免遮挡内容；⑤主题切换：浅色/深色/护眼（豆沙绿）三档，即时生效并记忆。
// @author       PingWangWang
// @icon         https://docs.qq.com/favicon.ico
// @match        https://docs.qq.com/desktop/*
// @match        https://docs.qq.com/home*
// @match        https://docs.qq.com/doc/*
// @match        https://docs.qq.com/sheet/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /********************* 配置 *********************/
  var KEY_DESKTOP_W = 'td_sidebar_width';      // desktop 目录栏宽度
  var KEY_OUTLINE_W = 'td_outline_width';      // doc 大纲面板宽度
  var KEY_GEAR_POS = 'td_gear_pos';            // 齿轮悬浮按钮位置 {x,y}
  var SETTING_AI = 'td_auto_close_ai';
  var KEY_THEME = 'td_theme';                // 主题模式：light / dark / sepia
  var GEAR_SIZE = 28;        // 齿轮按钮直径(px)
  var GEAR_MARGIN = 16;      // 默认距视口边缘间距(px)
  var GEAR_DRAG_THRESHOLD = 4; // 超过该位移(px)判定为拖动而非点击
  var DEFAULT_WIDTH = 240;   // desktop 目录栏默认宽度
  var OUTLINE_DEFAULT = 256; // doc 大纲默认宽度（实测内联 width:256px）
  var MIN_WIDTH = 160;
  var OUTLINE_MIN = 216;     // 官方 min-width:216px
  var MAX_WIDTH = 560;
  var OUTLINE_MAX = 600;
  var HANDLE_W = 8;          // 分隔条命中区域宽度(px)
  var CONTENT_GAP = 12;      // 大纲拉宽后与正文的保证间距(px)

  /********************* 主题定义 *********************/
  var THEME_ORDER = ['light', 'dark', 'sepia'];
  var THEMES = {
    light: { label: '浅色', hint: '官方默认' },
    dark:  { label: '深色', hint: '夜间反色' },
    sepia: { label: '护眼', hint: '豆沙绿' }
  };
  var DEFAULT_THEME = 'light';
  var THEME_STYLE_ID = 'td-theme-style';
  var THEME_OVERLAY_ID = 'td-theme-overlay';      // 蒙层容器（内含提亮层/护眼层）
  var SEPIA_COLOR = '#c7edcc';   // 护眼豆沙绿
  var DARK_LIFT_COLOR = '#1c1f24'; // 深色提亮底色：把反色后的纯黑抬到深灰，避免纯黑刺眼

  /********************* 工具 *********************/
  function $(sel, root) { return (root || document).querySelector(sel); }

  /** 设置存储：优先 GM_*，无 Tampermonkey 环境时回退 localStorage */
  var store = {
    get: function (k) {
      try { if (typeof GM_getValue === 'function') { var v = GM_getValue(k, null); if (v !== null && v !== undefined) return v; } } catch (e) {}
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set: function (k, val) {
      try { if (typeof GM_setValue === 'function') GM_setValue(k, val); } catch (e) {}
      try { localStorage.setItem(k, String(val)); } catch (e) {}
    },
    del: function (k) {
      try { if (typeof GM_setValue === 'function') GM_setValue(k, null); } catch (e) {}
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  function clamp(w, min, max) { return Math.max(min, Math.min(max, w)); }

  /********************* 设置项：自动关闭 AI 助手面板 *********************/
  function getAutoCloseAi() { return store.get(SETTING_AI) === '1'; }
  function setAutoCloseAi(on) { store.set(SETTING_AI, on ? '1' : '0'); refreshMenu(); }

  var menuId = null;
  var themeMenuId = null;
  function refreshMenu() {
    var label = '⚙️ 设置：自动关闭右侧 AI 助手面板（当前：' + (getAutoCloseAi() ? '开启' : '关闭') + '）';
    var themeLabel = '🎨 主题：切换为「' + THEMES[nextTheme()].label + '」（当前：' + THEMES[getTheme()].label + '）';
    try {
      if (typeof GM_registerMenuCommand !== 'function') return;
      if (menuId !== null && typeof GM_unregisterMenuCommand === 'function') GM_unregisterMenuCommand(menuId);
      menuId = GM_registerMenuCommand(label, function () {
        applyAutoCloseAi(!getAutoCloseAi());
      });
      if (themeMenuId !== null && typeof GM_unregisterMenuCommand === 'function') GM_unregisterMenuCommand(themeMenuId);
      themeMenuId = GM_registerMenuCommand(themeLabel, function () {
        setTheme(nextTheme());   // 浅色 → 深色 → 护眼 → 浅色 循环
      });
    } catch (e) { /* 非油猴环境忽略 */ }
  }

  /********************* 分隔条 UI（桌面版 & 文档页共用） *********************/
  var HANDLE_ID = 'td-sidebar-resize-handle';

  function ensureHandleStyle() {
    if ($('#' + HANDLE_ID + '-style')) return;
    var css = [
      // fixed 定位挂 body，避开容器 overflow:hidden 裁剪；rAF 持续贴齐目标右缘
      '#' + HANDLE_ID + '{position:fixed;top:0;left:0;width:' + HANDLE_W + 'px;height:100px;' +
        'cursor:col-resize;z-index:2147483647;user-select:none;-webkit-user-select:none;}',
      '#' + HANDLE_ID + ' .td-rz-line{position:absolute;top:0;left:' + (HANDLE_W / 2 - 1) + 'px;width:2px;height:100%;' +
        'background:transparent;transition:background .15s ease;}',
      '#' + HANDLE_ID + ':hover .td-rz-line, #' + HANDLE_ID + '.td-rz-dragging .td-rz-line{background:#4e83fd;}',
      'body.td-rz-noselect, body.td-rz-noselect *{user-select:none !important;-webkit-user-select:none !important;}',
      'body.td-rz-noselect, body.td-rz-noselect *{cursor:col-resize !important;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = HANDLE_ID + '-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function createHandle() {
    ensureHandleStyle();
    var h = document.createElement('div');
    h.id = HANDLE_ID;
    h.innerHTML = '<div class="td-rz-line"></div>';
    return h;
  }

  /** 让分隔条持续贴齐目标右缘（fixed 定位 + rAF 同步） */
  function syncHandle(target, handle) {
    var r = target.getBoundingClientRect();
    var visible = r.width > 0 && r.height > 0;
    handle.style.display = visible ? 'block' : 'none';
    if (visible) {
      handle.style.top = r.top + 'px';
      handle.style.left = (r.right - HANDLE_W / 2) + 'px';
      handle.style.height = r.height + 'px';
    }
  }

  /**
   * 通用拖动绑定。
   * opts: { min, max, apply(w), commit(w), reset() }
   * apply: 拖动过程中实时应用宽度；commit: 结束后保存；reset: 双击恢复默认
   */
  function attachDrag(target, handle, opts) {
    var dragging = false;

    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = true;
      e.preventDefault();
      e.stopPropagation();
      handle.classList.add('td-rz-dragging');
      document.body.classList.add('td-rz-noselect');
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var rect = target.getBoundingClientRect();
      var w = clamp(Math.round(e.clientX - rect.left), opts.min, opts.max);
      opts.apply(w);
      target.__tdLastW = w;
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('td-rz-dragging');
      document.body.classList.remove('td-rz-noselect');
      var w = target.__tdLastW;
      if (w == null) w = Math.round(target.getBoundingClientRect().width);
      opts.commit(w);
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    });

    handle.addEventListener('dblclick', function (e) {
      e.preventDefault();
      opts.reset();
      try { window.dispatchEvent(new Event('resize')); } catch (err) {}
    });
  }

  /********************* 桌面版（/desktop）目录栏拖宽 *********************/
  /**
   * 定位左侧栏容器。腾讯文档把宽度写在 .desktop-layout-sidebar-pc
   * 的内联 CSS 变量 --sidebar-width 上（实测默认 240px）。
   * 做多级兜底，防止官方改类名导致脚本失效。
   */
  function findSidebar() {
    var el = $('.desktop-layout-sidebar-pc');
    if (el) return el;
    el = document.querySelector('[style*="--sidebar-width"]');
    if (el) return el;
    var nav = $('nav.desktop-sidebar');
    if (nav) {
      var p = nav;
      for (var i = 0; i < 3 && p.parentElement; i++) p = p.parentElement;
      return p;
    }
    return null;
  }

  /********************* 宽度自适应修复（desktop） *********************/
  /**
   * Root cause：官方 CSS 把侧栏叶子层写死为适配 240px 的固定宽度
   * （.rc-tree-treenode 224px / .desktop-sidebar-link 224px /
   *   .rc-tree-node-content-wrapper 208px 等），拉宽 --sidebar-width
   * 后外层全变宽，叶子层不动，导致文字被裁不显示。
   */
  var FIX_STYLE_ID = 'td-sidebar-width-fix-style';
  function injectWidthFix() {
    if ($('#' + FIX_STYLE_ID)) return;
    var css = [
      '.desktop-layout-sidebar-pc .rc-tree-treenode{width:100% !important;max-width:100% !important;min-width:0 !important;}',
      '.desktop-layout-sidebar-pc .rc-tree-node-content-wrapper{flex:1 1 auto !important;width:auto !important;min-width:0 !important;max-width:100% !important;}',
      '.desktop-layout-sidebar-pc .rc-tree-title{width:auto !important;max-width:100% !important;}',
      '.desktop-layout-sidebar-pc .desktop-sidebar-route-link,' +
      '.desktop-layout-sidebar-pc .desktop-sidebar-link,' +
      '.desktop-layout-sidebar-pc .desktop-node-link{width:100% !important;max-width:100% !important;min-width:0 !important;box-sizing:border-box !important;}',
      '.desktop-layout-sidebar-pc .desktop-storage-link-main{width:auto !important;max-width:100% !important;}',
      '.desktop-layout-sidebar-pc .desktop-tree-nav-indicator{width:100% !important;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = FIX_STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyDesktopWidth(sidebar, w) {
    sidebar.style.setProperty('--sidebar-width', w + 'px');
  }

  function mountDesktop() {
    if ($('#' + HANDLE_ID)) return true;
    var sidebar = findSidebar();
    if (!sidebar) return false;

    injectWidthFix();

    var saved = parseInt(store.get(KEY_DESKTOP_W), 10);
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) applyDesktopWidth(sidebar, saved);

    var handle = createHandle();
    attachDrag(sidebar, handle, {
      min: MIN_WIDTH, max: MAX_WIDTH,
      apply: function (w) { applyDesktopWidth(sidebar, w); },
      commit: function (w) { store.set(KEY_DESKTOP_W, w); },
      reset: function () {
        applyDesktopWidth(sidebar, DEFAULT_WIDTH);
        store.del(KEY_DESKTOP_W);
      }
    });
    document.documentElement.appendChild(handle);

    var rafTimer = null;
    var loop = function () {
      if (!document.documentElement.contains(handle) || !document.documentElement.contains(sidebar)) {
        cancelAnimationFrame(rafTimer);
        if (handle.parentNode) handle.parentNode.removeChild(handle);
        setTimeout(start, 1000);
        return;
      }
      syncHandle(sidebar, handle);
      rafTimer = requestAnimationFrame(loop);
    };
    rafTimer = requestAnimationFrame(loop);
    return true;
  }

  /********************* 文档页（/doc）大纲面板拖宽 *********************/
  /**
   * 实测结构：大纲是绝对定位悬浮抽屉
   *   .drawer_drawer-container (w:0) > .drawer_drawer__xxx.drawer_drawer-left__xxx
   *   内联 width:256px; min-width:216px; max-width:332px
   * 正文纸面（[class*="editor-wrapper"]）在 .editor-zone_editor-zone 滚动容器内
   * margin:auto 居中，不随抽屉变宽移动 → 拉宽必须同时给滚动容器
   * 补 padding-left（实验：padding 200px → 纸面右移 100px），保证
   * 纸面左缘 ≥ 抽屉右缘 + CONTENT_GAP，避免遮挡。
   */
  function findOutlineDrawer() {
    var d = document.querySelector('[class*="drawer_drawer__"][class*="drawer_drawer-left"]');
    if (d && d.getBoundingClientRect().width > 50) return d;
    // 兜底：从「大纲」文本向上找绝对定位窄面板
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      if ((n.textContent || '').trim() === '大纲' && n.parentElement) {
        var el = n.parentElement;
        for (var i = 0; i < 10 && el; i++) {
          var r = el.getBoundingClientRect();
          var cs = getComputedStyle(el);
          if (cs.position === 'absolute' && r.width >= 120 && r.width <= 400 && r.left < 100) return el;
          el = el.parentElement;
        }
      }
    }
    return null;
  }

  function findEditorScroller() {
    return document.querySelector('[class*="editor-zone_editor-zone"]');
  }

  function findPaper() {
    return document.querySelector('[class*="editor-wrapper"]') ||
           document.querySelector('[class*="melo-doc-view"]');
  }

  /**
   * 正文列定位（v1.6.2 起默认居中）：
   *  - 内容列比「大纲右缘 ~ 滚动区右缘」的可见区域窄 → 在该区域内水平居中，
   *    不再紧挨目录右侧、右侧留大片空白；
   *  - 内容列过宽放不下 → 退回原防遮挡逻辑（左缘 = 大纲右缘 + CONTENT_GAP）。
   * 仍走增量控制器（增益 1 + ±2px 死区）：padding→纸面位移系数 0<s≤1 时
   * 单调收敛（增益 2 在 s=1 实站会振荡，实测踩坑），目标从「防遮挡线」
   * 换成「居中线」不改变收敛性质。
   */
  function syncContentShift(drawer) {
    var scroller = findEditorScroller();
    var paper = findPaper();
    if (!scroller || !paper) return;
    var dr = drawer.getBoundingClientRect();
    var pr = paper.getBoundingClientRect();
    if (dr.width === 0 || pr.width === 0) return;
    // 右边界用 clientWidth：剔除滚动条宽度，居中不受其影响
    var rightEdge = scroller.getBoundingClientRect().left + scroller.clientWidth;
    var visibleL = dr.right + CONTENT_GAP;          // 可见区域左缘（含安全间距）
    var visibleW = rightEdge - visibleL;            // 可见区域宽度
    if (visibleW <= 0) return;
    var targetX;
    if (pr.width < visibleW - 2 * CONTENT_GAP) {
      targetX = visibleL + (visibleW - pr.width) / 2;   // 居中
    } else {
      targetX = visibleL;                                // 过宽：仅保证不遮挡
    }
    var need = targetX - pr.x;                     // >0 需右移，<0 需左移
    if (Math.abs(need) <= 2) return;               // 死区防抖
    var cur = parseInt(scroller.style.getPropertyValue('padding-left'), 10) || 0;
    var pad = Math.max(0, Math.min(2400, Math.round(cur + need)));
    if (pad !== cur) scroller.style.setProperty('padding-left', pad + 'px', 'important');
  }

  function applyOutlineWidth(drawer, w) {
    drawer.style.setProperty('width', w + 'px', 'important');
    drawer.style.setProperty('max-width', 'none', 'important'); // 解除官方 max-width:332px 封顶
  }

  var docState = { curW: null, started: false, timer: null };

  function getSavedOutlineW() {
    var v = parseInt(store.get(KEY_OUTLINE_W), 10);
    return (v >= OUTLINE_MIN && v <= OUTLINE_MAX) ? v : OUTLINE_DEFAULT;
  }

  /**
   * 文档页采用无状态 tick 架构：官方 React 重渲染会重建抽屉/滚动容器
   * 节点并重置内联样式（实测导致闭包 rAF 循环持旧引用失效），
   * 因此每 tick 重新查询现势节点，把宽度与正文偏移重新施加，
   * 节点被重建后 150ms 内自愈。
   */
  function mountDocOutline() {
    if (docState.started) return true;
    var drawer = findOutlineDrawer();
    if (!drawer) return false;
    docState.started = true;
    if (docState.curW == null) docState.curW = getSavedOutlineW();

    // 代理目标：每次拖动实时解析现势抽屉节点（防拖拽中途被 React 重建）
    var proxy = {
      getBoundingClientRect: function () {
        var d = findOutlineDrawer();
        if (d) return d.getBoundingClientRect();
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      }
    };

    var handle = createHandle();
    attachDrag(proxy, handle, {
      min: OUTLINE_MIN, max: OUTLINE_MAX,
      apply: function (w) { docState.curW = w; docTick(); },
      commit: function (w) { store.set(KEY_OUTLINE_W, w); },
      reset: function () {
        docState.curW = OUTLINE_DEFAULT;
        store.del(KEY_OUTLINE_W);
        docTick();
      }
    });
    document.documentElement.appendChild(handle);

    function docTick() {
      var d = findOutlineDrawer();
      if (!d) return;
      // 官方重渲染会重置内联宽度 → 每 tick 强制对齐宽度真值
      if (parseInt(d.style.width, 10) !== docState.curW) applyOutlineWidth(d, docState.curW);
      syncHandle(d, handle);
      syncContentShift(d);
      if (!document.documentElement.contains(handle)) {
        document.documentElement.appendChild(handle); // handle 被清理时自动补挂
      }
    }
    docTick();
    docState.timer = setInterval(docTick, 150);
    return true;
  }

  /********************* AI 助手面板自动关闭 *********************/
  var aiHiddenByUs = [];  // 记录被我们 display:none 的面板，关闭设置后恢复
  var lastAiCloseAt = 0;

  /** 在页面内找"AI助手"面板根：右侧、有宽度的容器 */
  function findAiPanel() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      var t = (n.textContent || '').trim();
      if (t !== 'AI助手') continue;
      var el = n.parentElement;
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.left < window.innerWidth * 0.5) continue; // 需在屏幕右半侧
      var root = el, rootRect;
      for (var i = 0; i < 8 && root; i++) {
        rootRect = root.getBoundingClientRect();
        if (rootRect.width >= 250 && rootRect.width <= 800 &&
            rootRect.right >= window.innerWidth - 12 && rootRect.height > 200) {
          return root;
        }
        root = root.parentElement;
      }
    }
    return null;
  }

  /** 关闭 AI 面板：多策略（关闭按钮 → 入口按钮切换 → display:none 兜底） */
  function aiCloseTick(force) {
    if (!force && !getAutoCloseAi()) return;
    var now = Date.now();
    if (now - lastAiCloseAt < 800) return;

    var topBar = document.querySelector('.desktop-top-bar-right.with-ai-panel');
    var panel = findAiPanel();
    if (!topBar && !panel) return;

    lastAiCloseAt = now;

    if (panel) {
      var sel = ['button', '[role="button"]', '.docs-icon', '[class*="close"]', 'svg', 'i'];
      for (var s = 0; s < sel.length; s++) {
        var els = panel.querySelectorAll(sel[s]);
        var best = null;
        for (var i = 0; i < els.length; i++) {
          var r = els[i].getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.top <= panel.getBoundingClientRect().top + 64 && r.right >= panel.getBoundingClientRect().right - 90) {
            if (!best || r.right > best.getBoundingClientRect().right) best = els[i];
          }
        }
        if (best) {
          best.click();
          setTimeout(function () {
            if (getAutoCloseAi() && (document.querySelector('.desktop-top-bar-right.with-ai-panel') || findAiPanel())) {
              tryEntryToggle();
            }
          }, 500);
          return;
        }
      }
    }
    tryEntryToggle();
  }

  /** 策略2：点击顶栏 AI 入口按钮切换面板 */
  function tryEntryToggle() {
    var btn = document.querySelector('.desktop-ai-entry-button');
    if (btn) { btn.click(); }
    setTimeout(function () {
      if (!getAutoCloseAi()) return;
      var p = findAiPanel();
      if (p && p.getBoundingClientRect().width > 0) {
        p.__tdAiHidden = true;
        aiHiddenByUs.push(p);
        p.style.setProperty('display', 'none', 'important');
      } else if (document.querySelector('.desktop-top-bar-right.with-ai-panel')) {
        var tb = document.querySelector('.desktop-top-bar-right.with-ai-panel');
        tb.classList.remove('with-ai-panel');
        tb.__tdAiClassRemoved = true;
        aiHiddenByUs.push(tb);
      }
    }, 500);
  }

  /** 关闭设置被关掉时，恢复我们隐藏的面板 */
  function restoreAiPanels() {
    while (aiHiddenByUs.length) {
      var el = aiHiddenByUs.pop();
      if (el.__tdAiHidden) { el.style.removeProperty('display'); el.__tdAiHidden = false; }
      if (el.__tdAiClassRemoved) { el.classList.add('with-ai-panel'); el.__tdAiClassRemoved = false; }
    }
  }

  var aiTimer = null;
  function startAiWatcher() {
    if (aiTimer) return;
    aiTimer = setInterval(function () {
      if (getAutoCloseAi()) aiCloseTick(false);
    }, 1000);
  }

  /********************* 主题模式：浅色 / 深色 / 护眼 *********************/
  /**
   * 实现要点（踩坑记录）：
   * 1. 深色：给 body 加 invert(1) hue-rotate(180deg) 滤镜（Dark Reader 同类做法），
   *    照片类媒体(img/video/picture)再反向还原一次避免偏色；iframe/embed/object
   *    整帧反色；canvas 刻意不还原（腾讯文档 Word 正文 / Excel 表格画在 canvas
   *    上，且 canvas 背景透明——还原会让黑字贴在被反黑的白纸面上不可读）。
   *    反色会把白底变成「纯黑」，对比度过高且刺眼，故再叠一层 screen 深灰提亮层
   *    把纯黑抬到深灰（#1c1f24 级），白字仍为白，观感更柔和。
   * 2. 护眼：不用 hue-rotate（会把蓝色链接转成紫红），改用一层
   *    豆沙绿 #c7edcc 的 mix-blend-mode:multiply 蒙层：白底 → 正豆沙绿、
   *    黑字保持黑、蓝字仍偏蓝，色相保留最自然。
   * 3. 关键：filter 会让该元素成为 position:fixed 后代的包含块，导致 fixed
   *    定位漂移。因此脚本自身 UI（齿轮 / 设置卡片 / 分隔条）统一挂到
   *    documentElement（body 的兄弟节点），不落入 body 滤镜范围 —— 既保持
   *    原色，也完全不受包含块变化影响，无需任何坐标补偿。
   * 4. 蒙层 z-index(2147482000) 低于脚本 UI(2147483000+)，故脚本 UI 不被着色。
   */
  function getTheme() {
    var t = store.get(KEY_THEME);
    return THEMES[t] ? t : DEFAULT_THEME;
  }

  function nextTheme() {
    var i = THEME_ORDER.indexOf(getTheme());
    if (i < 0) i = 0;
    return THEME_ORDER[(i + 1) % THEME_ORDER.length];
  }

  function setTheme(t) {
    if (!THEMES[t]) t = DEFAULT_THEME;
    store.set(KEY_THEME, t);
    applyTheme();
    refreshMenu();
  }

  function ensureThemeStyle() {
    if (document.getElementById(THEME_STYLE_ID)) return;
    var css = [
      /* ---- 深色：body 整体反色，html 背景同步变深避免透明区域漏白 ----
       * 反色是线性映射：白(255) → 黑(0)，整页会变成纯黑，对比度过高(≈21:1)
       * 久看刺眼。故在 body 之上再叠一层 mix-blend-mode:screen 的深灰提亮层，
       * 把纯黑抬到 #1c1f24 左右的深灰（对比度降到 ≈15:1），白字仍为白。
       * 注意 html 背景也要用同一深灰，否则边缘/过渡区会出现纯黑色带。 */
      'html.td-theme-dark{background:' + DARK_LIFT_COLOR + ' !important;}',
      'html.td-theme-dark > body{filter:invert(1) hue-rotate(180deg) !important;}',
      // iframe / embed / object 整帧反色（doc/sheet 正文若渲染在 iframe 内也能覆盖）
      'html.td-theme-dark > body iframe,html.td-theme-dark > body embed,' +
      'html.td-theme-dark > body object{filter:invert(1) hue-rotate(180deg) !important;}',
      // 仅照片类媒体反向还原。注意 canvas 刻意不还原：
      // 腾讯文档 Word 正文 / Excel 表格都画在 canvas 上，还原会让文字保持黑色，
      // 而父级白纸面被反成黑底 → 黑字黑底不可读（v1.6.1 踩坑修复）
      'html.td-theme-dark > body img,html.td-theme-dark > body video,' +
      'html.td-theme-dark > body picture{filter:invert(1) hue-rotate(180deg) !important;}',
      // 深色提亮层：screen 混合，把纯黑抬成深灰（pointer-events:none 不影响交互）
      'html.td-theme-dark #' + THEME_OVERLAY_ID + '{position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:2147482000;background:' + DARK_LIFT_COLOR + ';mix-blend-mode:screen;}',

      /* ---- 护眼：豆沙绿 multiply 蒙层 ---- */
      'html.td-theme-sepia{background:' + SEPIA_COLOR + ' !important;}',
      'html.td-theme-sepia #' + THEME_OVERLAY_ID + '{position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:2147482000;background:' + SEPIA_COLOR + ';mix-blend-mode:multiply;}',

      /* ---- 深色模式下脚本自身 UI 同步换肤（挂在 html 下，不进 body 滤镜） ---- */
      'html.td-theme-dark #td-rz-gear{background:rgba(45,48,54,.92);border-color:#4a4e56;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.5);}',
      'html.td-theme-dark #td-rz-gear svg{fill:#c8ccd2;}',
      'html.td-theme-dark #td-rz-settings{background:#2a2d33;color:#e6e8eb;' +
      'border-color:#3a3e45;box-shadow:0 6px 24px rgba(0,0,0,.5);}',
      'html.td-theme-dark #td-rz-settings .td-rz-title{color:#e6e8eb;}',
      'html.td-theme-dark #td-rz-settings .td-rz-row:hover{background:#343841;}',
      'html.td-theme-dark #td-rz-settings .td-rz-label{color:#e6e8eb;}',
      'html.td-theme-dark #td-rz-settings .td-rz-divider{background:#3a3e45;}',
      'html.td-theme-dark #td-rz-settings .td-rz-footer{color:#8b919c;}',
      'html.td-theme-dark #td-rz-settings .td-rz-seg{border-color:#4a4e56;}',
      'html.td-theme-dark #td-rz-settings .td-rz-seg-btn{background:#2a2d33;color:#c8ccd2;}',
      'html.td-theme-dark #td-rz-settings .td-rz-seg-btn + .td-rz-seg-btn{border-left-color:#4a4e56;}',
      'html.td-theme-dark #td-rz-settings .td-rz-seg-btn:hover{background:#343841;}',
      // 选中态必须带 html.td-theme-dark 前缀压过上面的普通态（特异性 1id+3class > 1id+2class+1element），
      // 否则深色下点选主题后按钮不变蓝（v1.6.1 踩坑修复）
      'html.td-theme-dark #td-rz-settings .td-rz-seg-btn.td-rz-seg-on,' +
      'html.td-theme-dark #td-rz-settings .td-rz-seg-btn.td-rz-seg-on:hover' +
      '{background:#4e83fd !important;color:#fff !important;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = THEME_STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyTheme() {
    var t = getTheme();
    var html = document.documentElement;
    html.classList.remove('td-theme-light', 'td-theme-dark', 'td-theme-sepia');
    html.classList.add('td-theme-' + t);
    ensureThemeStyle();

    // 深色（screen 提亮层）与护眼（multiply 豆沙绿层）都需要蒙层；
    // 同一容器按当前主题类切换混合模式与颜色，切到浅色时移除。
    var ov = document.getElementById(THEME_OVERLAY_ID);
    if (t === 'dark' || t === 'sepia') {
      if (!ov) {
        ov = document.createElement('div');
        ov.id = THEME_OVERLAY_ID;
        html.appendChild(ov);
      }
    } else if (ov && ov.parentNode) {
      ov.parentNode.removeChild(ov);
    }
  }

  /********************* 设置面板 UI（齿轮按钮 + 弹出卡片） *********************/
  var GEAR_ID = 'td-rz-gear';
  var PANEL_ID = 'td-rz-settings';
  var MASK_ID = 'td-rz-mask';   // 全屏透明遮罩：面板打开时拦截页面/iframe 点击用于关闭

  /** 开关切换：立即生效 */
  function applyAutoCloseAi(on) {
    setAutoCloseAi(on);            // 持久化 + 刷新油猴菜单
    if (on) aiCloseTick(true);     // 开：立即关一轮面板
    else restoreAiPanels();        // 关：恢复被隐藏的面板
  }

  /********************* 齿轮位置：默认右下角 + 可拖动 + 记忆 *********************/
  /** 默认位置：视口右下角 */
  function defaultGearPos() {
    return {
      x: Math.max(4, window.innerWidth - GEAR_SIZE - GEAR_MARGIN),
      y: Math.max(4, window.innerHeight - GEAR_SIZE - GEAR_MARGIN)
    };
  }

  /** 钳制在视口内（窗口缩放/分辨率变化后仍可见） */
  function clampGearPos(p) {
    var maxX = Math.max(4, window.innerWidth - GEAR_SIZE - 4);
    var maxY = Math.max(4, window.innerHeight - GEAR_SIZE - 4);
    return { x: Math.max(4, Math.min(Math.round(p.x), maxX)),
             y: Math.max(4, Math.min(Math.round(p.y), maxY)) };
  }

  function loadGearPos() {
    var raw = store.get(KEY_GEAR_POS);
    if (raw) {
      try {
        var p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (p && typeof p.x === 'number' && typeof p.y === 'number') return clampGearPos(p);
      } catch (e) {}
    }
    return clampGearPos(defaultGearPos());
  }

  function saveGearPos(p) { store.set(KEY_GEAR_POS, JSON.stringify(p)); }

  function applyGearPos(gear, p) {
    gear.style.left = p.x + 'px';
    gear.style.top = p.y + 'px';
  }

  /** 设置面板跟随齿轮：优先放上方，空间不足改下方；水平右对齐且不出屏 */
  function positionPanel(gear, panel) {
    var gr = gear.getBoundingClientRect();
    var pw = panel.offsetWidth || 264;
    var ph = panel.offsetHeight || 220;
    var vw = window.innerWidth, vh = window.innerHeight;

    var left = gr.right - pw;                       // 与齿轮右对齐
    left = Math.max(8, Math.min(left, vw - pw - 8));

    var top = gr.top - ph - 8;                      // 优先上方
    if (top < 8) top = gr.bottom + 8;               // 上方放不下改下方
    top = Math.max(8, Math.min(top, vh - ph - 8));

    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  function createSettingsUi() {
    if ($('#' + GEAR_ID)) return;

    var css = [
      '#' + GEAR_ID + '{position:fixed;width:' + GEAR_SIZE + 'px;height:' + GEAR_SIZE + 'px;border-radius:50%;' +
        'background:rgba(255,255,255,.9);border:1px solid #e0e3e8;box-shadow:0 1px 4px rgba(0,0,0,.12);' +
        'cursor:grab;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
        'box-sizing:border-box;transition:transform .15s ease, box-shadow .15s ease;padding:0;}',
      '#' + GEAR_ID + ':hover{transform:rotate(40deg) scale(1.08);box-shadow:0 2px 8px rgba(0,0,0,.2);}',
      // 拖动中：覆盖 hover 的旋转，改用 grabbing 光标（同特异性靠后定义生效）
      '#' + GEAR_ID + '.td-rz-gear-dragging{cursor:grabbing !important;transition:none;' +
        'transform:scale(1.12);box-shadow:0 4px 14px rgba(0,0,0,.28);opacity:.95;}',
      '#' + GEAR_ID + ' svg{width:16px;height:16px;fill:#5f6672;pointer-events:none;}',
      'body.td-rz-gear-move,body.td-rz-gear-move *{user-select:none !important;' +
        '-webkit-user-select:none !important;cursor:grabbing !important;}',
      '#' + PANEL_ID + '{position:fixed;width:264px;background:#fff;border-radius:12px;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.16);border:1px solid #eceef1;z-index:2147483001;' +
        'font-size:13px;color:#333;overflow:hidden;display:none;user-select:none;-webkit-user-select:none;}',
      '#' + PANEL_ID + '.td-rz-open{display:block;}',
      '#' + PANEL_ID + ' .td-rz-title{padding:12px 14px 8px;font-weight:600;font-size:13px;color:#1f2329;}',
      '#' + PANEL_ID + ' .td-rz-row{display:flex;align-items:center;justify-content:space-between;' +
        'padding:10px 14px;cursor:pointer;transition:background .12s ease;}',
      '#' + PANEL_ID + ' .td-rz-row:hover{background:#f5f6f8;}',
      '#' + PANEL_ID + ' .td-rz-row .td-rz-label{color:#333;}',
      '#' + PANEL_ID + ' .td-rz-switch{position:relative;width:36px;height:20px;border-radius:10px;' +
        'background:#d5d9e0;transition:background .18s ease;flex-shrink:0;margin-left:8px;}',
      '#' + PANEL_ID + ' .td-rz-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;' +
        'border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .18s ease;}',
      '#' + PANEL_ID + ' .td-rz-switch.td-rz-on{background:#4e83fd;}',
      '#' + PANEL_ID + ' .td-rz-switch.td-rz-on::after{left:18px;}',
      '#' + PANEL_ID + ' .td-rz-divider{height:1px;background:#f0f1f4;margin:0 14px;}',
      '#' + PANEL_ID + ' .td-rz-footer{padding:8px 14px 12px;color:#9aa1ac;font-size:12px;line-height:1.6;}',
      /* 主题分段选择器 */
      '#' + PANEL_ID + ' .td-rz-row.td-rz-theme-row{cursor:default;}',
      '#' + PANEL_ID + ' .td-rz-row.td-rz-theme-row:hover{background:transparent;}',
      '#' + PANEL_ID + ' .td-rz-seg{display:flex;flex-shrink:0;margin-left:8px;border:1px solid #e3e6ea;' +
        'border-radius:8px;overflow:hidden;}',
      '#' + PANEL_ID + ' .td-rz-seg-btn{border:0;background:#fff;color:#5f6672;font-size:12px;' +
        'font-family:inherit;line-height:1.4;padding:4px 9px;cursor:pointer;}',
      '#' + PANEL_ID + ' .td-rz-seg-btn + .td-rz-seg-btn{border-left:1px solid #e3e6ea;}',
      '#' + PANEL_ID + ' .td-rz-seg-btn:hover{background:#f2f4f7;}',
      '#' + PANEL_ID + ' .td-rz-seg-btn.td-rz-seg-on{background:#4e83fd;color:#fff;}',
      '#' + PANEL_ID + ' .td-rz-seg-btn.td-rz-seg-on:hover{background:#4e83fd;}',
      /* 全屏透明遮罩：低于齿轮(2147483000)与面板(2147483001)，高于页面内容(含 iframe) */
      '#' + MASK_ID + '{position:fixed;inset:0;z-index:2147482999;display:none;background:transparent;' +
        'border:0;padding:0;margin:0;cursor:default;}',
      '#' + MASK_ID + '.td-rz-open{display:block;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = GEAR_ID + '-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    var gear = document.createElement('button');
    gear.id = GEAR_ID;
    gear.type = 'button';
    gear.title = '侧栏助手设置';
    gear.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94 0 .32.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.34.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.23.09.47 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="td-rz-title">侧栏助手设置</div>' +
      '<div class="td-rz-row td-rz-theme-row" id="td-rz-row-theme">' +
      '  <span class="td-rz-label">主题模式</span>' +
      '  <span class="td-rz-seg" id="td-rz-theme-seg">' +
      '    <button type="button" class="td-rz-seg-btn" data-theme="light">浅色</button>' +
      '    <button type="button" class="td-rz-seg-btn" data-theme="dark">深色</button>' +
      '    <button type="button" class="td-rz-seg-btn" data-theme="sepia">护眼</button>' +
      '  </span>' +
      '</div>' +
      '<div class="td-rz-divider"></div>' +
      '<div class="td-rz-row" id="td-rz-row-ai">' +
      '  <span class="td-rz-label">自动关闭 AI 助手面板</span>' +
      '  <span class="td-rz-switch" id="td-rz-switch-ai"></span>' +
      '</div>' +
      '<div class="td-rz-divider"></div>' +
      '<div class="td-rz-row" id="td-rz-row-reset">' +
      '  <span class="td-rz-label" style="color:#4e83fd;">恢复默认侧栏宽度</span>' +
      '</div>' +
      '<div class="td-rz-row" id="td-rz-row-gearpos">' +
      '  <span class="td-rz-label" style="color:#4e83fd;">悬浮按钮回到右下角</span>' +
      '</div>' +
      '<div class="td-rz-footer">拖动侧栏/大纲右边缘调宽 · 双击分隔线也可重置<br>' +
      '齿轮可自由拖动摆放（位置自动记忆）· 右键齿轮立即复位<br>主题三档即时切换 · 设置自动保存</div>';

    gear.title = '侧栏助手设置（可拖动摆放 · 右键立即复位）';
    // 挂在 <html> 下（body 的兄弟）：不落入主题滤镜范围，避免 fixed 定位漂移与自身被反色
    document.documentElement.appendChild(gear);
    document.documentElement.appendChild(panel);

    // 全屏透明遮罩：面板打开时垫在面板/齿轮之下、页面内容之上，点击任意处关闭
    var mask = document.createElement('div');
    mask.id = MASK_ID;
    document.documentElement.appendChild(mask);

    // 初始位置：右下角（有记忆则用记忆位置）
    var gearPos = loadGearPos();
    applyGearPos(gear, gearPos);

    var sw = panel.querySelector('#td-rz-switch-ai');
    function renderSwitch() { sw.classList.toggle('td-rz-on', getAutoCloseAi()); }
    renderSwitch();

    var segWrap = panel.querySelector('#td-rz-theme-seg');
    var segBtns = segWrap.querySelectorAll('.td-rz-seg-btn');
    function renderTheme() {
      var cur = getTheme();
      for (var i = 0; i < segBtns.length; i++) {
        segBtns[i].classList.toggle('td-rz-seg-on', segBtns[i].getAttribute('data-theme') === cur);
      }
    }
    renderTheme();

    // 主题分段点击：事件委托 + closest 兼容（按钮内无子元素，e.target 即按钮）
    segWrap.addEventListener('click', function (e) {
      var btn = e.target;
      while (btn && btn !== segWrap && !btn.classList.contains('td-rz-seg-btn')) btn = btn.parentNode;
      if (!btn || btn === segWrap) return;
      e.stopPropagation();
      setTheme(btn.getAttribute('data-theme'));
      renderTheme();
    });

    function openPanel() {
      panel.classList.add('td-rz-open');
      mask.classList.add('td-rz-open');
      renderSwitch();
      renderTheme();
      positionPanel(gear, panel);
    }
    function closePanel() {
      panel.classList.remove('td-rz-open');
      mask.classList.remove('td-rz-open');
    }

    /*** 拖动摆放：位移超过阈值才算拖动，否则仍视为点击 ***/
    var gDrag = { active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };

    gear.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      gDrag.active = true;
      gDrag.moved = false;
      gDrag.sx = e.clientX;
      gDrag.sy = e.clientY;
      gDrag.ox = parseFloat(gear.style.left) || 0;
      gDrag.oy = parseFloat(gear.style.top) || 0;
      e.preventDefault();   // 防止拖出文本选区
      e.stopPropagation();
    });

    document.addEventListener('mousemove', function (e) {
      if (!gDrag.active) return;
      var dx = e.clientX - gDrag.sx, dy = e.clientY - gDrag.sy;
      if (!gDrag.moved) {
        if (Math.abs(dx) + Math.abs(dy) <= GEAR_DRAG_THRESHOLD) return;
        gDrag.moved = true;
        gear.classList.add('td-rz-gear-dragging');
        document.body.classList.add('td-rz-gear-move');
      }
      var p = clampGearPos({ x: gDrag.ox + dx, y: gDrag.oy + dy });
      applyGearPos(gear, p);
      if (panel.classList.contains('td-rz-open')) positionPanel(gear, panel);
    });

    document.addEventListener('mouseup', function () {
      if (!gDrag.active) return;
      gDrag.active = false;
      gear.classList.remove('td-rz-gear-dragging');
      document.body.classList.remove('td-rz-gear-move');
      if (gDrag.moved) {
        saveGearPos({ x: parseFloat(gear.style.left) || 0, y: parseFloat(gear.style.top) || 0 });
      }
      // moved 留给随后的 click 事件判断，click 结束后在下一帧清零
      setTimeout(function () { gDrag.moved = false; }, 0);
    });

    // 右键：立即复位到右下角
    gear.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var p = clampGearPos(defaultGearPos());
      applyGearPos(gear, p);
      saveGearPos(p);
      if (panel.classList.contains('td-rz-open')) positionPanel(gear, panel);
    });

    gear.addEventListener('click', function (e) {
      e.stopPropagation();
      if (gDrag.moved) return;   // 刚才是在拖动，不触发开合
      panel.classList.contains('td-rz-open') ? closePanel() : openPanel();
    });

    panel.querySelector('#td-rz-row-ai').addEventListener('click', function (e) {
      e.stopPropagation();
      applyAutoCloseAi(!getAutoCloseAi());
      renderSwitch();
    });

    // 恢复默认宽度（按当前页面类型分流）
    panel.querySelector('#td-rz-row-reset').addEventListener('click', function (e) {
      e.stopPropagation();
      if (isDocPage()) {
        var drawer = findOutlineDrawer();
        if (drawer) {
          drawer.style.setProperty('width', OUTLINE_DEFAULT + 'px', 'important');
          drawer.style.removeProperty('max-width');
          store.del(KEY_OUTLINE_W);
          syncContentShift(drawer);
        }
      } else {
        var sb = findSidebar();
        if (sb) {
          sb.style.setProperty('--sidebar-width', DEFAULT_WIDTH + 'px');
          store.del(KEY_DESKTOP_W);
        }
      }
      try { window.dispatchEvent(new Event('resize')); } catch (err) {}
      closePanel();
    });

    // 悬浮按钮复位到右下角
    panel.querySelector('#td-rz-row-gearpos').addEventListener('click', function (e) {
      e.stopPropagation();
      var p = clampGearPos(defaultGearPos());
      applyGearPos(gear, p);
      saveGearPos(p);
      positionPanel(gear, panel);
    });

    // 窗口尺寸变化：保证齿轮仍在视口内，面板重新贴齐
    window.addEventListener('resize', function () {
      var p = clampGearPos({
        x: parseFloat(gear.style.left) || 0,
        y: parseFloat(gear.style.top) || 0
      });
      applyGearPos(gear, p);
      if (panel.classList.contains('td-rz-open')) positionPanel(gear, panel);
    });

    // 点击页面任意处（含 iframe 上方）→ 关闭面板。
    // 遮罩 z-index 低于齿轮/面板、高于页面内容，故点击齿轮/面板不会落到遮罩上；
    // 点击正文/表格（即使渲染在 iframe 内）也会被遮罩拦截并触发关闭。
    mask.addEventListener('mousedown', function (e) {
      e.stopPropagation();
      closePanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });

    panel.__renderSwitch = renderSwitch;
    panel.__renderTheme = renderTheme;
  }

  /** 外部（油猴菜单）切换后同步卡片开关状态 */
  var _origSetAutoCloseAi = setAutoCloseAi;
  setAutoCloseAi = function (on) {
    _origSetAutoCloseAi(on);
    var panel = $('#' + PANEL_ID);
    if (panel && panel.__renderSwitch) panel.__renderSwitch();
  };

  /** 外部（油猴菜单 / 调试钩子）切换主题后同步卡片分段选中态 */
  var _origSetTheme = setTheme;
  setTheme = function (t) {
    _origSetTheme(t);
    var panel = $('#' + PANEL_ID);
    if (panel && panel.__renderTheme) panel.__renderTheme();
  };

  /********************* 初始化 + SPA 监听 *********************/
  function isDocPage() { return /^\/doc\//.test(location.pathname); }
  function isSheetPage() { return /^\/sheet\//.test(location.pathname); }

  function mount() {
    if ($('#' + HANDLE_ID)) return true;
    // 表格页(/sheet/*)无目录栏与大纲面板，跳过侧栏挂载，仅保留主题/齿轮/AI 面板逻辑
    if (isSheetPage()) return true;
    return isDocPage() ? mountDocOutline() : mountDesktop();
  }

  function start() {
    if (mount()) return;
    // SPA 首屏异步渲染：轮询 + MutationObserver 双保险
    var timer = setInterval(function () {
      if (mount()) { clearInterval(timer); observer.disconnect(); }
    }, 500);
    var observer = new MutationObserver(function () {
      if (mount()) { clearInterval(timer); observer.disconnect(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // 15 秒后仍未找到目标面板则停止观察（未登录跳转等场景）
    setTimeout(function () { clearInterval(timer); observer.disconnect(); }, 15000);
  }

  function startAll() {
    start();
    applyTheme();        // 主题先于 UI 应用，卡片渲染时即为当前主题
    refreshMenu();
    createSettingsUi();
    if (getAutoCloseAi()) aiCloseTick(true);
    startAiWatcher();
  }

  /********************* 调试 / 测试钩子 *********************/
  try {
    window.__tdResize = {
      version: '1.6.5',
      themes: THEME_ORDER.slice(),
      getTheme: getTheme,
      setTheme: function (t) { setTheme(t); },
      cycleTheme: function () { setTheme(nextTheme()); },
      getAutoCloseAi: getAutoCloseAi,
      setAutoCloseAi: function (on) { setAutoCloseAi(!!on); if (on) aiCloseTick(true); else restoreAiPanels(); },
      closeAiNow: function () { aiCloseTick(true); },
      restoreAi: restoreAiPanels,
      openSettings: function () { var g = $('#' + GEAR_ID); if (g) g.click(); },
      findOutlineDrawer: findOutlineDrawer,
      syncContentShift: function () { var d = findOutlineDrawer(); if (d) syncContentShift(d); },
      getGearPos: function () { var g = $('#' + GEAR_ID); return g ? { x: parseFloat(g.style.left), y: parseFloat(g.style.top) } : null; },
      resetGearPos: function () { var g = $('#' + GEAR_ID); if (!g) return; var p = clampGearPos(defaultGearPos()); applyGearPos(g, p); saveGearPos(p); }
    };
  } catch (e) {}

  startAll();
})();

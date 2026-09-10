// ==UserScript==
// @name         Tencent Docs Web Assistant — 腾讯文档Web助手
// @namespace    https://github.com/PingWangWang
// @version      1.6.3
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

// 说明：本文件仅含元数据头，供 Tampermonkey 检查更新使用（体积小、请求快）。
// 若后续将本项目推送到 GitHub，取消下面三行注释并替换为实际地址，即可开启自动更新：
// @downloadURL  https://raw.githubusercontent.com/PingWangWang/TencentDocs-Web-Assistant/main/TencentDocs-Web-Assistant.user.js
// @updateURL    https://raw.githubusercontent.com/PingWangWang/TencentDocs-Web-Assistant/main/TencentDocs-Web-Assistant.meta.js
// @supportURL   https://github.com/PingWangWang/TencentDocs-Web-Assistant/issues

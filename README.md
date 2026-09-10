# Tencent Docs Web Assistant — 腾讯文档Web助手

> 腾讯文档（docs.qq.com）网页端增强用户脚本：把「太窄、看不全」的左侧目录栏 / 大纲面板变成**可自由拖拽调宽**的面板，并保证正文内容同步让位、不被遮挡；附带可拖动的悬浮设置按钮与「自动关闭 AI 助手面板」开关。

[![Version](https://img.shields.io/badge/version-1.5.1-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-supported-orange)]()

## 项目亮点

- **目录栏自由调宽**：桌面版（`/desktop`）左侧固定目录栏默认 240px 太窄、长目录名显示不全，鼠标拖右边缘即可调宽（160–560px）
- **文字不再被截断**：官方 CSS 把目录叶子层宽度写死适配 240px，拉宽后文字仍不显示——脚本注入自适应覆盖样式彻底修复
- **文档页大纲也能拖**：文档页（`/doc/*`）左侧「大纲」是**悬浮抽屉**，直接拉宽会压住正文；脚本在拉宽的同时让正文纸面同步右移，始终保持 ≥12px 安全间距
- **宽度自动记忆**：刷新、换页、重开浏览器都保持你调过的宽度；双击分隔条一键恢复默认
- **悬浮设置按钮**：右下角齿轮按钮，可自由拖动摆放到任意位置（位置自动记忆），再也不怕挡内容
- **自动关闭 AI 助手面板**：设置里一键开关，点击立即生效，无需刷新

## 安装

### 前提条件
浏览器需安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展（Chrome / Edge / Firefox 均支持）。

### 安装步骤

1. 打开 Tampermonkey 面板 → **创建新脚本**
2. 将 [`TencentDocs-Web-Assistant.user.js`](./TencentDocs-Web-Assistant.user.js) 的**全部内容**粘贴进去
3. `Ctrl + S` 保存并启用
4. 打开 [docs.qq.com](https://docs.qq.com) 并刷新页面

> 若你之前安装过旧名「腾讯文档-侧栏目录宽度可拖拽调整」，因 `@name` 已变更，Tampermonkey 会视为**新脚本**，请在面板中删除旧条目以免重复运行。

### 自动更新
当前未托管到公开仓库，故未启用 `@updateURL`。若后续推送到 GitHub，取消 [`TencentDocs-Web-Assistant.meta.js`](./TencentDocs-Web-Assistant.meta.js) 底部三行注释并替换为实际地址即可开启。

## 快速开始

| 页面 | 操作 | 效果 |
|------|------|------|
| `docs.qq.com/desktop/*` | 鼠标移到**左侧目录栏右边缘**，出现蓝色分隔条后左右拖动 | 目录栏调宽，右侧内容区实时联动压缩 |
| `docs.qq.com/doc/*` | 鼠标移到**左侧大纲面板右边缘**拖动 | 大纲调宽，正文纸面自动右移，不会被遮挡 |
| 任意页面 | 双击分隔条 | 恢复官方默认宽度并清除记忆 |
| 任意页面 | 点击**右下角齿轮** | 打开设置面板（开关 AI 面板自动关闭 / 恢复默认宽度 / 悬浮按钮复位） |
| 任意页面 | 拖动齿轮 / 右键齿轮 | 自由摆放位置（自动记忆）/ 立即回到右下角 |

## 功能详解

### 1. 桌面版目录栏调宽（`/desktop`、`/home`）

- 拖动范围 **160 ~ 560px**，默认 240px
- 官方把宽度写在 `.desktop-layout-sidebar-pc` 的内联 CSS 变量 `--sidebar-width` 上，脚本只需改该变量，主内容区自动 flex 联动
- **文字截断修复**：官方叶子层（`.rc-tree-treenode` 224px、`.desktop-sidebar-link` 224px、`.rc-tree-node-content-wrapper` 208px）为固定宽度，脚本注入 `!important` 覆盖为 `width:100% / flex:1 / min-width:0`，拉宽缩回都不破版

### 2. 文档页大纲调宽（`/doc/*`）

- 拖动范围 **216 ~ 600px**，默认 256px（并解除官方 `max-width: 332px` 封顶）
- 大纲是**绝对定位悬浮抽屉**（外层容器宽 0），拉宽天然会遮挡正文 → 脚本给编辑器滚动容器动态补 `padding-left`，用增量控制器把纸面左缘推到「大纲右缘 + 12px」之外，实时自校正
- 官方 React 重渲染会重建抽屉节点并重置内联样式，脚本采用**无状态 tick 架构**（每 150ms 重查现势节点并重施加宽度与偏移），节点被重建后自动自愈

### 3. 悬浮设置按钮（齿轮）

| 能力 | 说明 |
|------|------|
| 默认位置 | 视口**右下角**（距边缘 16px），不压侧栏内容 |
| 拖动摆放 | 按住任意拖动，`grab`/`grabbing` 光标反馈，拖动中放大 1.12 倍 |
| 位置记忆 | 松手即存，刷新/换页原地恢复 |
| 拖点区分 | 位移 ≤4px 判为点击（开合面板），>4px 判为拖动，**不会误开面板** |
| 越界保护 | 拖出视口自动钳回边界；窗口缩放时重新钳制，按钮永不丢失 |
| 面板跟随 | 设置卡片自动贴着齿轮弹出（默认上方、空间不足改下方），始终完整落在视口内 |
| 复位方式 | ①右键齿轮 ②设置卡片内「悬浮按钮回到右下角」 |

### 4. 设置面板

- **自动关闭 AI 助手面板**：滑块开关，点击**立即生效**（开启瞬间执行一轮关闭；关闭则恢复此前被隐藏的面板）。关闭策略三级兜底：面板头部关闭按钮 → 顶栏 AI 入口按钮切换 → `display:none` 隐藏
- **恢复默认侧栏宽度**：等价于双击分隔条，按当前页面类型自动分流
- 点击卡片外区域或按 `Esc` 关闭；油猴菜单中同名开关保留，两处状态双向同步

## 存储键说明

| 键 | 类型 | 说明 |
|----|------|------|
| `td_sidebar_width` | number | 桌面版目录栏宽度（px） |
| `td_outline_width` | number | 文档页大纲宽度（px） |
| `td_gear_pos` | JSON `{x,y}` | 齿轮悬浮按钮位置（视口坐标） |
| `td_auto_close_ai` | `'1'` / `'0'` | 自动关闭 AI 助手面板开关 |

> 优先使用 `GM_getValue` / `GM_setValue`，无 Tampermonkey 环境时自动回退 `localStorage`。

## 项目结构

```
tampermonkey/
├─ TencentDocs-Web-Assistant.user.js   # 用户脚本主文件（全部逻辑与样式）
├─ TencentDocs-Web-Assistant.meta.js   # Tampermonkey 元数据头（用于检查更新）
└─ README.md                           # 本说明文档
```

## 技术架构

| 机制 | 用途 |
|------|------|
| CSS 变量 `--sidebar-width` | 桌面版侧栏宽度的唯一真值来源 |
| `position: fixed` + `requestAnimationFrame` | 分隔条贴齐面板右缘，避开容器 `overflow:hidden` 裁剪 |
| `setInterval` 无状态 tick | 文档页对抗 React 重渲染导致的节点重建 |
| 增量控制器（增益 1 + ±2px 死区） | 正文偏移收敛，对任意 padding 位移系数 0<s≤1 均单调收敛 |
| MutationObserver + 轮询 | SPA 首屏异步渲染的双保险挂载 |
| `GM_registerMenuCommand` | 油猴菜单开关入口 |

### 调试钩子
页面控制台可使用 `window.__tdResize`：

```js
__tdResize.version            // 脚本版本
__tdResize.getAutoCloseAi()   // 读取 AI 自动关闭开关
__tdResize.setAutoCloseAi(true/false)
__tdResize.getGearPos()       // 齿轮位置真值（内联 style，非 rect）
__tdResize.resetGearPos()     // 齿轮复位到右下角
__tdResize.openSettings()     // 打开设置面板
```

## 版本历史

| 版本 | 主要内容 |
|------|----------|
| 1.5.1 | 脚本更名为 **Tencent Docs Web Assistant — 腾讯文档Web助手**，补齐 `.meta.js` 与 README |
| 1.5.0 | 齿轮悬浮按钮默认改到**右下角**，支持自由拖动摆放 + 位置记忆 + 越界钳制；设置面板跟随齿轮定位；右键/菜单项一键复位 |
| 1.4.1 | 新增文档页（`/doc/*`）左侧大纲拖宽，正文内容同步右移不遮挡；无状态 tick 架构对抗 React 重渲染 |
| 1.3.0 | 设置做成页面内真实按钮：齿轮 + 弹出卡片 + 滑块开关，点击立即生效 |
| 1.2.0 | 修复拉宽后目录文字不显示（叶子层宽度自适应）；新增「自动关闭 AI 助手面板」油猴菜单开关 |
| 1.1.0 | 首个可用版本：目录栏拖拽调宽、宽度记忆、双击重置、边界钳制 |

## 开发

纯前端用户脚本，无需构建工具。修改 `.user.js` 后保存，刷新 docs.qq.com 页面即生效。

自测环境（Playwright + 1:1 复刻 mock 页）位于 `C:\Users\Administrator\.workbuddy\binaries\node\workspace\`：

- `td_mock.html` — 桌面版布局 mock（CSS 变量宽度 + 硬编码叶子层宽度）
- `td_doc_mock.html` — 文档页布局 mock（绝对定位悬浮抽屉 + 居中纸面）
- `test_td_userscript.js` — 全量用例（49 项：拖拽/记忆/钳制/重置/文字自适应/AI 面板/齿轮拖动与定位）

```bash
cd "C:/Users/Administrator/.workbuddy/binaries/node/workspace"
NODE_PATH="C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules" node test_td_userscript.js
```

### 已知限制
- AI 助手面板本体在**登录后才渲染**，自动关闭功能基于顶栏 `.with-ai-panel` 状态类 + 右侧面板文本启发式实现；如登录后未生效，请提供面板 DOM 截图以便精准适配
- 依赖腾讯文档现有类名，官方改版可能失效（已尽量做多级兜底选择器）

## License

MIT

---

*为腾讯文档重度用户打造的网页增强助手。*

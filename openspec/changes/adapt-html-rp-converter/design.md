## Context

本项目是一个基于 Vue 3 + vue-cli-service 构建的 Chrome Extension (Manifest V3) 模板，现有 4 个页面入口（popup、background、options、content）。需要按照《HTML ↔ Axure RP 双向转换 Chrome 插件技术方案 v1.1》将 HTML 与 Axure RP 原型文件双向转换功能适配到该 Vue 模板中。

方案已通过技术验证，包括：
- F1（多 HTML → RP）使用 Offscreen Document API 离屏渲染
- F2（当前页面 → RP）使用 Content Script 注入 + DOM 遍历
- F3（RP → 多 HTML）使用 JSZip 解包 + RP XML 解析
- 共享 Widget IR 中间表示层作为格式转换核心

## Goals / Non-Goals

**Goals:**
- 将方案中的 `lib/core/`、`lib/shared/`、`lib/utils/` 核心库代码移植到 Vue 模板的 `src/lib/` 目录
- 将 popup UI 重构为 Vue 3 组件，实现三 Tab 交互
- 将 background 逻辑适配到 Vue 模板的 service worker 入口
- 创建 content script 用于 F2 DOM 抓取
- 创建 offscreen 页面用于 F1 离屏渲染
- 更新 manifest.json 配置为方案中的 MV3 权限模型
- 引入 jszip 和 fast-xml-parser 依赖

**Non-Goals:**
- 不做 Axure RP 10 兼容（仅 RP 9）
- 不做渐变/动画/Shadow DOM 等边缘 case 的完整支持（按方案中的限制处理）
- 不替换 Vue 模板的 webpack 构建链
- 不改动 options 页面（保留原模板内容）

## Decisions

### 1. 保留 Vue 多页面架构
- **选型**：保持 vue.config.js 的多入口配置，新增 offscreen 页面入口
- **理由**：现有模板已配置 popup/background/content/options 四个入口，vue-cli-service 的多页面能力可以自然扩展 offscreen 页面
- **替代方案**：拆分 build 流程 → 增加维护成本，且与现有 CI 不兼容

### 2. 核心库文件存放位置
- **选型**：`src/lib/` 下按 `core/`、`shared/`、`utils/` 组织，与方案一致
- **理由**：方便区分哪些文件在 service worker 中用 import（core/、utils/），哪些被注入页面（shared/ 不使用 import/export）
- **注意**：shared/ 下的文件必须使用普通函数声明，不能使用 `export`/`import`

### 3. Popup UI 使用 Vue SFC
- **选型**：将方案中的 popup HTML 转换为 Vue 单文件组件（SFC），三 Tab 使用 v-if/v-show 切换
- **理由**：保持 Vue 模板的一致性，利用 Vue 的响应式能力管理状态和进度展示
- **替代方案**：纯 HTML/JS → 丢失 Vue 生态优势，与模板风格不一致

### 4. Background 使用 ES Module
- **选型**：`manifest.json` 配置 `"type": "module"`，background 文件使用 `import/export`
- **理由**：与方案一致，MV3 推荐的 service worker 写法

### 5. Content Script 不使用 import
- **选型**：`content/main.js` 和 `lib/shared/extract-raw-dom.js` 使用普通函数（无 import/export）
- **理由**：`chrome.scripting.executeScript` 注入的文件按经典脚本执行，不支持 ES Module 语法

### 6. 图片资源处理策略
- **选型**：按方案中的三级策略（同域直接读取 → 跨域 fetch → 截图降级）
- **理由**：覆盖所有图片场景，保证转换完整度

## Risks / Trade-offs

- **[构建风险]** offscreen 页面需配置 `"type": "module"` 但 `vue-cli-service` 默认输出可能包含 webpack runtime → 需要配置 `vue.config.js` 确保 offscreen 页面输出为干净 HTML
- **[兼容风险]** RP XML 格式为逆向推断，需在实现后使用真实 Axure RP 9 文件验证
- **[安全风险]** F1 离屏渲染上传的 HTML → 使用 `sandbox="allow-same-origin"` 且不加 `allow-scripts` 防止 XSS
- **[性能风险]** 大页面 DOM 遍历可能导致 content script 执行超时 → 使用 requestIdleCallback 分批处理
- **[依赖风险]** JSZip 和 fast-xml-parser 为运行时依赖，打包进 extension 会增加大小 → JSZip 约 300KB gzip，可接受
- **[Vue 构建限制]** `vue-cli-service` 对 `type: "module"` 的 service worker 输出可能有兼容问题 → background 入口可能需要配置 webpack 的 `output.libraryTarget` 或使用 copy 方式

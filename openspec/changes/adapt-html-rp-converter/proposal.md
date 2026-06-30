## Why

当前项目基于 Vue 3 Chrome 扩展模板，需要按照《HTML ↔ Axure RP 双向转换 Chrome 插件技术方案》将 HTML 与 Axure RP 原型文件之间双向转换的功能适配到现有的 Vue 模板结构中。该方案已完成技术设计验证，现在需要将方案中的代码结构、核心逻辑和 UI 界面落地到已有的 Vue 3 多页面架构中。

## What Changes

- 按照方案中的目录结构，在 Vue 模板中创建对应的核心库文件（lib/），包括 Widget IR、DOM 抓取、RP 解析/构建、HTML 构建、颜色/字体/图片工具等模块
- 重构 popup 页面为 Vue 组件，实现三 Tab（HTML→RP、页面→RP、RP→HTML）切换交互
- 重构 background service worker，实现消息路由、IR 构建、ZIP 操作等核心逻辑
- 创建 content script 用于 F2 真实页面 DOM 抓取
- 创建 offscreen 页面用于 F1 离屏渲染上传的 HTML 文件
- 更新 manifest.json 配置以支持 MV3 权限模型（offscreen、scripting、downloads、storage、activeTab）
- 引入 JSZip 和 fast-xml-parser 作为运行时依赖
- 创建图标资源占位

## Capabilities

### New Capabilities
- `html-to-rp`: 多 HTML 文件上传并转换为 Axure RP 文件（F1 功能）
- `page-to-rp`: 捕获当前浏览器页面 DOM 并转换为 RP 文件（F2 功能）
- `rp-to-html`: 解析 .rp 文件并导出为多 HTML 文件的 ZIP 包（F3 功能）
- `core-pipeline`: 共享的 Widget IR 中间表示层及格式转换管道

### Modified Capabilities

- (无，当前为全新功能适配)

## Impact

- 修改 `manifest.json`：更新 permissions、background、content_scripts 配置
- 修改 `src/pages/popup/Index.vue`：替换为三 Tab 转换器 UI
- 修改 `src/pages/popup/main.js`：保持 Vue 挂载不变
- 修改 `src/pages/background/main.js`：实现 service worker 核心消息处理
- 修改 `src/pages/content/main.js`：实现 DOM 抓取逻辑
- 新增 `src/pages/offscreen/`：离屏渲染页面
- 新增 `src/lib/`：核心库文件（core、shared、utils）
- 新增 `src/public/icons/`：图标资源
- 依赖新增：jszip、fast-xml-parser

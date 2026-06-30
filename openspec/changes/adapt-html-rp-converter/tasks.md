## 1. 项目基础配置

- [ ] 1.1 更新 manifest.json：配置 permissions（activeTab、scripting、downloads、storage、offscreen）、background（type: module）、移除静态 content_scripts 声明
- [ ] 1.2 去除 host_permissions 中的 `<all_urls>` 通配符
- [ ] 1.3 安装运行时依赖：jszip、fast-xml-parser
- [ ] 1.4 创建 `src/lib/` 目录结构（core/、shared/、utils/）
- [ ] 1.5 配置 vue.config.js 添加 offscreen 页面入口
- [ ] 1.6 创建图标资源占位文件（icons/icon-16.png、icon-48.png、icon-128.png）

## 2. 核心库 - Widget IR 类型定义

- [ ] 2.1 创建 `src/lib/core/widget-ir.js`：定义 DocumentIR、PageIR、WidgetIR、WidgetType、Bounds、WidgetStyle 等 JSDoc 类型和校验工具

## 3. 核心库 - 颜色/字体/图片工具

- [ ] 3.1 创建 `src/lib/utils/color.js`：实现 colorToArgb() 和 argbToHex() 颜色转换函数
- [ ] 3.2 创建 `src/lib/utils/font.js`：字体名处理 / fallback stack
- [ ] 3.3 创建 `src/lib/utils/image.js`：base64 编解码 / MIME 检测 / blobToBase64

## 4. 共享 DOM 提取层

- [ ] 4.1 创建 `src/lib/shared/extract-raw-dom.js`：实现 captureNode()、extractStyle()、getImageSrc()、extractCaptureResult()（纯函数，无 import/export）

## 5. F2 - Content Script 实现

- [ ] 5.1 重写 `src/pages/content/main.js`：注入 extract-raw-dom.js，调用 extractCaptureResult(document.body) 并发送 CAPTURE_RESULT 消息回 service worker

## 6. F3 - RP 解析与 HTML 生成

- [ ] 6.1 创建 `src/lib/core/rp-parser.js`：使用 fast-xml-parser 解析 document.xml → DocumentIR（含页面、Widget 提取）
- [ ] 6.2 创建 `src/lib/core/html-builder.js`：实现 buildHtmlFromPage(pageIR) 生成完整 HTML 字符串，含 CSS 绝对定位样式
- [ ] 6.3 更新 manifest.json：添加 downloads 权限

## 7. F1 - Offscreen Document 实现

- [ ] 7.1 创建 `src/pages/offscreen/main.js`：监听 RENDER_HTML 消息，使用 iframe.srcdoc 渲染 HTML，调用 extractCaptureResult() 后回传结果
- [ ] 7.2 创建 `src/pages/offscreen/index.html`：包含 iframe（sandbox=allow-same-origin）和入口脚本引用
- [ ] 7.3 实现 HTML 预处理逻辑（inline CSS、绝对化资源路径）

## 8. DOM → IR 转换与 RP 构建

- [ ] 8.1 创建 `src/lib/core/dom-capture.js`：CaptureResult → PageIR / WidgetIR 转换（含样式归一化）
- [ ] 8.2 创建 `src/lib/core/rp-builder.js`：PageIR → RP XML 生成，含 DocumentIR 组装、图片资源打包、buildDocumentXml/buildPageXml/buildWidgetXml/buildStyleXml

## 9. Background Service Worker

- [ ] 9.1 重写 `src/pages/background/main.js`：实现消息路由（CAPTURE_TAB、CONVERT_HTML_FILES、PARSE_RP），协调各模块完成转换流程，处理 PROGRESS/DONE/ERROR 消息回调

## 10. Popup UI（Vue 组件）

- [ ] 10.1 重写 `src/pages/popup/Index.vue`：三 Tab 界面（HTML→RP、页面→RP、RP→HTML），Tab 切换逻辑，文件拖拽/上传交互
- [ ] 10.2 实现 F1 Tab：文件拖拽区域、文件列表展示、转换按钮、进度显示
- [ ] 10.3 实现 F2 Tab：抓取按钮、进度显示
- [ ] 10.4 实现 F3 Tab：文件拖拽区域、文件名展示、解析按钮、进度显示
- [ ] 10.5 实现 popup ↔ service_worker 消息通信（发送指令、接收进度和结果）
- [ ] 10.6 引入 JSZip 和 fast-xml-parser 库到 popup.html（或使用 import）

## 11. 端到端验证

- [ ] 11.1 构建项目：`npm run build` 确认无构建错误
- [ ] 11.2 验证 F3：使用真实 .rp 文件测试 RP→HTML 转换流程
- [ ] 11.3 验证 F2：在浏览器中打开网页测试页面捕获功能
- [ ] 11.4 验证 F1：上传多个 HTML 文件测试批量转换

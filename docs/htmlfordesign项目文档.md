# HTML ↔ Axure RP 双向转换 Chrome 插件 — 项目文档

> 版本：v2.0（基于实际源码） | 目标：Chrome Manifest V3 | 构建：Vue CLI (webpack)

本文件描述当前 `html-rp-converter` 项目的**实际代码结构、模块职责与业务流程**。所有路径和代码片段均来自源码。

---

## 一、项目概述

一个 Chrome 扩展，在 HTML 文件与 Axure RP 原型文件之间双向转换。

| # | 功能 | 输入 | 输出 |
|---|---|---|---|
| F1 | 多 HTML 文件 → RP | 用户上传多个 .html 文件 | 一个多页 .rp 文件 |
| F2 | 当前网页 → RP | 激活标签页的实时 DOM | 一个单页 .rp 文件 |
| F3 | RP → 多 HTML 文件 | 用户上传一个 .rp 文件 | 含多个 HTML 的 ZIP |

**核心设计原则**：

- **共享管道**：F1 和 F2 统一走同一套 DOM 抓取逻辑（F1 用 Offscreen Document 离屏渲染上传的 HTML，F2 用 content script 注入真实 Tab，两者共享 `extract-raw-dom.js`）
- **Widget IR 层**：所有方向都先转换为中间表示（IR），再从 IR 生成目标格式
- **尽力转换**：不可识别元素记录警告后跳过，不因边缘 case 中断整体流程

---

## 二、技术栈

| 类别 | 选型 | 说明 |
|---|---|---|
| 插件规范 | Chrome Manifest V3 | Service Worker 替代 Background Page |
| 构建工具 | Vue CLI 5 (webpack) | 多入口打包，popup 使用 Vue 3 SFC |
| UI 框架 | Vue 3 (Comp API) | 仅 popup 页面使用 Vue，其余页面为原生 JS |
| ZIP 操作 | JSZip 3.x (npm) | 打包 .rp / 解包 .rp / 打包多 HTML |
| XML 解析 | fast-xml-parser 5.x (npm) | 解析 RP 内部 XML |
| XML 生成 | 原生字符串模板 | 避免引入 DOM 操作库 |
| 样式计算 | 原生 `getComputedStyle` | Content Script 中使用 |
| 布局计算 | 原生 `getBoundingClientRect` | Content Script 中使用 |

**依赖**（来自 `package.json`）：

- `vue: ^3.5.34`
- `jszip: ^3.10.1`
- `fast-xml-parser: ^5.9.3`

---

## 三、项目目录结构

### 3.1 源码目录 (`src/`)

```
src/
├── assets/
│   └── logo.png
│
├── lib/
│   ├── core/                        # ★ 核心转换逻辑（仅在 service worker 中使用）
│   │   ├── widget-ir.js             # Widget IR 类型定义与工厂函数
│   │   ├── dom-capture.js           # CaptureResult → Widget IR 转换
│   │   ├── rp-parser.js             # RP XML → DocumentIR
│   │   ├── rp-builder.js            # DocumentIR → RP XML + ZIP
│   │   └── html-builder.js          # PageIR → HTML + CSS
│   │
│   ├── shared/                      # 共享逻辑（content / offscreen 共用）
│   │   └── extract-raw-dom.js       # 原始 DOM → CaptureResult 提取函数
│   │                                 # （导出 extractCaptureResult 等纯函数）
│   │
│   └── utils/                       # 工具函数（仅在 service worker 中使用）
│       ├── color.js                 # CSS color → ARGB hex 互转
│       ├── font.js                  # 字体名归一化 / fallback stack
│       └── image.js                 # base64 编解码 / MIME 检测
│
└── pages/
    ├── popup/                       # Popup 页面（Vue 3 SFC）
    │   ├── popup.js                  # Vue 入口：createApp(App).mount('#app')
    │   └── Index.vue                # 三个 Tab 的操作界面、文件上传、消息监听
    │
    ├── background/                  # Service Worker（ES Module）
    │   └── popup.js                  # 消息路由、F1/F2/F3 主控逻辑、ZIP 操作
    │
    ├── content/                     # Content Script（注入到目标页面）
    │   └── popup.js                  # 入口，import extractCaptureResult 后执行
    │
    ├── offscreen/                   # Offscreen Document（F1 离屏渲染）
    │   ├── popup.js                  # 接收 RENDER_HTML 消息，在 iframe 中渲染并抓取
    │   └── index.html               # 离屏文档 HTML（仅含 <div id="app">）
    │
    └── options/                     # Options 页面（占位，未使用）
        ├── popup.js                  # Vue 入口
        └── Index.vue                # 占位模板
```

### 3.2 构建输出 (`dist/`)

Vue CLI (webpack) 将多入口源码构建到 `dist/`：

| 源码入口 | webpack 输出 | 说明 |
|---|---|---|
| `src/pages/popup/popup.js` | `dist/js/popup.js` | Vue popup bundle |
| `src/pages/background/popup.js` | `dist/js/background.js` | Service Worker bundle |
| `src/pages/content/popup.js` | `dist/js/content.js` | Content Script bundle（含 extract-raw-dom） |
| `src/pages/offscreen/popup.js` | `dist/js/offscreen.js` | Offscreen Document bundle |
| `src/pages/popup/index.html`* | `dist/popup.html` | Popup HTML |
| `src/pages/offscreen/index.html` | `dist/offscreen.html` | Offscreen HTML |
| `manifest.json` (根目录) | `dist/manifest.json` | 直接 copy |

> \* popup/background/content/options 的 HTML 模板使用 `public/index.html`，offscreen 使用 `src/pages/offscreen/index.html`。

### 3.3 构建配置 (`vue.config.js`)

```js
const chromeName = ['popup', 'background', 'options', 'content', 'offscreen']

// 五个入口分别打包
chromeName.forEach((name) => {
  const template = name === 'offscreen'
    ? `src/pages/${name}/index.html`
    : 'public/index.html'
  pages[name] = {
    entry: `src/pages/${name}/popup.js`,
    template,
    filename: `${name}.html`
  }
})
```

输出时 `manifest.json` 通过 `CopyWebpackPlugin` 直接复制到 `dist/`，文件名不做 hash。

---

## 四、Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "HTML ↔ Axure RP Converter",
  "version": "1.0.0",

  "permissions": [
    "activeTab",
    "scripting",
    "downloads",
    "storage",
    "offscreen"
  ],

  "background": {
    "service_worker": "js/background.js",
    "type": "module"
  },

  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
}
```

**权限说明**：

- `activeTab` — F2 抓取当前页面时临时授权注入 content script
- `scripting` — `chrome.scripting.executeScript` 按需注入
- `downloads` — 触发 .rp / .zip 下载
- `offscreen` — F1 离屏渲染 HTML
- `storage` — 预留（当前未使用）

**不声明 `host_permissions`**：按需注入模型，由用户点击 popup 按钮触发 `activeTab` 临时授权。

**`"type": "module"`**：Service Worker 使用 ES Module，可以正常 `import` JSZip、fast-xml-parser 等 npm 包。

---

## 五、Widget IR 设计（核心共享层）

> **文件**：`src/lib/core/widget-ir.js`

所有转换方向（F1/F2/F3）都以 Widget IR 为中间表示。以下类型定义直接来自源码 JSDoc 注解。

### 5.1 文档 / 页面 / Widget 层级

```
DocumentIR
  ├── rpVersion: string            (默认 "9")
  └── pages: PageIR[]

PageIR
  ├── id: string
  ├── name: string                 (HTML 文件名 / 标签页 title)
  ├── width: number                (画布宽度 px)
  ├── height: number               (画布高度 px)
  ├── bgColor: string              (#RRGGBB)
  └── widgets: WidgetIR[]          (顶层 Widget 列表)

WidgetIR
  ├── id: string
  ├── type: WidgetType
  ├── bounds: Bounds               (相对父容器的绝对坐标)
  ├── style: WidgetStyle
  ├── content: string?             (Text / Button 文本内容)
  ├── src: string?                 (Image base64 Data URL)
  ├── states: WidgetIR[][]?        (DynamicPanel 多状态)
  ├── children: WidgetIR[]?        (子节点)
  ├── interactions: Interaction[]?
  ├── zIndex: number?
  ├── name: string?                (设计稿组件名)
  └── warnings: string[]?          (转换警告)
```

### 5.2 WidgetType

```js
'Rectangle' | 'Text' | 'Image' | 'Button' | 'TextBox'
| 'Checkbox' | 'RadioButton' | 'Select' | 'Line'
| 'Group' | 'DynamicPanel' | 'Unknown'
```

### 5.3 样式类型

```ts
FillStyle { type: 'solid'|'none'; color: string; opacity: number; }
BorderStyle { color: string; width: number; style: 'solid'|'dashed'|'none'; radius: number; }
FontStyle { family: string; size: number; weight: 'normal'|'bold'; italic: boolean;
            underline: boolean; color: string; align: 'left'|'center'|'right'; lineHeight: number; }
ShadowStyle { enabled: boolean; x: number; y: number; blur: number; color: string; }
WidgetStyle { fill, border, font, shadow, opacity, rotation }
Interaction { event; actions: InteractionAction[] }
InteractionAction { type: 'show'|'hide'|'toggle'|'setState'|'navigate'; target; state; url }
```

### 5.4 工厂函数

| 函数 | 用途 |
|---|---|
| `createDocument(rpVersion)` | 创建空 `DocumentIR` |
| `createPage(name, width, height)` | 创建 `PageIR`，自动生成 `p{n}` 格式 id |
| `generateId(prefix)` | 递增 ID 生成器 |
| `resetIdCounter()` | 重置 ID 计数器 |
| `defaultBounds()` / `defaultStyle()` | 创建默认值 |
| `isValidWidgetType(type)` | 校验 Widget 类型 |

---

## 六、业务流程

### 6.1 F3：RP → 多 HTML 文件

```
用户在 Popup 上传 .rp 文件
        │
        ▼  Popup Index.vue: parseRpToHtml()
        │   读取 ArrayBuffer → base64 → chrome.runtime.sendMessage({ type: 'PARSE_RP' })
        ▼
[service_worker] background/popup.js: handleParseRp(payload)
        │
        ├─► JSZip.loadAsync(rpBase64, { base64: true })   // 解包
        │   zip.file('document.xml').async('string')
        │
        ├─► rp-parser.js: parseDocumentXml(docXml)         // XML → DocumentIR
        │   使用 fast-xml-parser 解析，遍历 sitemap/pages/objects
        │   每个 <ax:page> → PageIR，每个 <ax:object> → WidgetIR
        │
        ├─► 提取 zip.folder('resources/images') 中的图片资源
        │
        ├─► 每个 PageIR → html-builder.js: buildHtmlFromPage(pageIR)
        │   HTML 为绝对定位布局（包含 <style> 和 <div class="rp-canvas">)
        │   图片替换为 base64 Data URL
        │
        ├─► JSZip 打包 htmlZip.generateAsync({ type: 'blob' })
        │
        └─► chrome.downloads.download({ url, filename, saveAs: true })
           输出 {原文件名}.html.zip
```

### 6.2 F2：当前网页 → RP

```
用户点击「抓取当前页面」
        │
        ▼  Popup Index.vue: capturePageToRp()
        │   chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' })
        ▼
[service_worker] background/popup.js: handleCaptureTab(tabId)
        │
        │   chrome.tabs.query({ active: true }) → tabId
        │   broadcastToPopup('PROGRESS', '正在注入 DOM 抓取脚本...')
        │
        ├─► chrome.scripting.executeScript({
        │       target: { tabId },
        │       files: ['js/content.js']           // webpack 打包的 content bundle
        │   })
        │
        ▼ content/popup.js 在页面上下文中执行：
        │
        │   import { extractCaptureResult } from '...extract-raw-dom.js'
        │   const result = extractCaptureResult(document.body)
        │       内部：captureNode(el) 递归遍历 DOM
        │             getComputedStyle + getBoundingClientRect 提取布局
        │             过滤不可见元素 (display:none / visibility:hidden / opacity:0)
        │             提取图片 src (含 background-image)
        │   chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: result })
        │
        ▼
[service_worker] background/popup.js: handleCaptureResult(captureResult, tabId)
        │
        ├─► dom-capture.js: captureResultToPageIr(captureResult)
        │   resetIdCounter()
        │   → captureResult.tree.children.map(convertNodeToWidget)
        │   → HTML 标签映射到 WidgetType (div→Rectangle, span→Text, img→Image, input→TextBox...)
        │   → convertStyle() 提取背景色/边框/字体/透明度
        │
        ├─► processCrossOriginImages(pageIr, tabId)
        │   遍历所有 Image Widget
        │   ├─ data: / blob: URL → blobToBase64(fetch(url).blob()) 直接转
        │   ├─ 远程 URL → fetch(url, { mode: 'cors' }) → blob → blobToBase64
        │   └─ CORS 失败 → 保留原 URL + 写入 warnings
        │
        ├─► createDocument('9') → doc.pages.push(pageIr)
        │
        ├─► rp-builder.js: buildRpFile(doc)
        │   buildDocumentXml → buildPageXml → buildWidgetXml (递归)
        │   │  每个 Widget 生成 <ax:object> XML
        │   │  样式生成 <ax:fillStyle>/<ax:borderStyle>/<ax:labelStyle>
        │   │  图片提取 base64 → resources/images/img_NNN.ext
        │   └─ JSZip 打包 → Blob
        │
        └─► URL.createObjectURL(blob) → chrome.downloads.download({ filename: '{pageName}.rp', saveAs: true })
```

### 6.3 F1：多 HTML 文件 → RP

采用 **Offscreen Document API** + `iframe.srcdoc` 方案（不使用 Blob Tab）。

```
用户上传 [a.html, b.html, c.html]
        │
        ▼  Popup Index.vue: convertHtmlToRp()
        │   读取每个 File 的 text() → 组装 { name, html } 数组
        │   chrome.runtime.sendMessage({ type: 'CONVERT_HTML_FILES', payload: { files } })
        ▼
[service_worker] background/popup.js: handleConvertHtmlFiles(payload)
        │
        ├─► createDocument('9')
        │
        ├─► ensureOffscreenDocument()
        │   │  chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
        │   │  不存在则 chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_SCRAPING'] })
        │   │  只创建一次，同一次转换复用
        │
        ├─► 逐文件处理（串行）:
        │   │
        │   ├─► preprocessHtml(file.html)
        │   │   ├─ 正则匹配 <link rel="stylesheet"> → fetch CSS → 内联为 <style>
        │   │   └─ (可选) 相对路径图片 → 绝对路径
        │   │
        │   ├─► sendToOffscreen(processedHtml)
        │   │   chrome.runtime.sendMessage({ type: 'RENDER_HTML', payload: { html, width: 1440 } })
        │   │   带回调 → 等待 CAPTURE_RESULT
        │   │
        │   ▼ offscreen/popup.js: renderHtml(payload)
        │   │
        │   │   iframe.srcdoc = payload.html
        │   │   iframe sandbox="allow-same-origin"  (禁止脚本执行)
        │   │   iframe.width = 1440px
        │   │   └─► iframe.onload → extractCaptureResult(iframe.contentDocument.body)
        │   │       引用同一份 extract-raw-dom.js，和 F2 逻辑完全一致
        │   │       sendResponse({ success: true, payload: captureResult })
        │   │
        │   ├─► dom-capture.js: captureResultToPageIr(captureResult, fileName)
        │   │   和 F2 完全相同的转换管道
        │   │
        │   └─► doc.pages.push(pageIr)
        │
        ├─► chrome.offscreen.closeDocument()  (关闭离屏文档)
        │
        ├─► rp-builder.js: buildRpFile(doc)   (含多页，和 F2 相同生成逻辑)
        │
        └─► chrome.downloads.download({ filename: 'converted.rp', saveAs: true })
```

**iframe 安全性**：`sandbox="allow-same-origin"` 保留 DOM 读取权限但默认禁止脚本执行（未加 `allow-scripts`），用户上传的 HTML 中任何 `<script>` 都不会运行。

**iframe 尺寸**：固定宽度 1440px（对应常见设计稿宽度），高度在 `load` 事件后用 `scrollHeight` 实测取得。

---

## 七、消息协议

### 7.1 Popup ↔ Service Worker

| 消息类型 | 方向 | payload | 说明 |
|---|---|---|---|
| `CAPTURE_TAB` | popup → SW | 无 | F2：请求抓取当前标签页 |
| `CONVERT_HTML_FILES` | popup → SW | `{ files: [{name, html}[]] }` | F1：提交上传的 HTML 文件 |
| `PARSE_RP` | popup → SW | `{ rpBase64, fileName }` | F3：提交 RP 文件 base64 |
| `PROGRESS` | SW → popup | `{ message }` | 进度通知 |
| `DONE` | SW → popup | `{ message }` | 完成通知（popup 复位 converting 状态） |
| `ERROR` | SW → popup | `{ message }` | 错误通知（popup 复位 converting 状态） |

**实现方式**：SW 通过 `broadcastToPopup(type, message)` 主动广播，popup 的 `onSwMessage` 监听 `PROGRESS` / `DONE` / `ERROR`。

### 7.2 Content Script → Service Worker

| 消息类型 | 方向 | payload | 说明 |
|---|---|---|---|
| `CAPTURE_RESULT` | content → SW | `{ title, width, height, tree }` | F2：DOM 抓取结果 |

SW 收到后回复 `{ success: true }` 做 ack。

### 7.3 Service Worker ↔ Offscreen Document

| 消息类型 | 方向 | payload | 响应 |
|---|---|---|---|
| `RENDER_HTML` | SW → offscreen | `{ html, width }` | `{ success, payload: CaptureResult }` — 带回调 |

`sendToOffscreen(html)` 封装为 Promise，等待 offscreen 的 `sendResponse` 回调。

---

## 八、关键模块源码说明

### 8.1 `extract-raw-dom.js` — DOM 提取（共享层）

**文件**：`src/lib/shared/extract-raw-dom.js`  
**使用者**：`content/popup.js`（F2）和 `offscreen/popup.js`（F1）  
**导出**：`extractCaptureResult`, `captureNode`, `extractStyle`, `getImageSrc`, `getDirectText`

核心流程：

```
extractCaptureResult(rootEl)           // 入口，传入 document.body
  ├─► captureNode(el, parentRect)      // 递归，过滤不可见节点
  │   ├─► getBoundingClientRect()      // 布局信息
  │   ├─► getComputedStyle(el)         // 样式信息
  │   ├─► getDirectText(el)            // 提取直接文本（排除子元素文本）
  │   ├─► getImageSrc(el, style)       // <img src> 或 background-image url
  │   └─► extractStyle(cs)             // 提取 12 项关键 CSS 属性
  └─► 返回 { title, width, height, tree }
```

**被注入为 Content Script 的处理**：webpack 打包时，`content/popup.js` 的 `import { extractCaptureResult }` 会被编译进 bundle `js/content.js`。`chrome.scripting.executeScript({ files: ['js/content.js'] })` 注入的是打包后的单文件，在其中 `import` 已转化为 webpack 的模块加载代码，不依赖原生 ES Module 支持。

### 8.2 `dom-capture.js` — CaptureResult → Widget IR

**文件**：`src/lib/core/dom-capture.js`  
**使用者**：`background/popup.js`（F1 + F2 共用）  
**入口**：`captureResultToPageIr(captureResult, pageName)`

流程：
1. `resetIdCounter()` — 重置 Widget ID 计数器
2. `createPage()` — 创建 `PageIR`（name 取自 captureResult.title 或传入参数）
3. `captureResult.tree.children.map(convertNodeToWidget)` — 递归转换
   - `mapTagToWidgetNode()` — HTML 标签→WidgetType 映射（div→Rectangle/detectDivRole, span→Text, img→Image, input→TextBox/Checkbox/RadioButton...）
   - `convertStyle()` — CSS 属性→WidgetStyle（背景色、边框、字体、透明度）
   - 容器类标签（div/Rectangle/Group）的子节点保留为 `widget.children`

### 8.3 `rp-builder.js` — Widget IR → RP 文件

**文件**：`src/lib/core/rp-builder.js`  
**入口**：`buildRpFile(doc: DocumentIR): Promise<Blob>`

流程：
1. `buildDocumentXml(doc)` — 生成 document.xml 字符串
   - `buildPageXml(page)` — 每页的 `<ax:page>`
   - `buildWidgetXml(w, depth)` — 递归生成 `<ax:object>`，子节点嵌套 `<ax:objects>`
   - `buildStyleXml(s)` — 填充色、边框、字体样式（CSS → ARGB hex 转换用 `colorToArgb`）
   - `buildContentXml(w)` — 文本、图片 src
2. `collectImages(doc)` — 遍历所有 Image Widget，提取 base64 → `resources/images/img_NNN.ext`
3. JSZip 打包 → `zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })`

### 8.4 `rp-parser.js` — RP XML → Widget IR

**文件**：`src/lib/core/rp-parser.js`  
**入口**：`parseDocumentXml(xmlStr: string): DocumentIR`

使用 `fast-xml-parser` 的 `XMLParser`：
- `attributeNamePrefix: ''` — 属性名不加前缀
- `ignoreAttributes: false` — 保留属性
- 支持 `ax:` 命名空间前缀（同时兼容无前缀形式）

流程：
1. 解析 XML → 原始 JS 对象
2. 遍历 `<ax:sitemap>` 获取页面列表
3. 遍历 `<ax:pages>` 获取每页定义（宽高、背景色）
4. 每页的 `<ax:objects>` → `parseWidget()` 递归解析
   - `parseWidgetStyle()` — 解析 fill/border/label/shadow 样式
   - 支持子对象嵌套和 DynamicPanel 多状态

### 8.5 `html-builder.js` — Widget IR → HTML

**文件**：`src/lib/core/html-builder.js`  
**入口**：`buildHtmlFromPage(pageIR: PageIR): string`

流程：
1. `flattenWidgets(pageIR.widgets)` — 展开 Group/嵌套子节点
2. `buildCssRules(widgets)` — 为每个扁平 Widget 生成 CSS 规则（绝对定位）
3. `buildBodyHtml(widgets)` — 生成 HTML body
   - `widgetToHtml(w)` — 按类型转换：Text→`<div>`, Image→`<img>`, Button→`<button>`, TextBox→`<input>`, Select→`<select>`, DynamicPanel→多层 `<div>`（默认状态显示其余隐藏）
4. 组装完整的 `<!DOCTYPE html>` 文档

### 8.6 Popup UI (`Index.vue`)

**文件**：`src/pages/popup/Index.vue`（Vue 3 Options API）

三个 Tab 切换面板：

| Tab | id | 功能 |
|---|---|---|
| HTML→RP | t1 | 拖拽/选择多个 .html 文件 + 转换按钮 |
| 页面→RP | t2 | 直接触发抓取当前页面 |
| RP→HTML | t3 | 拖拽/选择 .rp 文件 + 解析按钮 |

状态管理：
- `converting: boolean` — 全局转换锁（三个 Tab 共用）
- `progress: { t1, t2, t3 }` — 每个 Tab 独立的进度文本
- 通过 `chrome.runtime.onMessage.addListener(onSwMessage)` 监听 SW 的 `PROGRESS` / `DONE` / `ERROR`

文件 base64 编码方式（F3）：手动逐字节 `String.fromCharCode` + `btoa` 构建 base64。

---

## 九、HTML 标签 → WidgetType 映射表

| HTML 标签 / 角色 | WidgetType | 备注 |
|---|---|---|
| `<div>` | `Rectangle` / `Text` / `Image` / `Button` / `Group` | 根据 role / 文本 / 背景图判定 |
| `<span>`, `<p>`, `<h1>`–`<h6>`, `<a>`, `<label>`, `<li>` | `Text` | |
| `<img>` | `Image` | |
| `<button>` | `Button` | |
| `<input type="text">` | `TextBox` | 含 email/password/search/tel/url |
| `<input type="checkbox">` | `Checkbox` | |
| `<input type="radio">` | `RadioButton` | |
| `<select>` | `Select` | |
| `<textarea>` | `TextBox` | |
| `<ul>`, `<ol>`, `<table>`, `<section>`, `<nav>`, `<header>`, `<footer>`, `<main>` | `Group` | |
| 其他 | `Unknown` | 记录 warning |

---

## 十、颜色格式转换

Axure RP 内部使用 **ARGB 十六进制**（`ff3366cc` = 不透明白色，Alpha 在前）。

**文件**：`src/lib/utils/color.js`

| 函数 | 用途 | 示例 |
|---|---|---|
| `colorToArgb(cssColor, opacity?)` | CSS → ARGB | `'#3366cc'` → `'ff3366cc'` |
| `argbToHex(argb)` | ARGB → #RRGGBB | `'ffffffff'` → `'#ffffff'` |
| `argbToRgba(argb)` | ARGB → rgba() | `'803366cc'` → `'rgba(51,102,204,0.50)'` |
| `parseCssColor(cssColor)` | CSS → [r,g,b,a] | 支持 #RGB, #RRGGBB, rgb(), rgba(), 命名色 |

---

## 十一、字体处理

**文件**：`src/lib/utils/font.js`

| 函数 | 用途 |
|---|---|
| `normalizeFontFamily(name)` | 中文字体别名归一化（如 `pingfang sc` → `PingFang SC`） |
| `buildFontStack(name, fallbacks?)` | 构建 CSS font-family fallback |
| `normalizeFontWeight(weight)` | `700`/`bold` → `'bold'`，其余 → `'normal'` |
| `isCJkFont(name)` | 判断是否为中文字体（决定 fallback 策略） |

---

## 十二、图片处理

**文件**：`src/lib/utils/image.js`

| 函数 | 用途 |
|---|---|
| `blobToBase64(blob)` | Blob → `data:mime;base64,...`（手写分块 base64，兼容 SW 环境） |
| `base64ToBlob(data)` | `data:...;base64,...` → Blob |
| `getMimeType(filename)` | 扩展名 → MIME |
| `isDataUrl(url)` | 判断是否为 data: URL |
| `isSameOrigin(url)` | SW 中退化为检查 data:/blob: 前缀 |

---

## 十三、RP 文件结构（逆向工程参考）

.rp 文件本质是 ZIP，解开后包含：

```
example.rp (ZIP)
├── document.xml          ← 核心：包含所有页面和 Widget 定义
├── notes.xml             ← 批注，可忽略
└── resources/
    └── images/
        ├── img_001.png
        └── img_002.jpg
```

**document.xml 参考结构**（通过 Axure RP 9 逆向得到，`rp-parser.js` 当前基于此解析）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<ax:AxureRP xmlns:ax="http://www.axure.com/AxureRP" version="9">

  <ax:sitemap>
    <ax:page id="p1" name="首页" type="page"/>
    <ax:page id="p2" name="详情页" type="page"/>
  </ax:sitemap>

  <ax:pages>
    <ax:page id="p1" name="首页" w="1440" h="900">
      <ax:objects>

        <!-- 矩形 -->
        <ax:object id="w1" type="Rectangle" label="卡片">
          <ax:x>100</ax:x>  <ax:y>80</ax:y>
          <ax:w>320</ax:w>  <ax:h>200</ax:h>
          <ax:fillStyle>
            <ax:fillColor argb="ffffffff"/>
            <ax:gradient enabled="false"/>
          </ax:fillStyle>
          <ax:borderStyle>
            <ax:borderColor argb="ffcccccc"/>
            <ax:borderWidth>1</ax:borderWidth>
            <ax:borderRadius>8</ax:borderRadius>
          </ax:borderStyle>
        </ax:object>

        <!-- 文本 -->
        <ax:object id="w2" type="Text">
          <ax:x>120</ax:x>  <ax:y>100</ax:y>
          <ax:w>200</ax:w>  <ax:h>30</ax:h>
          <ax:labelStyle>
            <ax:fontName>PingFang SC</ax:fontName>
            <ax:fontSize>16</ax:fontSize>
            <ax:fontColor argb="ff333333"/>
            <ax:bold>false</ax:bold>
            <ax:align>left</ax:align>
          </ax:labelStyle>
          <ax:text>示例文字</ax:text>
        </ax:object>

        <!-- 图片 -->
        <ax:object id="w3" type="Image">
          <ax:x>0</ax:x>  <ax:y>0</ax:y>
          <ax:w>400</ax:w>  <ax:h>300</ax:h>
          <ax:src>resources/images/img_001.png</ax:src>
        </ax:object>

      </ax:objects>
    </ax:page>
  </ax:pages>

</ax:AxureRP>
```

> ⚠️ `rp-parser.js` 同时兼容 `ax:` 命名空间前缀和无前缀两种形式（`ax:fillColor` / `fillColor`）。

**格式逆向方法**：
1. 在 Axure RP 9 中手动创建测试文件，每次只添加一种 Widget 类型
2. 保存为 .rp → 改扩展名 .zip → 解包 → 阅读格式化后的 XML
3. 记录每种 Widget 的 XML 标签/属性映射
4. 从 Rectangle → Text → Image → Button → TextBox → Checkbox → Select → DynamicPanel 迭代覆盖

---

## 十四、技术边界与已知限制

| 项目 | 说明 |
|---|---|
| RP 版本 | 仅兼容 Axure RP 9，RP 10 格式差异需另行验证 |
| CSS 渐变 | `linear-gradient` 等无 Axure 原生对应，降级为截图 |
| Web 字体 | `@font-face` 自定义字体不打包 |
| 伪元素 | `::before`/`::after` 不支持 |
| Shadow DOM | 不穿透 Shadow Root |
| iframe 内容 | 不抓取跨域 iframe 内部 DOM |
| 跨域图片（无 CORS） | 降级为保留原 URL + warning |
| JS 交互 | 复杂 Axure 交互（变量判断、条件逻辑）转 HTML 时仅保留 show/hide |
| 上传 HTML 内嵌 `<script>`（F1） | 离屏渲染时用 sandbox 禁止执行，只识别静态 HTML/CSS 结构 |
| 响应式布局 | RP → HTML 输出为绝对定位 |
| 动画 / transition | 不支持 |

---

## 十五、MVP Widget 支持矩阵

| Widget | HTML→RP | RP→HTML | 备注 |
|---|---|---|---|
| Rectangle / Box | ✅ | ✅ | div + 样式 |
| Text | ✅ | ✅ | div / span |
| Image | ✅ | ✅ | img base64 |
| Button | ✅ | ✅ | button |
| TextBox | ✅ | ✅ | input[text] |
| Checkbox | ✅ | ✅ | input[checkbox] |
| RadioButton | ✅ | ✅ | input[radio] |
| Select | ✅ | ✅ | select |
| Line | ⚠️ | ✅ | HR / border 近似 |
| DynamicPanel | ⚠️ | ⚠️ 仅首状态 | 复杂度高 |
| Group | ✅ | ✅ | 容器嵌套 |
| Repeater | ❌ | ❌ | |
| Master 引用 | ❌ | ⚠️ 内联展开 | |

---

## 十六、开发命令

```bash
# 开发模式（文件变更时自动重新构建）
npm run dev

# 生产构建
npm run build

# 代码检查
npm run lint
```

构建产物输出到 `dist/` 目录，在 Chrome `chrome://extensions/` 中以「开发者模式」加载 `dist/` 文件夹即可测试。

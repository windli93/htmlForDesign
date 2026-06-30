# HTML ↔ Axure RP 双向转换 Chrome 插件技术方案

> 版本：v1.1（已修订）| 目标：Manifest V3 | Axure RP 9

> **本次复核修正的两个真实问题**
> 1. **F1 的「Blob Tab」方案技术上跑不通**：`URL.createObjectURL()` 生成的 Blob URL 绑定在创建它的执行上下文里（popup/service worker），`chrome.tabs.create` 打开的是全新的浏览上下文，无法解析这个 Blob，导航会直接失败。已改用 `chrome.offscreen` API + `iframe.srcdoc`（见第八节）。
> 2. **静态注入的 content script 文件列表和 service worker 的 ES Module 用法冲突**：原 manifest 把 `widget-ir.js`、`color.js` 等文件同时声明为「注入到每个页面」和「service worker 里 `import` 的模块」，但 `chrome.scripting.executeScript` 注入的文件以经典脚本执行，不支持 `export`/`import`。修正后，注入到页面/离屏文档的只有一份不依赖 import 的纯函数提取逻辑，IR 转换相关的工具文件只在 service worker 一侧使用（见第三、四节）。
>
> 顺带把权限从 `host_permissions: ["<all_urls>"]` + `tabs` 收窄为按需注入模型，减少安装时的权限申请，也更容易过 Chrome Web Store 审核。

---

## 一、项目概述

### 1.1 三大功能

| # | 功能 | 输入 | 输出 |
|---|---|---|---|
| F1 | 多 HTML 文件 → RP | 用户上传多个 .html 文件 | 一个多页 .rp 文件 |
| F2 | 当前网页 → RP | 激活标签页的实时 DOM | 一个单页 .rp 文件 |
| F3 | RP → 多 HTML 文件 | 用户上传一个 .rp 文件 | 含多个 HTML 的 ZIP |

### 1.2 关键设计原则

- **共享管道**：F1 和 F2 统一走同一套 DOM 抓取逻辑（F1 用 Offscreen Document 离屏渲染上传的 HTML，F2 用 content script 注入真实 Tab，两者共享同一份提取函数）
- **Widget IR 层**：所有方向都先转换为中间表示（IR），再从 IR 生成目标格式，格式逆向工作只做一次
- **尽力转换**：不可识别元素记录警告后跳过，不因边缘 case 中断整体流程
- **MVP 优先**：先做 F3（RP → HTML），用已知输入验证 RP 格式理解，再做 F1/F2

---

## 二、技术栈

| 类别 | 选型 | 说明 |
|---|---|---|
| 插件规范 | Chrome Manifest V3 | Service Worker 替代 Background Page |
| ZIP 操作 | JSZip 3.x | 打包 .rp / 解包 .rp / 打包多 HTML |
| XML 解析 | fast-xml-parser 4.x | 解析 RP 内部 XML |
| XML 生成 | 原生字符串模板 | 避免引入 DOM 操作库 |
| 样式计算 | 原生 `getComputedStyle` | Content Script 中使用 |
| 布局计算 | 原生 `getBoundingClientRect` | Content Script 中使用 |
| 截图兜底 | `chrome.tabs.captureVisibleTab` | 跨域图片无法 fetch 时降级 |

---

## 三、插件目录结构

```
html-rp-converter/
├── manifest.json
│
├── popup/
│   ├── popup.html               # 三个 Tab 的操作入口
│   ├── popup.js                 # Tab 切换 + 消息转发 + 进度展示
│   └── popup.css
│
├── content_scripts/
│   └── capture.js               # 注入到真实 Tab 的入口文件，几行代码，不依赖 import（避免与 ES Module 冲突）
│
├── offscreen/
│   ├── offscreen.html           # F1 专用：离屏渲染上传的 HTML 文件
│   └── offscreen.js             # 入口文件，逻辑与 capture.js 对称，操作 iframe.contentDocument
│
├── background/
│   └── service_worker.js        # 消息路由、IR 构建、ZIP 操作、跨域图片 fetch、下载触发（type: module）
│
├── lib/
│   ├── jszip.min.js
│   ├── fast-xml-parser.min.js
│   │
│   ├── shared/
│   │   └── extract-raw-dom.js   # 原始 DOM→CaptureResult 提取函数，capture.js 和 offscreen.js 共用同一份（不写 import/export）
│   │
│   ├── core/                    # 以下文件只在 service worker 里用 import 引入，不会被注入到任何页面
│   │   ├── widget-ir.js         # IR 类型定义与校验工具
│   │   ├── dom-capture.js       # CaptureResult → Widget IR（在 service worker 中执行）
│   │   ├── rp-parser.js         # RP XML → Widget IR  ← 优先实现
│   │   ├── rp-builder.js        # Widget IR → RP XML
│   │   └── html-builder.js      # Widget IR → HTML + CSS
│   │
│   └── utils/
│       ├── color.js             # CSS color → ARGB hex 互转
│       ├── font.js              # 字体名处理 / fallback stack
│       └── image.js             # base64 编解码 / MIME 检测
│
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

---

## 四、Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "HTML ↔ Axure RP Converter",
  "version": "1.0.0",
  "description": "在 HTML 文件与 Axure RP 原型文件之间双向转换",

  "permissions": [
    "activeTab",
    "scripting",
    "downloads",
    "storage",
    "offscreen"
  ],

  "background": {
    "service_worker": "background/service_worker.js",
    "type": "module"
  },

  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
}
```

> **不声明静态 content_scripts，也不声明 host_permissions**
> F2 抓取「当前页面」时，由 popup 里的按钮点击触发 `activeTab` 临时授权（点击扩展图标打开 popup 这个动作本身就会为当前激活的 Tab 授予临时权限），再用 `chrome.scripting.executeScript({ target: { tabId }, files: ['lib/shared/extract-raw-dom.js', 'content_scripts/capture.js'] })` 按需注入——只有用户主动点击「抓取当前页面」时才会接触页面 DOM，不需要在安装时就声明 `<all_urls>`。好处是权限申请面更小，更容易过 Chrome Web Store 审核，用户也更放心。
>
> **被注入的文件必须是不依赖 import 的经典脚本**：`chrome.scripting.executeScript` 的 `files` 数组是按经典脚本方式顺序执行的，不支持 `export`/`import` 语法（即使 `files` 里列了多个文件，它们会共享同一个全局作用域，可以互相调用普通函数，但不能用 ES Module 语法）。所以 `lib/shared/extract-raw-dom.js` 和 `content_scripts/capture.js` 都只用普通函数声明。所有需要 IR 转换、颜色/字体归一化的逻辑都放在 service worker 一侧（声明了 `"type": "module"`，可以正常用 `import`/`export`）。
>
> **MV3 其他注意事项**
> - Service Worker 无持久状态，长任务需用 `chrome.storage.session` 中转数据
> - 不能在 Service Worker 里操作 DOM；图片截图降级方案用 `chrome.tabs.captureVisibleTab`（仍只能针对当前可见 Tab，对应 F2 场景）
> - F1 不打开真实 Tab，改用 `chrome.offscreen` API（见第八节），因此不需要 `tabs` 权限

---

## 五、Widget IR 设计（核心共享层）

```js
// lib/core/widget-ir.js

/**
 * 文档级 IR
 * @typedef {Object} DocumentIR
 * @property {string}   rpVersion  - 目标 RP 版本，默认 "9"
 * @property {PageIR[]} pages
 */

/**
 * 页面级 IR（对应 RP 中一个 Page，或一个 HTML 文件）
 * @typedef {Object} PageIR
 * @property {string}     id
 * @property {string}     name          - 页面名称（HTML 文件名 / 标签页 title）
 * @property {number}     width         - 画布宽度 px
 * @property {number}     height        - 画布高度 px
 * @property {string}     [bgColor]     - 背景色 #RRGGBB
 * @property {WidgetIR[]} widgets       - 顶层 Widget 列表
 */

/**
 * Widget 节点 IR
 * @typedef {Object} WidgetIR
 * @property {string}       id
 * @property {WidgetType}   type
 * @property {Bounds}       bounds        - 相对父容器的绝对坐标
 * @property {WidgetStyle}  style
 * @property {string}       [content]     - Text / Button 的文本内容
 * @property {string}       [src]         - Image 的 base64 Data URL
 * @property {WidgetIR[][]} [states]      - DynamicPanel 的多状态（每个状态是 WidgetIR 数组）
 * @property {WidgetIR[]}   [children]    - 子节点（Group / Container）
 * @property {Interaction[]} [interactions]
 * @property {number}       [zIndex]
 * @property {string}       [name]        - 设计稿中的组件名
 * @property {string[]}     [warnings]    - 转换过程中的不支持项日志
 */

/**
 * @typedef {'Rectangle'|'Text'|'Image'|'Button'|'TextBox'|'Checkbox'
 *           |'RadioButton'|'Select'|'Line'|'Group'|'DynamicPanel'|'Unknown'} WidgetType
 */

/**
 * @typedef {Object} Bounds
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} WidgetStyle
 * @property {FillStyle}   [fill]
 * @property {BorderStyle} [border]
 * @property {FontStyle}   [font]
 * @property {ShadowStyle} [shadow]
 * @property {number}      [opacity]    - 0~1
 * @property {number}      [rotation]   - 度
 */

// FillStyle / BorderStyle / FontStyle / ShadowStyle / Interaction 见附录 A
```

---

## 六、F3：RP → 多 HTML（优先实现）

### 6.1 处理流程

```
用户在 Popup 上传 .rp 文件
        │
        ▼
[service_worker] JSZip 解包
        │  读取 document.xml
        ▼
[rp-parser.js] XML → DocumentIR
        │  每个 <Page> 解析为 PageIR + WidgetIR[]
        ▼
[html-builder.js] DocumentIR → HTML 文件组
        │  每个 PageIR 生成一个 page-N.html
        │  提取图片资源为内联 base64
        ▼
[service_worker] JSZip 打包为 output.zip
        │
        ▼
chrome.downloads 触发下载
```

### 6.2 RP 文件结构（逆向工程目标）

.rp 文件本质是 ZIP，需手动解包分析。以下为通过逆向 Axure RP 9 样本文件得到的参考结构：

```
example.rp (ZIP)
├── document.xml          ← 核心：包含所有页面和 Widget 定义
├── notes.xml             ← 批注，可忽略
└── resources/
    └── images/
        ├── img_001.png
        └── img_002.jpg
```

**document.xml 预估结构（需实测修正）：**

```xml
<?xml version="1.0" encoding="utf-8"?>
<ax:AxureRP xmlns:ax="http://www.axure.com/AxureRP"
            version="9">

  <ax:sitemap>
    <ax:page id="p1" name="首页"   type="page"/>
    <ax:page id="p2" name="详情页" type="page"/>
  </ax:sitemap>

  <ax:pages>
    <ax:page id="p1" name="首页" w="1440" h="900">
      <ax:objects>

        <!-- 矩形 / 形状 -->
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
          <ax:shadowStyle enabled="false"/>
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
            <ax:italic>false</ax:italic>
            <ax:align>left</ax:align>
            <ax:lineHeight>1.5</ax:lineHeight>
          </ax:labelStyle>
          <ax:text>示例文字</ax:text>
        </ax:object>

        <!-- 图片 -->
        <ax:object id="w3" type="Image">
          <ax:x>0</ax:x>  <ax:y>0</ax:y>
          <ax:w>400</ax:w>  <ax:h>300</ax:h>
          <ax:src>resources/images/img_001.png</ax:src>
        </ax:object>

        <!-- 输入框 -->
        <ax:object id="w4" type="TextBox">
          <ax:x>100</ax:x>  <ax:y>300</ax:y>
          <ax:w>280</ax:w>  <ax:h>40</ax:h>
          <ax:hint>请输入内容</ax:hint>
        </ax:object>

        <!-- 动态面板（多状态容器） -->
        <ax:object id="w5" type="DynamicPanel" defaultState="0">
          <ax:x>0</ax:x>  <ax:y>400</ax:y>
          <ax:w>375</ax:w>  <ax:h>200</ax:h>
          <ax:states>
            <ax:state index="0" name="默认">
              <ax:objects><!-- 子 widget 列表 --></ax:objects>
            </ax:state>
            <ax:state index="1" name="激活">
              <ax:objects><!-- 子 widget 列表 --></ax:objects>
            </ax:state>
          </ax:states>
        </ax:object>

      </ax:objects>
    </ax:page>
  </ax:pages>

</ax:AxureRP>
```

> ⚠️ **以上 XML 为推断结构**，实际命名空间前缀、标签名、属性名需通过以下步骤实测确认。

### 6.3 RP 格式逆向方法

```
Step 1  在 Axure RP 9 中手动创建测试文件
        每次只添加一种 Widget 类型，设置典型属性后另存为 .rp

Step 2  解包分析
        $ cp example.rp example.zip && unzip example.zip -d rp_extracted/
        用 VSCode 或 xmllint 格式化 document.xml 阅读

Step 3  记录格式字典
        建立 widget-type-map.json，记录每种 Widget 的 XML 标签/属性映射

Step 4  迭代覆盖
        Rectangle → Text → Image → Button → TextBox → Checkbox
        → Select → DynamicPanel（按 MVP 优先级顺序）

Step 5  双向验证
        用 rp-parser.js 解析后再用 rp-builder.js 重建，在 Axure 打开验证还原度
```

### 6.4 html-builder.js 核心逻辑

```js
// lib/core/html-builder.js

export function buildHtmlFromPage(pageIR) {
  const widgets = flattenWidgets(pageIR.widgets); // 展开 Group
  const styles  = buildCssRules(widgets);
  const body    = buildBodyHtml(widgets);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${pageIR.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .rp-canvas {
      position: relative;
      width: ${pageIR.width}px;
      height: ${pageIR.height}px;
      background: ${pageIR.bgColor || '#ffffff'};
      overflow: hidden;
    }
    ${styles}
  </style>
</head>
<body>
  <div class="rp-canvas">
    ${body}
  </div>
</body>
</html>`;
}

function widgetToCss(w) {
  const s = w.style;
  return `
  #${w.id} {
    position: absolute;
    left: ${w.bounds.x}px;
    top:  ${w.bounds.y}px;
    width:  ${w.bounds.width}px;
    height: ${w.bounds.height}px;
    z-index: ${w.zIndex || 0};
    ${s.fill?.color    ? `background-color: ${s.fill.color};` : ''}
    ${s.border?.width  ? `border: ${s.border.width}px solid ${s.border.color};` : ''}
    ${s.border?.radius ? `border-radius: ${s.border.radius}px;` : ''}
    ${s.font?.size     ? `font-size: ${s.font.size}px;` : ''}
    ${s.font?.color    ? `color: ${s.font.color};` : ''}
    ${s.font?.family   ? `font-family: ${s.font.family}, sans-serif;` : ''}
    ${s.opacity != null ? `opacity: ${s.opacity};` : ''}
  }`;
}

function widgetToHtml(w) {
  switch (w.type) {
    case 'Text':
    case 'Rectangle':
      return `<div id="${w.id}">${w.content || ''}</div>`;
    case 'Image':
      return `<img id="${w.id}" src="${w.src}" alt="${w.name || ''}">`;
    case 'Button':
      return `<button id="${w.id}">${w.content || ''}</button>`;
    case 'TextBox':
      return `<input id="${w.id}" type="text" placeholder="${w.content || ''}">`;
    case 'Checkbox':
      return `<label id="${w.id}"><input type="checkbox">${w.content || ''}</label>`;
    case 'Select':
      return `<select id="${w.id}"></select>`;
    case 'DynamicPanel':
      // 只渲染默认状态，其余状态 display:none
      return buildDynamicPanelHtml(w);
    default:
      return `<div id="${w.id}" data-type="${w.type}">${w.content || ''}</div>`;
  }
}
```

---

## 七、F2：当前网页 → RP

### 7.1 处理流程

```
用户点击「抓取当前页面」
        │
        ▼
[popup.js] → chrome.tabs.query 获取 activeTab.id
        │
        ▼
[service_worker] → chrome.scripting.executeScript 注入 capture.js
        │
        ▼
[capture.js] 在页面上下文中运行
        │  1. 过滤不可见元素
        │  2. 递归遍历 DOM 树
        │  3. getComputedStyle + getBoundingClientRect
        │  4. 提取文本、图片 src、表单属性
        │  5. 序列化为 CaptureResult JSON（含 base64 图片）
        │
        ▼
chrome.runtime.sendMessage → service_worker
        │
        ▼ 对跨域图片进行 background fetch
[service_worker] 图片兜底：captureVisibleTab 截图切图
        │
        ▼
[dom-capture.js] CaptureResult → PageIR
        │
        ▼
[rp-builder.js] PageIR → RP XML → JSZip → .rp 下载
```

### 7.2 核心遍历逻辑（capture.js / offscreen.js 共用）

> 下面这几个函数实际放在 `lib/shared/extract-raw-dom.js` 里——纯函数，不写 `import`/`export`。`capture.js` 只是个几行的入口文件，调用这份共享逻辑后把结果发回 service worker；第八节的 `offscreen.js` 调用的是同一份函数，只是把根节点换成 `iframe.contentDocument.body`，保证两条路径的还原效果一致，也不用维护两套相似代码。

```js
// lib/shared/extract-raw-dom.js（capture.js 和 offscreen.js 共用，无 import/export）

function captureNode(el, parentRect) {
  const rect   = el.getBoundingClientRect();
  const style  = window.getComputedStyle(el);

  // 过滤不可见节点
  if (rect.width === 0 || rect.height === 0) return null;
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  if (parseFloat(style.opacity) === 0) return null;

  // 相对文档坐标（考虑滚动）
  const absX = rect.left + window.scrollX;
  const absY = rect.top  + window.scrollY;

  const node = {
    tagName:   el.tagName.toLowerCase(),
    id:        el.id || generateId(),
    bounds:    { x: absX, y: absY, width: rect.width, height: rect.height },
    text:      getDirectText(el),
    src:       getImageSrc(el, style),   // <img> src 或 background-image url
    inputType: el.type || null,
    placeholder: el.placeholder || null,
    href:      el.href || null,
    role:      el.getAttribute('role'),
    style:     extractStyle(style),
    children:  [],
  };

  // 递归子节点（非纯文本节点）
  for (const child of el.children) {
    const childNode = captureNode(child, rect);
    if (childNode) node.children.push(childNode);
  }

  return node;
}

function extractStyle(cs) {
  return {
    bgColor:      cs.backgroundColor,
    borderColor:  cs.borderTopColor,
    borderWidth:  parseFloat(cs.borderTopWidth),
    borderRadius: parseFloat(cs.borderTopLeftRadius),
    fontFamily:   cs.fontFamily,
    fontSize:     parseFloat(cs.fontSize),
    fontWeight:   cs.fontWeight,
    fontColor:    cs.color,
    textAlign:    cs.textAlign,
    lineHeight:   cs.lineHeight,
    opacity:      parseFloat(cs.opacity),
    zIndex:       parseInt(cs.zIndex) || 0,
    boxShadow:    cs.boxShadow,
  };
}

// 图片处理：<img> / background-image / SVG
function getImageSrc(el, style) {
  if (el.tagName === 'IMG' && el.src) return el.src;
  const bg = style.backgroundImage;
  if (bg && bg !== 'none') {
    const match = bg.match(/url\(["']?(.+?)["']?\)/);
    return match ? match[1] : null;
  }
  return null;
}

// 汇总入口：传入根节点（document.body 或 iframe.contentDocument.body）
function extractCaptureResult(rootEl) {
  const doc = rootEl.ownerDocument;
  return {
    title:  doc.title,
    width:  doc.documentElement.scrollWidth,
    height: doc.documentElement.scrollHeight,
    tree:   captureNode(rootEl, null),
  };
}
```

```js
// content_scripts/capture.js —— 真正注入页面的文件，只有这几行
extractAndSend();

async function extractAndSend() {
  const result = extractCaptureResult(document.body);
  chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: result });
}
```

### 7.3 跨域图片处理方案

| 情况 | 处理方式 |
|---|---|
| 同域图片 / Data URL | Content Script 直接读取 |
| 跨域图片（有 CORS） | Service Worker `fetch()` → base64 |
| 跨域图片（无 CORS） | `chrome.tabs.captureVisibleTab` 截全屏后按 BoundingRect 切图 |
| SVG inline | 直接序列化 SVG 字符串后 base64 |

```js
// background/service_worker.js - 图片 fetch 策略
async function fetchImageAsBase64(url, tabId) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await blobToBase64(blob);
  } catch {
    // CORS 失败，降级截图切图
    return await cropTabScreenshot(tabId, imageBounds);
  }
}
```

---

## 八、F1：多 HTML 文件 → RP

### 8.1 关键设计：Offscreen Document，而不是「Blob Tab」

最初设想是把每个上传的 HTML 渲染成一个后台静默 Tab（`chrome.tabs.create({ url: blobUrl, active: false })`），复用 F2 的抓取逻辑。**这条路线技术上走不通**：`URL.createObjectURL()` 生成的 Blob URL 形如 `blob:chrome-extension://<id>/<uuid>`，只能在创建它的那个执行上下文（popup 或 service worker）里解析；`chrome.tabs.create` 打开的是一个完全独立的浏览上下文，没有访问这个 Blob 对象的权限，直接把这个 URL 粘贴到新 Tab 地址栏也会报「访问被拒绝」，程序化打开同理失败。

正确做法是用 MV3 专门为「service worker 没有 DOM」这个问题设计的 **Offscreen Document API**（Chrome 109+，需要 `offscreen` 权限）：

```
用户上传 [a.html, b.html, c.html]
        │
        ▼
[service_worker] 确保离屏文档只创建一次（同一时刻只能存在一个）：
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen/offscreen.html')]
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: '离屏渲染用户上传的 HTML 文件以提取布局信息',
    });
  }
        │
        ▼
逐文件处理（串行，避免内存占用过高），每个文件：
  service_worker → chrome.runtime.sendMessage({ type: 'RENDER_HTML', payload: { html: htmlText, width: 1440 } })
        │
        ▼
[offscreen.js] 接收消息后：
  1. iframe.srcdoc = htmlText
     iframe 设置 sandbox="allow-same-origin"（不加 allow-scripts）
  2. 等待 iframe 的 load 事件
  3. 对 iframe.contentDocument.body 调用 extractCaptureResult()
     （引用同一份 lib/shared/extract-raw-dom.js，和 capture.js 逻辑完全一致）
  4. sendMessage 把 CaptureResult 传回 service_worker
        │
        ▼
[service_worker] 收到 CaptureResult → 进入与 F2 相同的 dom-capture.js IR 转换管道
        │
        ▼
全部文件处理完毕，多个 PageIR 组装为 DocumentIR（pages 数组）
        │
        ▼
rp-builder.js → 一个含多页的 .rp 文件
        │
        ▼
chrome.offscreen.closeDocument()（全部转换任务结束后关闭，省内存）
```

**为什么用 `srcdoc` 而不是「在离屏文档里再建一次 Blob URL」**：`<iframe srcdoc="...">` 直接把 HTML 字符串塞进属性里，浏览器解析时就地生成文档，不经过任何 URL 注册/解析步骤，天然绕开 Blob URL 的上下文绑定问题。`srcdoc` 文档默认继承父文档（离屏页面，即扩展自身）的源，配合 `sandbox="allow-same-origin"`，`offscreen.js` 可以直接拿到 `iframe.contentDocument` 读取布局，不需要处理跨域。

**为什么要加 sandbox**：用户上传的 HTML 文件可能带任意 `<script>`。我们只需要浏览器把 HTML/CSS 排好版供读取，不需要也不希望这些脚本真的执行——如果上传文件来源不可信，让其中的脚本在和扩展「同源」的离屏文档里执行，是一个实打实的攻击面。`sandbox="allow-same-origin"` 在保留 DOM 读取权限的同时默认禁止脚本执行（因为没加 `allow-scripts`），相当于免费拿到一层安全隔离，同时这也意味着上传 HTML 里依赖 JS 渲染的动态内容不会被捕获到（纯静态结构导出场景下通常没问题，需要捕获 JS 渲染结果的场景应该用 F2 抓真实页面）。

**iframe 尺寸**：离屏文档整体不可见，但 iframe 内部的布局仍然依赖一个具体的视口宽度——0×0 的 iframe 会把所有元素挤成 0 宽。需要显式给 iframe 设一个目标宽度（默认 1440px，对应常见设计稿宽度，后续可以在 popup 里加一个「目标宽度」输入框），高度则在 `load` 事件后用 `scrollHeight` 实测取得，覆盖首屏以下的内容。

### 8.2 预处理步骤（inline CSS / 绝对化资源路径）

静态 HTML 文件里的 `<link rel="stylesheet">`、相对路径图片，在 `srcdoc` 文档里的基准地址是 `about:srcdoc`，相对路径会全部解析失败。抓取前必须先做一次预处理：

```js
// popup.js（上传文件后，发给 service worker 前先做这一步）
async function preprocessHtml(htmlText, fallbackBaseUrl) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');

  // 1. 相对路径资源 → 绝对路径（图片、video poster 等）
  doc.querySelectorAll('img[src], source[src]').forEach(el => {
    const raw = el.getAttribute('src');
    if (raw && !/^(https?:|data:)/.test(raw)) {
      el.setAttribute('src', new URL(raw, fallbackBaseUrl).href);
    }
  });

  // 2. <link rel="stylesheet"> 尝试 fetch 后内联为 <style>（同域或允许跨域时）
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  for (const link of links) {
    try {
      const cssUrl = new URL(link.getAttribute('href'), fallbackBaseUrl).href;
      const css = await (await fetch(cssUrl)).text();
      const styleTag = doc.createElement('style');
      styleTag.textContent = css;
      link.replaceWith(styleTag);
    } catch {
      // 拉取失败就保留原 link；它在 srcdoc 文档里会加载失败，
      // 效果上等同于缺少这部分样式，不阻断整体流程
    }
  }

  return doc.documentElement.outerHTML;
}
```

> 如果用户上传的多个 HTML 文件本身是「同一个导出包里的若干页面」（图片、CSS 都在同一目录），`fallbackBaseUrl` 留空、资源全部走 inline 是最稳的；如果引用了外部 CDN 资源，跨域拉取失败时只能接受降级（缺样式或缺图）。

---

## 九、rp-builder.js：IR → RP XML

### 9.1 生成策略

```js
// lib/core/rp-builder.js

export async function buildRpFile(documentIR) {
  const zip = new JSZip();

  const xml = buildDocumentXml(documentIR);
  zip.file('document.xml', xml);

  // 收集所有图片资源
  const images = collectImages(documentIR);
  for (const [filename, base64] of Object.entries(images)) {
    zip.file(`resources/images/${filename}`, base64, { base64: true });
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

function buildDocumentXml(doc) {
  const pagesXml = doc.pages.map(buildPageXml).join('\n');
  const sitemap  = doc.pages.map(p =>
    `<ax:page id="${p.id}" name="${escXml(p.name)}" type="page"/>`
  ).join('\n    ');

  return `<?xml version="1.0" encoding="utf-8"?>
<ax:AxureRP xmlns:ax="http://www.axure.com/AxureRP" version="9">
  <ax:sitemap>
    ${sitemap}
  </ax:sitemap>
  <ax:pages>
    ${pagesXml}
  </ax:pages>
</ax:AxureRP>`;
}

function buildPageXml(page) {
  const objectsXml = page.widgets.map(buildWidgetXml).join('\n        ');
  return `<ax:page id="${page.id}" name="${escXml(page.name)}"
             w="${page.width}" h="${page.height}">
      <ax:objects>
        ${objectsXml}
      </ax:objects>
    </ax:page>`;
}

function buildWidgetXml(w) {
  const base = `<ax:object id="${w.id}" type="${w.type}" label="${escXml(w.name || '')}">
        <ax:x>${w.bounds.x}</ax:x>
        <ax:y>${w.bounds.y}</ax:y>
        <ax:w>${w.bounds.width}</ax:w>
        <ax:h>${w.bounds.height}</ax:h>
        ${buildStyleXml(w.style)}
        ${buildContentXml(w)}
      </ax:object>`;
  return base;
}

function buildStyleXml(s) {
  if (!s) return '';
  return `
        <ax:fillStyle>
          <ax:fillColor argb="${colorToArgb(s.fill?.color)}"/>
        </ax:fillStyle>
        <ax:borderStyle>
          <ax:borderColor argb="${colorToArgb(s.border?.color)}"/>
          <ax:borderWidth>${s.border?.width || 0}</ax:borderWidth>
          <ax:borderRadius>${s.border?.radius || 0}</ax:borderRadius>
        </ax:borderStyle>
        <ax:labelStyle>
          <ax:fontName>${s.font?.family || 'Arial'}</ax:fontName>
          <ax:fontSize>${s.font?.size || 14}</ax:fontSize>
          <ax:fontColor argb="${colorToArgb(s.font?.color)}"/>
          <ax:bold>${s.font?.weight === 'bold'}</ax:bold>
          <ax:align>${s.font?.align || 'left'}</ax:align>
        </ax:labelStyle>`;
}
```

### 9.2 颜色格式转换

Axure 内部使用 ARGB 十六进制（`ffffffff` = 不透明白色）：

```js
// lib/utils/color.js

/**
 * CSS color → Axure ARGB hex
 * 输入：'#3366cc' / 'rgb(51,102,204)' / 'rgba(51,102,204,0.5)'
 * 输出：'ff3366cc' / '803366cc'
 */
export function colorToArgb(cssColor, opacity = 1) {
  if (!cssColor || cssColor === 'transparent') return '00000000';
  const [r, g, b, a = 1] = parseCssColor(cssColor);
  const alpha = Math.round((a * opacity) * 255);
  return [alpha, r, g, b]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
}

export function argbToHex(argb) {
  // 'ffffffff' → '#ffffff'
  return '#' + argb.slice(2);
}
```

---

## 十、popup.html UI 结构

```html
<!-- popup/popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { width: 380px; min-height: 320px; font-family: system-ui; padding: 16px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
    .tab  { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px;
            cursor: pointer; font-size: 12px; text-align: center; }
    .tab.active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
    .panel { display: none; }
    .panel.active { display: block; }
    .btn-primary { width: 100%; padding: 10px; background: #1a73e8;
                   color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    .progress { margin-top: 12px; font-size: 12px; color: #666; }
    .file-drop { border: 2px dashed #ddd; border-radius: 8px; padding: 20px;
                 text-align: center; color: #999; cursor: pointer; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="tabs">
    <div class="tab active" data-tab="t1">HTML→RP</div>
    <div class="tab" data-tab="t2">页面→RP</div>
    <div class="tab" data-tab="t3">RP→HTML</div>
  </div>

  <!-- F1: 上传多个 HTML → RP -->
  <div id="t1" class="panel active">
    <div class="file-drop" id="htmlDrop">
      点击或拖入多个 .html 文件
    </div>
    <input type="file" id="htmlInput" multiple accept=".html,.htm" hidden>
    <div id="htmlFileList" style="font-size:12px;color:#333;margin-bottom:8px;"></div>
    <button class="btn-primary" id="btnHtmlToRp">开始转换 → 下载 .rp</button>
    <div class="progress" id="p1"></div>
  </div>

  <!-- F2: 当前页面 → RP -->
  <div id="t2" class="panel">
    <p style="font-size:13px;color:#555;margin-bottom:12px;">
      将当前激活标签页的完整 DOM 转换为 Axure RP 文件
    </p>
    <button class="btn-primary" id="btnPageToRp">抓取当前页面 → .rp</button>
    <div class="progress" id="p2"></div>
  </div>

  <!-- F3: RP → 多 HTML -->
  <div id="t3" class="panel">
    <div class="file-drop" id="rpDrop">
      点击或拖入 .rp 文件
    </div>
    <input type="file" id="rpInput" accept=".rp" hidden>
    <div id="rpFileName" style="font-size:12px;color:#333;margin-bottom:8px;"></div>
    <button class="btn-primary" id="btnRpToHtml">解析 → 下载 HTML.zip</button>
    <div class="progress" id="p3"></div>
  </div>

  <script src="../lib/jszip.min.js"></script>
  <script src="../lib/fast-xml-parser.min.js"></script>
  <script src="popup.js" type="module"></script>
</body>
</html>
```

---

## 十一、消息协议（popup ↔ service_worker）

```js
// 统一消息格式
const MSG = {
  // F2: popup → sw
  CAPTURE_TAB:    'CAPTURE_TAB',
  // F1: popup → sw
  CONVERT_HTML_FILES: 'CONVERT_HTML_FILES',  // payload: { files: { name, html }[] }
  // F3: popup → sw
  PARSE_RP:       'PARSE_RP',               // payload: { rpBase64: string }

  // sw → popup（进度回报）
  PROGRESS:       'PROGRESS',               // payload: { step, total, message }
  DONE:           'DONE',                   // payload: { downloadUrl }
  ERROR:          'ERROR',                  // payload: { message }
};

// capture.js → service_worker（F2，真实 Tab 场景）
// chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: CaptureResult })

// service_worker ↔ offscreen.js（F1 专用通道，与上面 popup↔sw 是两条独立的消息流）
// sw → offscreen: chrome.runtime.sendMessage({ type: 'RENDER_HTML', payload: { html, width } })
// offscreen → sw: chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: CaptureResult })
```

---

## 十二、开发阶段规划

### Phase 0：准备（3~5 天）

- [ ] 搭建插件脚手架，完成 MV3 基础配置
- [ ] 在 Axure RP 9 中手动创建覆盖 6 种 Widget 的测试文件
- [ ] 解包分析，填写格式字典 `rp-format-dict.md`
- [ ] Widget IR 类型定义定稿

### Phase 1：F3 RP → HTML（1~1.5 周）

- [ ] `rp-parser.js` 解析 document.xml → DocumentIR
- [ ] `html-builder.js` DocumentIR → HTML 文件
- [ ] Popup 的 F3 Tab UI + 拖拽上传
- [ ] Service Worker 中的 ZIP 打包下载
- [ ] 端到端测试：解析自建 .rp → 验证 HTML 还原度

### Phase 2：F2 当前页面 → RP（1~1.5 周）

- [ ] `dom-capture.js` + `capture.js` DOM 遍历逻辑
- [ ] 图片跨域 fetch 策略（fetch + 截图降级）
- [ ] `rp-builder.js` DocumentIR → RP XML
- [ ] Popup 的 F2 Tab UI + 进度展示
- [ ] 端到端测试：抓取简单页面 → 在 Axure 打开验证

### Phase 3：F1 多 HTML → RP（0.5~1 周）

- [ ] Offscreen Document 创建/复用/关闭逻辑（`offscreen.js` + sandbox iframe）
- [ ] `lib/shared/extract-raw-dom.js` 从 capture.js 中抽取，验证两边复用一致
- [ ] HTML inline CSS 预处理（8.2）
- [ ] 多页 RP 文件生成
- [ ] 批量进度展示

### Phase 4：打磨（持续）

- [ ] 错误提示与警告日志面板
- [ ] 进度条动效
- [ ] 大页面性能优化（分批抓取）
- [ ] DynamicPanel 交互基础支持
- [ ] Chrome Web Store 发布准备

---

## 十三、技术边界与已知限制

| 项目 | 说明 |
|---|---|
| RP 版本 | 仅保证兼容 Axure RP 9，RP 10 格式差异需另行验证 |
| CSS 渐变 | `linear-gradient` 等无 Axure 原生对应，降级为截图图片 |
| Web 字体 | `@font-face` 自定义字体不打包，输出 HTML 需用户手动引入 |
| 伪元素 | `::before/::after` 不支持，记录警告跳过 |
| Shadow DOM | 不穿透 Shadow Root，复杂 Web Components 只抓外壳 |
| iframe 内容 | 不抓取跨域 iframe 内部 DOM |
| JS 交互 | 复杂 Axure 交互（变量判断、条件逻辑）转 HTML 时仅保留 show/hide |
| 上传 HTML 内嵌 `<script>`（F1） | 离屏渲染时用 sandbox 禁止执行，只识别静态 HTML/CSS 结构（安全考虑，也避免不确定的动态渲染结果）|
| 响应式布局 | RP → HTML 输出为绝对定位，非响应式 |
| 动画 / transition | 不支持 |

---

## 附录 A：WidgetStyle 完整类型定义

```ts
interface FillStyle {
  type: 'solid' | 'none';      // 暂不支持 gradient
  color: string;               // #RRGGBB
  opacity: number;             // 0~1
}

interface BorderStyle {
  color:  string;
  width:  number;              // px
  style:  'solid' | 'dashed' | 'none';
  radius: number;              // px，四角统一
}

interface FontStyle {
  family:     string;
  size:       number;          // px
  weight:     'normal' | 'bold';
  italic:     boolean;
  underline:  boolean;
  color:      string;          // #RRGGBB
  align:      'left' | 'center' | 'right';
  lineHeight: number;          // 数值，如 1.5
}

interface ShadowStyle {
  enabled: boolean;
  x:       number;
  y:       number;
  blur:    number;
  color:   string;
}

interface Interaction {
  event:   'onClick' | 'onMouseEnter' | 'onMouseLeave' | 'onChange';
  actions: InteractionAction[];
}

interface InteractionAction {
  type:    'show' | 'hide' | 'toggle' | 'setState' | 'navigate';
  target?: string;    // Widget ID
  state?:  number;    // DynamicPanel 目标状态索引
  url?:    string;    // navigate 用
}
```

---

## 附录 B：MVP Widget 支持矩阵

| Widget | HTML→RP | RP→HTML | 备注 |
|---|---|---|---|
| Rectangle / Box | ✅ | ✅ | div + 样式 |
| Text | ✅ | ✅ | p / span |
| Image | ✅ | ✅ | img base64 |
| Button | ✅ | ✅ | button |
| TextBox | ✅ | ✅ | input[text] |
| Checkbox | ✅ | ✅ | input[checkbox] |
| RadioButton | ✅ | ✅ | input[radio] |
| Select | ✅ | ✅ | select |
| Line | ⚠️ | ✅ | HR / border 近似 |
| DynamicPanel | ❌ Phase 4 | ⚠️ 仅首状态 | 复杂度高 |
| Repeater | ❌ 暂不支持 | ❌ 暂不支持 | |
| Master 引用 | ❌ | ⚠️ 内联展开 | |
| Icon / SVG | ⚠️ 截图 | ✅ 内联 | |
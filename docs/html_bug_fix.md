# Bug 排查与修复方案

> 项目：HTML ↔ Axure RP 插件  
> 问题现象：点击「抓取当前页面→RP」时报错  
> `Could not establish connection. Receiving end does not exist.`

---

## 一、根因分析

报错出现在 `popup.vue` 的 `.catch()` 里，说明 `chrome.runtime.sendMessage` 这条 Promise **本身被 reject 了**，而不是消息送达后业务出错。触发路径：

```
popup → chrome.runtime.sendMessage(CAPTURE_TAB)
          ↓ Promise reject
        .catch(err) → 显示 "无法发送到后台（Could not establish connection）"
```

导致这条 Promise reject 的根因有三个，且会叠加出现：

| # | 根因 | 触发条件 |
|---|---|---|
| **A** | `CAPTURE_TAB` 的消息处理器 `return false` 但从未调用 `sendResponse` | 每次必现 |
| **B** | SW 冷启动竞态：popup 发消息时 SW 还未注册 `onMessage` 监听 | SW 被回收后首次使用 |
| **C** | `CONVERT_HTML_FILES` / `PARSE_RP` 同样缺少 `sendResponse` | 每次必现 |

---

## 二、Bug 清单

### 🔴 Bug 1（P0 · 主因）— `CAPTURE_TAB` 处理器未调用 `sendResponse`

**文件**：`background.js` 第 28–29 行

```js
// ❌ 当前代码
case 'CAPTURE_TAB':
  handleCaptureTab(sender.tab?.id)
  return false   // 未调用 sendResponse，端口被关闭
```

`chrome.runtime.sendMessage` 返回的 Promise，只有在处理器调用了 `sendResponse` 后才会 resolve；若处理器 `return false` 且未调用 `sendResponse`，Chrome 关闭消息端口，Promise **立刻 reject**，触发 popup 的 `.catch()`，显示"Could not establish connection"。

`CONVERT_HTML_FILES` 和 `PARSE_RP` 存在相同问题（第 38、42 行）。

**修复**：

```js
// ✅ 修复后
case 'CAPTURE_TAB':
  handleCaptureTab(msg.payload?.tabId)   // ← 同步修复 Bug 3
  sendResponse({ started: true })        // ← 立即 ack，关闭端口前给出响应
  return false

case 'CONVERT_HTML_FILES':
  handleConvertHtmlFiles(msg.payload)
  sendResponse({ started: true })
  return false

case 'PARSE_RP':
  handleParseRp(msg.payload)
  sendResponse({ started: true })
  return false
```

---

### 🔴 Bug 2（P0 · 主因）— SW 冷启动竞态，popup 发消息时 SW 尚未就绪

**文件**：`popup.vue` `capturePageToRp` / `convertHtmlToRp` / `parseRpToHtml`

MV3 Service Worker 在闲置约 30 秒后会被回收。当 popup 第一次打开（或 SW 刚被回收）时，Chrome 会启动 SW，但 SW 注册 `onMessage` 监听器有一个短暂的异步窗口。如果 popup 在 SW 完成初始化前就发送消息，会收到"Could not establish connection"。

**修复**：在 popup 发送任何业务消息前，先用一个带重试的 `PING` 探活。

```js
// popup.vue — 在 methods 中新增工具方法
async ensureSwReady (maxRetries = 5, delayMs = 150) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.runtime.sendMessage({ type: 'PING' })
      return  // SW 已就绪
    } catch {
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
  }
  throw new Error('无法连接到后台 Service Worker，请在 chrome://extensions 重载扩展后重试')
},

// capturePageToRp 改为先探活
async capturePageToRp () {
  if (this.converting) return
  this.converting = true
  this.progress.t2 = '正在连接后台服务...'
  try {
    await this.ensureSwReady()                        // ← 新增
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    this.setProgressListener('t2')
    await chrome.runtime.sendMessage({
      type: MSG.CAPTURE_TAB,
      payload: { tabId: tab.id }                     // ← 同步修复 Bug 3
    })
    this.progress.t2 = '正在注入 DOM 抓取脚本...'
  } catch (err) {
    this.progress.t2 = '错误: ' + (err?.message || err)
    this.converting = false
  }
},
```

对应在 `background.js` 新增 `PING` 处理：

```js
case 'PING':
  sendResponse({ pong: true })
  return false
```

---

### 🔴 Bug 3（P0 · 主因）— `sender.tab?.id` 从 popup 上下文发消息时永远是 `undefined`

**文件**：`background.js` 第 28 行；`popup.vue` `capturePageToRp`

当 popup 调用 `chrome.runtime.sendMessage`，`sender` 是 popup 上下文，**没有 tab**，`sender.tab` 为 `undefined`，`sender.tab?.id` 为 `undefined`。

后续的兜底查询 `chrome.tabs.query({ active: true, currentWindow: true })` 在 Service Worker 上下文中 `currentWindow` **含义不明确**（SW 没有窗口），在多窗口场景下极易抓到错误 Tab。

**修复**：popup 自己查 Tab 并把 `tabId` 放进消息载荷，background 直接读：

```js
// popup.vue capturePageToRp（见 Bug 2 修复，已包含此改动）
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
await chrome.runtime.sendMessage({ type: MSG.CAPTURE_TAB, payload: { tabId: tab.id } })

// background.js
case 'CAPTURE_TAB':
  handleCaptureTab(msg.payload?.tabId)   // ← 从 payload 读，不再用 sender.tab?.id
  sendResponse({ started: true })
  return false
```

`handleCaptureTab` 内部的兜底查询也改为更可靠的方式：

```js
async function handleCaptureTab (tabId) {
  try {
    if (!tabId) {
      // 兜底：改用 lastFocusedWindow 在 SW 上下文更可靠
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      tabId = tab?.id
    }
    if (!tabId) {
      sendErrorToPopup('无法获取当前标签页 ID')
      return
    }
    // … 后续不变
```

---

### 🟠 Bug 4（P1）— `content.js` 的 `sendMessage` 无错误处理，UI 永久卡在"转换中"

**文件**：`content.js` 第 13–15 行

```js
// ❌ 当前代码 —— 两处 sendMessage 都没有 .catch()
chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: result })
// ...
chrome.runtime.sendMessage({ type: 'ERROR', payload: { ... } })
```

若 SW 在 `executeScript` resolve 后恰好被回收（极端场景），content script 发送 `CAPTURE_RESULT` 会静默失败，popup 的 `converting` 永远不会被复位，按钮永久 disabled。

**修复**：

```js
// content.js
;(function () {
  const send = (msg, retries = 2) => {
    chrome.runtime.sendMessage(msg).catch(() => {
      if (retries > 0) setTimeout(() => send(msg, retries - 1), 200)
    })
  }

  try {
    const result = extractCaptureResult(document.body)
    send({ type: 'CAPTURE_RESULT', payload: result })
  } catch (err) {
    send({ type: 'ERROR', payload: { message: 'DOM 抓取失败: ' + err.message } })
  }
})()
```

---

### 🟠 Bug 5（P1）— F3 图片提取：`imgFolder.files` 遍历了整个 ZIP 的所有文件

**文件**：`background.js` 第 336–344 行

```js
// ❌ 当前代码
const imgFolder = zip.folder('resources/images')
if (imgFolder) {
  const imgFiles = Object.keys(imgFolder.files)  // ← 这里是 BUG
```

JSZip v3 的 `zip.folder(name)` 返回一个新的 JSZip 实例，但它的 `.files` 属性指向的是**原始 ZIP 根节点的 files 对象**，包含 `document.xml`、`notes.xml` 等所有文件。结果是把 `document.xml` 也当成图片用 base64 读出来，既浪费时间又会在 `images` 字典里产生脏数据。

**修复**：直接在根 `zip.files` 上按路径前缀过滤：

```js
// ✅ 修复后
const IMAGE_PREFIX = 'resources/images/'
const imgFiles = Object.keys(zip.files).filter(
  path => path.startsWith(IMAGE_PREFIX) && !zip.files[path].dir
)
for (const imgPath of imgFiles) {
  const base64 = await zip.files[imgPath].async('base64')
  const name = imgPath.slice(IMAGE_PREFIX.length)   // 只保留文件名
  images[name] = base64
}
```

---

### 🟠 Bug 6（P1）— `offscreen.html` 缺少 `<script>` 标签，F1 功能完全失效

**文件**：`offscreen.html`

`offscreen.html` 目前只有一个空 `<div id="app">`，没有加载任何脚本。如果项目的 webpack 配置里 **`HtmlWebpackPlugin` 没有把 offscreen 列为入口**，编译后的 `offscreen.js` bundle 根本不会被注入，`chrome.runtime.onMessage` 监听器永远不会注册，`sendToOffscreen` 会永远挂起。

**修复**：确认 webpack 入口配置包含 offscreen，或手动添加 script 标签：

```html
<!-- offscreen.html —— body 结尾处 -->
<body>
  <div id="app"></div>
  <script src="js/offscreen.js"></script>   <!-- ← 确保此行存在于编译输出中 -->
</body>
```

同时在 webpack 配置（如 `vue.config.js` / `webpack.config.js`）中确认：

```js
// webpack.config.js 示意
entry: {
  popup:      './src/popup/popup.js',
  background: './src/background/background.js',
  content:    './src/content/content.js',
  offscreen:  './src/offscreen/offscreen.js',   // ← 必须有这一行
},
plugins: [
  new HtmlWebpackPlugin({
    template: './src/offscreen/offscreen.html',
    filename:  'offscreen.html',
    chunks:    ['offscreen'],                    // ← 绑定正确的 chunk
  }),
]
```

---

### 🟡 Bug 7（P2）— `offscreen.js` 超时定时器未在成功时清除

**文件**：`offscreen.js` 第 78 行

`renderHtml` 里的 30 秒超时定时器在 iframe 成功 load 后没有被 `clearTimeout`。Promise 已经 resolve，定时器 30 秒后触发 `reject`（对已 settle 的 Promise 无害），但会产生无意义的 GC 压力，且日志里会出现误导性的"iframe 渲染超时"提示。

**修复**：

```js
function renderHtml (payload) {
  return new Promise((resolve, reject) => {
    // …创建 iframe 代码不变…

    // 超时保护
    const timeoutId = setTimeout(() => {          // ← 保存 timer id
      reject(new Error('iframe 渲染超时'))
    }, 30000)

    iframe.onload = function () {
      clearTimeout(timeoutId)                     // ← 成功时取消定时器
      try {
        const doc = iframe.contentDocument
        if (!doc || !doc.body) {
          reject(new Error('iframe 文档不可访问'))
          return
        }
        const height = doc.documentElement.scrollHeight || doc.body.scrollHeight
        iframe.style.height = height + 'px'
        const result = extractCaptureResult(doc.body)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }

    iframe.onerror = function () {
      clearTimeout(timeoutId)                     // ← 失败时也取消
      reject(new Error('iframe 加载失败'))
    }
  })
}
```

---

### 🟡 Bug 8（P2）— `rp-parser.js` 解析 ARGB 时 alpha 通道被丢弃

**文件**：`rp-parser.js` 第 169、182、199 行

Axure 用 8 位 ARGB 十六进制存颜色（如 `80ffffff` = 50% 透明白）。当前代码 `.slice(2)` 直接截掉前两位（alpha），半透明元素在转出的 HTML 里会变成完全不透明。

```js
// ❌ 当前
color: '#' + (argbHex).slice(2),  // 丢弃 alpha
opacity: 1
```

**修复**：提取 alpha 并映射到 CSS opacity：

```js
// ✅ 修复后 —— 新增辅助函数放在 rp-parser.js 顶部
function argbToStyle (argbHex) {
  if (!argbHex || argbHex.length < 8) return { color: '#ffffff', opacity: 1 }
  const alpha   = parseInt(argbHex.slice(0, 2), 16) / 255
  const hexColor = '#' + argbHex.slice(2)
  return { color: hexColor, opacity: parseFloat(alpha.toFixed(2)) }
}

// 用法示例（fill color）：
const { color, opacity } = argbToStyle(
  typeof color === 'object' ? (color.argb || 'ffffffff') : String(color)
)
style.fill = { type: 'solid', color, opacity }
```

---

## 三、`tabId` 在 `processImage` 中是死参数

**文件**：`background.js` 第 118–160 行

`processImage(w, tabId)` 签名接收 `tabId`，但函数体内完全没用到它——原始设计可能打算用 `captureVisibleTab` 截图降级，但未实现。建议删除该参数避免误导：

```js
// processCrossOriginImages 里
promises.push(processImage(w))      // ← 去掉 tabId

// processImage 签名
async function processImage (w) {   // ← 去掉 tabId 参数
```

---

## 四、修改汇总

| 文件 | 改动 | 解决 Bug |
|---|---|---|
| `background.js` | `CAPTURE_TAB` / `CONVERT_HTML_FILES` / `PARSE_RP` 三个 case 各加 `sendResponse({ started: true })` | Bug 1 |
| `background.js` | 新增 `case 'PING': sendResponse({ pong: true }); return false` | Bug 2 |
| `background.js` | `handleCaptureTab` 从 `msg.payload?.tabId` 读 tabId，兜底改 `lastFocusedWindow: true` | Bug 3 |
| `background.js` | F3 图片提取改为 `Object.keys(zip.files).filter(path => path.startsWith('resources/images/'))` | Bug 5 |
| `background.js` | `processImage` 去掉无用的 `tabId` 参数 | 死参数清理 |
| `popup.vue` | 新增 `ensureSwReady` 方法；三个操作入口调用前先探活 | Bug 2 |
| `popup.vue` | `capturePageToRp` 自行查询 Tab 并把 `tabId` 放进 payload | Bug 3 |
| `content.js` | 两处 `sendMessage` 加带重试的 `.catch()` | Bug 4 |
| `offscreen.html` | 确保 webpack 注入 `<script src="js/offscreen.js">` | Bug 6 |
| `offscreen.js` | `clearTimeout(timeoutId)` 在 load / error 时调用 | Bug 7 |
| `rp-parser.js` | 新增 `argbToStyle` 函数，正确提取 alpha 并写入 `opacity` 字段 | Bug 8 |

---

## 五、修复后完整 `background.js` 消息处理器

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'PING':
      sendResponse({ pong: true })
      return false

    case 'CAPTURE_TAB':
      handleCaptureTab(msg.payload?.tabId)   // ← tabId 来自 payload
      sendResponse({ started: true })        // ← 立即 ack
      return false

    case 'CAPTURE_RESULT':
      handleCaptureResult(msg.payload, sender.tab?.id)
      sendResponse({ success: true })
      return false

    case 'CONVERT_HTML_FILES':
      handleConvertHtmlFiles(msg.payload)
      sendResponse({ started: true })        // ← 新增
      return false

    case 'PARSE_RP':
      handleParseRp(msg.payload)
      sendResponse({ started: true })        // ← 新增
      return false

    default:
      console.warn('[SW] 未知消息类型:', msg.type)
      return false
  }
})
```

---

## 六、测试验证 Checklist

修复后按以下步骤验证每个 Bug 是否消除：

```
□ F2 首次点击（SW 冷启动）→ 不再报 "Could not establish connection"
□ F2 扩展闲置 >30 秒后再点击 → 正常触发，不报错
□ F2 复杂页面（DOM 节点 >5000）→ 进度正常推进，不卡死
□ F1 上传多个 HTML → 离屏文档正常渲染，生成 .rp 文件
□ F3 解析 .rp → 图片正常内嵌，不把 document.xml 当图片
□ F3 含半透明元素的 .rp → HTML 中 opacity 正确还原
□ 开发模式重载扩展后 → 重新打开 popup 首次操作不报错
```
# Bug 修复方案文档

> 版本：v1.3 | 覆盖本轮排查发现的全部问题  
> 涉及文件：`vue.config.js` / `background.js` / `lib/core/rp-builder.js` /
> `lib/core/rp-parser.js` / `content.js` / `offscreen.js` / `popup.vue`

---

## 快速索引

| # | 问题 | 文件 | 严重度 |
|---|---|---|---|
| 1 | webpack 分包导致 background.js / content.js 不自包含，SW 启动即崩溃 | `vue.config.js` | 🔴 P0 |
| 2 | `URL.createObjectURL` 在 MV3 SW 中不可用，下载功能完全失效 | `rp-builder.js` `background.js` | 🔴 P0 |
| 3 | `CAPTURE_TAB` 等三个消息处理器未调用 `sendResponse`，popup Promise 立刻 reject | `background.js` | 🔴 P0 |
| 4 | SW 冷启动竞态：popup 发消息时 SW 尚未就绪 | `popup.vue` `background.js` | 🔴 P0 |
| 5 | `sender.tab?.id` 在 popup 上下文恒为 `undefined`；`currentWindow` 在 SW 中行为不确定 | `background.js` `popup.vue` | 🟠 P1 |
| 6 | `content.js` 发送 `CAPTURE_RESULT` 无 `.catch()`，失败时 UI 永久卡死 | `content.js` | 🟠 P1 |
| 7 | F3 图片提取：`imgFolder.files` 遍历整个 ZIP，把 document.xml 也当图片处理 | `background.js` | 🟠 P1 |
| 8 | `offscreen.js` 超时定时器未在成功时清除 | `offscreen.js` | 🟡 P2 |
| 9 | `rp-parser.js` ARGB 颜色 `.slice(2)` 丢弃 alpha 通道 | `rp-parser.js` | 🟡 P2 |

---

## Bug 1 — `vue.config.js` webpack 分包策略错误（P0）

### 根因

所有五个入口（含 `background`、`content`）均放进 `pages`，触发 vue-cli-service
默认的 `splitChunks` 优化：

- `jszip`、`fast-xml-parser` → 剥入 `chunk-vendors.js`
- webpack 模块注册器 → 剥入 `runtime.js`
- `extract-raw-dom.js`（被 content + offscreen 共用）→ 剥入 `chunk-common.js`

Chrome 按 manifest 只加载单个 `js/background.js`，其余 chunk 不加载，
`__webpack_require__` 未定义，SW 启动即崩溃，`onMessage` 从不注册。

### 修复：`vue.config.js` 全文替换

```js
const path = require('node:path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

// 需要生成 HTML 的页面（Chrome 通过完整 HTML 按序加载多个 chunk）
const htmlPageNames = ['popup', 'options', 'offscreen']

// 必须是自包含单文件（Chrome 只加载单个 JS，不帮你加载其他 chunk）
const standaloneNames = ['background', 'content']

const pages = {}
htmlPageNames.forEach((name) => {
  const template = name === 'offscreen'
    ? `src/pages/${name}/index.html`
    : 'public/index.html'
  pages[name] = {
    entry:    `src/pages/${name}/${name}.js`,
    template,
    filename: `${name}.html`
  }
})

module.exports = {
  pages,
  filenameHashing: false,

  chainWebpack: (config) => {
    // background / content 作为独立 webpack 入口，不经过 HtmlWebpackPlugin
    standaloneNames.forEach((name) => {
      config.entry(name).add(`./src/pages/${name}/${name}.js`)
    })

    // 分块策略：background / content 不参与代码分割，所有依赖直接内联
    config.optimization.splitChunks({
      cacheGroups: {
        vendors: {
          name:     'chunk-vendors',
          test:     /[\\/]node_modules[\\/]/,
          priority: -10,
          chunks:   (chunk) => !standaloneNames.includes(chunk.name)
        },
        common: {
          name:               'chunk-common',
          minChunks:          2,
          priority:           -20,
          chunks:             (chunk) => !standaloneNames.includes(chunk.name),
          reuseExistingChunk: true
        }
      }
    })

    // 禁用独立 runtime chunk，将 __webpack_require__ 内嵌进每个入口
    config.optimization.runtimeChunk(false)
  },

  configureWebpack: {
    plugins: [
      new CopyWebpackPlugin({
        patterns: [{
          from: path.resolve('manifest.json'),
          to:   `${path.resolve('dist')}/manifest.json`
        }]
      })
    ]
  }
}
```

### 验证

```bash
npm run build
ls -lh dist/js/background.js   # 期望 > 500 KB（jszip 等依赖已内联）
grep -c "getBoundingClientRect" dist/js/content.js  # 期望 > 0
ls dist/background.html 2>&1   # 期望：No such file or directory
```

---

## Bug 2 — `URL.createObjectURL` 在 MV3 SW 中不可用（P0）

### 根因

`URL.createObjectURL()` 是浏览器窗口上下文 API，在 MV3 Service Worker
中不存在，调用即抛 `TypeError: URL.createObjectURL is not a function`，
三个功能（F1/F2/F3）的下载步骤全部失效。

JSZip 支持直接输出 `base64` 字符串，`chrome.downloads.download` 接受
`data:` URL，两者结合可完全绕过 `createObjectURL`。

### 修复一：`lib/core/rp-builder.js`

仅改最后一段 `generateAsync`，其余逻辑不动：

```js
// ❌ 原来 —— 返回 Blob，调用方需 URL.createObjectURL
export async function buildRpFile(doc) {
  const zip = new JSZip()
  // ... 填充 zip（不变）...
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}

// ✅ 修复后 —— 直接返回 data URL 字符串
export async function buildRpFile(doc) {
  const zip = new JSZip()
  // ... 填充 zip（不变）...
  const base64 = await zip.generateAsync({
    type: 'base64',          // ← blob → base64
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  return `data:application/zip;base64,${base64}`
}
```

### 修复二：`background.js` — F2 `handleCaptureResult`

```js
// ❌ 原来
const blob = await buildRpFile(doc)
const url  = URL.createObjectURL(blob)      // ← 删除这行
await chrome.downloads.download({ url, filename: `${pageIr.name || 'page'}.rp`, saveAs: true })

// ✅ 修复后（buildRpFile 已直接返回 data URL）
const url = await buildRpFile(doc)
await chrome.downloads.download({ url, filename: `${pageIr.name || 'page'}.rp`, saveAs: true })
```

### 修复三：`background.js` — F1 `handleConvertHtmlFiles`

```js
// ❌ 原来
const blob = await buildRpFile(doc)
const url  = URL.createObjectURL(blob)      // ← 删除这行
await chrome.downloads.download({ url, filename: 'converted.rp', saveAs: true })

// ✅ 修复后
const url = await buildRpFile(doc)
await chrome.downloads.download({ url, filename: 'converted.rp', saveAs: true })
```

### 修复四：`background.js` — F3 `handleParseRp`

```js
// ❌ 原来
const blob = await htmlZip.generateAsync({
  type: 'blob',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 }
})
const url = URL.createObjectURL(blob)       // ← 删除这行
await chrome.downloads.download({ url, filename: outName, saveAs: true })

// ✅ 修复后
const base64 = await htmlZip.generateAsync({
  type: 'base64',              // ← blob → base64
  compression: 'DEFLATE',
  compressionOptions: { level: 6 }
})
await chrome.downloads.download({
  url:      `data:application/zip;base64,${base64}`,
  filename: outName,
  saveAs:   true
})
```

---

## Bug 3 — 消息处理器缺少 `sendResponse`（P0）

### 根因

`CAPTURE_TAB`、`CONVERT_HTML_FILES`、`PARSE_RP` 三个 case 均 `return false`
但未调用 `sendResponse`，Chrome 关闭消息端口，popup 的 `sendMessage` Promise
立刻 reject，显示"Could not establish connection"。

### 修复：`background.js` 消息路由

```js
// ✅ 修复后（完整消息路由）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'PING':
      sendResponse({ pong: true })
      return false

    case 'CAPTURE_TAB':
      handleCaptureTab(msg.payload?.tabId)
      sendResponse({ started: true })     // ← 新增
      return false

    case 'CAPTURE_RESULT':
      handleCaptureResult(msg.payload, sender.tab?.id)
      sendResponse({ success: true })
      return false

    case 'CONVERT_HTML_FILES':
      handleConvertHtmlFiles(msg.payload)
      sendResponse({ started: true })     // ← 新增
      return false

    case 'PARSE_RP':
      handleParseRp(msg.payload)
      sendResponse({ started: true })     // ← 新增
      return false

    default:
      console.warn('[SW] 未知消息类型:', msg.type)
      return false
  }
})
```

---

## Bug 4 — SW 冷启动竞态（P0）

### 根因

SW 闲置约 30 秒后被 Chrome 回收。popup 打开后立即发消息，SW
可能还未完成初始化并注册 `onMessage`，导致"Could not establish connection"。

### 修复一：`popup.vue` — 新增探活方法，三个操作入口调用前先探活

```js
// ✅ 新增方法
async ensureSwReady (maxRetries = 5, delayMs = 150) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.runtime.sendMessage({ type: 'PING' })
      return
    } catch {
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
  }
  throw new Error('无法连接到后台 Service Worker，请在 chrome://extensions 重载扩展后重试')
},

// capturePageToRp 修改示例（convertHtmlToRp / parseRpToHtml 同理）
async capturePageToRp () {
  if (this.converting) return
  this.converting = true
  this.progress.t2 = '正在连接后台服务...'
  try {
    await this.ensureSwReady()                                    // ← 新增
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    this.setProgressListener('t2')
    await chrome.runtime.sendMessage({
      type: MSG.CAPTURE_TAB,
      payload: { tabId: tab.id }                                 // ← 传 tabId（见 Bug 5）
    })
    this.progress.t2 = '正在注入 DOM 抓取脚本...'
  } catch (err) {
    this.progress.t2 = '错误: ' + (err?.message || err)
    this.converting = false
  }
},
```

### 修复二：`background.js` — 新增 PING 处理（见 Bug 3 修复，已包含）

---

## Bug 5 — `tabId` 获取错误（P1）

### 根因

popup 发送 `CAPTURE_TAB` 时 `sender.tab` 为 `undefined`（popup 不属于任何 Tab），
`sender.tab?.id` 恒为 `undefined`。SW 内 `chrome.tabs.query({ currentWindow: true })`
无"当前窗口"语义，多窗口时可能抓到错误 Tab。

### 修复：`background.js` — `handleCaptureTab`

```js
// ❌ 原来
async function handleCaptureTab(tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    tabId = tab.id
  }
  // ...
}

// ✅ 修复后（tabId 由 popup 传入，兜底改用 lastFocusedWindow）
async function handleCaptureTab(tabId) {
  try {
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      tabId = tab?.id
    }
    if (!tabId) {
      sendErrorToPopup('无法获取当前标签页 ID')
      return
    }
    // ... 后续不变
```

`popup.vue` 发送时带上 tabId（见 Bug 4 修复中已包含）：

```js
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
await chrome.runtime.sendMessage({ type: MSG.CAPTURE_TAB, payload: { tabId: tab.id } })
```

---

## Bug 6 — `content.js` sendMessage 无错误处理（P1）

### 根因

`chrome.runtime.sendMessage` 无 `.catch()`，若 SW 此时恰好被回收，
发送失败静默丢弃，popup 的 `converting` 永久为 `true`，按钮永久 disabled。

### 修复：`content.js`

```js
// ❌ 原来
chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: result })

// ✅ 修复后（带重试的发送封装）
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

## Bug 7 — F3 图片提取：`imgFolder.files` 遍历整个 ZIP（P1）

### 根因

`zip.folder('resources/images')` 返回的子 JSZip 实例，其 `.files`
属性指向的是**原始 ZIP 根节点的 files 对象**，包含 `document.xml` 等所有条目，
导致 `document.xml` 被当图片写入 `images`，后续替换逻辑产生脏数据。

### 修复：`background.js` — `handleParseRp` 图片提取段

```js
// ❌ 原来
const imgFolder = zip.folder('resources/images')
if (imgFolder) {
  const imgFiles = Object.keys(imgFolder.files)   // 遍历了整个 zip！
  for (const imgPath of imgFiles) {
    const file = imgFolder.files[imgPath]
    if (!file.dir) {
      const base64 = await file.async('base64')
      const name   = imgPath.split('/').pop()
      images[name] = base64
    }
  }
}

// ✅ 修复后（按路径前缀过滤）
const IMAGE_PREFIX = 'resources/images/'
const imgPaths = Object.keys(zip.files).filter(
  p => p.startsWith(IMAGE_PREFIX) && !zip.files[p].dir
)
for (const imgPath of imgPaths) {
  const base64 = await zip.files[imgPath].async('base64')
  const name   = imgPath.slice(IMAGE_PREFIX.length)   // 仅保留文件名
  images[name] = base64
}
```

---

## Bug 8 — `offscreen.js` 超时定时器未清除（P2）

### 根因

iframe 成功 load 后 `resolve()` 已被调用，但 30 秒定时器仍在运行，
到期后调用 `reject()`（对已 settled 的 Promise 无害，但产生误导性日志）。

### 修复：`offscreen.js` — `renderHtml`

```js
// ❌ 原来
iframe.onload = function () {
  // ...resolve(result)
}
setTimeout(() => reject(new Error('iframe 渲染超时')), 30000)  // 无法被取消

// ✅ 修复后
const timeoutId = setTimeout(() => {
  reject(new Error('iframe 渲染超时'))
}, 30000)

iframe.onload = function () {
  clearTimeout(timeoutId)          // ← 成功时取消定时器
  try {
    // ...resolve(result)
  } catch (err) {
    reject(err)
  }
}

iframe.onerror = function () {
  clearTimeout(timeoutId)          // ← 失败时也取消
  reject(new Error('iframe 加载失败'))
}
```

---

## Bug 9 — `rp-parser.js` ARGB alpha 通道丢失（P2）

### 根因

Axure 使用 8 位 ARGB 十六进制存储颜色（如 `80ffffff` = 50% 透明白）。
`.slice(2)` 截掉前两位（alpha 字节），半透明元素在还原的 HTML 里变为不透明。

### 修复：`rp-parser.js` — 新增辅助函数，替换三处颜色解析

```js
// ✅ 新增辅助函数（放在文件顶部）
function argbToStyle(argbHex) {
  if (!argbHex || argbHex.length < 8) return { color: '#ffffff', opacity: 1 }
  const alpha = parseInt(argbHex.slice(0, 2), 16) / 255
  const color = '#' + argbHex.slice(2)
  return { color, opacity: parseFloat(alpha.toFixed(2)) }
}

// ✅ fill 颜色解析改为（原来直接 .slice(2)）
const fillArgb = typeof color === 'object'
  ? (color.argb || 'ffffffff')
  : String(color)
const { color: fillColor, opacity: fillOpacity } = argbToStyle(fillArgb)
style.fill = { type: 'solid', color: fillColor, opacity: fillOpacity }

// border / font 颜色同理替换，alpha 部分写入对应的 opacity 字段
```

---

## 修改文件汇总

| 文件 | 改动类型 | 对应 Bug |
|---|---|---|
| `vue.config.js` | 全文替换 | Bug 1 |
| `lib/core/rp-builder.js` | `generateAsync` 返回类型 blob→base64 | Bug 2 |
| `background.js` | 删 3 处 `URL.createObjectURL`；F3 改 base64 输出；补 `sendResponse`；修 tabId；修图片过滤 | Bug 2 / 3 / 5 / 7 |
| `popup.vue` | 新增 `ensureSwReady`；三个操作先探活；`capturePageToRp` 传 tabId | Bug 4 / 5 |
| `content.js` | `sendMessage` 加带重试的 `.catch()` | Bug 6 |
| `offscreen.js` | `clearTimeout` 补全 | Bug 8 |
| `rp-parser.js` | 新增 `argbToStyle`，修复三处颜色解析 | Bug 9 |
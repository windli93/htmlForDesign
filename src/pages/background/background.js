/**
 * Service Worker - 消息路由、IR 构建、ZIP 操作、跨域图片 fetch、下载触发
 *
 * 使用 type: module，支持 import/export。
 */

import { captureResultToPageIr } from '../../lib/core/dom-capture.js'
import { buildRpFile } from '../../lib/core/rp-builder.js'
import { parseDocumentXml } from '../../lib/core/rp-parser.js'
import { buildHtmlFromPage } from '../../lib/core/html-builder.js'
import { createDocument, resetIdCounter } from '../../lib/core/widget-ir.js'
import { blobToBase64, isDataUrl } from '../../lib/utils/image.js'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

// ========== 消息路由 ==========
//
// 设计要点：popup 发来的指令消息（CAPTURE_TAB / CONVERT_HTML_FILES / PARSE_RP）
// 都不带回调，因此 SW 不通过 sendResponse 回传完成态——sendResponse 只会回到
// 「那条消息的发送方」，到不了 popup。所有进度/完成/错误统一用主动广播
// （sendProgressToPopup / sendDoneToPopup / sendErrorToPopup）推给 popup，
// popup 的 onSwMessage 监听到 DONE/ERROR 后复位 converting 状态。
// CAPTURE_RESULT 来自 content script（也无回调），给它一个 ack 即可。

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'PING':
      sendResponse({ pong: true })
      return false

    case 'CAPTURE_TAB':
      handleCaptureTab(msg.payload?.tabId)
      sendResponse({ started: true })
      return false

    case 'CAPTURE_RESULT':
      handleCaptureResult(msg.payload, sender.tab?.id)
      sendResponse({ success: true }) // ack，避免 message port 警告
      return false

    case 'CONVERT_HTML_FILES':
      handleConvertHtmlFiles(msg.payload)
      sendResponse({ started: true })
      return false

    case 'PARSE_RP':
      handleParseRp(msg.payload)
      sendResponse({ started: true })
      return false

    default:
      console.warn('[SW] 未知消息类型:', msg.type)
      return false
  }
})

// ========== F2: 捕获当前页面 ==========

/**
 * 处理捕获当前 Tab 的请求
 * 只负责注入 content script；真正的抓取结果由 content script 通过
 * CAPTURE_RESULT 消息异步送回，再由 handleCaptureResult 处理。
 * @param {number} tabId
 */
async function handleCaptureTab(tabId) {
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

    sendProgressToPopup('正在注入 DOM 抓取脚本...')

    // 注入 content script（webpack 已把 extract-raw-dom 打包进 js/content.js）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['js/content.js']
    })

    sendProgressToPopup('DOM 脚本已注入，等待页面响应...')
  } catch (err) {
    sendErrorToPopup('注入失败: ' + err.message)
  }
}

/**
 * 处理从 content script 返回的抓取结果
 * @param {Object} captureResult
 * @param {number} tabId
 */
async function handleCaptureResult(captureResult, tabId) {
  try {
    sendProgressToPopup('正在转换 DOM → IR...')

    // CaptureResult → PageIR
    const pageIr = captureResultToPageIr(captureResult)
    const doc = createDocument('9')
    doc.pages.push(pageIr)

    sendProgressToPopup('正在构建 RP 文件...')

    // 处理图片（base64 化）
    await processCrossOriginImages(pageIr, tabId)

    // 构建 .rp 文件（返回 data URL）
    const url = await buildRpFile(doc)

    // 触发下载
    await chrome.downloads.download({
      url,
      filename: `${pageIr.name || 'page'}.rp`,
      saveAs: true
    })

    sendDoneToPopup('转换完成！已下载 .rp 文件')
  } catch (err) {
    sendErrorToPopup('转换失败: ' + err.message)
  }
}

/**
 * 处理跨域图片
 * @param {import('../../lib/core/widget-ir.js').PageIR} pageIr
 * @param {number} tabId
 */
async function processCrossOriginImages(pageIr, _tabId) {
  const promises = []

  function walkWidget(w) {
    if (w.type === 'Image' && w.src && !w.src.startsWith('data:')) {
      promises.push(processImage(w))
    }
    if (w.children) w.children.forEach(walkWidget)
    if (w.states) w.states.forEach(state => state.forEach(walkWidget))
  }

  pageIr.widgets.forEach(walkWidget)
  await Promise.allSettled(promises)
}

/**
 * 处理单个图片（fetch 后 base64，失败降级为 warning）
 *
 * 注意：MV3 service worker 没有 FileReader / window，因此 base64 化必须用
 * blob.arrayBuffer() + btoa；isSameOrigin 在 SW 里也无法判断（无 window.location），
 * 这里统一用「data:/blob: 直接转，其余 fetch(cors) 尝试，失败即降级」。
 * @param {import('../../lib/core/widget-ir.js').WidgetIR} w
 * @param {number} tabId
 */
async function processImage(w) {
  try {
    if (isDataUrl(w.src) || w.src.startsWith('blob:')) {
      // data URL / blob URL - 直接（或 fetch blob 后）转 base64 data URL
      w.src = await blobToBase64(await (await fetch(w.src)).blob())
    } else {
      // 远程图片（无论同/跨域）都尝试 fetch(cors)
      const resp = await fetch(w.src, { mode: 'cors' })
      const blob = await resp.blob()
      w.src = await blobToBase64(blob)
    }
  } catch {
    // fetch 失败（CORS 拒绝等），降级为 warning，保留原 src
    w.warnings = w.warnings || []
    w.warnings.push('无法获取图片（可能跨域无 CORS），已保留原 URL：' + w.src)
  }
}

// ========== F1: 多 HTML 文件 → RP ==========

/**
 * 处理多 HTML 文件转换
 * @param {Object} payload
 * @param {Array<{name:string, html:string}>} payload.files
 */
async function handleConvertHtmlFiles(payload) {
  try {
    const doc = createDocument('9')

    for (let i = 0; i < payload.files.length; i++) {
      const file = payload.files[i]
      sendProgressToPopup(`正在处理 ${i + 1}/${payload.files.length}: ${file.name}`)

      // 创建 offscreen 文档
      await ensureOffscreenDocument()

      // 预处理 HTML（inline CSS、绝对化资源路径）
      const processedHtml = await preprocessHtml(file.html)

      // 发送 HTML 到 offscreen 渲染
      const captureResult = await sendToOffscreen(processedHtml)

      // CaptureResult → PageIR
      const pageIr = captureResultToPageIr(captureResult, file.name.replace(/\.html?$/i, ''))
      doc.pages.push(pageIr)
    }

    // 关闭 offscreen 文档
    await chrome.offscreen.closeDocument()
    offscreenCreated = false

    sendProgressToPopup('正在构建 RP 文件...')

    // 构建 .rp（返回 data URL）
    const url = await buildRpFile(doc)

    await chrome.downloads.download({
      url,
      filename: 'converted.rp',
      saveAs: true
    })

    sendDoneToPopup('转换完成！已下载 converted.rp')
  } catch (err) {
    sendErrorToPopup('转换失败: ' + err.message)
  }
}

/**
 * 预处理 HTML（inline CSS、绝对化资源路径）
 * @param {string} htmlText
 * @param {string} [fallbackBaseUrl]
 * @returns {Promise<string>}
 */
async function preprocessHtml(htmlText, fallbackBaseUrl) {
  // 简单字符串替换处理大多数情况
  let processed = htmlText

  // 1. 处理 <link rel="stylesheet"> - 尝试 fetch 后内联
  const linkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi
  let match
  while ((match = linkRegex.exec(htmlText)) !== null) {
    const href = match[1]
    try {
      const url = fallbackBaseUrl ? new URL(href, fallbackBaseUrl).href : href
      const resp = await fetch(url)
      const css = await resp.text()
      processed = processed.replace(match[0], `<style>${css}</style>`)
    } catch {
      // 拉取失败，保留原 link
      console.warn('[SW] 无法内联样式:', href)
    }
  }

  // 2. 相对路径图片 → 绝对路径（仅在提供 fallbackBaseUrl 时）
  if (fallbackBaseUrl) {
    processed = processed.replace(/(<(?:img|source)[^>]*src=["'])(\/[^"']+)(["'])/gi, (m, prefix, path, suffix) => {
      try {
        return prefix + new URL(path, fallbackBaseUrl).href + suffix
      } catch {
        return m
      }
    })
  }

  return processed
}

/** 确保离屏文档已创建 */
let offscreenCreated = false

async function ensureOffscreenDocument() {
  if (offscreenCreated) return

  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  })

  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: '离屏渲染用户上传的 HTML 文件以提取布局信息'
    })
  }

  offscreenCreated = true
}

/**
 * 发送 HTML 到 offscreen 文档渲染
 * @param {string} html
 * @returns {Promise<Object>} CaptureResult
 */
function sendToOffscreen(html) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'RENDER_HTML',
      payload: { html, width: 1440 }
    }, (response) => {
      if (response?.success) {
        resolve(response.payload)
      } else {
        reject(new Error(response?.error || '离屏渲染失败'))
      }
    })
  })
}

// ========== F3: RP 文件 → 多 HTML ==========

/**
 * 处理 RP 文件解析
 * @param {Object} payload
 * @param {string} payload.rpBase64 - RP 文件的 base64 编码
 * @param {string} payload.fileName - 原文件名
 */
async function handleParseRp(payload) {
  try {
    sendProgressToPopup('正在解包 RP 文件...')

    // 加载 ZIP
    const zip = await JSZip.loadAsync(payload.rpBase64, { base64: true })

    // 读取 document.xml
    const docXmlFile = zip.file('document.xml')
    if (!docXmlFile) {
      throw new Error(
        '无法识别此 .rp 文件：未找到 document.xml。' +
        '本插件当前仅支持按《实现方案》中推断的 "ZIP + document.xml" 结构解析，' +
        '需使用 Axure RP 9 导出的样本做格式逆向后再支持。'
      )
    }
    const docXml = await docXmlFile.async('string')

    sendProgressToPopup('正在解析文档结构...')

    // 解析 XML → DocumentIR
    resetIdCounter()
    const doc = parseDocumentXml(docXml)

    if (!doc.pages || doc.pages.length === 0) {
      throw new Error(
        '解析未得到任何页面。该 .rp 文件的实际 XML 结构可能与插件内置解析器不一致，' +
        '需按真实样本逆向修正 rp-parser.js。'
      )
    }

    // 提取图片资源
    const images = {}
    const IMAGE_PREFIX = 'resources/images/'
    const imgPaths = Object.keys(zip.files).filter(
      path => path.startsWith(IMAGE_PREFIX) && !zip.files[path].dir
    )
    for (const imgPath of imgPaths) {
      const base64 = await zip.files[imgPath].async('base64')
      const name = imgPath.slice(IMAGE_PREFIX.length)
      images[name] = base64
    }

    sendProgressToPopup('正在生成 HTML 文件...')

    // 构建 HTML 文件
    const htmlZip = new JSZip()
    for (const page of doc.pages) {
      // 替换图片引用
      replaceImageRefs(page, images)
      const html = buildHtmlFromPage(page)
      htmlZip.file(`page-${page.id}.html`, html)
    }

    // 添加图片资源
    for (const [name, data] of Object.entries(images)) {
      htmlZip.file(`resources/${name}`, data, { base64: true })
    }

    sendProgressToPopup('正在打包...')

    const base64 = await htmlZip.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })

    const url = `data:application/zip;base64,${base64}`
    const outName = (payload.fileName || 'output').replace(/\.rp$/i, '') + '.html.zip'

    await chrome.downloads.download({
      url,
      filename: outName,
      saveAs: true
    })

    sendDoneToPopup('解析完成！已下载 ' + outName)
  } catch (err) {
    sendErrorToPopup('解析失败: ' + err.message)
  }
}

/**
 * 替换 Widget 中的图片引用为 base64
 * @param {import('../../lib/core/widget-ir.js').PageIR} page
 * @param {Object} images
 */
function replaceImageRefs(page, images) {
  function walk(w) {
    if (w.type === 'Image' && w.src) {
      // 从 RP 路径中提取图片名
      const name = w.src.split('/').pop()
      if (images[name]) {
        const ext = name.split('.').pop()
        const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }
        const mime = mimeTypes[ext] || 'image/png'
        w.src = `data:${mime};base64,${images[name]}`
      }
    }
    if (w.children) w.children.forEach(walk)
    if (w.states) w.states.forEach(s => s.forEach(walk))
  }
  page.widgets.forEach(walk)
}

// ========== 工具函数 ==========

/**
 * 向 popup 主动广播一条消息（统一封装，popup 关闭时忽略拒绝）
 * @param {string} type - 'PROGRESS' | 'DONE' | 'ERROR'
 * @param {string} message
 */
function broadcastToPopup(type, message) {
  chrome.runtime.sendMessage({
    type,
    payload: { message }
  }).catch(() => {
    // popup 可能已关闭，忽略 "Receiving end does not exist" 错误
  })
}

/**
 * 向 popup 发送进度消息
 * @param {string} message
 */
function sendProgressToPopup(message) {
  broadcastToPopup('PROGRESS', message)
}

/**
 * 向 popup 发送完成消息（触发 popup 复位 converting）
 * @param {string} message
 */
function sendDoneToPopup(message) {
  broadcastToPopup('DONE', message)
}

/**
 * 向 popup 发送错误消息（触发 popup 复位 converting）
 * @param {string} message
 */
function sendErrorToPopup(message) {
  broadcastToPopup('ERROR', message)
}

console.log('[SW] Service Worker 已启动')


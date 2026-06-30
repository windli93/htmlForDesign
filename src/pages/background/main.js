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
import { blobToBase64, isSameOrigin } from '../../lib/utils/image.js'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

// ========== 消息路由 ==========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'CAPTURE_TAB':
      handleCaptureTab(sender.tab?.id, sendResponse)
      return true // 异步响应

    case 'CAPTURE_RESULT':
      handleCaptureResult(msg.payload, sender.tab?.id, sendResponse)
      return true

    case 'CONVERT_HTML_FILES':
      handleConvertHtmlFiles(msg.payload, sendResponse)
      return true

    case 'PARSE_RP':
      handleParseRp(msg.payload, sendResponse)
      return true

    default:
      console.warn('[SW] 未知消息类型:', msg.type)
      return false
  }
})

// ========== F2: 捕获当前页面 ==========

/**
 * 处理捕获当前 Tab 的请求
 * @param {number} tabId
 * @param {Function} sendResponse
 */
async function handleCaptureTab(tabId, sendResponse) {
  try {
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      tabId = tab.id
    }

    // 注入共享库和 content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['js/content.js']
    })

    // 等待 content script 发送 CAPTURE_RESULT
    // 实际 CAPTURE_RESULT 由 onMessage 路由到 handleCaptureResult
    // 这里只是触发注入，返回的 sendResponse 在 handleCaptureResult 中处理
    sendProgressToPopup('DOM 脚本已注入，等待页面响应...')
  } catch (err) {
    sendResponse({ type: 'ERROR', payload: { message: '注入失败: ' + err.message } })
  }
}

/**
 * 处理从 content script 返回的抓取结果
 * @param {Object} captureResult
 * @param {number} tabId
 * @param {Function} sendResponse
 */
async function handleCaptureResult(captureResult, tabId, sendResponse) {
  try {
    sendProgressToPopup('正在转换 DOM → IR...')

    // CaptureResult → PageIR
    const pageIr = captureResultToPageIr(captureResult)
    const doc = createDocument('9')
    doc.pages.push(pageIr)

    sendProgressToPopup('正在构建 RP 文件...')

    // 处理跨域图片
    await processCrossOriginImages(pageIr, tabId)

    // 构建 .rp 文件
    const blob = await buildRpFile(doc)
    const url = URL.createObjectURL(blob)

    // 触发下载
    await chrome.downloads.download({
      url,
      filename: `${pageIr.name || 'page'}.rp`,
      saveAs: true
    })

    sendResponse({ type: 'DONE', payload: { message: '转换完成！', downloadUrl: url } })
  } catch (err) {
    sendResponse({ type: 'ERROR', payload: { message: '转换失败: ' + err.message } })
  }
}

/**
 * 处理跨域图片
 * @param {import('../../lib/core/widget-ir.js').PageIR} pageIr
 * @param {number} tabId
 */
async function processCrossOriginImages(pageIr, tabId) {
  const promises = []

  function walkWidget(w) {
    if (w.type === 'Image' && w.src && !w.src.startsWith('data:')) {
      promises.push(processImage(w, tabId))
    }
    if (w.children) w.children.forEach(walkWidget)
    if (w.states) w.states.forEach(state => state.forEach(walkWidget))
  }

  pageIr.widgets.forEach(walkWidget)
  await Promise.allSettled(promises)
}

/**
 * 处理单个图片（fetch 或截图降级）
 * @param {import('../../lib/core/widget-ir.js').WidgetIR} w
 * @param {number} tabId
 */
async function processImage(w, tabId) {
  try {
    if (isSameOrigin(w.src) || w.src.startsWith('data:')) {
      // 同域或 data URL - 直接读取
      const resp = await fetch(w.src)
      const blob = await resp.blob()
      w.src = await blobToBase64(blob)
    } else {
      // 跨域尝试 fetch
      const resp = await fetch(w.src, { mode: 'cors' })
      const blob = await resp.blob()
      w.src = await blobToBase64(blob)
    }
  } catch {
    // CORS 失败，添加警告
    w.warnings = w.warnings || []
    w.warnings.push('无法获取跨域图片（无 CORS），请手动替换')
  }
}

// ========== F1: 多 HTML 文件 → RP ==========

/**
 * 处理多 HTML 文件转换
 * @param {Object} payload
 * @param {Array<{name:string, html:string}>} payload.files
 * @param {Function} sendResponse
 */
async function handleConvertHtmlFiles(payload, sendResponse) {
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

    sendProgressToPopup('正在构建 RP 文件...')

    // 构建 .rp
    const blob = await buildRpFile(doc)
    const url = URL.createObjectURL(blob)

    await chrome.downloads.download({
      url,
      filename: 'converted.rp',
      saveAs: true
    })

    sendResponse({ type: 'DONE', payload: { message: '转换完成！', downloadUrl: url } })
  } catch (err) {
    sendResponse({ type: 'ERROR', payload: { message: '转换失败: ' + err.message } })
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
 * @param {Function} sendResponse
 */
async function handleParseRp(payload, sendResponse) {
  try {
    sendProgressToPopup('正在解包 RP 文件...')

    // 加载 ZIP
    const zip = await JSZip.loadAsync(payload.rpBase64, { base64: true })

    // 读取 document.xml
    const docXml = await zip.file('document.xml').async('string')

    sendProgressToPopup('正在解析文档结构...')

    // 解析 XML → DocumentIR
    resetIdCounter()
    const doc = parseDocumentXml(docXml)

    // 提取图片资源
    const images = {}
    const imgFolder = zip.folder('resources/images')
    if (imgFolder) {
      const imgFiles = Object.keys(imgFolder.files)
      for (const imgPath of imgFiles) {
        const file = imgFolder.files[imgPath]
        if (!file.dir) {
          const base64 = await file.async('base64')
          const name = imgPath.split('/').pop()
          images[name] = base64
        }
      }
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

    const blob = await htmlZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })

    const url = URL.createObjectURL(blob)
    const outName = (payload.fileName || 'output').replace(/\.rp$/i, '') + '.html.zip'

    await chrome.downloads.download({
      url,
      filename: outName,
      saveAs: true
    })

    sendResponse({ type: 'DONE', payload: { message: '解析完成！', downloadUrl: url } })
  } catch (err) {
    sendResponse({ type: 'ERROR', payload: { message: '解析失败: ' + err.message } })
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
 * 向 popup 发送进度消息
 * @param {string} message
 */
function sendProgressToPopup(message) {
  chrome.runtime.sendMessage({
    type: 'PROGRESS',
    payload: { message }
  }).catch(() => {
    // popup 可能已关闭，忽略错误
  })
}

console.log('[SW] Service Worker 已启动')


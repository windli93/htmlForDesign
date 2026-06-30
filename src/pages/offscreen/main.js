/**
 * Offscreen Document - F1 离屏渲染上传的 HTML 文件
 *
 * 接收 service worker 发来的 RENDER_HTML 消息，
 * 在 sandbox iframe 中渲染 HTML，提取 DOM 后返回结果。
 */

import { extractCaptureResult } from '../../lib/shared/extract-raw-dom.js'

// 监听来自 service worker 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RENDER_HTML') {
    renderHtml(msg.payload)
      .then((result) => {
        sendResponse({ success: true, payload: result })
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message })
      })
    return true // 异步响应
  }
})

/**
 * 渲染 HTML 并提取 DOM
 * @param {Object} payload
 * @param {string} payload.html - HTML 字符串
 * @param {number} [payload.width] - 目标宽度
 * @returns {Promise<Object>} CaptureResult
 */
function renderHtml(payload) {
  return new Promise((resolve, reject) => {
    const targetWidth = payload.width || 1440

    // 获取或创建 iframe
    let iframe = document.getElementById('renderFrame')
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'renderFrame'
      iframe.setAttribute('sandbox', 'allow-same-origin')
      iframe.style.width = targetWidth + 'px'
      iframe.style.height = '0px'
      iframe.style.border = 'none'
      iframe.style.visibility = 'hidden'
      iframe.style.position = 'absolute'
      document.body.appendChild(iframe)
    }

    // 设置 srcdoc
    iframe.srcdoc = payload.html

    // 等待 load 事件
    iframe.onload = function () {
      try {
        const doc = iframe.contentDocument
        if (!doc || !doc.body) {
          reject(new Error('iframe 文档不可访问'))
          return
        }

        // 计算实际高度
        const height = doc.documentElement.scrollHeight || doc.body.scrollHeight
        iframe.style.height = height + 'px'

        // 提取 DOM
        const result = extractCaptureResult(doc.body)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }

    iframe.onerror = function () {
      reject(new Error('iframe 加载失败'))
    }

    // 超时保护
    setTimeout(() => {
      reject(new Error('iframe 渲染超时'))
    }, 30000)
  })
}

/**
 * Content Script - 注入到浏览器页面的 DOM 抓取入口
 *
 * Webpack 会将此文件及其 import 的模块打包为单一 bundle，
 * 通过 chrome.scripting.executeScript({ files: ['js/content.js'] }) 注入。
 */

import { extractCaptureResult } from '../../lib/shared/extract-raw-dom.js'

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

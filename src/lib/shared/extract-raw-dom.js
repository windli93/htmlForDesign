/**
 * 原始 DOM → CaptureResult 提取函数
 *
 * 提供纯函数用于从 DOM 树中提取布局信息，生成统一的 CaptureResult 格式。
 * 可通过 import 导入（webpack 构建），也可作为独立脚本加载。
 */

let _captureIdCounter = 0

function generateNodeId() {
  return 'n' + (++_captureIdCounter)
}

/**
 * 递归捕获 DOM 节点信息
 * @param {Element} el
 * @param {DOMRect|null} parentRect
 * @returns {Object|null}
 */
function captureNode(el, parentRect) {
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)

  // 过滤不可见节点
  if (rect.width === 0 || rect.height === 0) return null
  if (style.display === 'none' || style.visibility === 'hidden') return null
  if (parseFloat(style.opacity) === 0) return null

  // 相对文档坐标（考虑滚动）
  const absX = rect.left + window.scrollX
  const absY = rect.top + window.scrollY

  const node = {
    tagName: el.tagName.toLowerCase(),
    id: el.id || generateNodeId(),
    bounds: { x: absX, y: absY, width: rect.width, height: rect.height },
    text: getDirectText(el),
    src: getImageSrc(el, style),
    inputType: el.type || null,
    placeholder: el.placeholder || null,
    href: el.href || null,
    role: el.getAttribute('role'),
    style: extractStyle(style),
    children: []
  }

  // 递归子节点（非纯文本节点）
  for (const child of el.children) {
    const childNode = captureNode(child, rect)
    if (childNode) node.children.push(childNode)
  }

  return node
}

/**
 * 提取计算样式
 * @param {CSSStyleDeclaration} cs
 * @returns {Object}
 */
function extractStyle(cs) {
  return {
    bgColor: cs.backgroundColor,
    borderColor: cs.borderTopColor,
    borderWidth: parseFloat(cs.borderTopWidth),
    borderRadius: parseFloat(cs.borderTopLeftRadius),
    fontFamily: cs.fontFamily,
    fontSize: parseFloat(cs.fontSize),
    fontWeight: cs.fontWeight,
    fontColor: cs.color,
    textAlign: cs.textAlign,
    lineHeight: cs.lineHeight,
    opacity: parseFloat(cs.opacity),
    zIndex: parseInt(cs.zIndex) || 0,
    boxShadow: cs.boxShadow
  }
}

/**
 * 获取图片 URL
 * @param {Element} el
 * @param {CSSStyleDeclaration} style
 * @returns {string|null}
 */
function getImageSrc(el, style) {
  if (el.tagName === 'IMG' && el.src) return el.src
  const bg = style.backgroundImage
  if (bg && bg !== 'none') {
    const match = bg.match(/url\(["']?(.+?)["']?\)/)
    return match ? match[1] : null
  }
  return null
}

/**
 * 获取元素的直接文本内容（排除子元素文本）
 * @param {Element} el
 * @returns {string}
 */
function getDirectText(el) {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    }
  }
  return text.trim()
}

/**
 * 汇总入口：传入根节点（document.body 或 iframe.contentDocument.body）
 * @param {Element} rootEl
 * @returns {Object} CaptureResult
 */
function extractCaptureResult(rootEl) {
  _captureIdCounter = 0
  const doc = rootEl.ownerDocument
  return {
    title: doc.title,
    width: doc.documentElement.scrollWidth,
    height: doc.documentElement.scrollHeight,
    tree: captureNode(rootEl, null)
  }
}

export { captureNode, extractStyle, getImageSrc, getDirectText, extractCaptureResult }
export default extractCaptureResult

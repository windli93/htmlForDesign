/**
 * CaptureResult → Widget IR
 *
 * 将 Content Script 返回的原始 DOM 抓取结果转换为 PageIR / WidgetIR。
 * 在 service worker 中执行。
 */

import { isValidWidgetType, createPage, defaultStyle, generateId, resetIdCounter } from './widget-ir.js'
import { colorToArgb } from '../utils/color.js'
import { normalizeFontFamily, normalizeFontWeight } from '../utils/font.js'

/**
 * CaptureResult → PageIR
 * @param {Object} captureResult - 从 content script 返回的抓取结果
 * @param {string} [pageName] - 可选页面名
 * @returns {import('./widget-ir.js').PageIR}
 */
export function captureResultToPageIr(captureResult, pageName) {
  resetIdCounter()

  const page = createPage(
    pageName || captureResult.title || '抓取页面',
    captureResult.width || 1440,
    captureResult.height || 900
  )

  if (captureResult.tree && captureResult.tree.children) {
    page.widgets = captureResult.tree.children
      .map(child => convertNodeToWidget(child))
      .filter(Boolean)
  }

  return page
}

/**
 * 将 DOM 节点转换为 WidgetIR
 * @param {Object} node
 * @returns {import('./widget-ir.js').WidgetIR|null}
 */
function convertNodeToWidget(node) {
  if (!node) return null

  const widgetType = mapTagToWidgetType(node)
  const bounds = { ...node.bounds }

  // 归一化坐标：如果父节点偏移，需要递归累加
  // 但 capture.js 已经计算了绝对文档坐标

  const widget = {
    id: node.id || generateId(),
    type: widgetType,
    bounds,
    style: convertStyle(node.style, widgetType),
    content: widgetType === 'Text' || widgetType === 'Button' ? (node.text || '') : null,
    src: widgetType === 'Image' ? node.src : null,
    zIndex: parseInt(node.style?.zIndex) || 0,
    warnings: []
  }

  // 递归子节点
  if (node.children && node.children.length > 0) {
    const children = node.children
      .map(child => convertNodeToWidget(child))
      .filter(Boolean)

    // 如果当前是容器类标签，子节点作为 children
    if (['Rectangle', 'Group', 'Unknown'].includes(widgetType) || node.tagName === 'div') {
      widget.children = children
    }
  }

  if (widgetType === 'Unknown') {
    widget.warnings.push(`未知标签: ${node.tagName}`)
  }

  return widget
}

/**
 * HTML 标签 → WidgetType 映射
 * @param {Object} node
 * @returns {import('./widget-ir.js').WidgetType}
 */
function mapTagToWidgetType(node) {
  const tag = node.tagName?.toLowerCase()

  const map = {
    'div': detectDivRole(node),
    'span': 'Text',
    'p': 'Text',
    'h1': 'Text',
    'h2': 'Text',
    'h3': 'Text',
    'h4': 'Text',
    'h5': 'Text',
    'h6': 'Text',
    'a': 'Text',
    'button': 'Button',
    'input': detectInputType(node),
    'img': 'Image',
    'select': 'Select',
    'textarea': 'TextBox',
    'label': 'Text',
    'ul': 'Group',
    'ol': 'Group',
    'li': 'Text',
    'table': 'Group',
    'section': 'Group',
    'article': 'Group',
    'nav': 'Group',
    'header': 'Group',
    'footer': 'Group',
    'main': 'Group'
  }

  return map[tag] || 'Unknown'
}

/**
 * 检测 div 的具体角色
 * @param {Object} node
 * @returns {import('./widget-ir.js').WidgetType}
 */
function detectDivRole(node) {
  const role = node.role
  if (role === 'button') return 'Button'
  if (role === 'img') return 'Image'
  if (role === 'group') return 'Group'
  // 有背景图且无文本的 div 视为 Image
  if (node.src && !node.text) return 'Image'
  if (node.text) return 'Text'
  return 'Rectangle'
}

/**
 * 检测 input 类型
 * @param {Object} node
 * @returns {import('./widget-ir.js').WidgetType}
 */
function detectInputType(node) {
  const type = (node.inputType || '').toLowerCase()
  if (type === 'checkbox') return 'Checkbox'
  if (type === 'radio') return 'RadioButton'
  if (type === 'text' || type === 'email' || type === 'password' || type === 'search' || type === 'tel' || type === 'url') return 'TextBox'
  return 'TextBox'
}

/**
 * 转换样式对象
 * @param {Object} rawStyle - 从 DOM 提取的原始样式
 * @param {import('./widget-ir.js').WidgetType} widgetType
 * @returns {import('./widget-ir.js').WidgetStyle}
 */
function convertStyle(rawStyle, widgetType) {
  if (!rawStyle) return defaultStyle()

  const s = defaultStyle()

  // 背景色
  if (rawStyle.bgColor && rawStyle.bgColor !== 'rgba(0, 0, 0, 0)' && rawStyle.bgColor !== 'transparent') {
    s.fill = {
      type: 'solid',
      color: '#' + colorToArgb(rawStyle.bgColor).slice(2) || '#ffffff',
      opacity: 1
    }
  }

  // 边框
  if (rawStyle.borderWidth && rawStyle.borderWidth > 0) {
    s.border = {
      color: rawStyle.borderColor ? '#' + colorToArgb(rawStyle.borderColor).slice(2) : '#cccccc',
      width: rawStyle.borderWidth,
      style: 'solid',
      radius: rawStyle.borderRadius || 0
    }
  }

  // 字体
  if (widgetType === 'Text' || widgetType === 'Button') {
    s.font = {
      family: normalizeFontFamily(rawStyle.fontFamily),
      size: rawStyle.fontSize || 14,
      weight: normalizeFontWeight(rawStyle.fontWeight),
      italic: false,
      underline: false,
      color: rawStyle.fontColor ? '#' + colorToArgb(rawStyle.fontColor).slice(2) : '#333333',
      align: rawStyle.textAlign && ['left', 'center', 'right'].includes(rawStyle.textAlign) ? rawStyle.textAlign : 'left',
      lineHeight: parseFloat(rawStyle.lineHeight) || 1.5
    }
  }

  // 透明度
  if (rawStyle.opacity != null && rawStyle.opacity < 1) {
    s.opacity = rawStyle.opacity
  }

  return s
}

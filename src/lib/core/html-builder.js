/**
 * Widget IR → HTML + CSS
 *
 * 将 PageIR 转换为完整 HTML 文件字符串（绝对定位）。
 */

import { normalizeFontFamily, normalizeFontWeight, buildFontStack } from '../utils/font.js'

/**
 * 从 PageIR 生成完整 HTML
 * @param {import('./widget-ir.js').PageIR} pageIR
 * @returns {string}
 */
export function buildHtmlFromPage(pageIR) {
  const widgets = flattenWidgets(pageIR.widgets)
  const styles = buildCssRules(widgets)
  const body = buildBodyHtml(pageIR.widgets)

  const bgColor = pageIR.bgColor || '#ffffff'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageIR.name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: ${bgColor}; }
    .rp-canvas {
      position: relative;
      width: ${pageIR.width}px;
      height: ${pageIR.height}px;
      background: ${bgColor};
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
</html>`
}

/**
 * 展开 Group，扁平化 Widget 列表
 * @param {import('./widget-ir.js').WidgetIR[]} widgets
 * @returns {import('./widget-ir.js').WidgetIR[]}
 */
function flattenWidgets(widgets) {
  const result = []
  for (const w of widgets) {
    result.push(w)
    if (w.children && w.children.length > 0) {
      result.push(...flattenWidgets(w.children))
    }
  }
  return result
}

/**
 * 构建 CSS 规则字符串
 * @param {import('./widget-ir.js').WidgetIR[]} widgets
 * @returns {string}
 */
function buildCssRules(widgets) {
  return widgets.map(w => widgetToCss(w)).filter(Boolean).join('\n')
}

/**
 * 单个 Widget 的 CSS
 * @param {import('./widget-ir.js').WidgetIR} w
 * @returns {string}
 */
function widgetToCss(w) {
  const s = w.style
  if (!s) return ''

  return `
  #${w.id} {
    position: absolute;
    left: ${w.bounds.x}px;
    top:  ${w.bounds.y}px;
    width:  ${w.bounds.width}px;
    height: ${w.bounds.height}px;
    z-index: ${w.zIndex || 0};
    ${s.fill?.color && s.fill.type !== 'none' ? `background-color: ${s.fill.color};` : ''}
    ${s.border?.width && s.border.style !== 'none' ? `border: ${s.border.width}px ${s.border.style} ${s.border.color};` : ''}
    ${s.border?.radius ? `border-radius: ${s.border.radius}px;` : ''}
    ${s.font?.size ? `font-size: ${s.font.size}px;` : ''}
    ${s.font?.color ? `color: ${s.font.color};` : ''}
    ${s.font?.family ? `font-family: ${buildFontStack(s.font.family)};` : ''}
    ${s.font?.weight ? `font-weight: ${s.font.weight};` : ''}
    ${s.font?.align ? `text-align: ${s.font.align};` : ''}
    ${s.opacity != null && s.opacity < 1 ? `opacity: ${s.opacity};` : ''}
    overflow: hidden;
  }`
}

/**
 * 构建 Widget HTML body
 * @param {import('./widget-ir.js').WidgetIR[]} widgets
 * @returns {string}
 */
function buildBodyHtml(widgets) {
  return widgets.map(w => widgetToHtml(w)).join('\n    ')
}

/**
 * 单个 Widget → HTML 标签
 * @param {import('./widget-ir.js').WidgetIR} w
 * @returns {string}
 */
function widgetToHtml(w) {
  switch (w.type) {
    case 'Text':
    case 'Rectangle':
      return `<div id="${w.id}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>${escapeHtml(w.content || '')}</div>`

    case 'Image':
      return `<img id="${w.id}" src="${w.src || ''}" alt="${escapeHtml(w.name || '')}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>`

    case 'Button':
      return `<button id="${w.id}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>${escapeHtml(w.content || '')}</button>`

    case 'TextBox':
      return `<input id="${w.id}" type="text" placeholder="${escapeHtml(w.content || '')}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>`

    case 'Checkbox':
      return `<label id="${w.id}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}><input type="checkbox">${escapeHtml(w.content || '')}</label>`

    case 'RadioButton':
      return `<label id="${w.id}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}><input type="radio" name="radio-group">${escapeHtml(w.content || '')}</label>`

    case 'Select':
      return `<select id="${w.id}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}></select>`

    case 'Line':
      return `<div id="${w.id}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''} style="border-top: 1px solid ${(w.style?.border?.color) || '#999'};"></div>`

    case 'DynamicPanel': {
      return buildDynamicPanelHtml(w)
    }

    case 'Group':
      return `<div id="${w.id}" class="rp-group"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>${w.children ? buildBodyHtml(w.children) : ''}</div>`

    default:
      return `<div id="${w.id}" data-type="${w.type}"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>${escapeHtml(w.content || '')}</div>`
  }
}

/**
 * DynamicPanel → HTML（默认状态显示，其余隐藏）
 * @param {import('./widget-ir.js').WidgetIR} w
 * @returns {string}
 */
function buildDynamicPanelHtml(w) {
  if (!w.states || w.states.length === 0) return `<div id="${w.id}" class="rp-dynamic-panel"></div>`

  const defaultIdx = w.defaultState || 0
  return `
    <div id="${w.id}" class="rp-dynamic-panel"${w.name ? ` data-name="${escapeHtml(w.name)}"` : ''}>
      ${w.states.map((stateWidgets, idx) => `
        <div class="rp-panel-state" data-state="${idx}" style="${idx === defaultIdx ? '' : 'display:none;'}">
          ${buildBodyHtml(stateWidgets)}
        </div>
      `).join('')}
    </div>`
}

/**
 * HTML 转义
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

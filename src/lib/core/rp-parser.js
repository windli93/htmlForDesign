/**
 * RP XML → DocumentIR / PageIR / WidgetIR
 *
 * 使用 fast-xml-parser 解析 document.xml，提取页面和 Widget 信息。
 * RP 文件本质是 ZIP，此模块解析解压后的 document.xml 字符串。
 */

import { XMLParser } from 'fast-xml-parser'
import { isValidWidgetType, createDocument, createPage, defaultBounds, defaultStyle } from './widget-ir.js'

/**
 * 解析 document.xml 字符串为 DocumentIR
 * @param {string} xmlStr
 * @returns {import('./widget-ir.js').DocumentIR}
 */
export function parseDocumentXml(xmlStr) {
  const parser = new XMLParser({
    attributeNamePrefix: '',
    textNodeName: '_text',
    ignoreAttributes: false,
    parseAttributeValue: true,
    trimValues: true
  })

  const raw = parser.parse(xmlStr)
  const axure = raw['ax:AxureRP'] || raw.AxureRP || {}
  const doc = createDocument(axure.version || '9')

  // 提取页面列表
  const pages = extractPages(axure)
  doc.pages = pages

  return doc
}

/**
 * 提取页面列表
 * @param {Object} axure
 * @returns {import('./widget-ir.js').PageIR[]}
 */
function extractPages(axure) {
  const pages = []
  const sitemap = axure['ax:sitemap'] || axure.sitemap || {}
  const pageNodes = sitemap['ax:page'] || sitemap.page || []
  const pagesContainer = axure['ax:pages'] || axure.pages || {}
  const pageDefs = pagesContainer['ax:page'] || pagesContainer.page || []

  // 统一为数组
  const sitemapPages = Array.isArray(pageNodes) ? pageNodes : (pageNodes ? [pageNodes] : [])
  const defPages = Array.isArray(pageDefs) ? pageDefs : (pageDefs ? [pageDefs] : [])

  for (const sp of sitemapPages) {
    const pid = sp.id
    const def = defPages.find(d => d.id === pid) || {}
    const page = createPage(
      sp.name || def.name || '未命名页面',
      parseInt(def.w) || 1440,
      parseInt(def.h) || 900
    )
    page.id = pid
    page.bgColor = def.bgColor || '#ffffff'

    // 提取 Widget
    const objects = def['ax:objects'] || def.objects || {}
    const widgetList = objects['ax:object'] || objects.object || []
    page.widgets = (Array.isArray(widgetList) ? widgetList : [widgetList])
      .map(w => parseWidget(w))
      .filter(Boolean)

    pages.push(page)
  }

  return pages
}

/**
 * 解析单个 Widget XML 节点
 * @param {Object} w
 * @returns {import('./widget-ir.js').WidgetIR|null}
 */
function parseWidget(w) {
  if (!w) return null

  const type = mapWidgetType(w.type)
  const widget = {
    id: w.id || 'w_unknown',
    type,
    bounds: {
      x: parseInt(w['ax:x'] || w.x || 0),
      y: parseInt(w['ax:y'] || w.y || 0),
      width: parseInt(w['ax:w'] || w.w || 100),
      height: parseInt(w['ax:h'] || w.h || 50)
    },
    style: parseWidgetStyle(w),
    content: w['ax:text'] || w.text || null,
    src: w['ax:src'] || w.src || null,
    name: w.label || null,
    zIndex: parseInt(w.zIndex) || 0,
    warnings: []
  }

  // 解析子对象
  const objectsNode = w['ax:objects'] || w.objects || null
  if (objectsNode) {
    const children = objectsNode['ax:object'] || objectsNode.object || []
    widget.children = (Array.isArray(children) ? children : [children])
      .map(c => parseWidget(c))
      .filter(Boolean)
  }

  // 解析 DynamicPanel 状态
  const statesNode = w['ax:states'] || w.states || null
  if (statesNode) {
    const stateList = statesNode['ax:state'] || statesNode.state || []
    const states = Array.isArray(stateList) ? stateList : [stateList]
    widget.states = states.map(s => {
      const stateObjects = s['ax:objects'] || s.objects || {}
      const stateWidgets = stateObjects['ax:object'] || stateObjects.object || []
      return (Array.isArray(stateWidgets) ? stateWidgets : [stateWidgets])
        .map(c => parseWidget(c))
        .filter(Boolean)
    })
    widget.defaultState = parseInt(w.defaultState) || 0
  }

  if (type === 'Unknown') {
    widget.warnings.push(`未识别 Widget 类型: ${w.type}`)
  }

  return widget
}

/**
 * 映射 Axure Widget 类型
 * @param {string} axType
 * @returns {import('./widget-ir.js').WidgetType}
 */
function mapWidgetType(axType) {
  const map = {
    Rectangle: 'Rectangle',
    Text: 'Text',
    Image: 'Image',
    Button: 'Button',
    TextBox: 'TextBox',
    Checkbox: 'Checkbox',
    RadioButton: 'RadioButton',
    Select: 'Select',
    Line: 'Line',
    Group: 'Group',
    DynamicPanel: 'DynamicPanel'
  }
  return map[axType] || 'Unknown'
}

/**
 * 解析 Widget 样式
 * @param {Object} w
 * @returns {import('./widget-ir.js').WidgetStyle}
 */
function parseWidgetStyle(w) {
  const style = defaultStyle()

  // 填充色
  const fill = w['ax:fillStyle'] || w.fillStyle
  if (fill) {
    const color = fill['ax:fillColor'] || fill.fillColor
    style.fill = {
      type: fill.gradient && fill.gradient.enabled === 'true' ? 'none' : 'solid',
      color: color ? '#' + (typeof color === 'object' ? (color.argb || 'ffffffff') : String(color)).slice(2) : '#ffffff',
      opacity: 1
    }
    if (fill.gradient && fill.gradient.enabled === 'true') {
      // 渐变暂不支持
    }
  }

  // 边框
  const border = w['ax:borderStyle'] || w.borderStyle
  if (border) {
    const color = border['ax:borderColor'] || border.borderColor
    style.border = {
      color: color ? '#' + (typeof color === 'object' ? (color.argb || 'ffcccccc') : String(color)).slice(2) : '#cccccc',
      width: parseInt(border['ax:borderWidth'] || border.borderWidth || 1),
      style: 'solid',
      radius: parseInt(border['ax:borderRadius'] || border.borderRadius || 0)
    }
  }

  // 字体
  const label = w['ax:labelStyle'] || w.labelStyle
  if (label) {
    const fontColor = label['ax:fontColor'] || label.fontColor
    style.font = {
      family: label['ax:fontName'] || label.fontName || 'Arial',
      size: parseInt(label['ax:fontSize'] || label.fontSize || 14),
      weight: (label['ax:bold'] || label.bold) === 'true' ? 'bold' : 'normal',
      italic: (label['ax:italic'] || label.italic) === 'true',
      underline: false,
      color: fontColor ? '#' + (typeof fontColor === 'object' ? (fontColor.argb || 'ff333333') : String(fontColor)).slice(2) : '#333333',
      align: label['ax:align'] || label.align || 'left',
      lineHeight: parseFloat(label['ax:lineHeight'] || label.lineHeight || 1.5)
    }
  }

  // 阴影
  const shadow = w['ax:shadowStyle'] || w.shadowStyle
  if (shadow) {
    style.shadow = {
      enabled: shadow.enabled === 'true',
      x: 0,
      y: 0,
      blur: 0,
      color: '#000000'
    }
  }

  style.opacity = parseFloat(w.opacity) || 1
  style.rotation = parseFloat(w.rotation) || 0

  return style
}

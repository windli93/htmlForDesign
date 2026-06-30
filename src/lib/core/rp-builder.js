/**
 * Widget IR → RP XML
 *
 * 将 DocumentIR 转换为 RP 文件格式（XML + ZIP 打包）。
 */

import { colorToArgb } from '../utils/color.js'
import { normalizeFontFamily, normalizeFontWeight } from '../utils/font.js'
import { getMimeType } from '../utils/image.js'
import JSZip from 'jszip'

/**
 * 从 DocumentIR 构建完整的 .rp 文件 Blob
 * @param {import('./widget-ir.js').DocumentIR} doc
 * @returns {Promise<Blob>}
 */
export async function buildRpFile(doc) {
  const zip = new JSZip()

  // 生成 document.xml
  const xml = buildDocumentXml(doc)
  zip.file('document.xml', xml)

  // 收集并添加图片资源
  const images = collectImages(doc)
  for (const [filename, base64] of Object.entries(images)) {
    zip.file(`resources/images/${filename}`, base64, { base64: true })
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}

/**
 * 构建 document.xml 字符串
 * @param {import('./widget-ir.js').DocumentIR} doc
 * @returns {string}
 */
function buildDocumentXml(doc) {
  const sitemap = doc.pages.map(p =>
    `<ax:page id="${escXml(p.id)}" name="${escXml(p.name)}" type="page"/>`
  ).join('\n    ')

  const pagesXml = doc.pages.map(buildPageXml).join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<ax:AxureRP xmlns:ax="http://www.axure.com/AxureRP" version="${escXml(doc.rpVersion || '9')}">
  <ax:sitemap>
    ${sitemap}
  </ax:sitemap>
  <ax:pages>
    ${pagesXml}
  </ax:pages>
</ax:AxureRP>`
}

/**
 * 构建页面 XML
 * @param {import('./widget-ir.js').PageIR} page
 * @returns {string}
 */
function buildPageXml(page) {
  const objectsXml = page.widgets.map(w => buildWidgetXml(w)).join('\n        ')
  return `
    <ax:page id="${escXml(page.id)}" name="${escXml(page.name)}"
             w="${page.width}" h="${page.height}">
      <ax:objects>
        ${objectsXml}
      </ax:objects>
    </ax:page>`
}

/**
 * 构建 Widget XML
 * @param {import('./widget-ir.js').WidgetIR} w
 * @param {number} [depth]
 * @returns {string}
 */
function buildWidgetXml(w, depth = 0) {
  const indent = '        ' + '  '.repeat(depth)

  let xml = `${indent}<ax:object id="${escXml(w.id)}" type="${w.type}" label="${escXml(w.name || '')}">
${indent}  <ax:x>${w.bounds.x}</ax:x>
${indent}  <ax:y>${w.bounds.y}</ax:y>
${indent}  <ax:w>${w.bounds.width}</ax:w>
${indent}  <ax:h>${w.bounds.height}</ax:h>`

  // 样式
  xml += buildStyleXml(w.style, indent)

  // 内容
  xml += buildContentXml(w, indent)

  // 子节点
  if (w.children && w.children.length > 0) {
    xml += `\n${indent}  <ax:objects>`
    xml += '\n' + w.children.map(c => buildWidgetXml(c, depth + 1)).join('\n')
    xml += `\n${indent}  </ax:objects>`
  }

  // DynamicPanel states
  if (w.states && w.states.length > 0) {
    xml += `\n${indent}  <ax:defaultState>${w.defaultState || 0}</ax:defaultState>`
    xml += `\n${indent}  <ax:states>`
    w.states.forEach((stateWidgets, idx) => {
      xml += `\n${indent}    <ax:state index="${idx}" name="状态 ${idx + 1}">`
      xml += `\n${indent}      <ax:objects>`
      xml += '\n' + stateWidgets.map(c => buildWidgetXml(c, depth + 2)).join('\n')
      xml += `\n${indent}      </ax:objects>`
      xml += `\n${indent}    </ax:state>`
    })
    xml += `\n${indent}  </ax:states>`
  }

  xml += `\n${indent}</ax:object>`
  return xml
}

/**
 * 构建样式 XML
 * @param {import('./widget-ir.js').WidgetStyle} s
 * @param {string} indent
 * @returns {string}
 */
function buildStyleXml(s, indent) {
  if (!s) return ''

  let xml = ''
  xml += `\n${indent}  <ax:fillStyle>`
  xml += `\n${indent}    <ax:fillColor argb="${colorToArgb(s.fill?.color, s.fill?.opacity)}"/>`
  xml += `\n${indent}    <ax:gradient enabled="false"/>`
  xml += `\n${indent}  </ax:fillStyle>`

  xml += `\n${indent}  <ax:borderStyle>`
  xml += `\n${indent}    <ax:borderColor argb="${colorToArgb(s.border?.color)}"/>`
  xml += `\n${indent}    <ax:borderWidth>${s.border?.width || 0}</ax:borderWidth>`
  xml += `\n${indent}    <ax:borderRadius>${s.border?.radius || 0}</ax:borderRadius>`
  xml += `\n${indent}  </ax:borderStyle>`

  xml += `\n${indent}  <ax:labelStyle>`
  xml += `\n${indent}    <ax:fontName>${s.font?.family || 'Arial'}</ax:fontName>`
  xml += `\n${indent}    <ax:fontSize>${s.font?.size || 14}</ax:fontSize>`
  xml += `\n${indent}    <ax:fontColor argb="${colorToArgb(s.font?.color)}"/>`
  xml += `\n${indent}    <ax:bold>${s.font?.weight === 'bold'}</ax:bold>`
  xml += `\n${indent}    <ax:align>${s.font?.align || 'left'}</ax:align>`
  xml += `\n${indent}  </ax:labelStyle>`

  xml += `\n${indent}  <ax:shadowStyle enabled="${s.shadow?.enabled ? 'true' : 'false'}"/>`

  return xml
}

/**
 * 构建内容 XML
 * @param {import('./widget-ir.js').WidgetIR} w
 * @param {string} indent
 * @returns {string}
 */
function buildContentXml(w, indent) {
  let xml = ''

  if (w.content) {
    xml += `\n${indent}  <ax:text>${escXml(w.content)}</ax:text>`
  }

  if (w.src) {
    xml += `\n${indent}  <ax:src>${escXml(w.src)}</ax:src>`
  }

  if (w.zIndex && w.zIndex !== 0) {
    xml += `\n${indent}  <ax:zIndex>${w.zIndex}</ax:zIndex>`
  }

  if (w.opacity != null && w.opacity !== 1) {
    xml += `\n${indent}  <ax:opacity>${w.opacity}</ax:opacity>`
  }

  return xml
}

/**
 * 收集文档中所有图片
 * @param {import('./widget-ir.js').DocumentIR} doc
 * @returns {Object.<string, string>} filename -> base64 data
 */
function collectImages(doc) {
  const images = {}
  let imgCounter = 0

  function walkWidget(w) {
    if (w.type === 'Image' && w.src) {
      const mime = w.src.startsWith('data:') ? w.src.split(';')[0].split(':')[1] : 'image/png'
      const ext = mime.split('/')[1] || 'png'
      const base64Data = w.src.includes('base64,') ? w.src.split('base64,')[1] : w.src
      imgCounter++
      images[`img_${String(imgCounter).padStart(3, '0')}.${ext}`] = base64Data
    }
    if (w.children) w.children.forEach(walkWidget)
    if (w.states) w.states.forEach(state => state.forEach(walkWidget))
  }

  doc.pages.forEach(page => page.widgets.forEach(walkWidget))
  return images
}

/**
 * XML 转义
 * @param {string} str
 * @returns {string}
 */
function escXml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

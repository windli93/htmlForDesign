/**
 * 颜色格式转换工具
 * CSS color → Axure ARGB hex 互转
 */

/**
 * 解析 CSS 颜色字符串为 RGBA 数组
 * @param {string} cssColor
 * @returns {number[]} [r, g, b, a] 0-255, 0-1
 */
export function parseCssColor(cssColor) {
  if (!cssColor || cssColor === 'transparent') return [0, 0, 0, 0]

  // 处理 #RRGGBB
  let match = cssColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (match) {
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16), 1]
  }

  // 处理 #RGB
  match = cssColor.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (match) {
    return [parseInt(match[1] + match[1], 16), parseInt(match[2] + match[2], 16), parseInt(match[3] + match[3], 16), 1]
  }

  // 处理 rgb(r,g,b) / rgba(r,g,b,a)
  match = cssColor.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i)
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), match[4] !== undefined ? parseFloat(match[4]) : 1]
  }

  // 处理 named colors (简化)
  const namedColors = {
    red: [255, 0, 0, 1], green: [0, 128, 0, 1], blue: [0, 0, 255, 1],
    white: [255, 255, 255, 1], black: [0, 0, 0, 1], gray: [128, 128, 128, 1],
    transparent: [0, 0, 0, 0]
  }
  if (namedColors[cssColor.toLowerCase()]) return namedColors[cssColor.toLowerCase()]

  // fallback
  return [0, 0, 0, 1]
}

/**
 * CSS color → Axure ARGB hex
 * @param {string} cssColor - '#3366cc' / 'rgb(51,102,204)' / 'rgba(51,102,204,0.5)'
 * @param {number} [opacity=1] - 额外透明度系数
 * @returns {string} 'ff3366cc' / '803366cc'
 */
export function colorToArgb(cssColor, opacity = 1) {
  if (!cssColor || cssColor === 'transparent') return '00000000'
  const [r, g, b, a = 1] = parseCssColor(cssColor)
  const alpha = Math.round(Math.min(Math.max(a * opacity, 0), 1) * 255)
  return [alpha, r, g, b]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Axure ARGB hex → CSS hex (#RRGGBB)
 * @param {string} argb - 'ffffffff'
 * @returns {string} '#ffffff'
 */
export function argbToHex(argb) {
  if (!argb || argb.length < 6) return '#000000'
  return '#' + argb.slice(2)
}

/**
 * Axure ARGB hex → CSS RGBA
 * @param {string} argb - '803366cc'
 * @returns {string} 'rgba(51,102,204,0.5)'
 */
export function argbToRgba(argb) {
  if (!argb || argb.length < 8) return 'rgba(0,0,0,0)'
  const alpha = parseInt(argb.slice(0, 2), 16) / 255
  const r = parseInt(argb.slice(2, 4), 16)
  const g = parseInt(argb.slice(4, 6), 16)
  const b = parseInt(argb.slice(6, 8), 16)
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`
}

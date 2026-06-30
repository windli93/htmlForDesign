/**
 * 字体名处理 / fallback stack
 */

/** 常见中文字体映射 */
const CJK_FONT_ALIASES = {
  'pingfang sc': 'PingFang SC',
  'pingfang': 'PingFang SC',
  '微软雅黑': 'Microsoft YaHei',
  '微软雅黑microsoft yahei': 'Microsoft YaHei',
  'microsoft yahei': 'Microsoft YaHei',
  '苹方': 'PingFang SC',
  'helvetica neue': 'Helvetica Neue',
  'helveticaneue': 'Helvetica Neue'
}

/**
 * 归一化字体名
 * @param {string} fontName
 * @returns {string}
 */
export function normalizeFontFamily(fontName) {
  if (!fontName) return 'Arial'
  const lower = fontName.toLowerCase().trim().replace(/\s+/g, ' ')
  return CJK_FONT_ALIASES[lower] || fontName
}

/**
 * 构建 CSS font-family fallback stack
 * @param {string} fontName
 * @param {string[]} [extraFallbacks]
 * @returns {string}
 */
export function buildFontStack(fontName, extraFallbacks = []) {
  const normalized = normalizeFontFamily(fontName)
  const fallbacks = [...extraFallbacks]

  // 根据字体类型决定 fallback
  if (isCJkFont(normalized)) {
    fallbacks.push('Microsoft YaHei', 'PingFang SC', 'sans-serif')
  } else {
    fallbacks.push('Arial', 'sans-serif')
  }

  return [normalized, ...new Set(fallbacks)].join(', ')
}

/** 判断是否为中文字体 */
function isCJkFont(name) {
  const cjkKeywords = ['pingfang', 'microsoft yahei', '微软雅黑', '苹方', 'noto sans sc', 'source han sans']
  const lower = name.toLowerCase()
  return cjkKeywords.some(k => lower.includes(k))
}

/**
 * 归一化 font-weight
 * @param {number|string} weight
 * @returns {'normal'|'bold'}
 */
export function normalizeFontWeight(weight) {
  if (typeof weight === 'string') {
    if (weight === 'bold' || weight === '700' || weight === '800' || weight === '900') return 'bold'
    return 'normal'
  }
  return weight >= 700 ? 'bold' : 'normal'
}

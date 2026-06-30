/**
 * 图片处理工具
 */

/** MIME 类型映射 */
const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon'
}

/**
 * 根据扩展名获取 MIME 类型
 * @param {string} filename
 * @returns {string}
 */
export function getMimeType(filename) {
  if (!filename) return 'image/png'
  const ext = filename.split('.').pop().toLowerCase()
  return MIME_TYPES[ext] || 'image/png'
}

/**
 * Blob → base64 Data URL
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * base64 字符串 → Blob
 * @param {string} base64Data - 含 data: URL 前缀或不含
 * @returns {Blob}
 */
export function base64ToBlob(base64Data) {
  const match = base64Data.match(/^data:(.+?);base64,(.+)$/)
  if (match) {
    const mime = match[1]
    const bytes = atob(match[2])
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      arr[i] = bytes.charCodeAt(i)
    }
    return new Blob([arr], { type: mime })
  }

  // 纯 base64（无前缀）
  const bytes = atob(base64Data)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i)
  }
  return new Blob([arr], { type: 'image/png' })
}

/**
 * 检查 URL 是否为 data URL
 * @param {string} url
 * @returns {boolean}
 */
export function isDataUrl(url) {
  return !!url && url.startsWith('data:')
}

/**
 * 检查 URL 是否为同域或可 CORS 请求
 * @param {string} url
 * @returns {boolean}
 */
export function isSameOrigin(url) {
  try {
    const target = new URL(url)
    return target.origin === window.location.origin
  } catch {
    return false
  }
}

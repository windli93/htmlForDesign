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
 *
 * 注意：MV3 service worker 没有 FileReader / window，因此这里用
 * blob.arrayBuffer() + 手写 base64 编码，确保在 SW 里也能跑。
 * @param {Blob} blob
 * @returns {Promise<string>} 形如 "data:image/png;base64,...."
 */
export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // 分块 base64，避免 String.fromCharCode 对超大数组报最大长度错误
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  const base64 = btoa(binary)
  const mime = blob.type || 'image/png'
  return `data:${mime};base64,${base64}`
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
 * 判断 URL 是否「可直接读取」（无需跨域 fetch）
 *
 * 注意：MV3 service worker 没有 window.location，无法做真正的同源比较。
 * 这里退化为「data:/blob: 前缀视为可直接读取」，其余一律按跨域 fetch
 * 处理（交给 fetch 本身的成功/失败决定）。调用方（SW 的 processImage）
 * 已据此分支处理。
 * @param {string} url
 * @returns {boolean}
 */
export function isSameOrigin(url) {
  return isDataUrl(url) || (!!url && url.startsWith('blob:'))
}

/**
 * 生成 Chrome Extension 图标 PNG 文件
 *
 * 使用纯 Node.js（zlib 原生模块）生成最小有效 PNG。
 * 图标为纯色方块 (#1a73e8 Google Blue)，无外部依赖。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons')

const SIZES = [16, 48, 128]

// 图标颜色 (R, G, B) — #1a73e8
const ICON_COLOR = [0x1a, 0x73, 0xe8]

/** 生成 PNG 文件二进制 */
function createPng(width, height, rgb) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)   // width
  ihdrData.writeUInt32BE(height, 4)  // height
  ihdrData[8] = 8                    // bit depth
  ihdrData[9] = 2                    // color type: RGB
  ihdrData[10] = 0                   // compression
  ihdrData[11] = 0                   // filter
  ihdrData[12] = 0                   // interlace
  const ihdr = makeChunk('IHDR', ihdrData)

  // IDAT chunk — raw pixel data with filter byte per row
  const rawRows = []
  for (let y = 0; y < height; y++) {
    rawRows.push(0) // filter byte: None
    for (let x = 0; x < width; x++) {
      rawRows.push(rgb[0], rgb[1], rgb[2])
    }
  }
  const compressed = deflateSync(Buffer.from(rawRows))
  const idat = makeChunk('IDAT', compressed)

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

/** 构建一个 PNG chunk */
function makeChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const typeB = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeB, data])

  // CRC32
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcData))

  return Buffer.concat([length, typeB, data, crc])
}

/** CRC32 校验 */
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ========== Main ==========

mkdirSync(OUT_DIR, { recursive: true })

for (const size of SIZES) {
  const png = createPng(size, size, ICON_COLOR)
  const outPath = resolve(OUT_DIR, `icon-${size}.png`)
  writeFileSync(outPath, png)
  console.log(`✔ icon-${size}.png  (${png.length} bytes) -> ${outPath}`)
}

console.log('\n所有图标已生成！')

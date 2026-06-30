/**
 * Widget IR - 中间表示层类型定义与校验工具
 *
 * 所有方向（F1/F2/F3）都先转换为中间表示（IR），再从 IR 生成目标格式。
 * 本文件只在 service worker 中用 import 引入。
 */

/**
 * @typedef {'Rectangle'|'Text'|'Image'|'Button'|'TextBox'|'Checkbox'
 *           |'RadioButton'|'Select'|'Line'|'Group'|'DynamicPanel'|'Unknown'} WidgetType
 */

/**
 * @typedef {Object} Bounds
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} FillStyle
 * @property {'solid'|'none'} type
 * @property {string} color   - #RRGGBB
 * @property {number} opacity - 0~1
 */

/**
 * @typedef {Object} BorderStyle
 * @property {string}  color
 * @property {number}  width  - px
 * @property {'solid'|'dashed'|'none'} style
 * @property {number}  radius - px
 */

/**
 * @typedef {Object} FontStyle
 * @property {string}   family
 * @property {number}   size       - px
 * @property {'normal'|'bold'} weight
 * @property {boolean}  italic
 * @property {boolean}  underline
 * @property {string}   color      - #RRGGBB
 * @property {'left'|'center'|'right'} align
 * @property {number}   lineHeight
 */

/**
 * @typedef {Object} ShadowStyle
 * @property {boolean} enabled
 * @property {number}  x
 * @property {number}  y
 * @property {number}  blur
 * @property {string}  color
 */

/**
 * @typedef {Object} InteractionAction
 * @property {'show'|'hide'|'toggle'|'setState'|'navigate'} type
 * @property {string}  [target] - Widget ID
 * @property {number}  [state]  - DynamicPanel 目标状态索引
 * @property {string}  [url]    - navigate 用
 */

/**
 * @typedef {Object} Interaction
 * @property {'onClick'|'onMouseEnter'|'onMouseLeave'|'onChange'} event
 * @property {InteractionAction[]} actions
 */

/**
 * @typedef {Object} WidgetStyle
 * @property {FillStyle}   [fill]
 * @property {BorderStyle} [border]
 * @property {FontStyle}   [font]
 * @property {ShadowStyle} [shadow]
 * @property {number}      [opacity]    - 0~1
 * @property {number}      [rotation]   - 度
 */

/**
 * Widget 节点 IR
 * @typedef {Object} WidgetIR
 * @property {string}       id
 * @property {WidgetType}   type
 * @property {Bounds}       bounds        - 相对父容器的绝对坐标
 * @property {WidgetStyle}  style
 * @property {string}       [content]     - Text / Button 的文本内容
 * @property {string}       [src]         - Image 的 base64 Data URL
 * @property {WidgetIR[][]} [states]      - DynamicPanel 的多状态
 * @property {WidgetIR[]}   [children]    - 子节点
 * @property {Interaction[]} [interactions]
 * @property {number}       [zIndex]
 * @property {string}       [name]        - 设计稿中的组件名
 * @property {string[]}     [warnings]    - 转换警告
 */

/**
 * 页面级 IR
 * @typedef {Object} PageIR
 * @property {string}     id
 * @property {string}     name
 * @property {number}     width
 * @property {number}     height
 * @property {string}     [bgColor]
 * @property {WidgetIR[]} widgets
 */

/**
 * 文档级 IR
 * @typedef {Object} DocumentIR
 * @property {string}   rpVersion
 * @property {PageIR[]} pages
 */

/** 校验 Widget 类型是否合法 */
export function isValidWidgetType(type) {
  const valid = ['Rectangle', 'Text', 'Image', 'Button', 'TextBox',
    'Checkbox', 'RadioButton', 'Select', 'Line', 'Group',
    'DynamicPanel', 'Unknown']
  return valid.includes(type)
}

/** 创建默认 Bounds */
export function defaultBounds(x = 0, y = 0, width = 100, height = 50) {
  return { x, y, width, height }
}

/** 创建默认 WidgetStyle */
export function defaultStyle() {
  return {
    fill: { type: 'none', color: '#ffffff', opacity: 1 },
    border: { color: '#cccccc', width: 0, style: 'none', radius: 0 },
    font: { family: 'Arial', size: 14, weight: 'normal', italic: false,
      underline: false, color: '#333333', align: 'left', lineHeight: 1.5 },
    shadow: { enabled: false, x: 0, y: 0, blur: 0, color: '#000000' },
    opacity: 1,
    rotation: 0
  }
}

/** 生成递增 ID */
let _idCounter = 0
export function generateId(prefix = 'w') {
  return `${prefix}${++_idCounter}`
}

/** 重置 ID 计数器 */
export function resetIdCounter() {
  _idCounter = 0
}

/** 创建空 DocumentIR */
export function createDocument(rpVersion = '9') {
  return { rpVersion, pages: [] }
}

/** 创建 PageIR */
export function createPage(name, width = 1440, height = 900) {
  return {
    id: generateId('p'),
    name,
    width,
    height,
    bgColor: '#ffffff',
    widgets: []
  }
}

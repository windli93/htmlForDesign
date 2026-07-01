const path = require('node:path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

// ── 需要生成 HTML 的页面（popup/offscreen 由 HTML 按序加载多个 chunk，没问题）
const htmlPageNames = ['popup', 'options', 'offscreen']

// ── 必须是自包含单文件的入口（Chrome 只加载单个 JS，不帮你加载其他 chunk）
const standaloneNames = ['background', 'content']

const pages = {}
htmlPageNames.forEach((name) => {
    const template = name === 'offscreen'
        ? `src/pages/${name}/index.html`
        : 'public/index.html'
    pages[name] = {
        entry:    `src/pages/${name}/${name}.js`,
        template,
        filename: `${name}.html`
    }
})

module.exports = {
    pages,
    filenameHashing: false,

    chainWebpack: (config) => {
        // ── 把 background/content 作为普通 webpack 入口加入
        //    不经过 pages / HtmlWebpackPlugin，只输出 js 文件
        standaloneNames.forEach((name) => {
            config.entry(name).add(`./src/pages/${name}/${name}.js`)
        })

        // ── 分包策略：background/content 不参与代码分割
        //    它们的所有依赖（jszip、fast-xml-parser、extract-raw-dom 等）
        //    都直接内联进各自的 bundle，形成自包含文件
        config.optimization.splitChunks({
            cacheGroups: {
                vendors: {
                    name:     'chunk-vendors',
                    test:     /[\\/]node_modules[\\/]/,
                    priority: -10,
                    chunks:   (chunk) => !standaloneNames.includes(chunk.name)  // ← 排除 background/content
                },
                common: {
                    name:               'chunk-common',
                    minChunks:          2,
                    priority:           -20,
                    chunks:             (chunk) => !standaloneNames.includes(chunk.name),  // ← 排除
                    reuseExistingChunk: true
                }
            }
        })

        // ── 禁用独立 runtime chunk
        //    将 webpack 模块注册器（__webpack_require__）内联进每个入口文件
        //    这样 background.js / content.js 不依赖外部 runtime.js 即可独立运行
        config.optimization.runtimeChunk(false)
    },

    configureWebpack: {
        plugins: [
            new CopyWebpackPlugin({
                patterns: [{
                    from: path.resolve('manifest.json'),
                    to:   `${path.resolve('dist')}/manifest.json`
                }]
            })
        ]
    }
}
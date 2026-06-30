const path = require('node:path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const pages = {}

const chromeName = ['popup', 'background', 'options', 'content', 'offscreen']

chromeName.forEach((name) => {
  const template = name === 'offscreen'
    ? `src/pages/${name}/index.html`
    : 'public/index.html'
  pages[name] = {
    entry: `src/pages/${name}/main.js`,
    template,
    filename: `${name}.html`
  }
})

module.exports = {
  pages,
  filenameHashing: false,
  configureWebpack: {
    plugins: [
      new CopyWebpackPlugin({
        patterns: [{
          from: path.resolve('manifest.json'),
          to: `${path.resolve('dist')}/manifest.json`
        }]
      })]
  }
}

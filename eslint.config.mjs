import pluginVue from 'eslint-plugin-vue'
import standard from '@vue/eslint-config-standard'

export default [
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  {
    files: ['**/*.{js,mjs,cjs,vue}']
  },
  ...pluginVue.configs['flat/essential'],
  ...standard
]

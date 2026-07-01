<template>
  <main class="popup-page">
    <!-- Tab 切换 -->
    <div class="tabs">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</div>
    </div>

    <!-- F1: HTML → RP -->
    <div v-show="activeTab === 't1'" class="panel">
      <div class="file-drop" @click="triggerFilePick('html')" @dragover.prevent @drop.prevent="onHtmlDrop">
        <template v-if="htmlFiles.length === 0">点击或拖入多个 .html 文件</template>
        <template v-else>
          <div v-for="f in htmlFiles" :key="f.name" class="file-item">{{ f.name }}</div>
        </template>
      </div>
      <input ref="htmlInput" type="file" multiple accept=".html,.htm" hidden @change="onHtmlPick">
      <button
        class="btn-primary"
        :disabled="htmlFiles.length === 0 || converting"
        @click="convertHtmlToRp"
      >开始转换 → 下载 .rp</button>
      <div v-if="progress.t1" class="progress">{{ progress.t1 }}</div>
    </div>

    <!-- F2: 页面 → RP -->
    <div v-show="activeTab === 't2'" class="panel">
      <p class="desc">将当前激活标签页的完整 DOM 转换为 Axure RP 文件</p>
      <button
        class="btn-primary"
        :disabled="converting"
        @click="capturePageToRp"
      >抓取当前页面 → .rp</button>
      <div v-if="progress.t2" class="progress">{{ progress.t2 }}</div>
    </div>

    <!-- F3: RP → HTML -->
    <div v-show="activeTab === 't3'" class="panel">
      <div class="file-drop" @click="triggerFilePick('rp')" @dragover.prevent @drop.prevent="onRpDrop">
        <template v-if="!rpFile">点击或拖入 .rp 文件</template>
        <template v-else>
          <div class="file-item">{{ rpFile.name }}</div>
        </template>
      </div>
      <input ref="rpInput" type="file" accept=".rp" hidden @change="onRpPick">
      <button
        class="btn-primary"
        :disabled="!rpFile || converting"
        @click="parseRpToHtml"
      >解析 → 下载 HTML.zip</button>
      <div v-if="progress.t3" class="progress">{{ progress.t3 }}</div>
    </div>
  </main>
</template>

<script>
const MSG = {
  PING: 'PING',
  CAPTURE_TAB: 'CAPTURE_TAB',
  CONVERT_HTML_FILES: 'CONVERT_HTML_FILES',
  PARSE_RP: 'PARSE_RP',
  PROGRESS: 'PROGRESS',
  DONE: 'DONE',
  ERROR: 'ERROR'
}

export default {
  name: 'PopupPage',

  data () {
    return {
      activeTab: 't1',
      htmlFiles: [],
      rpFile: null,
      converting: false,
      progress: { t1: '', t2: '', t3: '' }
    }
  },

  computed: {
    tabs () {
      return [
        { id: 't1', label: 'HTML→RP' },
        { id: 't2', label: '页面→RP' },
        { id: 't3', label: 'RP→HTML' }
      ]
    }
  },

  created () {
    // 监听来自 service worker 的消息
    chrome.runtime.onMessage.addListener(this.onSwMessage)
  },

  methods: {
    // ========== 文件选择 ==========

    triggerFilePick (type) {
      if (this.converting) return
      if (type === 'html') {
        this.$refs.htmlInput.click()
      } else {
        this.$refs.rpInput.click()
      }
    },

    onHtmlPick (e) {
      this.htmlFiles = Array.from(e.target.files)
    },

    onRpPick (e) {
      this.rpFile = e.target.files[0] || null
    },

    onHtmlDrop (e) {
      const files = Array.from(e.dataTransfer.files).filter(f =>
        f.name.endsWith('.html') || f.name.endsWith('.htm')
      )
      if (files.length > 0) this.htmlFiles = files
    },

    onRpDrop (e) {
      const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.rp'))
      if (file) this.rpFile = file
    },

    // ========== SW 探活 ==========

    async ensureSwReady (maxRetries = 5, delayMs = 150) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          await chrome.runtime.sendMessage({ type: MSG.PING })
          return // SW 已就绪
        } catch {
          if (i < maxRetries - 1) {
            await new Promise(r => setTimeout(r, delayMs))
          }
        }
      }
      throw new Error('无法连接到后台 Service Worker，请在 chrome://extensions 重载扩展后重试')
    },

    // ========== F1: HTML → RP ==========

    async convertHtmlToRp () {
      if (this.htmlFiles.length === 0 || this.converting) return
      this.converting = true
      this.progress.t1 = '正在连接后台服务...'

      try {
        await this.ensureSwReady()

        const files = await Promise.all(this.htmlFiles.map(async (f) => ({
          name: f.name,
          html: await f.text()
        })))

        this.progress.t1 = '准备中...'
        this.setProgressListener('t1')

        await chrome.runtime.sendMessage({
          type: MSG.CONVERT_HTML_FILES,
          payload: { files }
        })
      } catch (err) {
        this.progress.t1 = '错误: ' + (err?.message || err)
        this.converting = false
      }
    },

    // ========== F2: 页面捕获 ==========

    async capturePageToRp () {
      if (this.converting) return
      this.converting = true
      this.progress.t2 = '正在连接后台服务...'

      try {
        await this.ensureSwReady()

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

        this.setProgressListener('t2')
        this.progress.t2 = '正在注入 DOM 抓取脚本...'

        await chrome.runtime.sendMessage({
          type: MSG.CAPTURE_TAB,
          payload: { tabId: tab.id }
        })
      } catch (err) {
        this.progress.t2 = '错误: ' + (err?.message || err)
        this.converting = false
      }
    },

    // ========== F3: RP → HTML ==========

    async parseRpToHtml () {
      if (!this.rpFile || this.converting) return
      this.converting = true
      this.progress.t3 = '正在连接后台服务...'

      try {
        await this.ensureSwReady()

        this.progress.t3 = '读取文件中...'
        const arrayBuffer = await this.rpFile.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        let binaryStr = ''
        for (let i = 0; i < uint8Array.length; i++) {
          binaryStr += String.fromCharCode(uint8Array[i])
        }
        const rpBase64 = btoa(binaryStr)

        this.setProgressListener('t3')

        await chrome.runtime.sendMessage({
          type: MSG.PARSE_RP,
          payload: { rpBase64, fileName: this.rpFile.name }
        })
      } catch (err) {
        this.progress.t3 = '错误: ' + (err?.message || err)
        this.converting = false
      }
    },

    // ========== 消息处理 ==========

    setProgressListener (tab) {
      // 单次监听 PROGRESS/DONE/ERROR，存入 this.progress[tab]
      this._progressTab = tab
    },

    onSwMessage (msg) {
      const tab = this._progressTab || this.activeTab

      switch (msg.type) {
        case MSG.PROGRESS:
          this.progress[tab] = msg.payload.message
          break

        case MSG.DONE:
          this.progress[tab] = msg.payload.message || '完成！'
          this.converting = false
          this.htmlFiles = []
          this.rpFile = null
          break

        case MSG.ERROR:
          this.progress[tab] = '错误: ' + (msg.payload?.message || '未知错误')
          this.converting = false
          break
      }
    }
  }
}
</script>

<style scoped>
.popup-page {
  width: 380px;
  min-height: 320px;
  padding: 16px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1f2937;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.tab {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  text-align: center;
  user-select: none;
}

.tab.active {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}

.panel {
  padding: 0;
}

.file-drop {
  border: 2px dashed #ddd;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  color: #999;
  cursor: pointer;
  margin-bottom: 12px;
  font-size: 13px;
}

.file-drop:hover {
  border-color: #1a73e8;
  color: #1a73e8;
}

.file-item {
  font-size: 12px;
  color: #333;
  padding: 2px 0;
}

.desc {
  font-size: 13px;
  color: #555;
  margin-bottom: 12px;
  line-height: 1.5;
}

.btn-primary {
  width: 100%;
  padding: 10px;
  background: #1a73e8;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-primary:not(:disabled):hover {
  background: #1557b0;
}

.progress {
  margin-top: 12px;
  font-size: 12px;
  color: #666;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}
</style>

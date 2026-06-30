<template>
  <main class="popup-page">
    <p class="eyebrow">Vue 3 Chrome Extension</p>
    <h1>Extension Popup</h1>
    <p>Start building your browser action UI here.</p>
  </main>
</template>

<script>
export default {
  name: 'PopupPage'
}
</script>

<style scoped>
.popup-page {
  width: 240px;
  padding: 16px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1f2937;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #42b983;
}

h1 {
  margin: 0 0 8px;
  font-size: 18px;
}

p {
  margin: 0;
  line-height: 1.5;
}
</style>

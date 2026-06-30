<template>
  <main class="options-page">
    <section class="panel">
      <p class="eyebrow">Vue 3 Chrome Extension</p>
      <h1>Extension Options</h1>
      <p>Use this page for settings that should open outside the popup.</p>
    </section>
  </main>
</template>

<script>
export default {
  name: 'OptionsPage'
}
</script>

<style scoped>
.options-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1f2937;
  background: #f8fafc;
}

.panel {
  width: min(480px, calc(100vw - 32px));
  padding: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 20px 45px rgb(15 23 42 / 8%);
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
  font-size: 28px;
}

p {
  margin: 0;
  line-height: 1.6;
}
</style>

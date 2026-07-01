## 1. Service Worker fixes (src/pages/background/background.js)

- [x] 1.1 Add `PING` case to message router: `case 'PING': sendResponse({ pong: true }); return false`
- [x] 1.2 Add `sendResponse({ started: true })` to `CAPTURE_TAB` case after `handleCaptureTab(msg.payload?.tabId)`
- [x] 1.3 Add `sendResponse({ started: true })` to `CONVERT_HTML_FILES` case after `handleConvertHtmlFiles(msg.payload)`
- [x] 1.4 Add `sendResponse({ started: true })` to `PARSE_RP` case after `handleParseRp(msg.payload)`
- [x] 1.5 Change `handleCaptureTab` to read `tabId` from parameter (passed as `msg.payload?.tabId`) instead of `sender.tab?.id`
- [x] 1.6 Fix `handleCaptureTab` fallback query: change `currentWindow: true` to `lastFocusedWindow: true`
- [x] 1.7 Add early return in `handleCaptureTab` when no tabId found: `sendErrorToPopup('无法获取当前标签页 ID')`
- [x] 1.8 Fix F3 image extraction: replace `zip.folder('resources/images').files` with `Object.keys(zip.files).filter(path => path.startsWith('resources/images/') && !zip.files[path].dir)`
- [x] 1.9 Update image path extraction to use `imgPath.slice('resources/images/'.length)` for filename
- [x] 1.10 Remove unused `tabId` parameter from `processImage` signature and its caller in `processCrossOriginImages`

## 2. Popup UI fixes (src/pages/popup/popup.vue)

- [x] 2.1 Add `ensureSwReady()` method with PING retry: 5 attempts, 150ms delay, throws error on exhaustion
- [x] 2.2 Add `ensureSwReady()` call at start of `convertHtmlToRp()` (F1), set progress to "正在连接后台服务..."
- [x] 2.3 Refactor `capturePageToRp()` (F2): call `ensureSwReady()`, query `chrome.tabs.query({ active: true, currentWindow: true })`, pass `tabId` in payload
- [x] 2.4 Add `ensureSwReady()` call at start of `parseRpToHtml()` (F3), set progress to "正在连接后台服务..."
- [x] 2.5 Add `MSG` constant entry for `PING` type

## 3. Content script fixes (src/pages/content/content.js)

- [x] 3.1 Add `send()` helper function that wraps `chrome.runtime.sendMessage` with retry: 3 total attempts, 200ms delay
- [x] 3.2 Replace direct `chrome.runtime.sendMessage` call for `CAPTURE_RESULT` with `send({ type: 'CAPTURE_RESULT', payload: result })`
- [x] 3.3 Replace direct `chrome.runtime.sendMessage` call for `ERROR` with `send({ type: 'ERROR', payload: ... })`

## 4. Offscreen document fixes (src/pages/offscreen/offscreen.js)

- [x] 4.1 Save timeout ID: `const timeoutId = setTimeout(() => reject(...), 30000)` instead of bare `setTimeout`
- [x] 4.2 Add `clearTimeout(timeoutId)` at the beginning of `iframe.onload` handler (before try block)
- [x] 4.3 Add `clearTimeout(timeoutId)` at the beginning of `iframe.onerror` handler

## 5. RP parser fixes (src/lib/core/rp-parser.js)

- [x] 5.1 Add `argbToStyle(argbHex)` helper function: extract alpha from first 2 hex chars → opacity (0-1), rest → `#RRGGBB`
- [x] 5.2 Update fill color parsing: use `argbToStyle()` instead of `.slice(2)`, set both `color` and `opacity`
- [x] 5.3 Update border color parsing: use `argbToStyle()` for color extraction
- [x] 5.4 Update font color parsing: use `argbToStyle()` for color extraction

## 6. Build verification

- [x] 6.1 Run `npm run build` to verify all files compile without errors
- [x] 6.2 Confirm `dist/js/content.js` includes the retry-enabled send function
- [x] 6.3 Confirm `dist/js/background.js` includes PING handler and sendResponse acks
- [x] 6.4 Confirm `dist/js/offscreen.js` includes clearTimeout calls

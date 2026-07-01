## Context

The plugin is built as a Chrome MV3 extension using Vue CLI (webpack) with 5 entry points: popup (Vue 3 SFC), background (service worker), content script, offscreen document, and options (placeholder). It converts between HTML and Axure RP files via a shared Widget IR layer.

Currently, all three features (F1: HTML→RP, F2: page→RP, F3: RP→HTML) suffer from connection failures and data corruption bugs. The bugs were identified through testing and documented in `docs/html_bug_fix.md`.

## Goals / Non-Goals

**Goals:**
- Eliminate all "Could not establish connection" errors across F1/F2/F3
- Handle MV3 Service Worker cold-start race condition at popup open time
- Fix tab ID resolution to work reliably from popup context
- Ensure content script failures don't permanently lock the UI
- Fix F3 image extraction to correctly filter resource files
- Fix ARGB alpha channel parsing for accurate color opacity in RP→HTML conversion
- Clean up offscreen timeout timer leak

**Non-Goals:**
- Changing the overall architecture or build system
- Adding new features or widget type support
- Refactoring code beyond what's needed for the fixes
- Implementing `captureVisibleTab` screenshot fallback (not in scope)

## Decisions

### D1: `sendResponse({ started: true })` as early ack pattern
- **Choice**: Each popup-initiated message handler calls `sendResponse({ started: true })` immediately, then continues async work via broadcast messages (`PROGRESS`/`DONE`/`ERROR`)
- **Rationale**: In MV3, `chrome.runtime.sendMessage` from popup returns a Promise that resolves only when the handler calls `sendResponse`. If the handler `return false` without calling `sendResponse`, Chrome closes the port and the Promise rejects. The existing code already broadcasts progress to popup — this just adds the missing ack.
- **Alternative**: Use `return true` to keep the port open for async response. Rejected because it would block popup's Promise indefinitely and conflict with the existing broadcast pattern.

### D2: PING-based SW readiness probe
- **Choice**: Popup sends `PING` messages with retry (5 attempts, 150ms delay) before any business message
- **Rationale**: MV3 SW gets recycled after ~30s idle. When popup opens, SW may still be initializing. A lightweight PING probe detects this, retries until SW is ready. Simpler than alternatives like `chrome.runtime.connect` long-lived port.
- **Alternative**: Use `chrome.runtime.connect` with `onConnect` for persistent channel. Rejected — adds complexity for a startup-only problem.

### D3: Popup-side tabId resolution
- **Choice**: Popup uses `chrome.tabs.query({ active: true, currentWindow: true })` then passes `tabId` in message payload. SW reads from payload, not `sender.tab?.id`
- **Rationale**: When popup sends a message, `sender.tab` is undefined because popup is not a tab. The SW fallback `chrome.tabs.query({ currentWindow: true })` is unreliable because SW has no window. Popup is the correct context to find the active tab, and `currentWindow` is well-defined there.
- **Alternative**: Use `sender.tab?.id` when content script sends CAPTURE_RESULT (since content script IS in a tab). Already done for that case. This decision is only about CAPTURE_TAB from popup.

### D4: Zip file filtering by path prefix
- **Choice**: Filter `Object.keys(zip.files)` with `path.startsWith('resources/images/')` instead of `zip.folder('resources/images').files`
- **Rationale**: JSZip v3's `zip.folder()` returns a new instance whose `.files` points to the root's files object — it does NOT scope to just the folder contents. Using path prefix filtering avoids this JSZip API quirk.
- **Alternative**: Iterate `zip.folder('').file(/^resources\/images\//)`. Equivalent but path prefix filtering is more explicit.

### D5: ARGB alpha extraction
- **Choice**: New `argbToStyle(argbHex)` function extracts alpha from first 2 hex chars of ARGB, maps to CSS opacity (0–1), rest to CSS #RRGGBB
- **Rationale**: Axure uses 8-char ARGB hex. Current code does `.slice(2)` which drops alpha entirely. The helper centralizes this conversion for all three color contexts (fill, border, font).

## Risks / Trade-offs

- **PING retry delay (750ms worst case)**: Adds a brief delay on cold-start popup open. Mitigation: only fires once on popup open; subsequent messages skip it. User sees "正在连接后台服务..." progress during wait.
- **sendResponse ack means popup Promise resolves BEFORE work completes**: Popup already doesn't rely on the Promise resolution — it uses broadcast PROGRESS/DONE/ERROR. The ack just prevents the Promise rejection.
- **Content script retry (200ms x 2 = 400ms)**: Adds minor delay on SW termination edge case. Mitigation: only happens when first attempt fails, which is rare.

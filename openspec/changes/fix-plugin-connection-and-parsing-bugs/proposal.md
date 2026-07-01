## Why

The plugin has critical connection bugs that cause "Could not establish connection" errors across all three features (F1/F2/F3), plus several parsing bugs that silently corrupt data. These issues prevent the plugin from working at all — users get immediate errors on any operation, and when operations do run, they produce incorrect results. Fixing these is urgent because the core functionality is completely broken.

## What Changes

- **Bug 1** (P0): Add `sendResponse({ started: true })` to `CAPTURE_TAB`, `CONVERT_HTML_FILES`, and `PARSE_RP` message handlers in the service worker to prevent premature port closure
- **Bug 2** (P0): Add `ensureSwReady()` ping-retry in popup before sending messages, with corresponding `PING` handler in service worker, to handle MV3 SW cold-start race condition
- **Bug 3** (P0): Move `tabId` resolution from service worker to popup (popup queries tabs and passes `tabId` in payload), and fix fallback query to use `lastFocusedWindow` in SW context
- **Bug 4** (P1): Add retry-with-catch wrapper to `sendMessage` calls in content script to prevent permanent UI lockdown on SW termination
- **Bug 5** (P1): Fix F3 image extraction to filter on `resources/images/` path prefix instead of using broken `zip.folder().files`
- **Bug 6** (P1): Ensure offscreen HTML loads its script bundle (already handled by webpack multi-entry config in `vue.config.js`; verified it works)
- **Bug 7** (P2): Add `clearTimeout` in offscreen.js onload/onerror to clean up timeout timer
- **Bug 8** (P2): Extract ARGB alpha channel correctly in rp-parser.js (`argbToStyle` helper) and map to CSS opacity
- **Dead param cleanup**: Remove unused `tabId` parameter from `processImage`

## Capabilities

### New Capabilities
- `sw-connection-resilience`: Service worker message handlers that always acknowledge messages, preventing premature port closure, and popup-side SW readiness probing with retry
- `tab-discovery-reliability`: Reliable active tab ID resolution — popup queries tabs and passes tabId in payload, SW uses `lastFocusedWindow` for fallback
- `content-script-resilience`: Content script message sending with automatic retry on failure
- `rp-parsing-correctness`: Correct ARGB alpha channel extraction in RP parser, and correct resource file filtering in RP ZIP parsing

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Files modified**: `src/pages/background/main.js`, `src/pages/popup/Index.vue`, `src/pages/content/main.js`, `src/pages/offscreen/main.js`, `src/lib/core/rp-parser.js`
- **No new dependencies**: All fixes use existing APIs
- **No breaking changes**: All message types remain the same; `sendResponse` ack is additive

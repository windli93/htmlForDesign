## ADDED Requirements

### Requirement: Popup resolves active tab ID and passes it in message payload
The popup SHALL query `chrome.tabs.query({ active: true, currentWindow: true })` to resolve the active tab ID and include it in the `CAPTURE_TAB` message payload as `{ tabId }`.

#### Scenario: Popup sends tabId in payload
- **WHEN** user triggers F2 capture from popup
- **THEN** the popup MUST call `chrome.tabs.query({ active: true, currentWindow: true })`, extract the tab's `id`, and send the message `{ type: 'CAPTURE_TAB', payload: { tabId: <id> } }`

### Requirement: Service Worker reads tabId from message payload
The service worker's `handleCaptureTab` function SHALL accept `tabId` from the message payload (`msg.payload?.tabId`) rather than from `sender.tab?.id`.

#### Scenario: SW uses payload tabId
- **WHEN** service worker receives `{ type: 'CAPTURE_TAB', payload: { tabId: 42 } }`
- **THEN** `handleCaptureTab` MUST use value `42` as the target tab ID

#### Scenario: SW fallback when payload tabId is missing
- **WHEN** service worker receives `CAPTURE_TAB` with no `payload.tabId`
- **THEN** `handleCaptureTab` MUST fall back to `chrome.tabs.query({ active: true, lastFocusedWindow: true })` to find the active tab

#### Scenario: SW reports error when no tab found
- **WHEN** service worker's `handleCaptureTab` cannot find any active tab (both payload tabId missing and fallback query returns empty)
- **THEN** the service worker MUST send `ERROR` notification to popup with message "无法获取当前标签页 ID"

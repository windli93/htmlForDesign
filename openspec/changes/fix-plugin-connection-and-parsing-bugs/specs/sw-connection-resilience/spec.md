## ADDED Requirements

### Requirement: Service Worker acknowledges popup-initiated messages
The service worker SHALL immediately call `sendResponse` with an acknowledgement (`{ started: true }`) for every popup-initiated message type (`CAPTURE_TAB`, `CONVERT_HTML_FILES`, `PARSE_RP`) before beginning asynchronous processing.

#### Scenario: F2 capture tab message ack
- **WHEN** popup sends `{ type: 'CAPTURE_TAB', payload: { tabId } }` to the service worker
- **THEN** the service worker MUST call `sendResponse({ started: true })` and start async processing, and popup's Promise MUST resolve without rejection

#### Scenario: F1 convert HTML files message ack
- **WHEN** popup sends `{ type: 'CONVERT_HTML_FILES', payload: { files } }` to the service worker
- **THEN** the service worker MUST call `sendResponse({ started: true })` and start async processing, and popup's Promise MUST resolve without rejection

#### Scenario: F3 parse RP message ack
- **WHEN** popup sends `{ type: 'PARSE_RP', payload: { rpBase64, fileName } }` to the service worker
- **THEN** the service worker MUST call `sendResponse({ started: true })` and start async processing, and popup's Promise MUST resolve without rejection

### Requirement: Service Worker responds to PING health checks
The service worker SHALL handle `PING` messages by immediately calling `sendResponse({ pong: true })`.

#### Scenario: SW responds to PING
- **WHEN** any extension context sends `{ type: 'PING' }` to the service worker
- **THEN** the service worker MUST respond with `{ pong: true }` within 10ms

### Requirement: Popup probes Service Worker readiness before sending messages
The popup SHALL probe the service worker's readiness by sending `PING` messages with retry logic before dispatching any business message (`CAPTURE_TAB`, `CONVERT_HTML_FILES`, `PARSE_RP`).

#### Scenario: SW ready on first PING
- **WHEN** popup calls `ensureSwReady()` and the service worker responds to the first PING
- **THEN** the method MUST return immediately without error, and the popup MUST proceed to send the business message

#### Scenario: SW starts up during retries
- **WHEN** popup calls `ensureSwReady()` and the first 2 PING attempts fail (SW still initializing), then the 3rd succeeds
- **THEN** the method MUST retry up to 5 times with 150ms delay between attempts, and return successfully after the 3rd successful PING

#### Scenario: SW unreachable after all retries
- **WHEN** popup calls `ensureSwReady()` and all 5 PING attempts fail
- **THEN** the method MUST throw an error with message indicating SW is unreachable, and the popup MUST display the error and reset the converting lock

### Requirement: Popup shows connection status during SW probing
The popup SHALL display a user-visible progress message ("正在连接后台服务...") while probing the service worker.

#### Scenario: Connection progress display
- **WHEN** popup begins `ensureSwReady()` probing
- **THEN** the popup MUST set the progress text of the active tab to "正在连接后台服务..."

## ADDED Requirements

### Requirement: User can capture current browser page
The system SHALL allow users to capture the DOM of the currently active browser tab and convert it to an Axure RP file.

#### Scenario: Capture current tab
- **WHEN** user clicks "抓取当前页面 → .rp" button in the "页面→RP" tab
- **THEN** the system SHALL inject a content script into the current active tab via `chrome.scripting.executeScript`
- **WHEN** the content script runs in the page context
- **THEN** it SHALL traverse the DOM tree and extract element positions, styles, text, and images

#### Scenario: Content script captures full DOM
- **WHEN** the content script traverses the DOM
- **THEN** it SHALL filter invisible elements (zero size, display:none, hidden, opacity:0)
- **THEN** it SHALL use `getComputedStyle` and `getBoundingClientRect` for accurate layout data
- **THEN** it SHALL collect image sources from `<img>` tags and CSS `background-image`
- **THEN** it SHALL serialize the result as a CaptureResult JSON

#### Scenario: Send captured data to service worker
- **WHEN** the content script finishes DOM traversal
- **THEN** it SHALL send the CaptureResult to the service worker via `chrome.runtime.sendMessage`

### Requirement: System handles cross-origin images
The system SHALL attempt to fetch cross-origin images and fall back to screenshot cropping if CORS fails.

#### Scenario: Fetch cross-origin image
- **WHEN** an image URL is cross-origin
- **THEN** the service worker SHALL attempt to `fetch()` the image
- **WHEN** the fetch succeeds
- **THEN** the image SHALL be converted to base64

#### Scenario: Fall back to screenshot
- **WHEN** fetching a cross-origin image fails (no CORS)
- **THEN** the system SHALL capture a full-page screenshot via `chrome.tabs.captureVisibleTab`
- **THEN** the system SHALL crop the image using the element's bounding rect

### Requirement: System converts CaptureResult to RP file
The system SHALL convert the captured DOM data into an RP file with proper Widget IR conversion.

#### Scenario: DOM to RP conversion
- **WHEN** the service worker receives a CaptureResult
- **THEN** it SHALL convert it to a PageIR via dom-capture.js
- **THEN** it SHALL convert the PageIR to RP XML via rp-builder.js
- **THEN** it SHALL package the result as a .rp ZIP file and trigger download

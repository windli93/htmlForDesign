## ADDED Requirements

### Requirement: Widget IR is the shared intermediate representation
The system SHALL use Widget IR as the common data format between HTML and RP conversions.

#### Scenario: Widget IR types are defined
- **WHEN** any conversion process runs
- **THEN** the system SHALL use the following IR types:
  - `DocumentIR` - contains `rpVersion` and list of `PageIR`
  - `PageIR` - contains page metadata (`id`, `name`, `width`, `height`, `bgColor`) and `WidgetIR[]`
  - `WidgetIR` - contains `id`, `type`, `bounds`, `style`, content, and children
- **THEN** supported WidgetType values SHALL be: Rectangle, Text, Image, Button, TextBox, Checkbox, RadioButton, Select, Line, Group, DynamicPanel, Unknown

#### Scenario: IR carries warnings for unsupported features
- **WHEN** a conversion encounters an unsupported feature
- **THEN** the system SHALL record a warning in the WidgetIR's `warnings` array
- **THEN** the system SHALL continue processing without interrupting the overall flow

### Requirement: Shared DOM extraction logic
The system SHALL have a shared `extract-raw-dom.js` file used by both the content script (F2) and offscreen document (F1) for DOM extraction.

#### Scenario: Shared extraction function
- **WHEN** either content script or offscreen document needs to extract DOM
- **THEN** they SHALL both call `extractCaptureResult(rootEl)` from the same shared file
- **THEN** the shared file SHALL NOT use `import`/`export` statements
- **THEN** the shared file SHALL use plain function declarations

### Requirement: Color conversion utilities
The system SHALL provide color conversion utilities for CSS color to Axure ARGB hex format and back.

#### Scenario: CSS color to ARGB
- **WHEN** a CSS color like `#3366cc` or `rgba(51,102,204,0.5)` is provided
- **THEN** `colorToArgb()` SHALL produce ARGB hex like `ff3366cc` or `803366cc`

#### Scenario: ARGB to CSS hex
- **WHEN** an ARGB hex like `ffffffff` is provided
- **THEN** `argbToHex()` SHALL produce `#ffffff`

### Requirement: Image utility functions
The system SHALL provide image handling utilities for base64 encoding/decoding and MIME type detection.

#### Scenario: Blob to base64
- **WHEN** a Blob is fetched from an image URL
- **THEN** the system SHALL convert it to a base64 data URL

### Requirement: Service worker routes messages between components
The service worker SHALL act as the central message hub, routing requests between popup, content scripts, and offscreen document.

#### Scenario: Message routing
- **WHEN** popup sends a `CAPTURE_TAB` message
- **THEN** the service worker SHALL execute the content script and wait for capture result
- **WHEN** popup sends a `CONVERT_HTML_FILES` message
- **THEN** the service worker SHALL coordinate offscreen document rendering and IR conversion
- **WHEN** popup sends a `PARSE_RP` message
- **THEN** the service worker SHALL parse the RP file and generate HTML ZIP
- **WHEN** any conversion completes
- **THEN** the service worker SHALL send a `DONE` message back to popup with download URL
- **WHEN** any error occurs
- **THEN** the service worker SHALL send an `ERROR` message back to popup

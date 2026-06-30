## ADDED Requirements

### Requirement: User can upload multiple HTML files
The system SHALL allow users to select and upload one or more .html files via the popup UI.

#### Scenario: Upload multiple HTML files
- **WHEN** user clicks the file drop zone in the "HTML→RP" tab
- **THEN** a file picker opens accepting .html and .htm files
- **WHEN** user selects multiple .html files
- **THEN** the file names SHALL be displayed in the file list

#### Scenario: Drag and drop HTML files
- **WHEN** user drags .html files onto the drop zone
- **THEN** the files SHALL be accepted and displayed in the file list

### Requirement: System converts HTML files to RP via Offscreen Document
The system SHALL use Chrome Offscreen Document API to render uploaded HTML files in a sandboxed iframe and extract DOM structure for RP conversion.

#### Scenario: Create offscreen document
- **WHEN** user clicks "开始转换 → 下载 .rp" button
- **THEN** the system SHALL create an offscreen document if one does not exist
- **WHEN** offscreen document is ready
- **THEN** the system SHALL send each HTML file to the offscreen document for rendering

#### Scenario: Render HTML in sandboxed iframe
- **WHEN** offscreen document receives an HTML file
- **THEN** it SHALL set `iframe.srcdoc` with the HTML content
- **THEN** the iframe SHALL have `sandbox="allow-same-origin"` attribute
- **THEN** it SHALL wait for the iframe load event
- **THEN** it SHALL extract the DOM structure using `extractCaptureResult()`

#### Scenario: Preprocess HTML before rendering
- **WHEN** HTML files contain relative image paths
- **THEN** the system SHALL convert relative paths to absolute URLs
- **WHEN** HTML files contain external stylesheets
- **THEN** the system SHALL attempt to inline them as `<style>` tags

### Requirement: System generates multi-page RP file
The system SHALL combine all processed HTML files into a single multi-page .rp file and trigger download.

#### Scenario: Generate and download RP file
- **WHEN** all HTML files are processed
- **THEN** the system SHALL combine page IRs into a DocumentIR
- **THEN** the system SHALL build the RP XML
- **THEN** the system SHALL package into a .rp ZIP file
- **THEN** the system SHALL trigger download via `chrome.downloads.download()`

### Requirement: Progress is displayed during conversion
The system SHALL show conversion progress for each file during F1 processing.

#### Scenario: Progress updates
- **WHEN** each file is being processed
- **THEN** the popup SHALL show a progress message (e.g., "正在处理 2/3: b.html")
- **WHEN** conversion is complete
- **THEN** the popup SHALL show a completion message and trigger download

## ADDED Requirements

### Requirement: User can upload an .rp file
The system SHALL allow users to select and upload a single .rp file via the popup UI.

#### Scenario: Upload RP file
- **WHEN** user clicks the file drop zone in the "RP→HTML" tab
- **THEN** a file picker opens accepting .rp files
- **WHEN** user selects an .rp file
- **THEN** the file name SHALL be displayed in the file list

### Requirement: System parses .rp file
The system SHALL use JSZip to unpack the .rp file and fast-xml-parser to parse document.xml into a DocumentIR.

#### Scenario: Unpack RP file
- **WHEN** user clicks "解析 → 下载 HTML.zip" button
- **THEN** the system SHALL read the .rp file as an ArrayBuffer
- **THEN** the system SHALL use JSZip to unpack the ZIP contents
- **THEN** the system SHALL extract `document.xml` from the ZIP

#### Scenario: Parse RP XML
- **WHEN** document.xml is extracted
- **THEN** the system SHALL use fast-xml-parser to parse the XML
- **THEN** the system SHALL extract the sitemap (page list)
- **THEN** the system SHALL extract widget objects for each page
- **THEN** the system SHALL convert extracted data into DocumentIR / PageIR / WidgetIR structures

#### Scenario: Handle RP images
- **WHEN** the .rp file contains image resources
- **THEN** the system SHALL extract images from `resources/images/` in the ZIP
- **THEN** the system SHALL inline images as base64 data URLs in the output HTML

### Requirement: System generates HTML files from parsed RP
The system SHALL convert the DocumentIR into multiple HTML files and package them as a ZIP for download.

#### Scenario: Generate HTML files
- **WHEN** the DocumentIR is ready
- **THEN** the system SHALL generate one HTML file per page using html-builder.js
- **THEN** each HTML file SHALL use absolute positioning (position: absolute) to match the RP layout
- **THEN** the system SHALL package all HTML files into a ZIP archive

#### Scenario: Download HTML ZIP
- **WHEN** the ZIP is ready
- **THEN** the system SHALL trigger download via `chrome.downloads.download()`
- **THEN** the download filename SHALL be the original .rp filename with `.html.zip` suffix

### Requirement: Widget types are supported in RP→HTML conversion
The system SHALL support converting the following RP widget types to HTML: Rectangle, Text, Image, Button, TextBox, Checkbox, Select, DynamicPanel.

#### Scenario: Convert Rectangle widget
- **WHEN** an RP Rectangle widget is encountered
- **THEN** the system SHALL generate a `<div>` with matching position, size, background, border, and shadow styles

#### Scenario: Convert Text widget
- **WHEN** an RP Text widget is encountered
- **THEN** the system SHALL generate a `<div>` with the text content, font family, font size, font color, and alignment

#### Scenario: Convert Image widget
- **WHEN** an RP Image widget is encountered
- **THEN** the system SHALL generate an `<img>` element with the base64 data URL

#### Scenario: Convert DynamicPanel widget
- **WHEN** a DynamicPanel widget is encountered
- **THEN** the system SHALL render the default state's widgets
- **THEN** other states SHALL be rendered but hidden (display: none)

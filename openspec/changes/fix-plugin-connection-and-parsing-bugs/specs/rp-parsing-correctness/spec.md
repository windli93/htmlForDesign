## ADDED Requirements

### Requirement: RP parser extracts ARGB alpha channel as CSS opacity
The `rp-parser.js` module SHALL extract the alpha channel from Axure ARGB hex color values (e.g., `80ffffff`) and set it as the `opacity` field on the corresponding style object, while converting the remaining RRGGBB portion to a CSS hex color.

#### Scenario: Opaque white ARGB
- **WHEN** parser encounters `fillColor.argb = "ffffffff"` (fully opaque white)
- **THEN** the resulting `fill.color` MUST be `#ffffff` and `fill.opacity` MUST be `1`

#### Scenario: Semi-transparent ARGB
- **WHEN** parser encounters `fillColor.argb = "80ffffff"` (50% transparent white)
- **THEN** the resulting `fill.color` MUST be `#ffffff` and `fill.opacity` MUST be `0.50`

#### Scenario: Transparent ARGB
- **WHEN** parser encounters `fillColor.argb = "00000000"` (fully transparent)
- **THEN** the resulting `fill.color` MUST be `#000000` and `fill.opacity` MUST be `0`

#### Scenario: ARGB extraction applies to font colors
- **WHEN** parser encounters `fontColor.argb = "cc333333"` in a `labelStyle` element
- **THEN** the resulting `font.color` MUST be `#333333` and `style.opacity` MUST be `0.80`

#### Scenario: ARGB extraction applies to border colors
- **WHEN** parser encounters `borderColor.argb = "ffcccccc"` in a `borderStyle` element
- **THEN** the resulting `border.color` MUST be `#cccccc` and border style MUST use the extracted color correctly

### Requirement: RP builder filters image resources by path prefix
The F3 handler in the service worker SHALL filter ZIP file entries by the `resources/images/` path prefix when extracting image resources, rather than using `zip.folder().files`.

#### Scenario: Correct image extraction
- **WHEN** F3 handler processes a .rp ZIP containing `document.xml`, `notes.xml`, and `resources/images/img_001.png`
- **THEN** only `resources/images/img_001.png` MUST be extracted as an image resource; `document.xml` and `notes.xml` MUST NOT appear in the images dictionary

#### Scenario: Nested resource directories ignored
- **WHEN** the .rp ZIP contains `resources/images/sub/img_002.png`
- **THEN** `img_002.png` MUST be correctly extracted (the path prefix filter includes it)

### Requirement: offscreen.js clears timeout timer on iframe load complete
The `renderHtml` function in `offscreen.js` SHALL clear the 30-second timeout timer when the iframe's `onload` or `onerror` event fires.

#### Scenario: Timeout cleared on successful load
- **WHEN** the iframe fires `onload` and the DOM extraction completes successfully
- **THEN** the timeout timer MUST be cleared via `clearTimeout`, and no "iframe 渲染超时" error MUST appear in subsequent logs

#### Scenario: Timeout cleared on load error
- **WHEN** the iframe fires `onerror`
- **THEN** the timeout timer MUST be cleared via `clearTimeout`, and the Promise MUST reject with "iframe 加载失败"

## ADDED Requirements

### Requirement: Content script sendMessage retries on failure
The content script SHALL wrap `chrome.runtime.sendMessage` calls in a retry mechanism that re-attempts sending on Promise rejection, up to 3 total attempts with 200ms delay between retries.

#### Scenario: Successful send on first attempt
- **WHEN** content script calls `send({ type: 'CAPTURE_RESULT', payload: result })` and SW is running
- **THEN** the message MUST be delivered on the first attempt, and no retry occurs

#### Scenario: Retry after SW termination
- **WHEN** content script calls `send()` and the first attempt fails because SW was terminated, but SW restarts before the second attempt
- **THEN** the message MUST be delivered on the second or third attempt (within 400ms total)

#### Scenario: All retries exhausted
- **WHEN** content script calls `send()` and all 3 attempts fail
- **THEN** the failure MUST be silently ignored (no unhandled rejection), and popup's converting lock may remain — acceptable because this edge case requires SW to be unreachable for 400ms+

### Requirement: Content script uses uniform retry wrapper for all messages
The content script SHALL use a single `send()` helper function that wraps `chrome.runtime.sendMessage` with retry logic for both `CAPTURE_RESULT` and `ERROR` messages.

#### Scenario: Error message also gets retry
- **WHEN** content script catches a DOM extraction error and calls `send({ type: 'ERROR', ... })`
- **THEN** the error message MUST also be sent with retry logic through the same `send()` helper

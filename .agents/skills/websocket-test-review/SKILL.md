---
name: websocket-test-review
description: Review changes to the WebSocket client for lifecycle correctness, reconnect behavior, timer cleanup, stale socket events, queue bounds, FIFO ordering, message loss, and missing race-condition tests.
---

# WebSocket test review

For each behavior change:

- Identify the externally observable contract.
- Identify relevant boundary states.
- Look for async races.
- Check whether timers need fake timers.
- Check whether stale socket instances are exercised.
- Verify the test fails when the protection is removed.
- Avoid tests coupled to private implementation details.

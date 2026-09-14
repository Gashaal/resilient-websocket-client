---
name: websocket-reliability-review
description: Review changes to the WebSocket client for lifecycle correctness, reconnect behavior, timer cleanup, stale socket events, queue bounds, FIFO ordering, message loss, and missing race-condition tests.
---

# WebSocket reliability review

Check the current WebSocket client changes for:

- stale socket events affecting the active connection
- duplicate reconnect timers
- reconnect after manual close
- incorrect reconnect attempt accounting
- broken exponential backoff
- queue overflow
- message loss during queue flushing
- incorrect FIFO behavior
- timers that are not cleaned up
- missing boundary/race-condition tests
